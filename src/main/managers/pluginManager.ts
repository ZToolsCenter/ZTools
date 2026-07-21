import { BrowserWindow, session, shell, WebContents, WebContentsView } from 'electron'
import fsSync from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import hideWindowHtml from '../../../resources/hideWindow.html?asset'

import mainPreload from '../../../resources/preload.js?asset'
import api from '../api'
import { WINDOW_INITIAL_HEIGHT, WINDOW_DEFAULT_HEIGHT, WINDOW_WIDTH } from '../common/constants'
import detachedWindowManager, { DETACHED_TITLEBAR_HEIGHT } from '../core/detachedWindowManager'
import { GLOBAL_SCROLLBAR_CSS } from '../core/globalStyles'
import {
  CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY,
  canPluginUseInternalApi,
  isBundledInternalPlugin,
  normalizeCustomInternalApiPluginNames
} from '../core/internalPlugins'
import { getInternalPluginUrl, getInternalPluginServerPort } from '../core/internalPluginServer'
import pluginWindowManager from '../core/pluginWindowManager'
import { registerIconProtocolForSession } from '../core/iconProtocol'
import lmdbInstance from '../core/lmdb/lmdbInstance'
import databaseAPI from '../api/shared/database'
import proxyManager from './proxyManager'
import {
  EnterPayload,
  PluginAssemblyCoordinator,
  type AssemblySession
} from './pluginAssemblyCoordinator'
import devToolsShortcut, { getDevToolsMode } from '../utils/devToolsShortcut'
import windowManager from './windowManager'
import {
  getDetachedWindowSizeKey,
  getPluginDataPrefix,
  getPluginSessionPartition
} from '../../shared/pluginRuntimeNamespace'

console.log('[Plugin] mainPreload', mainPreload)

const PLUGIN_OUT_GRACE_MS = 200

/**
 * 为插件视图注册外部链接拦截器
 * 同源 http/https 导航保留在插件内部，跨源链接使用系统默认浏览器打开，避免开发中插件热更新导致错误地在浏览器打开
 */
export function registerExternalLinkInterceptor(webContents: WebContents): void {
  const isHttpUrl = (url: string): boolean =>
    url.startsWith('http://') || url.startsWith('https://')

  const isSameHttpOrigin = (currentUrl: string, targetUrl: string): boolean => {
    if (!isHttpUrl(currentUrl) || !isHttpUrl(targetUrl)) return false

    try {
      return new URL(currentUrl).origin === new URL(targetUrl).origin
    } catch {
      return false
    }
  }

  // 拦截插件内部的页面跳转（如 <a href="..."> 点击）
  webContents.on('will-navigate', (event, url) => {
    const currentUrl = webContents.getURL()
    if (isHttpUrl(url) && !isSameHttpOrigin(currentUrl, url)) {
      event.preventDefault()
      console.log('[Plugin] 拦截跨源页面跳转，使用默认浏览器打开:', {
        from: currentUrl,
        to: url
      })
      shell.openExternal(url)
    }
  })

  // 拦截 target="_blank" 或 window.open 打开的链接，统一交给系统默认浏览器
  webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      console.log('[Plugin] 拦截新窗口打开，使用默认浏览器打开:', url)
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
}

interface PluginViewInfo {
  path: string
  name: string
  view: WebContentsView
  height?: number
  subInputPlaceholder?: string
  subInputValue?: string // 搜索框的值
  subInputVisible?: boolean // 子输入框是否可见
  logo?: string
  isDevelopment?: boolean
  backgroundRunning?: boolean // plugin.json pluginSetting.backgroundRunning，后台不节流
  single?: boolean // plugin.json pluginSetting.single, true/默认 = 单例不可多开, false = 允许多开
}

interface PluginLastEnterState {
  featureCode: string
  cmdType: string
}

export class PluginManager {
  // ==================== 插件配置/视图创建辅助方法 ====================

  /**
   * 从数据库查询插件信息
   */
  private fetchPluginInfoFromDB(pluginPath: string): any {
    try {
      const plugins = api.dbGet('plugins')
      if (plugins && Array.isArray(plugins)) {
        return plugins.find((p: any) => p.path === pluginPath) || null
      }
    } catch (error) {
      console.error('[Plugin] 查询插件信息失败:', error)
    }
    return null
  }

  /**
   * 读取 plugin.json 配置
   */
  private readPluginConfig(pluginPath: string): any {
    const pluginJsonPath = path.join(pluginPath, 'plugin.json')
    return JSON.parse(fsSync.readFileSync(pluginJsonPath, 'utf-8'))
  }

  /**
   * 判断指定 feature 是否设置了 mainHide
   * 同时检查 plugin.json 静态配置和数据库中的动态指令
   */
  private isFeatureMainHide(pluginPath: string, featureCode: string): boolean {
    try {
      // 1. 检查 plugin.json 中的静态 features
      const pluginConfig = this.readPluginConfig(pluginPath)
      const staticFeature = pluginConfig.features?.find((f: any) => f.code === featureCode)
      if (staticFeature?.mainHide === true) return true

      // 2. 检查数据库中的动态 features
      const pluginInfoFromDB = this.fetchPluginInfoFromDB(pluginPath)
      const effectiveName = pluginInfoFromDB?.name || pluginConfig.name
      if (effectiveName) {
        const doc = lmdbInstance.get(`${getPluginDataPrefix(effectiveName)}dynamic-features`)
        if (doc?.data) {
          const dynamicFeatures = JSON.parse(doc.data).features || []
          const dynamicFeature = dynamicFeatures.find((f: any) => f.code === featureCode)
          if (dynamicFeature?.mainHide === true) return true
        }
      }

      return false
    } catch {
      return false
    }
  }

  /**
   * 判断插件是否允许多开（pluginSetting.single 默认/true = 不可多开, false = 允许多开）
   */
  private isPluginMultiOpenAllowed(pluginPath: string): boolean {
    const cached = this.pluginViews.find((v) => v.path === pluginPath)
    if (cached) return cached.single === false
    try {
      const pluginConfig = this.readPluginConfig(pluginPath)
      return pluginConfig.pluginSetting?.single === false
    } catch {
      return false
    }
  }

  /**
   * 构建插件 logo 的 file:// URL
   */
  private buildPluginLogoUrl(pluginPath: string, logoRelPath?: string): string {
    return logoRelPath ? pathToFileURL(path.join(pluginPath, logoRelPath)).href : ''
  }

  /**
   * 解析插件入口 URL
   * @returns pluginUrl（字符串）以及是否无界面插件
   */
  private resolvePluginUrl(
    pluginPath: string,
    pluginConfig: any,
    isDevelopment: boolean
  ): { pluginUrl: string; isConfigHeadless: boolean } {
    const isConfigHeadless = !pluginConfig.main

    if (isConfigHeadless) {
      console.log('[Plugin] 检测到无界面插件(Config):', pluginConfig.name)
      return { pluginUrl: pathToFileURL(hideWindowHtml).href, isConfigHeadless }
    }
    if (isDevelopment && pluginConfig.development?.main) {
      console.log('[Plugin] 开发中插件，使用 development.main:', pluginConfig.development.main)
      return { pluginUrl: pluginConfig.development.main, isConfigHeadless }
    }
    if (pluginConfig.main.startsWith('http')) {
      console.log('[Plugin] 网络插件:', pluginConfig.main)
      return { pluginUrl: pluginConfig.main, isConfigHeadless }
    }
    // 生产环境内置插件：使用本地 HTTP server 加载（避免 file:// 下的 CSP 限制）
    if (isBundledInternalPlugin(pluginConfig.name) && getInternalPluginServerPort() > 0) {
      const httpUrl = getInternalPluginUrl(pluginConfig.name, pluginConfig.main)
      console.log('[Plugin] 内置插件使用 HTTP server:', httpUrl)
      return { pluginUrl: httpUrl, isConfigHeadless }
    }
    return {
      pluginUrl: pathToFileURL(path.join(pluginPath, pluginConfig.main)).href,
      isConfigHeadless
    }
  }

  /**
   * 创建并配置插件的 session（注册 preload、代理、图标协议）
   */
  private async setupPluginSession(
    pluginName: string,
    pluginPath: string
  ): Promise<Electron.Session> {
    const partition = getPluginSessionPartition(pluginName)
    console.log('[Plugin] 设置插件 Session:', {
      pluginName,
      pluginPath,
      partition
    })
    const sess = session.fromPartition(partition)
    sess.registerPreloadScript({ type: 'frame', filePath: mainPreload })
    await proxyManager.applyProxyToSession(sess, `插件 ${pluginName}`)
    if (isBundledInternalPlugin(pluginName)) {
      registerIconProtocolForSession(sess)
    }
    return sess
  }

  /**
   * 创建插件的 WebContentsView 实例
   */
  private createPluginWebContentsView(
    sess: Electron.Session,
    preloadPath?: string
  ): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: false,
        nodeIntegration: false,
        webSecurity: false,
        sandbox: false,
        allowRunningInsecureContent: true,
        webviewTag: true,
        preload: preloadPath,
        session: sess,
        defaultFontSize: 14
      }
    })
    view.setBackgroundColor('#00000000')
    return view
  }

  /**
   * 按插件后台运行策略设置 WebContents 节流
   * @param view 插件视图
   * @param pluginPath 插件路径（用于读取缓存中的 backgroundRunning 配置）
   * @param hidden true=视图处于后台/隐藏态；false=视图处于前台展示态
   */
  private applyBackgroundThrottlingByPolicy(
    view: WebContentsView,
    pluginPath: string | null | undefined,
    hidden: boolean
  ): void {
    if (view.webContents.isDestroyed()) return

    // 前台展示时始终关闭节流，保证交互响应
    if (!hidden) {
      view.webContents.backgroundThrottling = false
      return
    }

    // 后台态：仅当插件声明 backgroundRunning=true 时保持不节流
    const backgroundRunning =
      !!pluginPath && !!this.pluginViews.find((v) => v.path === pluginPath)?.backgroundRunning
    view.webContents.backgroundThrottling = !backgroundRunning
  }

  /**
   * 通知渲染进程：插件已打开
   */
  private sendPluginOpenedEvent(
    pluginConfig: any,
    pluginPath: string,
    logoUrl: string,
    cmdName: string,
    subInputPlaceholder: string,
    subInputVisible: boolean
  ): void {
    this.mainWindow?.webContents.send('plugin-opened', {
      name: pluginConfig.name,
      title: pluginConfig.title || pluginConfig.name,
      logo: logoUrl,
      path: pluginPath,
      cmdName,
      subInputPlaceholder,
      subInputVisible
    })
  }

  /**
   * 通知渲染进程：插件页面已加载完成
   */
  private sendPluginLoadedEvent(pluginName: string, pluginPath: string): void {
    this.mainWindow?.webContents.send('plugin-loaded', {
      name: pluginName,
      path: pluginPath
    })
  }
  private mainWindow: BrowserWindow | null = null
  private pluginView: WebContentsView | null = null
  private currentPluginPath: string | null = null
  private pluginViews: Array<PluginViewInfo> = []
  private assemblyCoordinator = new PluginAssemblyCoordinator()
  // 记录最近一次插件 ESC 触发的时间，用于短时间内抑制主窗口 hide
  private lastPluginEscTime: number | null = null
  // 插件默认高度（可配置）
  private pluginDefaultHeight: number = WINDOW_DEFAULT_HEIGHT - WINDOW_INITIAL_HEIGHT
  // 跟踪每个插件上次进入的状态（用于单例重入判断）
  private pluginLastEnterState: Map<string, PluginLastEnterState> = new Map()

  /**
   * 获取插件默认高度
   */
  public getPluginDefaultHeight(): number {
    return this.pluginDefaultHeight
  }

  /**
   * 设置插件默认高度
   */
  public setPluginDefaultHeight(height: number): void {
    this.pluginDefaultHeight = Math.max(200, height) // 最小 200px
  }

  /**
   * 判断是否跳过重入（同文本指令 + 同 featureCode → true）
   */
  private shouldSkipReEnter(pluginPath: string, featureCode: string): boolean {
    const lastState = this.pluginLastEnterState.get(pluginPath)
    if (!lastState) return false
    const currentCmdType = api.getLaunchParam()?.type || 'text'
    return (
      lastState.cmdType === 'text' &&
      currentCmdType === 'text' &&
      lastState.featureCode === featureCode
    )
  }

  /**
   * 记录插件进入状态（用于单例重入判断）
   */
  private recordEnterState(pluginPath: string, featureCode: string): void {
    const cmdType = api.getLaunchParam()?.type || 'text'
    this.pluginLastEnterState.set(pluginPath, { featureCode, cmdType })
  }

  /**
   * 复用已存在的分离窗口单例插件。
   * 必须在主窗口切换/隐藏当前插件之前调用，避免“只是聚焦已有分离窗口”却误退主窗口当前插件。
   */
  public async reuseDetachedSingletonIfExists(
    pluginPath: string,
    featureCode: string,
    source: 'main-window' | 'detached-window' | 'launch-precheck'
  ): Promise<boolean> {
    if (this.isPluginMultiOpenAllowed(pluginPath)) {
      return false
    }

    const detachedView = detachedWindowManager.getViewByPlugin(pluginPath)
    if (!detachedView) {
      return false
    }

    console.log('[Plugin] 复用已存在的分离窗口单例插件:', {
      pluginPath,
      featureCode,
      source
    })
    detachedWindowManager.focusByPlugin(pluginPath)

    if (!this.shouldSkipReEnter(pluginPath, featureCode)) {
      console.log('[Plugin] 分离窗口单例重入，触发 onPluginEnter:', {
        pluginPath,
        featureCode,
        source
      })
      const enterPayload = this.assemblyCoordinator.buildEnterPayload(
        api.getLaunchParam() as EnterPayload
      )
      await this.assemblyCoordinator.dispatchLifecycleEvent(
        detachedView,
        'PluginEnter',
        enterPayload
      )
      this.recordEnterState(pluginPath, featureCode)
    } else {
      console.log('[Plugin] 分离窗口单例同文本指令重入，仅聚焦:', {
        pluginPath,
        featureCode,
        source
      })
    }

    return true
  }

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  // 创建或更新插件视图
  public async createPluginView(
    pluginPath: string,
    featureCode: string,
    cmdName?: string
  ): Promise<void> {
    if (!this.mainWindow) return

    // 先尝试复用已存在的分离窗口单例插件，再决定是否切走主窗口当前插件。
    // 这里顺序不能后置，否则设置页等主窗口插件入口会先被 hide，再发现目标其实只需要聚焦已有分离窗口。
    if (
      this.currentPluginPath !== pluginPath &&
      (await this.reuseDetachedSingletonIfExists(pluginPath, featureCode, 'main-window'))
    ) {
      return
    }

    // 先处理当前视图切换，再开始新装配会话，避免 hidePluginView 误中断新会话
    if (this.currentPluginPath != null && this.currentPluginPath !== pluginPath) {
      this.assemblyCoordinator.trace('hide-current-plugin-before-switch', {
        pluginPath,
        featureCode,
        currentPluginPath: this.currentPluginPath
      })
      this.hidePluginView()
    }

    const assembly = this.assemblyCoordinator.beginAssembly(pluginPath, featureCode)

    console.log('[Plugin] 准备加载插件:', { assemblyId: assembly.id, pluginPath, featureCode })
    this.assemblyCoordinator.trace('create-plugin-view-enter', {
      assemblyId: assembly.id,
      pluginPath,
      featureCode,
      currentPluginPath: this.currentPluginPath
    })

    const pluginInfoFromDB = this.fetchPluginInfoFromDB(pluginPath)

    // 如果当前插件就是这个插件，直接返回
    if (this.currentPluginPath === pluginPath) {
      const cached = this.pluginViews.find((v) => v.path === pluginPath)
      if (cached) {
        // 单例重入：同文本指令 + 同 featureCode → 仅保持当前状态，不重新触发
        if (this.shouldSkipReEnter(pluginPath, featureCode)) {
          console.log('[Plugin] 同文本指令重入，跳过 onPluginEnter:', { pluginPath, featureCode })
          this.assemblyCoordinator.abortCurrentSession('singleton-skip-reenter')
          return
        }
        this.assemblyCoordinator.trace('reuse-current-plugin-view', {
          assemblyId: assembly.id,
          pluginPath,
          featureCode
        })
        await this.processPluginMode(pluginPath, featureCode, cached.view, assembly)
      }
      return
    }

    // 先尝试从缓存中复用已有视图
    const cached = this.pluginViews.find((v) => v.path === pluginPath)
    if (cached) {
      this.assemblyCoordinator.trace('restore-cached-plugin-view', {
        assemblyId: assembly.id,
        pluginPath,
        featureCode
      })
      await this.restoreCachedPluginView(
        cached,
        pluginPath,
        pluginInfoFromDB,
        featureCode,
        cmdName,
        assembly
      )
      return
    }

    // 缓存未命中，创建新的插件视图
    this.assemblyCoordinator.trace('create-new-plugin-view', {
      assemblyId: assembly.id,
      pluginPath,
      featureCode
    })
    await this.createNewPluginView(pluginPath, pluginInfoFromDB, featureCode, cmdName, assembly)
  }

  /**
   * 恢复缓存的插件视图
   */
  private async restoreCachedPluginView(
    cached: PluginViewInfo,
    pluginPath: string,
    pluginInfoFromDB: any,
    featureCode: string,
    cmdName?: string,
    assembly?: AssemblySession
  ): Promise<void> {
    if (!this.mainWindow) return
    this.assemblyCoordinator.trace('restore-cached-start', {
      assemblyId: assembly?.id,
      pluginPath,
      featureCode
    })

    // 使用局部变量持有视图引用。
    // 关键：延迟设置 this.pluginView，直到所有 async 操作完成。
    // 这样在 await 期间若 hidePluginView() 被竞态调用（focus-search → hidePlugin IPC），
    // 因 this.pluginView 仍为 null，守卫条件不通过，装配会话不会被误中断。
    const view = cached.view
    this.mainWindow.contentView.addChildView(view)

    // 恢复显示时关闭节流
    this.applyBackgroundThrottlingByPolicy(view, pluginPath, false)

    const mode = await this.getPluginMode(view.webContents, featureCode)

    // await 之后检查装配会话是否仍然有效
    if (assembly && !this.assemblyCoordinator.isActiveSession(assembly)) {
      console.log('[Plugin] 装配会话在 getPluginMode 期间被中断，跳过后续恢复:', pluginPath)
      this.mainWindow.contentView.removeChildView(view)
      return
    }

    // === 所有 async 操作完成，提交状态 ===
    this.pluginView = view
    this.currentPluginPath = pluginPath

    console.log('[Plugin] 插件视图获取焦点')
    view.webContents.focus()

    // 恢复之前的高度或使用默认高度
    const isConfigHeadless = !pluginInfoFromDB?.main
    if (isConfigHeadless) {
      this.setExpendHeight(0, false)
    } else if (mode === 'list') {
      // list 模式先收起，等待 preload 根据列表内容重新设置高度，避免复用旧高度闪烁
      this.setExpendHeight(0, false)
    } else if (this.isFeatureMainHide(pluginPath, featureCode)) {
      // mainHide 的 feature 不需要展示主界面，高度设为 0 避免闪烁
      this.setExpendHeight(0, false)
    } else {
      this.setExpendHeight(cached.height || this.pluginDefaultHeight, false)
    }

    // 读取插件配置并通知渲染进程
    try {
      const pluginConfig = this.readPluginConfig(pluginPath)
      const logoUrl = this.buildPluginLogoUrl(pluginPath, pluginConfig.logo)

      this.sendPluginOpenedEvent(
        pluginConfig,
        pluginPath,
        logoUrl,
        cmdName || '',
        cached.subInputPlaceholder || '搜索',
        cached.subInputVisible !== undefined ? cached.subInputVisible : false
      )
      this.sendPluginLoadedEvent(pluginConfig.name, pluginPath)
    } catch (error) {
      console.error('[Plugin] 读取插件配置失败:', error)
    }

    console.log('[Plugin] 复用缓存的 Plugin BrowserView')
    this.assemblyCoordinator.trace('restore-cached-finish', {
      assemblyId: assembly?.id,
      pluginPath,
      featureCode
    })
    await this.processPluginMode(pluginPath, featureCode, view, assembly, mode)

    // 修复部分 Windows 系统重新挂载 WebContentsView 后白屏问题：
    // removeChildView/addChildView 后某些 GPU 驱动下 compositor 不重绘 surface，
    // 通过 bounds 微调 (+1px/-1px) 强制 compositor 重新合成
    this.forceRepaintView(view)
  }

  /**
   * 创建全新的插件视图（缓存未命中时调用）
   */
  private async createNewPluginView(
    pluginPath: string,
    pluginInfoFromDB: any,
    featureCode: string,
    cmdName?: string,
    assembly?: AssemblySession
  ): Promise<void> {
    if (!this.mainWindow) return

    try {
      this.assemblyCoordinator.trace('create-new-view-start', {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode
      })
      // 插件加载时，先将窗口高度设置为 1px，避免节流
      api.resizeWindow(WINDOW_INITIAL_HEIGHT + 1)
      const pluginConfig = this.readPluginConfig(pluginPath)
      const isDevelopment = !!pluginInfoFromDB?.isDevelopment
      const effectiveName = pluginInfoFromDB?.name || pluginConfig.name
      const { pluginUrl } = this.resolvePluginUrl(pluginPath, pluginConfig, isDevelopment)

      const preloadPath = pluginConfig.preload
        ? path.join(pluginPath, pluginConfig.preload)
        : undefined

      const sess = await this.setupPluginSession(effectiveName, pluginPath)
      this.pluginView = this.createPluginWebContentsView(sess, preloadPath)

      // 注册主窗口专属的事件监听
      this.registerMainWindowPluginEvents(this.pluginView, pluginPath)

      this.mainWindow.contentView.addChildView(this.pluginView)

      // 设置初始布局（使用固定宽度常量，避免多显示器 DPI 缩放导致尺寸漂移）
      const windowWidth = WINDOW_WIDTH
      // 设置初始高度为 1px，避免节流
      this.pluginView.setBounds({ x: 0, y: WINDOW_INITIAL_HEIGHT, width: windowWidth, height: 1 })

      // 缓存新创建的视图
      const logoUrl = this.buildPluginLogoUrl(pluginPath, pluginConfig.logo)
      const pluginInfo: PluginViewInfo = {
        path: pluginPath,
        name: effectiveName,
        view: this.pluginView,
        subInputPlaceholder: '搜索',
        subInputVisible: false,
        logo: logoUrl,
        isDevelopment,
        backgroundRunning: !!pluginConfig.pluginSetting?.backgroundRunning,
        single: pluginConfig.pluginSetting?.single
      }
      this.pluginViews.push(pluginInfo)
      this.currentPluginPath = pluginPath

      // 通知渲染进程插件已打开
      this.sendPluginOpenedEvent(
        pluginConfig,
        pluginPath,
        logoUrl,
        cmdName || '',
        pluginInfo.subInputPlaceholder!,
        pluginInfo.subInputVisible!
      )

      const view = this.pluginView
      view.webContents.loadURL(pluginUrl)

      view.webContents.once('dom-ready', async () => {
        this.assemblyCoordinator.markDomReady(view.webContents.id)
        if (assembly && !this.assemblyCoordinator.isActiveSession(assembly)) {
          this.assemblyCoordinator.trace('dom-ready-ignored-inactive-session', {
            assemblyId: assembly.id,
            pluginPath,
            featureCode
          })
          return
        }
        if (assembly) {
          this.assemblyCoordinator.markSessionStatus(assembly, 'domReady')
        }

        view.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS)
        await this.processPluginMode(pluginPath, featureCode, view, assembly)
        this.sendPluginLoadedEvent(effectiveName, pluginPath)
        // 修复 Windows 首次进入插件时的白屏：新建视图同样需要触发重绘
        this.forceRepaintView(view)
        this.assemblyCoordinator.trace('create-new-view-dom-ready-finish', {
          assemblyId: assembly?.id,
          pluginPath,
          featureCode
        })
      })

      console.log('[Plugin] Plugin WebContentsView 已创建并缓存')
      this.assemblyCoordinator.trace('create-new-view-finish', {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode,
        effectiveName
      })
    } catch (error) {
      console.error('[Plugin] 加载插件配置失败:', error)
      this.assemblyCoordinator.trace('create-new-view-error', {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * 为主窗口中运行的插件视图注册事件监听
   * （devtools、焦点、快捷键、进程崩溃等）
   */
  private registerMainWindowPluginEvents(view: WebContentsView, pluginPath: string): void {
    view.webContents.on('devtools-opened', () => {
      console.log('[Plugin] 插件开发者工具已打开')
    })

    view.webContents.on('focus', () => {
      windowManager.updateFocusTarget('plugin')
      if (this.pluginView && !this.pluginView.webContents.isDestroyed()) {
        devToolsShortcut.register(this.pluginView.webContents)
      }
    })

    view.webContents.on('blur', () => {
      devToolsShortcut.unregister()
    })

    // Cmd+D / Ctrl+D 和 Cmd+Q / Ctrl+Q 快捷键
    view.webContents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        (input.key === 'd' || input.key === 'D') &&
        (input.meta || input.control)
      ) {
        event.preventDefault()
        console.log('[Plugin] 插件视图检测到 Cmd+D 快捷键')
        this.detachCurrentPlugin()
      }

      if (
        input.type === 'keyDown' &&
        (input.key === 'q' || input.key === 'Q') &&
        (input.meta || input.control)
      ) {
        const settings = databaseAPI.dbGet('settings-general') || {}
        const isEnabled = settings?.builtinAppShortcutsEnabled?.killPlugin !== false
        if (!isEnabled) {
          // 禁用时不拦截，让按键正常传到渲染进程（供 HotkeyInput 录制）
          return
        }
        event.preventDefault()
        console.log('[Plugin] 插件视图检测到 Cmd+Q 快捷键，终止插件')
        this.killCurrentPlugin()
      }
    })

    // 插件进程崩溃或退出
    view.webContents.on('render-process-gone', (_event, details) => {
      console.log('[Plugin] 插件进程已退出:', {
        pluginPath,
        reason: details.reason,
        exitCode: details.exitCode
      })

      const currentView = this.pluginView
      if (currentView && !currentView.webContents.isDestroyed()) {
        void this.assemblyCoordinator.dispatchLifecycleEvent(currentView, 'PluginOut', true)
      }

      const index = this.pluginViews.findIndex((v) => v.path === pluginPath)
      if (index !== -1) {
        this.assemblyCoordinator.clearDomReady(this.pluginViews[index].view.webContents.id)
        this.pluginViews.splice(index, 1)
        this.pluginLastEnterState.delete(pluginPath)
        console.log('[Plugin] 已从缓存中移除崩溃的插件:', pluginPath)
      }

      if (this.currentPluginPath === pluginPath) {
        this.hidePluginView()
        windowManager.notifyBackToSearch()
        this.currentPluginPath = null
        console.log('[Plugin] 插件崩溃，已返回搜索页面')
      }

      pluginWindowManager.closeByPlugin(pluginPath)
    })

    // 拦截外部链接跳转，使用系统默认浏览器打开
    registerExternalLinkInterceptor(view.webContents)
  }

  // 发送消息到插件
  public sendPluginMessage(eventName: string, data: any): void {
    if (this.pluginView && this.pluginView.webContents) {
      this.pluginView.webContents.send(eventName, data)
    }
  }

  // 隐藏插件视图
  public hidePluginView(): void {
    if (this.pluginView && this.mainWindow) {
      const currentPath = this.currentPluginPath
      const pluginView = this.pluginView
      console.log('[Plugin] 隐藏插件视图:', {
        currentPath,
        hasAssembly: this.assemblyCoordinator.hasCurrentSession()
      })

      // 发送插件退出事件（isKill=false 表示正常退出）
      if (!pluginView.webContents.isDestroyed()) {
        void this.assemblyCoordinator.dispatchLifecycleEvent(pluginView, 'PluginOut', false)
      }

      // 获取插件名称
      const cached = this.pluginViews.find((v) => v.path === currentPath)
      const pluginName = cached?.name

      // 仅移除视图以达到隐藏效果，但保留实例以便复用
      this.mainWindow.contentView.removeChildView(pluginView)
      // 隐藏时按策略决定是否启用节流
      this.applyBackgroundThrottlingByPolicy(pluginView, currentPath, true)
      console.log('[Plugin] Plugin WebContentsView 已隐藏，缓存保留')

      // 将当前引用清空，但缓存仍保留
      this.pluginView = null
      this.currentPluginPath = null
      this.assemblyCoordinator.abortCurrentSession('hide-view-abort-assembly')
      this.assemblyCoordinator.clearCurrentSession()

      // 通知渲染进程插件已关闭
      this.mainWindow.webContents.send('plugin-closed')

      // 检查是否需要终止插件
      if (pluginName && currentPath) {
        if (pluginWindowManager.hasWindowsByPlugin(currentPath)) {
          console.log(`[Plugin] 插件 ${pluginName} 还有打开的子窗口，暂不终止进程`)
        } else {
          this.checkAndKillPlugin(pluginName, currentPath)
        }
      }
    }
  }

  // 检查并终止插件
  private checkAndKillPlugin(pluginName: string, pluginPath: string): void {
    try {
      const data = api.dbGet('out-kill-plugin')
      if (Array.isArray(data) && data.includes(pluginName)) {
        console.log(`插件 ${pluginName} 配置为退出后立即结束，销毁 view`)
        this.killPlugin(pluginPath)
      }
    } catch (error) {
      console.log('[Plugin] 读取 outKillPlugin 配置失败:', error)
    }
  }

  /**
   * 主窗口渲染进程刷新时，仅将当前插件视图从 contentView 移除（不发送生命周期事件、不销毁）。
   * 避免渲染进程状态重置后与插件视图产生叠层问题。
   */
  public detachPluginViewOnRefresh(): void {
    if (!this.pluginView || !this.mainWindow) return
    const pluginView = this.pluginView
    console.log('[Plugin] 检测到主渲染进程刷新，移除当前插件视图以防叠层:', this.currentPluginPath)
    this.mainWindow.contentView.removeChildView(pluginView)
    this.pluginView = null
    this.currentPluginPath = null
    this.assemblyCoordinator.abortCurrentSession('renderer-refresh-abort-assembly')
    this.assemblyCoordinator.clearCurrentSession()
  }

  // 获取当前加载的插件路径
  public getCurrentPluginPath(): string | null {
    return this.currentPluginPath
  }

  // 获取当前加载的插件视图
  public getCurrentPluginView(): WebContentsView | null {
    return this.pluginView
  }

  /**
   * 在主窗口显示时按需恢复当前插件视图高度。
   * mainHide feature 在启动阶段会先把高度压成 0，后续若通过 showWindow 唤起主窗口，
   * 需要把插件视图恢复到缓存高度或默认高度。
   */
  public restoreCurrentPluginViewHeightOnWindowShow(): void {
    if (!this.mainWindow || !this.pluginView || !this.currentPluginPath) {
      return
    }

    const lastState = this.pluginLastEnterState.get(this.currentPluginPath)
    if (!lastState) return

    if (!this.isFeatureMainHide(this.currentPluginPath, lastState.featureCode)) {
      return
    }

    const bounds = this.pluginView.getBounds()
    if (bounds.height > 0) {
      return
    }

    const cached = this.pluginViews.find((v) => v.path === this.currentPluginPath)
    const targetHeight =
      cached?.height && cached.height > 0 ? cached.height : this.pluginDefaultHeight

    console.log('[Plugin] showWindow 时恢复 mainHide 插件高度:', targetHeight)
    this.setExpendHeight(targetHeight, true)
    this.forceRepaintView(this.pluginView)
  }

  public focusPluginView(): void {
    if (this.pluginView && this.pluginView.webContents) {
      console.log('[Plugin] 插件视图获取焦点')
      this.pluginView.webContents.focus()
    }
  }

  /**
   * 检查插件 WebContentsView 是否当前北有焦点
   * 供 Linux blur 事件处理器判断是否是应用内部焦点转移
   */
  public isPluginViewFocused(): boolean {
    if (!this.pluginView || this.pluginView.webContents.isDestroyed()) {
      return false
    }
    return this.pluginView.webContents.isFocused()
  }

  /**
   * 后台预加载插件（不显示在主窗口中，仅创建 WebContentsView 并缓存）
   * 用于"跟随主程序同时启动运行"功能
   */
  public async preloadPlugin(pluginPath: string): Promise<void> {
    if (!this.mainWindow) return

    // 如果已经在缓存中，跳过
    const existing = this.pluginViews.find((v) => v.path === pluginPath)
    if (existing) {
      console.log('[Plugin] 插件已在运行中，跳过预加载:', pluginPath)
      return
    }

    try {
      console.log('[Plugin] 开始后台预加载插件:', { pluginPath })
      const pluginInfoFromDB = this.fetchPluginInfoFromDB(pluginPath)
      const pluginConfig = this.readPluginConfig(pluginPath)
      const isDevelopment = !!pluginInfoFromDB?.isDevelopment
      const effectiveName = pluginInfoFromDB?.name || pluginConfig.name
      const { pluginUrl } = this.resolvePluginUrl(pluginPath, pluginConfig, isDevelopment)

      const preloadPath = pluginConfig.preload
        ? path.join(pluginPath, pluginConfig.preload)
        : undefined

      const sess = await this.setupPluginSession(effectiveName, pluginPath)
      const view = this.createPluginWebContentsView(sess, preloadPath)

      // 注册事件监听
      this.registerMainWindowPluginEvents(view, pluginPath)

      // 缓存视图（但不添加到主窗口、不设为当前插件）
      const logoUrl = this.buildPluginLogoUrl(pluginPath, pluginConfig.logo)
      const pluginInfo: PluginViewInfo = {
        path: pluginPath,
        name: effectiveName,
        view,
        subInputPlaceholder: '搜索',
        subInputVisible: false,
        logo: logoUrl,
        isDevelopment,
        backgroundRunning: !!pluginConfig.pluginSetting?.backgroundRunning,
        single: pluginConfig.pluginSetting?.single
      }
      this.pluginViews.push(pluginInfo)

      // 预加载后视图处于后台态，按策略设置节流（默认启用，backgroundRunning=true 例外）
      this.applyBackgroundThrottlingByPolicy(view, pluginPath, true)

      // 加载插件 URL
      view.webContents.loadURL(pluginUrl)

      view.webContents.once('dom-ready', () => {
        this.assemblyCoordinator.markDomReady(view.webContents.id)
        view.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS)
        console.log('[Plugin] 后台预加载插件完成:', {
          pluginName: effectiveName,
          pluginPath,
          webContentsId: view.webContents.id
        })
      })

      console.log('[Plugin] 后台预加载插件:', {
        pluginName: effectiveName,
        pluginPath
      })
    } catch (error) {
      console.error('[Plugin] 后台预加载插件失败:', pluginPath, error)
    }
  }

  // 获取所有运行中的插件路径（包括分离窗口中的插件）
  public getRunningPlugins(): string[] {
    const mainWindowPlugins = this.pluginViews.map((v) => v.path)
    const detachedPlugins = detachedWindowManager.getAllWindows().map((w) => w.pluginPath)
    return [...new Set([...mainWindowPlugins, ...detachedPlugins])]
  }

  // 获取所有运行中的插件信息（包括分离窗口中的插件）
  public getRunningPluginsInfo(): Array<{ path: string; name: string }> {
    const mainWindowPlugins = this.pluginViews.map((v) => ({ path: v.path, name: v.name }))
    const detachedPlugins = detachedWindowManager
      .getAllWindows()
      .map((w) => ({ path: w.pluginPath, name: w.pluginName }))
    const seen = new Set<string>()
    return [...mainWindowPlugins, ...detachedPlugins].filter((p) => {
      if (seen.has(p.path)) return false
      seen.add(p.path)
      return true
    })
  }

  // 获取所有插件视图
  public getAllPluginViews(): Array<PluginViewInfo> {
    return this.pluginViews
  }

  // 通过 webContents 查找插件名称
  public getPluginNameByWebContents(webContents: any): string | null {
    const plugin = this.pluginViews.find((v) => v.view.webContents === webContents)
    return plugin ? plugin.name : null
  }

  // 终止指定插件（包括分离窗口中的插件）
  public killPlugin(pluginPath: string): boolean {
    try {
      console.log('[Plugin] killPlugin 开始:', { pluginPath })
      const index = this.pluginViews.findIndex((v) => v.path === pluginPath)

      if (index !== -1) {
        // 插件在主窗口中运行
        const { view } = this.pluginViews[index]

        // 发送插件退出事件（isKill=true 表示进程结束），并给 renderer 一个短暂处理窗口。
        this.dispatchPluginOutBeforeClose(view, true)

        // 如果是当前显示的插件，先隐藏
        if (this.currentPluginPath === pluginPath && this.mainWindow) {
          this.mainWindow.contentView.removeChildView(view)
          this.pluginView = null
          this.currentPluginPath = null
          this.assemblyCoordinator.clearCurrentSession()
        }

        // 关闭该插件创建的所有窗口
        pluginWindowManager.closeByPlugin(pluginPath)

        // 从缓存中移除
        this.pluginViews.splice(index, 1)
        this.pluginLastEnterState.delete(pluginPath)

        console.log('[Plugin] 插件已终止:', pluginPath)
        console.log('[Plugin] killPlugin 完成:', {
          pluginPath,
          remainingPlugins: this.pluginViews.length
        })
        return true
      }

      // 插件可能在分离窗口中运行
      const detachedWindows = detachedWindowManager.getAllWindows()
      const isDetached = detachedWindows.some((w) => w.pluginPath === pluginPath)
      if (isDetached) {
        const detachedView = detachedWindowManager.getViewByPlugin(pluginPath)
        if (detachedView && !detachedView.webContents.isDestroyed()) {
          void this.assemblyCoordinator.dispatchLifecycleEvent(detachedView, 'PluginOut', true)
        }
        // 关闭该插件创建的所有独立窗口
        pluginWindowManager.closeByPlugin(pluginPath)
        // 关闭分离窗口（内部会销毁 webContents）
        setTimeout(() => {
          detachedWindowManager.closeByPlugin(pluginPath)
        }, PLUGIN_OUT_GRACE_MS)
        this.pluginLastEnterState.delete(pluginPath)
        console.log('[Plugin] 分离窗口插件已终止:', pluginPath)
        return true
      }

      console.log('[Plugin] 插件未运行:', pluginPath)
      return false
    } catch (error) {
      console.error('[Plugin] 终止插件失败:', error)
      return false
    }
  }

  // 通过插件名称终止插件
  public killPluginByName(pluginName: string): boolean {
    const plugin = this.pluginViews.find((v) => v.name === pluginName)
    if (plugin) {
      return this.killPlugin(plugin.path)
    }
    // 查找分离窗口中的插件
    const detachedWindow = detachedWindowManager
      .getAllWindows()
      .find((w) => w.pluginName === pluginName)
    if (detachedWindow) {
      return this.killPlugin(detachedWindow.pluginPath)
    }
    console.log('[Plugin] 未找到插件:', pluginName)
    return false
  }

  // 终止所有插件（包括分离窗口中的插件）
  public killAllPlugins(): void {
    console.log('[Plugin] killAllPlugins 开始:', { total: this.pluginViews.length })
    for (const { view, path } of this.pluginViews) {
      try {
        // 发送插件退出事件（isKill=true 表示进程结束）
        this.dispatchPluginOutBeforeClose(view, true)
        // 关闭该插件创建的所有窗口
        pluginWindowManager.closeByPlugin(path)
        console.log('[Plugin] 插件已终止:', path)
      } catch (error) {
        console.error('[Plugin] 终止插件失败:', path, error)
      }
    }

    if (this.mainWindow && this.pluginView) {
      this.mainWindow.contentView.removeChildView(this.pluginView)
    }

    this.pluginViews = []
    this.pluginView = null
    this.currentPluginPath = null
    this.assemblyCoordinator.clearCurrentSession()
    this.pluginLastEnterState.clear()

    // 关闭所有分离窗口中的插件
    for (const detachedWindow of detachedWindowManager.getAllWindows()) {
      if (!detachedWindow.view.webContents.isDestroyed()) {
        void this.assemblyCoordinator.dispatchLifecycleEvent(detachedWindow.view, 'PluginOut', true)
      }
    }
    setTimeout(() => {
      detachedWindowManager.closeAll()
    }, PLUGIN_OUT_GRACE_MS)

    console.log('[Plugin] killAllPlugins 完成')
  }

  private dispatchPluginOutBeforeClose(view: WebContentsView, isKill: boolean): void {
    const webContents = view.webContents
    if (webContents.isDestroyed()) return

    const webContentsId = webContents.id
    void this.assemblyCoordinator.dispatchLifecycleEvent(view, 'PluginOut', isKill)
    setTimeout(() => {
      if (!webContents.isDestroyed()) {
        webContents.close()
      }
      this.assemblyCoordinator.clearDomReady(webContentsId)
    }, PLUGIN_OUT_GRACE_MS)
  }

  /**
   * 终止当前插件并返回搜索页面
   * 用于 Cmd+Q / Ctrl+Q 快捷键
   */
  public killCurrentPlugin(): void {
    if (!this.currentPluginPath) {
      console.log('[Plugin] 没有正在运行的插件')
      return
    }

    const pluginPath = this.currentPluginPath

    // 终止插件
    const success = this.killPlugin(pluginPath)

    if (success && this.mainWindow) {
      windowManager.notifyBackToSearch()
      // 主窗口获取焦点
      this.mainWindow.webContents.focus()
      console.log('[Plugin] 已终止插件并返回搜索页面')
    }
  }

  // 发送输入事件到当前插件（统一接口）
  public sendInputEvent(
    event: Electron.MouseInputEvent | Electron.MouseWheelInputEvent | Electron.KeyboardInputEvent
  ): boolean {
    try {
      if (!this.pluginView || this.pluginView.webContents.isDestroyed()) {
        console.log('[Plugin] 没有活动的插件视图')
        return false
      }

      this.pluginView.webContents.sendInputEvent(event)

      console.log('[Plugin] 发送输入事件:', event)
      return true
    } catch (error) {
      console.error('[Plugin] 发送输入事件失败:', error)
      return false
    }
  }

  // 切换当前插件的开发者工具（打开/关闭）
  public async openPluginDevTools(): Promise<boolean> {
    try {
      if (!this.pluginView || this.pluginView.webContents.isDestroyed()) {
        console.log('[Plugin] 没有活动的插件视图')
        return false
      }

      // 检查开发者工具是否已打开
      if (this.pluginView.webContents.isDevToolsOpened()) {
        // 如果已打开，关闭开发者工具
        this.pluginView.webContents.closeDevTools()
        console.log('[Plugin] 已关闭插件开发者工具')
      } else {
        // 如果未打开，打开开发者工具
        const mode = getDevToolsMode()
        this.pluginView.webContents.openDevTools({ mode })
        console.log('[Plugin] 已打开插件开发者工具')
      }
      return true
    } catch (error) {
      console.error('[Plugin] 切换开发者工具失败:', error)
      return false
    }
  }

  /**
   * 强制重绘 WebContentsView（修复部分 Windows 系统白屏问题）
   * 通过 bounds 微调迫使 Chromium compositor 重新合成 surface。
   *
   * 关键：两次 setBounds 必须跨 event loop tick 执行。
   * 若在同一 tick 内同步调用，Chromium compositor 会合并两次操作，
   * 只取最终值在下次 vsync 渲染，+1px 中间状态从未触达 GPU 合成阶段，修复失效。
   * 用 setImmediate 将第二次调用推入下一 tick，使两次变化各自落在不同 vsync 周期，
   * 从而确保第一次 +1px 真正触发 compositor 重绘。
   */
  private forceRepaintView(view: WebContentsView): void {
    if (view.webContents.isDestroyed()) return
    const bounds = view.getBounds()
    if (bounds.height <= 0) return
    view.setBounds({ ...bounds, height: bounds.height + 1 })
    setImmediate(() => {
      if (!view.webContents.isDestroyed()) {
        view.setBounds(bounds)
      }
    })
  }

  /**
   * 强制重绘当前插件视图（供外部调用，如窗口唤醒时）
   */
  public forceRepaintCurrentView(): void {
    if (this.pluginView) {
      this.forceRepaintView(this.pluginView)
    }
  }

  // 设置插件视图高度
  public setExpendHeight(height: number, updateCache: boolean = true): void {
    if (!this.mainWindow || !this.pluginView) return

    console.log('[Plugin] 设置插件高度:', height)

    // 搜索框高度
    const mainContentHeight = WINDOW_INITIAL_HEIGHT
    // 计算总窗口高度
    const totalHeight = height + mainContentHeight

    // 使用固定宽度常量，避免多显示器 DPI 缩放导致 getSize() 返回被缩放的值
    const width = WINDOW_WIDTH

    // 通过 api.resizeWindow 调整主窗口大小
    api.resizeWindow(totalHeight)

    // 调整插件视图大小
    this.pluginView.setBounds({
      x: 0,
      y: mainContentHeight,
      width: width,
      height: height
    })

    // 更新缓存中的高度
    if (updateCache) {
      const cached = this.pluginViews.find((v) => v.view === this.pluginView)
      if (cached) {
        cached.height = height
      }
    }
  }

  // 设置子输入框 placeholder
  public setSubInputPlaceholder(placeholder: string): void {
    if (!this.pluginView) return

    // 更新缓存中的 placeholder
    const cached = this.pluginViews.find((v) => v.view === this.pluginView)
    if (cached) {
      cached.subInputPlaceholder = placeholder
    }
  }

  // 设置子输入框可见性
  public setSubInputVisible(pluginPath: string, visible: boolean): void {
    const cached = this.pluginViews.find((v) => v.path === pluginPath)
    if (cached) {
      cached.subInputVisible = visible
      console.log(`更新插件 ${pluginPath} 的子输入框可见性:`, visible)
    }
  }

  // 设置子输入框值
  public setSubInputValue(value: string): void {
    if (!this.pluginView) return

    // 更新缓存中的值
    const cached = this.pluginViews.find((v) => v.view === this.pluginView)
    if (cached) {
      cached.subInputValue = value
    }
  }

  // 更新插件视图大小（跟随窗口大小变化）
  public updatePluginViewBounds(width: number, height: number): void {
    if (!this.pluginView) return

    const mainContentHeight = WINDOW_INITIAL_HEIGHT
    const viewHeight = height - mainContentHeight

    if (viewHeight > 0) {
      this.pluginView.setBounds({
        x: 0,
        y: mainContentHeight,
        width: width,
        height: viewHeight
      })

      // 更新缓存中的高度
      const cached = this.pluginViews.find((v) => v.view === this.pluginView)
      if (cached) {
        cached.height = viewHeight
      }
    }
  }

  // 获取插件模式
  private getPluginMode(
    webContents: WebContents,
    featureCode: string
  ): Promise<string | undefined> {
    if (webContents.isDestroyed()) return Promise.resolve(undefined)

    const callId = Math.random().toString(36).substring(2, 11)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), 1000) // 1s timeout

      webContents.ipc.once(`plugin-mode-result-${callId}`, (_event, mode) => {
        clearTimeout(timeout)
        resolve(mode)
      })

      webContents.send('get-plugin-mode', { featureCode, callId })
    })
  }

  // ==================== 无界面插件相关方法 ====================

  // 处理插件模式
  private async processPluginMode(
    pluginPath: string,
    featureCode: string,
    view: WebContentsView,
    assembly?: AssemblySession,
    resolvedMode?: string
  ): Promise<void> {
    const mode = resolvedMode ?? (await this.getPluginMode(view.webContents, featureCode))
    console.log('[Plugin] 插件模式:', {
      assemblyId: assembly?.id,
      pluginPath,
      featureCode,
      mode
    })

    if (assembly && !this.assemblyCoordinator.isActiveSession(assembly)) {
      this.assemblyCoordinator.trace('process-mode-skip-inactive-session', {
        assemblyId: assembly.id,
        pluginPath,
        featureCode,
        mode
      })
      return
    }

    // 检查视图是否仍是活动视图
    if (this.pluginView !== view) {
      this.assemblyCoordinator.trace('process-mode-skip-inactive-view', {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode
      })
      return
    }

    if (mode === 'none') {
      // 无界面插件，调用插件方法
      this.setExpendHeight(0, false) // 不更新缓存，保留上次的 UI 高度
      this.callHeadlessPluginMethod(pluginPath, featureCode, api.getLaunchParam())
      this.recordEnterState(pluginPath, featureCode)
      this.assemblyCoordinator.trace('process-mode-headless', {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode
      })
      if (assembly) this.assemblyCoordinator.markSessionStatus(assembly, 'displayed')
    } else if (mode === 'list') {
      // list 模式先收起，等待 preload 渲染完成后再根据内容精确设置高度
      this.setExpendHeight(0, false)

      // 列表模式：在插件的 WebContentsView 内渲染列表 UI
      if (assembly) {
        this.assemblyCoordinator.markSessionStatus(assembly, 'readyToDisplay')
        const ack = await this.assemblyCoordinator.requestRendererAck(this.mainWindow, assembly)
        if (!ack || !this.assemblyCoordinator.isActiveSession(assembly)) return
      }

      // 通知插件的 preload 激活列表模式（preload 会自行渲染 UI、设置子输入框）
      view.webContents.send('activate-list-mode', {
        featureCode,
        action: api.getLaunchParam(),
        pluginPath
      })

      this.recordEnterState(pluginPath, featureCode)
      if (assembly) this.assemblyCoordinator.markSessionStatus(assembly, 'displayed')
    } else {
      if (assembly) {
        this.assemblyCoordinator.markSessionStatus(assembly, 'readyToDisplay')
        const ack = await this.assemblyCoordinator.requestRendererAck(this.mainWindow, assembly)
        this.assemblyCoordinator.trace('process-mode-ack-result', {
          assemblyId: assembly.id,
          pluginPath,
          featureCode,
          ack
        })
        if (!ack || !this.assemblyCoordinator.isActiveSession(assembly)) {
          this.assemblyCoordinator.trace('process-mode-skip-after-ack', {
            assemblyId: assembly.id,
            pluginPath,
            featureCode,
            ack
          })
          return
        }
      }

      // 有界面插件
      // mainHide 的 feature 不需要展示主界面，高度设为 0 避免闪烁
      let targetHeight = 0
      if (this.isFeatureMainHide(pluginPath, featureCode)) {
        this.setExpendHeight(0, false)
        console.log('[Plugin] mainHide feature, 设置高度为 0')
      } else {
        // 恢复高度: 优先使用缓存的高度，如果没有则使用默认高度
        const cached = this.pluginViews.find((v) => v.path === pluginPath)
        targetHeight = cached?.height || this.pluginDefaultHeight

        // 如果目标高度无效（可能被错误置为0），重置为默认值
        if (targetHeight <= 0) targetHeight = this.pluginDefaultHeight

        this.setExpendHeight(targetHeight, true)
      }

      // 让插件视图获取焦点
      view.webContents.focus()
      // 通知插件进入事件
      const enterPayload = this.assemblyCoordinator.buildEnterPayload(
        api.getLaunchParam() as EnterPayload,
        assembly
      )
      await this.assemblyCoordinator.dispatchLifecycleEvent(view, 'PluginReady')
      await this.assemblyCoordinator.dispatchLifecycleEvent(view, 'PluginEnter', enterPayload)
      this.recordEnterState(pluginPath, featureCode)
      this.assemblyCoordinator.trace('process-mode-enter-dispatched', {
        assemblyId: assembly?.id,
        pluginPath,
        featureCode,
        targetHeight,
        enterAssemblyId: enterPayload.__assemblyId,
        enterTs: enterPayload.__ts
      })
      if (assembly) this.assemblyCoordinator.markSessionStatus(assembly, 'displayed')
    }
  }

  /**
   * 调用无界面插件方法
   */
  public callHeadlessPluginMethod(
    pluginPath: string,
    featureCode: string,
    action: any
  ): Promise<any> {
    const plugin = this.pluginViews.find((p) => p.path === pluginPath)
    if (!plugin) {
      throw new Error('Plugin not found')
    }

    if (plugin.view.webContents.isDestroyed()) {
      throw new Error('Plugin view is destroyed')
    }

    console.log('[Plugin] 调用无界面插件方法:', { pluginPath, featureCode, action })

    // 生成唯一的调用 ID
    const callId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    // 创建 Promise 等待结果
    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        reject(new Error('Plugin method call timeout (30s)'))
      }, 30000) // 30秒超时

      // 监听一次性返回结果
      plugin.view.webContents.ipc.once(`plugin-method-result-${callId}`, (_event, result) => {
        clearTimeout(timeout)

        if (result.success) {
          resolve(result.result)
        } else {
          reject(new Error(result.error))
        }
      })

      // 发送调用请求
      plugin.view.webContents.send('call-plugin-method', {
        featureCode,
        action,
        callId
      })
    })
  }

  // ==================== mainPush 相关方法 ====================

  /**
   * 查询插件的 mainPush 回调，获取动态搜索结果
   * 如果插件尚未加载，会先预加载
   */
  public async queryMainPush(
    pluginPath: string,
    _featureCode: string,
    queryData: { code: string; type: string; payload: string }
  ): Promise<any[]> {
    console.log('[Plugin][MainPush] query start:', { pluginPath, queryData })
    // 确保插件已加载
    let plugin = this.pluginViews.find((v) => v.path === pluginPath)
    if (!plugin) {
      console.log('[Plugin][MainPush] plugin not loaded, preload first:', { pluginPath })
      await this.preloadPlugin(pluginPath)
      // 等待 dom-ready（最多 5 秒）
      plugin = this.pluginViews.find((v) => v.path === pluginPath)
      if (plugin && !plugin.view.webContents.isDestroyed()) {
        console.log('[Plugin][MainPush] waiting dom-ready after preload:', { pluginPath })
        await this.assemblyCoordinator.waitForDomReady(plugin.view, 5000)
      }
    }

    if (!plugin || plugin.view.webContents.isDestroyed()) {
      console.warn('[Plugin][MainPush] query aborted: plugin unavailable', { pluginPath })
      return []
    }

    const callId = `mp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 3000) // 3 秒超时

      plugin!.view.webContents.ipc.once(`main-push-result-${callId}`, (_event, result) => {
        clearTimeout(timeout)
        console.log('[Plugin][MainPush] result received:', {
          pluginPath,
          callId,
          success: !!result?.success,
          resultCount: Array.isArray(result?.results) ? result.results.length : 0
        })
        if (result.success && Array.isArray(result.results)) {
          // 处理图标路径：将相对路径转为 file:// URL（保留原始 icon 不变，用 _resolvedIcon 展示）
          const processed = result.results.map((item: any) => {
            if (
              item.icon &&
              !item.icon.startsWith('http') &&
              !item.icon.startsWith('file:') &&
              !item.icon.startsWith('data:')
            ) {
              return {
                ...item,
                _resolvedIcon: pathToFileURL(path.join(pluginPath, item.icon)).href
              }
            }
            return item
          })
          resolve(processed)
        } else {
          resolve([])
        }
      })

      plugin!.view.webContents.send('main-push-query', { queryData, callId })
      console.log('[Plugin][MainPush] query dispatched:', { pluginPath, callId })
    })
  }

  /**
   * 通知插件用户选择了 mainPush 结果
   * @returns 是否需要进入插件界面
   */
  public selectMainPush(
    pluginPath: string,
    _featureCode: string,
    selectData: { code: string; type: string; payload: string; option: any }
  ): Promise<boolean> {
    const plugin = this.pluginViews.find((v) => v.path === pluginPath)
    if (!plugin || plugin.view.webContents.isDestroyed()) {
      return Promise.resolve(false)
    }

    const callId = `mps_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 3000)

      plugin!.view.webContents.ipc.once(`main-push-select-result-${callId}`, (_event, result) => {
        clearTimeout(timeout)
        resolve(result.success && result.shouldEnterPlugin)
      })

      plugin!.view.webContents.send('main-push-select', { selectData, callId })
    })
  }

  // 处理插件按 ESC 键
  public handlePluginEsc(): void {
    // 记录 ESC 触发时间
    this.lastPluginEscTime = Date.now()
    console.log('[Plugin] 插件按下 ESC 键 (Main Process)，返回搜索页面')
    this.hidePluginView()
    windowManager.notifyBackToSearch()
    // 主窗口获取焦点
    this.mainWindow?.webContents.focus()
  }

  /**
   * 在插件 ESC 之后的极短时间内（默认 100ms）抑制主窗口 hide
   */
  public shouldSuppressMainHide(withinMs: number = 100): boolean {
    if (this.lastPluginEscTime == null) return false
    const diff = Date.now() - this.lastPluginEscTime
    if (diff <= withinMs) {
      return true
    }
    return false
  }
  // 检查插件是否处于开发模式
  public isPluginDev(webContentsId: number): boolean {
    // 首先检查是否是插件视图
    const plugin = this.pluginViews.find((v) => v.view.webContents.id === webContentsId)
    if (plugin) {
      return !!plugin.isDevelopment
    }

    // 然后检查是否是插件创建的窗口
    const pluginPath = pluginWindowManager.getPluginPathByWebContentsId(webContentsId)
    if (pluginPath) {
      // 根据插件路径查找对应的插件视图，确认是否处于开发模式
      const pluginView = this.pluginViews.find((v) => v.path === pluginPath)
      return !!pluginView?.isDevelopment
    }

    return false
  }

  /**
   * 读取分离窗口的上次尺寸（按插件名记录）
   */
  private getStoredDetachedSize(pluginName: string): { width: number; height: number } | null {
    try {
      const sizes = api.dbGet('detached-window-sizes')
      const sizeKey = getDetachedWindowSizeKey(pluginName)
      if (sizes && typeof sizes === 'object' && !Array.isArray(sizes) && sizes[sizeKey]) {
        const rawSize = sizes[sizeKey]
        const width = Number(rawSize?.width)
        const height = Number(rawSize?.height)

        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          return null
        }

        const clampedWidth = Math.max(400, Math.round(width))
        const clampedHeight = Math.max(300 - DETACHED_TITLEBAR_HEIGHT, Math.round(height))
        return { width: clampedWidth, height: clampedHeight }
      }
    } catch (error) {
      console.error('[Plugin] 读取分离窗口尺寸失败:', error)
    }

    return null
  }

  /**
   * 直接在独立窗口中创建插件（用于自动分离模式）
   * @param pluginPath 插件路径
   * @param featureCode 功能代码
   * @returns 创建结果
   */
  public async createPluginInDetachedWindow(
    pluginPath: string,
    featureCode: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[Plugin] 直接在独立窗口中创建插件:', { pluginPath, featureCode })

      if (await this.reuseDetachedSingletonIfExists(pluginPath, featureCode, 'detached-window')) {
        return { success: true }
      }

      const pluginInfoFromDB = this.fetchPluginInfoFromDB(pluginPath)
      const pluginConfig = this.readPluginConfig(pluginPath)
      const isDevelopment = !!pluginInfoFromDB?.isDevelopment
      const effectiveName = pluginInfoFromDB?.name || pluginConfig.name
      const { pluginUrl, isConfigHeadless } = this.resolvePluginUrl(
        pluginPath,
        pluginConfig,
        isDevelopment
      )

      if (isConfigHeadless) {
        return { success: false, error: '无界面插件不支持在独立窗口中打开' }
      }

      const preloadPath = pluginConfig.preload
        ? path.join(pluginPath, pluginConfig.preload)
        : undefined

      const sess = await this.setupPluginSession(effectiveName, pluginPath)
      const pluginView = this.createPluginWebContentsView(sess, preloadPath)

      // 监听插件进程崩溃或退出
      pluginView.webContents.on('render-process-gone', (_event, details) => {
        console.log('[Plugin] 独立窗口插件进程已退出:', {
          pluginPath,
          reason: details.reason,
          exitCode: details.exitCode
        })
      })

      const storedSize = this.getStoredDetachedSize(effectiveName)
      const windowWidth = storedSize?.width ?? 800
      const viewHeight = storedSize?.height ?? this.pluginDefaultHeight
      const logoUrl = this.buildPluginLogoUrl(pluginPath, pluginConfig.logo)

      const detachedWindow = detachedWindowManager.createDetachedWindow(
        pluginPath,
        effectiveName,
        pluginView,
        {
          width: windowWidth,
          height: viewHeight,
          title: pluginConfig.title || pluginConfig.name,
          logo: logoUrl,
          searchQuery: '',
          searchPlaceholder: '搜索...'
        }
      )

      if (!detachedWindow) {
        if (!pluginView.webContents.isDestroyed()) {
          pluginView.webContents.close()
        }
        return { success: false, error: '创建独立窗口失败' }
      }

      pluginView.webContents.loadURL(pluginUrl)

      pluginView.webContents.on('did-finish-load', () => {
        pluginView.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS)
        const enterPayload = this.assemblyCoordinator.buildEnterPayload(
          api.getLaunchParam() as EnterPayload
        )
        void this.assemblyCoordinator.dispatchLifecycleEvent(
          pluginView,
          'PluginEnter',
          enterPayload
        )
        this.recordEnterState(pluginPath, featureCode)
      })

      console.log('[Plugin] 插件已在独立窗口中创建:', {
        pluginName: effectiveName,
        pluginPath
      })
      return { success: true }
    } catch (error: unknown) {
      console.error('[Plugin] 在独立窗口中创建插件失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      }
    }
  }

  /**
   * 分离当前插件到独立窗口
   * 将当前在主窗口中运行的插件分离到一个独立的窗口中
   */
  public async detachCurrentPlugin(): Promise<{ success: boolean; error?: string }> {
    if (!this.mainWindow || !this.pluginView || !this.currentPluginPath) {
      return { success: false, error: '没有正在运行的插件' }
    }

    try {
      // 获取当前插件信息
      const cached = this.pluginViews.find((v) => v.path === this.currentPluginPath)
      if (!cached) {
        return { success: false, error: '插件信息未找到' }
      }

      // 读取插件配置
      const pluginJsonPath = path.join(this.currentPluginPath, 'plugin.json')
      const pluginConfig = JSON.parse(fsSync.readFileSync(pluginJsonPath, 'utf-8'))

      const storedSize = this.getStoredDetachedSize(cached.name)
      const defaultViewHeight = this.pluginDefaultHeight

      // 若存在历史尺寸则优先使用
      const windowWidth = storedSize?.width ?? 800
      const viewHeight = storedSize?.height ?? cached.height ?? defaultViewHeight

      // 发送插件分离事件（在分离之前通知插件）
      if (!cached.view.webContents.isDestroyed()) {
        void this.assemblyCoordinator.dispatchLifecycleEvent(cached.view, 'PluginDetach')
      }

      // 检测主窗口是否处于焦点状态，且输入框是否处于聚焦状态
      let shouldAutoFocusSubInput = false
      try {
        const isMainWindowFocused = this.mainWindow.webContents.isFocused()
        const isInputFocused = await this.mainWindow.webContents.executeJavaScript(
          'document.activeElement?.classList.contains("search-input")'
        )
        shouldAutoFocusSubInput = isMainWindowFocused && isInputFocused
        console.log('[Plugin] 主窗口聚焦状态:', {
          windowFocused: isMainWindowFocused,
          inputFocused: isInputFocused,
          shouldAutoFocus: shouldAutoFocusSubInput
        })
      } catch (error) {
        console.error('[Plugin] 检测输入框聚焦状态失败:', error)
      }

      // 使用新的分离窗口管理器创建窗口（使用缓存的搜索框状态）
      const detachedWindow = detachedWindowManager.createDetachedWindow(
        this.currentPluginPath,
        cached.name,
        cached.view,
        {
          width: windowWidth,
          height: viewHeight,
          title: pluginConfig.title || pluginConfig.name,
          logo: cached.logo,
          searchQuery: cached.subInputValue || '',
          searchPlaceholder: cached.subInputPlaceholder || '搜索...',
          subInputVisible: cached.subInputVisible !== undefined ? cached.subInputVisible : true,
          autoFocusSubInput: shouldAutoFocusSubInput // 只有主窗口输入框聚焦时才自动聚焦
        }
      )

      if (!detachedWindow) {
        return { success: false, error: '创建独立窗口失败' }
      }

      // 从主窗口中移除插件视图
      this.mainWindow.contentView.removeChildView(this.pluginView)

      // 从缓存中移除
      const index = this.pluginViews.findIndex((v) => v.path === this.currentPluginPath)
      if (index !== -1) {
        this.pluginViews.splice(index, 1)
      }

      // 通知渲染进程插件已关闭
      this.mainWindow.webContents.send('plugin-closed')
      windowManager.notifyBackToSearch()

      // 清空当前引用
      this.pluginView = null
      this.currentPluginPath = null

      console.log('[Plugin] 插件已分离到独立窗口:', {
        pluginName: cached.name
      })
      return { success: true }
    } catch (error: unknown) {
      console.error('[Plugin] 分离插件失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      }
    }
  }

  private getCustomInternalApiPluginNames(): string[] {
    const settings = databaseAPI.dbGet('settings-general') || {}
    return normalizeCustomInternalApiPluginNames(settings[CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY])
  }

  /**
   * 根据 WebContents 获取插件信息
   * @param webContents WebContents 实例
   * @returns 插件信息，如果不是插件则返回 null
   */
  public getPluginInfoByWebContents(webContents: WebContents): {
    name: string
    path: string
    canUseInternalApi: boolean
    isBundledInternal: boolean
    logo?: string
  } | null {
    const customInternalApiPluginNames = this.getCustomInternalApiPluginNames()

    // 1. 先检查主窗口中的插件视图
    for (const pluginViewInfo of this.pluginViews) {
      if (pluginViewInfo.view.webContents === webContents) {
        return {
          name: pluginViewInfo.name,
          path: pluginViewInfo.path,
          canUseInternalApi: canPluginUseInternalApi(
            pluginViewInfo.name,
            customInternalApiPluginNames
          ),
          isBundledInternal: isBundledInternalPlugin(pluginViewInfo.name),
          logo: pluginViewInfo.logo
        }
      }
    }

    // 2. 检查分离窗口中的插件
    const detachedWindows = detachedWindowManager.getAllWindows()
    for (const windowInfo of detachedWindows) {
      if (windowInfo.view.webContents === webContents) {
        return {
          name: windowInfo.pluginName,
          path: windowInfo.pluginPath,
          canUseInternalApi: canPluginUseInternalApi(
            windowInfo.pluginName,
            customInternalApiPluginNames
          ),
          isBundledInternal: isBundledInternalPlugin(windowInfo.pluginName)
        }
      }
    }

    return null
  }

  /**
   * 根据插件名称获取插件的 WebContents
   * @param name 插件名称
   * @returns WebContents 实例，如果未找到则返回 null
   */
  public getPluginWebContentsByName(name: string): WebContents | null {
    const plugin = this.pluginViews.find((v) => v.name === name)
    return plugin ? plugin.view.webContents : null
  }

  /**
   * 根据插件路径获取运行中的 WebContents。
   * 同时覆盖主窗口中的插件视图和分离窗口中的插件实例。
   */
  public getPluginWebContentsByPath(pluginPath: string): WebContents | null {
    const plugin = this.pluginViews.find((v) => v.path === pluginPath)
    if (plugin) return plugin.view.webContents

    const detachedWindow = detachedWindowManager
      .getAllWindows()
      .find((windowInfo) => windowInfo.pluginPath === pluginPath)
    return detachedWindow?.view.webContents ?? null
  }

  /**
   * 检查调用者是否为内置插件
   * @param event IPC 事件对象
   * @returns 是否为内置插件调用
   */
  public isInternalPluginCaller(event: Electron.IpcMainInvokeEvent): boolean {
    const pluginInfo = this.getPluginInfoByWebContents(event.sender)
    return pluginInfo?.canUseInternalApi ?? false
  }

  /**
   * 获取指定插件的内存使用情况
   * @param pluginPath 插件路径
   * @returns 内存信息（单位：MB）
   */
  public async getPluginMemoryInfo(pluginPath: string): Promise<{
    private: number
    shared: number
    total: number
  } | null> {
    const plugin = this.pluginViews.find((v) => v.path === pluginPath)
    if (!plugin) {
      console.warn('[Plugin] 未找到插件视图:', pluginPath)
      console.log(
        '[Plugin] 当前运行中的插件:',
        this.pluginViews.map((v) => v.path)
      )
      return null
    }

    if (plugin.view.webContents.isDestroyed()) {
      console.warn('[Plugin] 插件 webContents 已销毁:', pluginPath)
      return null
    }

    try {
      // 获取操作系统进程 ID（而不是 Chromium 内部 ID）
      const processId = plugin.view.webContents.getOSProcessId()
      // 使用 app.getAppMetrics() 获取所有进程的内存信息
      const { app } = await import('electron')
      const metrics = app.getAppMetrics()

      // 找到对应进程的内存信息
      const processMetric = metrics.find((metric) => metric.pid === processId)

      if (!processMetric) {
        console.warn('[Plugin] 未找到进程指标，进程ID:', processId)
        console.log(
          '[Plugin] 所有进程ID:',
          metrics.map((m) => m.pid)
        )
        return null
      }

      if (!processMetric.memory) {
        console.warn('[Plugin] 进程指标中没有内存信息:', processMetric)
        return null
      }
      // memory.workingSetSize 是工作集大小（KB）
      // memory.privateBytes 是私有字节数（KB）
      const workingSetSize = processMetric.memory.workingSetSize || 0
      const privateBytes = processMetric.memory.privateBytes || 0

      // 转换为 MB
      const result = {
        private: Math.round(privateBytes / 1024),
        shared: Math.round((workingSetSize - privateBytes) / 1024),
        total: Math.round(workingSetSize / 1024)
      }
      return result
    } catch (error) {
      console.error('[Plugin] 获取插件内存信息失败:', error)
      return null
    }
  }
}

export default new PluginManager()
