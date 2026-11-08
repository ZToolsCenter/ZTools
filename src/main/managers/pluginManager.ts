import { BrowserWindow, session, shell, WebContents, WebContentsView } from 'electron'
import fsSync from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import hideWindowHtml from '../../../resources/hideWindow.html?asset'

import mainPreload from '../../../resources/preload.js?asset'
import api from '../api'
import { WINDOW_DEFAULT_HEIGHT, WINDOW_WIDTH } from '../common/constants'
import { STANDARD_MAIN_WINDOW_HEADER_HEIGHT } from '../../shared/mainWindowLayout'
import detachedWindowManager, {
  DETACHED_TITLEBAR_HEIGHT,
  type DetachedPluginUpgradeSnapshot
} from '../core/detachedWindowManager'
import { GLOBAL_SCROLLBAR_CSS } from '../core/globalStyles'
import { buildPluginThemeCSS, getCurrentPluginThemeState } from '../core/pluginTheme'
import {
  CUSTOM_INTERNAL_API_DISABLED_KEY,
  CUSTOM_INTERNAL_API_PERMISSIONS_KEY,
  CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY,
  canPluginUseInternalApi,
  isBundledInternalPlugin,
  isTrustedInternalApiPlugin,
  normalizeCustomInternalApiPluginNames,
  normalizeInternalApiDisabledPluginList,
  normalizeInternalApiPermissionsMap
} from '../core/internalPlugins'
import pluginWindowManager from '../core/pluginWindowManager'
import { registerIconProtocolForSession } from '../core/iconProtocol'
import lmdbInstance from '../core/lmdb/lmdbInstance'
import databaseAPI from '../api/shared/database'
import proxyManager from './proxyManager'
import type { PluginEnterPayload, PluginMainWindowLaunchState } from '../../shared/pluginLaunch'
import { sendPluginLifecycle } from '../core/pluginLifecycle'
import {
  createPluginViewReadiness,
  waitForPluginViewReady,
  type PluginViewReadiness
} from '../core/pluginViewReadiness'
import devToolsShortcut, { getDevToolsMode } from '../utils/devToolsShortcut'
import windowManager from './windowManager'
import {
  getDetachedWindowSizeKey,
  getPluginDataPrefix,
  getPluginSessionPartition
} from '../../shared/pluginRuntimeNamespace'
import aiRequestStatusTracker from '../core/aiRequestStatusTracker'

console.log('[Plugin] mainPreload', mainPreload)

const PLUGIN_OUT_GRACE_MS = 200
// 单次启动等待页面就绪的上限；超时只结束本次启动，页面继续加载，后续启动重新等待。
const PLUGIN_LAUNCH_READY_TIMEOUT_MS = 15000
// 搜索结果不能被慢插件长时间阻塞，mainPush 查询使用更短的等待。
const PLUGIN_MAIN_PUSH_READY_TIMEOUT_MS = 5000

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
  loading: PluginViewReadiness
  cmdName?: string
  height?: number
  subInputPlaceholder?: string
  subInputValue?: string // 搜索框的值
  subInputVisible?: boolean // 子输入框是否可见
  logo?: string
  isDevelopment?: boolean
  backgroundRunning?: boolean // plugin.json pluginSetting.backgroundRunning，后台不节流
  single?: boolean // plugin.json pluginSetting.single, true/默认 = 单例不可多开, false = 允许多开
}

interface PluginLaunchRequest {
  id: number
  pluginPath: string
  featureCode: string
  payload: PluginEnterPayload
}

interface PluginLastEnterState {
  featureCode: string
  cmdType: string
}

export interface PluginUpgradeRelaunchContext {
  surface: 'main' | 'detached'
  pluginName: string
  pluginPath: string
  featureCode: string
  cmdName?: string
  cmdType: string
  param: any
  height: number
  detachedSnapshot?: DetachedPluginUpgradeSnapshot
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
   * 判断插件是否为需要保护源码的正式闭源插件。
   * 开发模式插件即使来源类型为 closed_source，也保留调试能力，方便本地开发联调。
   */
  private isClosedSourcePlugin(pluginPath: string): boolean {
    const pluginInfo = this.fetchPluginInfoFromDB(pluginPath)
    if (pluginInfo?.isDevelopment === true) return false

    if (pluginInfo?.sourceType === 'closed_source') return true

    // 兼容尚未写入注册表 sourceType 的插件；plugin.json 只能提供更严格的限制，
    // 不能把一个已标记为闭源的插件降级成开源。
    try {
      return this.readPluginConfig(pluginPath)?.sourceType === 'closed_source'
    } catch {
      return false
    }
  }

  /**
   * 获取插件 DevTools 权限。
   * @param pluginPath 插件物理路径
   */
  public getPluginDevToolsPermission(pluginPath: string): {
    allowed: boolean
    error?: string
  } {
    if (this.isClosedSourcePlugin(pluginPath)) {
      return { allowed: false, error: '闭源插件不支持打开开发者工具' }
    }
    return { allowed: true }
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
   * 判断启动指定 feature 时是否应保持主窗口隐藏。
   * @param pluginPath 插件目录路径。
   * @param featureCode 要启动的 feature code。
   * @returns feature 设置了 `mainHide: true` 时返回 true，否则返回 false。
   */
  public shouldKeepMainWindowHidden(pluginPath: string, featureCode: string): boolean {
    return this.isFeatureMainHide(pluginPath, featureCode)
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
   * 根据插件类型和运行环境解析插件视图入口 URL。
   * @param pluginPath 插件文件所在目录
   * @param pluginConfig 插件配置
   * @param isDevelopment 是否以开发模式运行插件
   * @returns 插件入口 URL 及无界面插件标记
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
    if (isDevelopment) {
      // E2E 使用独立端口，避免占用日常设置插件开发服务器的 5177 端口。
      const developmentMain =
        pluginConfig.name === 'setting' && process.env.ZTOOLS_SETTING_DEV_SERVER_URL
          ? process.env.ZTOOLS_SETTING_DEV_SERVER_URL
          : pluginConfig.development?.main
      if (developmentMain) {
        console.log('[Plugin] 开发中插件，使用 development.main:', developmentMain)
        return { pluginUrl: developmentMain, isConfigHeadless }
      }
    }
    if (pluginConfig.main.startsWith('http')) {
      console.log('[Plugin] 网络插件:', pluginConfig.main)
      return { pluginUrl: pluginConfig.main, isConfigHeadless }
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
    const pluginInfoFromDB = this.fetchPluginInfoFromDB(pluginPath)
    const sourceType =
      pluginInfoFromDB?.isDevelopment === true
        ? 'open_source'
        : pluginInfoFromDB?.sourceType === 'closed_source' ||
            pluginConfig.sourceType === 'closed_source'
          ? 'closed_source'
          : 'open_source'
    this.mainWindow?.webContents.send('plugin-opened', {
      name: pluginConfig.name,
      title: pluginConfig.title || pluginConfig.name,
      logo: logoUrl,
      path: pluginPath,
      cmdName,
      subInputPlaceholder,
      subInputVisible,
      sourceType
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
  private activeLaunch: PluginLaunchRequest | null = null
  private nextLaunchId = 0
  // 记录最近一次插件 ESC 触发的时间，用于短时间内抑制主窗口 hide
  private lastPluginEscTime: number | null = null
  // 插件默认高度（可配置）
  private pluginDefaultHeight: number = WINDOW_DEFAULT_HEIGHT - STANDARD_MAIN_WINDOW_HEADER_HEIGHT
  // 跟踪每个插件上次进入的状态（用于单例重入判断）
  private pluginLastEnterState: Map<string, PluginLastEnterState> = new Map()
  private preloadTasks = new Map<string, Promise<void>>()

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
   * 判断是否跳过相同文本功能的单例重入。
   * @param pluginPath 插件路径
   * @param featureCode 功能代码
   * @param input 本次启动快照
   * @returns 是否跳过重入
   */
  private shouldSkipReEnter(
    pluginPath: string,
    featureCode: string,
    input?: PluginEnterPayload
  ): boolean {
    const lastState = this.pluginLastEnterState.get(pluginPath)
    if (!lastState) return false
    const snapshot = input || api.getLaunchParam(pluginPath)
    // 动态结果携带新的输入或选项，即使功能相同也必须触发进入事件。
    if (snapshot?.from === 'main' || snapshot?.option !== undefined) return false
    const currentCmdType = snapshot?.type || 'text'
    return (
      lastState.cmdType === 'text' &&
      currentCmdType === 'text' &&
      lastState.featureCode === featureCode
    )
  }

  /**
   * 在唤起窗口前确定本次进入行为，只有前台同功能复用才保留搜索状态。
   * @param pluginPath 目标插件路径
   * @param featureCode 本次功能代码
   * @param enterParam 本次进入参数
   * @returns 本次启动行为及宿主应显示的搜索词
   */
  public getMainWindowLaunchState(
    pluginPath: string,
    featureCode: string,
    enterParam?: PluginEnterPayload
  ): PluginMainWindowLaunchState {
    const cached = this.pluginViews.find((plugin) => plugin.path === pluginPath)
    // 隐藏后的再次启动需要进入回调；不能在 showWindow 后重新判断可见性。
    if (
      this.mainWindow?.isVisible() &&
      this.currentPluginPath === pluginPath &&
      cached?.view === this.pluginView &&
      cached?.loading.isReady &&
      !cached.view.webContents.isDestroyed() &&
      this.shouldSkipReEnter(pluginPath, featureCode, enterParam)
    ) {
      // 用插件缓存恢复搜索词，覆盖其它尚未提交的启动请求留下的顶部栏占位。
      return { mode: 'focus', subInputValue: cached.subInputValue ?? '' }
    }
    return { mode: 'enter', subInputValue: '' }
  }

  /**
   * 记录本次实例进入类型，避免异步加载读取后续启动的参数。
   * @param pluginPath 插件路径
   * @param featureCode 功能代码
   * @param inputType 当前进入快照类型
   * @returns 无返回值
   */
  private recordEnterState(pluginPath: string, featureCode: string, inputType?: string): void {
    const cmdType = inputType || 'text'
    this.pluginLastEnterState.set(pluginPath, { featureCode, cmdType })
  }

  /**
   * 复用已存在的分离窗口单例插件。
   * 必须在主窗口切换/隐藏当前插件之前调用，避免“只是聚焦已有分离窗口”却误退主窗口当前插件。
   * @param pluginPath 插件路径
   * @param featureCode 功能代码
   * @param source 启动入口
   * @param enterParam 本次进入快照
   * @returns 是否已复用现有实例
   */
  public reuseDetachedSingletonIfExists(
    pluginPath: string,
    featureCode: string,
    source: 'main-window' | 'detached-window' | 'launch-precheck',
    enterParam?: PluginEnterPayload
  ): boolean {
    const launchSnapshot = structuredClone(enterParam ?? api.getLaunchParam(pluginPath))
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

    if (!this.shouldSkipReEnter(pluginPath, featureCode, launchSnapshot)) {
      console.log('[Plugin] 分离窗口单例重入，触发 onPluginEnter:', {
        pluginPath,
        featureCode,
        source
      })
      sendPluginLifecycle(detachedView, 'PluginEnter', launchSnapshot)
      this.recordEnterState(pluginPath, featureCode, launchSnapshot.type)
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

  /**
   * 固定本次启动参数并准备插件视图，仅页面尚未就绪时显示顶部栏占位。
   * @param pluginPath 目标插件路径
   * @param featureCode 功能代码
   * @param cmdName 显示名称
   * @param enterParam 本次进入参数
   * @param launchMode 唤起主窗口前确定的启动行为；省略时按当前状态判断
   * @returns 视图创建准备完成的 Promise；插件就绪后由当前请求提交显示
   */
  public async createPluginView(
    pluginPath: string,
    featureCode: string,
    cmdName?: string,
    enterParam?: PluginEnterPayload,
    launchMode?: PluginMainWindowLaunchState['mode']
  ): Promise<void> {
    if (!this.mainWindow) return
    const payload = structuredClone(enterParam ?? api.getLaunchParam(pluginPath))
    const mode = launchMode ?? this.getMainWindowLaunchState(pluginPath, featureCode, payload).mode

    // 聚焦已有独立窗口不改变主窗口的视图或待完成请求。
    if (
      this.currentPluginPath !== pluginPath &&
      this.reuseDetachedSingletonIfExists(pluginPath, featureCode, 'main-window', payload)
    )
      return
    // 每次主窗口选择都替换旧请求，包括无需再次触发进入回调的同功能选择。
    const request: PluginLaunchRequest = {
      id: ++this.nextLaunchId,
      pluginPath,
      featureCode,
      payload
    }
    this.activeLaunch = request

    try {
      // 隐藏旧视图只释放其展示位置，不取消刚建立的新请求。
      if (this.currentPluginPath && this.currentPluginPath !== pluginPath) {
        this.hideCurrentPluginView()
      }
      const config = this.readPluginConfig(pluginPath)
      const cached = this.pluginViews.find((plugin) => plugin.path === pluginPath)
      this.sendPluginOpenedEvent(
        config,
        pluginPath,
        this.buildPluginLogoUrl(pluginPath, config.logo),
        cmdName || '',
        cached?.subInputPlaceholder || '搜索',
        cached?.subInputVisible ?? false
      )
      if (cached && this.currentPluginPath === pluginPath && mode === 'focus') {
        // 仅前台同功能复用跳过进入；隐藏后的呼出继续走缓存展示和进入通知。
        cached.cmdName = cmdName || ''
        this.sendPluginLoadedEvent(cached.name, pluginPath)
        return
      }
      console.log('[Plugin] 准备启动:', { requestId: request.id, pluginPath, featureCode })

      // 已就绪的缓存直接恢复，避免先收起再展开；仍在加载的缓存也需要占位。
      if (!this.pluginView && !cached?.loading.isReady) {
        api.resizeWindow(windowManager.getMainWindowHeaderHeight() + 1)
      }
      this.reloadStalledPluginView(cached)

      // 与 mainPush 共用实例创建，避免前台启动与后台预加载各建一份视图。
      await this.preloadPlugin(pluginPath)
      if (this.activeLaunch !== request) return
      const plugin = this.pluginViews.find((item) => item.path === pluginPath)
      if (!plugin) throw new Error('插件视图创建失败')
      // 返回接受启动的结果，不让慢页面阻塞后续切换请求。
      void this.showPluginView(plugin, request, cmdName).catch((error) => {
        this.handleLaunchFailure(request, error)
      })
    } catch (error) {
      this.handleLaunchFailure(request, error)
    }
  }

  /**
   * 重新加载已停止加载却仍未就绪的缓存页面。
   * 这类页面不会再收到就绪事件，直接复用只会让每次启动都立即失败。
   * @param plugin 本次启动前已缓存的插件实例
   * @returns 无返回值
   */
  private reloadStalledPluginView(plugin: PluginViewInfo | undefined): void {
    const contents = plugin?.view.webContents
    if (!plugin || !contents || contents.isDestroyed()) return
    if (plugin.loading.isReady || contents.isLoading()) return
    console.warn('[Plugin] 缓存插件页面未就绪且已停止加载，重新加载:', {
      pluginPath: plugin.path,
      url: contents.getURL()
    })
    plugin.loading.reload()
  }

  /**
   * 仅为仍有效的请求报告失败并结束主窗口占位。
   * @param request 失败的启动请求
   * @param error 页面准备或展示失败原因
   * @returns 无返回值
   */
  private handleLaunchFailure(request: PluginLaunchRequest, error: unknown): void {
    console.error(
      '[Plugin] 启动失败:',
      { requestId: request.id, pluginPath: request.pluginPath },
      error
    )
    // 旧请求失败不得隐藏后来启动的插件，也不得清除其占位状态。
    if (this.activeLaunch !== request) return
    this.hidePluginView()
    windowManager.notifyBackToSearch()
  }

  /**
   * 等待页面与运行模式就绪，再将仍有效的请求提交到主窗口。
   * @param plugin 已创建或缓存的插件实例
   * @param request 本次启动请求及不可变参数
   * @param cmdName 本次指令显示名称
   * @returns 页面准备及当前请求展示结束的 Promise
   * @throws 当前页面未能完成加载或展示失败时抛错
   */
  private async showPluginView(
    plugin: PluginViewInfo,
    request: PluginLaunchRequest,
    cmdName?: string
  ): Promise<void> {
    const { view } = plugin
    let mode: string | undefined
    while (this.activeLaunch === request) {
      const documentReady = plugin.loading.ready
      const ready = await waitForPluginViewReady(documentReady, PLUGIN_LAUNCH_READY_TIMEOUT_MS)
      if (this.activeLaunch !== request) return
      // 页面可能重定向或重载；继续等待新文档，不提交旧页面的准备结果。
      if (documentReady !== plugin.loading.ready) continue
      if (!ready || view.webContents.isDestroyed()) throw new Error('插件页面未能加载完成')
      mode = await this.getPluginMode(view.webContents, request.featureCode)
      if (documentReady !== plugin.loading.ready) continue
      break
    }

    // 所有异步准备完成后统一检查；过期请求不挂载、不清理别人正在复用的视图。
    if (
      this.activeLaunch !== request ||
      !this.mainWindow ||
      this.mainWindow.isDestroyed() ||
      this.mainWindow.webContents.isDestroyed() ||
      view.webContents.isDestroyed() ||
      !this.pluginViews.includes(plugin)
    )
      return

    this.mainWindow.contentView.addChildView(view)
    this.pluginView = view
    this.currentPluginPath = plugin.path
    plugin.cmdName = cmdName || ''
    this.applyBackgroundThrottlingByPolicy(view, plugin.path, false)
    // 提交后到事件发送之间没有异步让步，避免其它请求插入共享状态修改。
    this.processPluginMode(plugin, request, mode)
    this.sendPluginLoadedEvent(plugin.name, plugin.path)
    this.forceRepaintView(view)
    console.log('[Plugin] 已进入:', { requestId: request.id, pluginPath: plugin.path })
  }

  /**
   * 为主窗口中运行的插件视图注册事件监听
   * （devtools、焦点、快捷键、进程崩溃等）
   * @param view 监听的插件实例
   * @param pluginPath 实例对应的插件路径
   * @returns 无返回值
   */
  private registerMainWindowPluginEvents(view: WebContentsView, pluginPath: string): void {
    view.webContents.on('devtools-opened', () => {
      const permission = this.getPluginDevToolsPermission(pluginPath)
      if (!permission.allowed && !view.webContents.isDestroyed()) {
        console.warn('[Plugin] 已阻止闭源插件开发者工具:', pluginPath)
        view.webContents.closeDevTools()
        return
      }
      console.log('[Plugin] 插件开发者工具已打开')
    })

    view.webContents.on('focus', () => {
      windowManager.updateFocusTarget('plugin')
      if (!view.webContents.isDestroyed()) {
        devToolsShortcut.register(view.webContents, () => {
          void this.togglePluginDevTools(view.webContents, pluginPath)
        })
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

      // 只释放崩溃实例，后台旧实例退出不能向当前其它插件发送退出通知。
      const index = this.pluginViews.findIndex((v) => v.view === view)
      if (index !== -1) {
        this.pluginViews.splice(index, 1)
        this.pluginLastEnterState.delete(pluginPath)
        console.log('[Plugin] 已从缓存中移除崩溃的插件:', pluginPath)
      }

      if (this.pluginView === view || this.activeLaunch?.pluginPath === pluginPath) {
        this.hidePluginView()
        windowManager.notifyBackToSearch()
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

  /**
   * 取消主窗口待完成的启动，并退出当前插件或加载占位。
   * @returns 无返回值
   */
  public hidePluginView(): void {
    // 用户退出在页面尚未挂载时同样有效，不能让慢加载随后重新打开插件。
    this.activeLaunch = null
    if (!this.pluginView) {
      this.mainWindow?.webContents.send('plugin-closed')
      return
    }
    this.hideCurrentPluginView()
  }

  /**
   * 隐藏当前已挂载视图并保留缓存，不取消其它待完成的启动请求。
   * @returns 无返回值
   */
  private hideCurrentPluginView(): void {
    if (this.pluginView && this.mainWindow) {
      const currentPath = this.currentPluginPath
      const pluginView = this.pluginView
      console.log('[Plugin] 隐藏插件视图:', { currentPath })

      // 发送插件退出事件（isKill=false 表示正常退出）
      if (!pluginView.webContents.isDestroyed()) {
        sendPluginLifecycle(pluginView, 'PluginOut', false)
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
   * @returns 无返回值
   */
  public detachPluginViewOnRefresh(): void {
    // 宿主重载也取消尚未挂载的启动；已有插件仅移除展示关系。
    this.activeLaunch = null
    if (!this.pluginView || !this.mainWindow) return
    const pluginView = this.pluginView
    console.log('[Plugin] 检测到主渲染进程刷新，移除当前插件视图以防叠层:', this.currentPluginPath)
    this.mainWindow.contentView.removeChildView(pluginView)
    this.pluginView = null
    this.currentPluginPath = null
  }

  /**
   * 获取主窗口当前插件路径，包含已接受但尚未挂载的启动目标。
   * @returns 当前或加载中的插件路径；搜索页返回 null
   */
  public getCurrentPluginPath(): string | null {
    // 加载占位仍属于插件页面，关闭和退出快捷键应能取消它。
    return this.currentPluginPath ?? this.activeLaunch?.pluginPath ?? null
  }

  // 获取当前加载的插件视图
  public getCurrentPluginView(): WebContentsView | null {
    return this.pluginView
  }

  /**
   * 保存发起升级的插件重启上下文，并把对应插件区域收起到 0 高度。
   * @param pluginName 需要升级的插件名称
   * @param pluginPath 当前插件物理路径
   * @param webContents 发起升级请求的渲染进程
   * @returns 可用于升级后重新打开插件的上下文；调用来源不匹配时返回 null
   */
  public collapseCurrentPluginForUpgrade(
    pluginName: string,
    pluginPath: string,
    webContents?: WebContents
  ): PluginUpgradeRelaunchContext | null {
    // 独立标题栏发起升级时，保存其窗口尺寸并只收起对应的插件内容区。
    const detachedSnapshot = webContents
      ? detachedWindowManager.collapsePluginForUpgrade(pluginName, pluginPath, webContents)
      : null
    if (detachedSnapshot) {
      const lastEnterState = this.pluginLastEnterState.get(pluginPath)
      return {
        surface: 'detached',
        pluginName,
        pluginPath,
        featureCode: lastEnterState?.featureCode || '',
        cmdType: lastEnterState?.cmdType || api.getLaunchParam(pluginPath)?.type || 'text',
        param: api.getLaunchParam(pluginPath) || {},
        height: detachedSnapshot.viewHeight,
        detachedSnapshot
      }
    }

    if (
      !this.pluginView ||
      this.currentPluginPath !== pluginPath ||
      this.pluginViews.find((plugin) => plugin.path === pluginPath)?.name !== pluginName
    ) {
      return null
    }

    // 在安装器销毁旧视图前保存原指令和高度，避免升级完成后丢失进入状态。
    const cached = this.pluginViews.find((plugin) => plugin.path === pluginPath)
    const lastEnterState = this.pluginLastEnterState.get(pluginPath)
    const currentBounds = this.pluginView.getBounds()
    const height =
      currentBounds.height > 0
        ? currentBounds.height
        : cached?.height && cached.height > 0
          ? cached.height
          : this.pluginDefaultHeight
    const context: PluginUpgradeRelaunchContext = {
      surface: 'main',
      pluginName,
      pluginPath,
      featureCode: lastEnterState?.featureCode || '',
      cmdName: cached?.cmdName,
      cmdType: lastEnterState?.cmdType || api.getLaunchParam(pluginPath)?.type || 'text',
      param: api.getLaunchParam(pluginPath) || {},
      height
    }

    // 保留主搜索栏和升级进度，同时彻底隐藏即将被替换的插件内容。
    this.setExpendHeight(0, false)
    return context
  }

  /**
   * 升级结束后恢复仍存活的旧视图，或按保存的进入状态重新启动插件。
   * @param context 升级开始前保存的插件进入上下文
   * @param pluginPath 安装完成后应打开的插件物理路径
   * @param installSucceeded 市场安装是否成功完成
   * @returns 恢复或重新启动结果
   */
  public async reopenPluginAfterUpgrade(
    context: PluginUpgradeRelaunchContext,
    pluginPath: string,
    installSucceeded: boolean
  ): Promise<{ success: boolean; error?: string }> {
    if (context.surface === 'detached' && context.detachedSnapshot) {
      // 安装器通过延迟关闭发布 PluginOut，等待旧独立窗口完成清理后再决定恢复或重建。
      await new Promise<void>((resolve) => {
        setTimeout(resolve, PLUGIN_OUT_GRACE_MS + 20)
      })

      // 下载或安装失败且旧窗口仍存活时，原地恢复以保留窗口位置和焦点。
      if (
        !installSucceeded &&
        detachedWindowManager.restorePluginAfterFailedUpgrade(context.detachedSnapshot)
      ) {
        return { success: true }
      }

      // 发布成功或旧窗口已退出时，始终重新创建独立窗口并复用升级前的进入参数。
      return await this.createPluginInDetachedWindow(
        pluginPath,
        context.featureCode,
        context.param as PluginEnterPayload
      )
    }

    if (this.pluginView && this.currentPluginPath === pluginPath) {
      // 下载或安装失败但旧视图仍存活时，直接恢复原高度和焦点。
      this.setExpendHeight(context.height, false)
      this.pluginView.webContents.focus()
      this.forceRepaintView(this.pluginView)
      return { success: true }
    }

    // 旧视图已被安装器销毁时，从当前注册路径创建新版本视图。
    return await api.launchPlugin({
      path: pluginPath,
      type: 'plugin',
      featureCode: context.featureCode || undefined,
      param: context.param,
      name: context.cmdName,
      cmdType: context.cmdType
    })
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
   * 合并同一插件的并发预加载，跨搜索会话共享一个后台实例。
   * @param pluginPath 插件路径
   * @returns 实例创建完成的 Promise，页面是否就绪由实例的 loading.ready 表示
   */
  public async preloadPlugin(pluginPath: string): Promise<void> {
    const pending = this.preloadTasks.get(pluginPath)
    if (pending) return pending
    const task = this.preloadPluginOnce(
      pluginPath,
      () => this.preloadTasks.get(pluginPath) === task
    )
    this.preloadTasks.set(pluginPath, task)
    try {
      await task
    } finally {
      if (this.preloadTasks.get(pluginPath) === task) this.preloadTasks.delete(pluginPath)
    }
  }

  /**
   * 创建一个不附着到主窗口的后台插件视图。
   * @param pluginPath 插件路径
   * @param canCreate 检查创建任务是否仍未被终止操作取消
   * @returns 视图创建结束的 Promise
   */
  private async preloadPluginOnce(pluginPath: string, canCreate: () => boolean): Promise<void> {
    if (!this.mainWindow) return

    // 如果已经在缓存中，跳过
    const existing = this.pluginViews.find((v) => v.path === pluginPath)
    if (existing && !existing.view.webContents.isDestroyed()) {
      console.log('[Plugin] 插件已在运行中，跳过预加载:', pluginPath)
      return
    }
    if (existing) this.pluginViews.splice(this.pluginViews.indexOf(existing), 1)

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
      // 创建期间的终止请求必须生效，不能在 await 后重新生成已被终止的实例。
      if (!canCreate() || !this.mainWindow || this.mainWindow.isDestroyed()) return
      const view = this.createPluginWebContentsView(sess, preloadPath)
      const loading = createPluginViewReadiness(view.webContents)

      // 注册事件监听
      this.registerMainWindowPluginEvents(view, pluginPath)

      // 缓存视图（但不添加到主窗口、不设为当前插件）
      const logoUrl = this.buildPluginLogoUrl(pluginPath, pluginConfig.logo)
      const pluginInfo: PluginViewInfo = {
        path: pluginPath,
        name: effectiveName,
        view,
        loading,
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

      // 就绪监听先于导航建立；主题在每次导航后恢复，不依赖当前主窗口请求。
      view.webContents.on('dom-ready', () => {
        // 后台页面也需要先具备主题色，避免首次切到前台时出现颜色闪烁。
        void view.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS)
        void view.webContents.insertCSS(buildPluginThemeCSS(getCurrentPluginThemeState()))
        console.log('[Plugin] 后台预加载插件完成:', {
          pluginName: effectiveName,
          pluginPath,
          webContentsId: view.webContents.id
        })
      })

      void view.webContents.loadURL(pluginUrl).catch((error) => {
        // 加载失败仅记录所属实例；就绪等待会返回失败，由当前请求结束占位。
        console.error('[Plugin] 页面加载失败:', { pluginPath }, error)
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

  /**
   * 终止指定插件及尚未完成的实例创建，保留退出通知的处理时间。
   * @param pluginPath 插件路径
   * @returns 是否找到并终止运行中或准备中的插件
   */
  public killPlugin(pluginPath: string): boolean {
    try {
      console.log('[Plugin] killPlugin 开始:', { pluginPath })
      const wasPreparing = this.preloadTasks.delete(pluginPath)
      if (this.activeLaunch?.pluginPath === pluginPath) this.activeLaunch = null
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
          sendPluginLifecycle(detachedView, 'PluginOut', true)
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
      return wasPreparing
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

  /**
   * 终止所有插件及准备任务，关闭前先通知实例退出。
   * @returns 无返回值
   */
  public killAllPlugins(): void {
    this.activeLaunch = null
    this.preloadTasks.clear()
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
    this.pluginLastEnterState.clear()

    // 关闭所有分离窗口中的插件
    for (const detachedWindow of detachedWindowManager.getAllWindows()) {
      if (!detachedWindow.view.webContents.isDestroyed()) {
        sendPluginLifecycle(detachedWindow.view, 'PluginOut', true)
      }
    }
    setTimeout(() => {
      detachedWindowManager.closeAll()
    }, PLUGIN_OUT_GRACE_MS)

    console.log('[Plugin] killAllPlugins 完成')
  }

  /**
   * 通知插件退出并在宽限时间后关闭对应实例。
   * @param view 待关闭的插件视图
   * @param isKill 是否终止插件
   * @returns 无返回值
   */
  private dispatchPluginOutBeforeClose(view: WebContentsView, isKill: boolean): void {
    const webContents = view.webContents
    if (webContents.isDestroyed()) return

    sendPluginLifecycle(view, 'PluginOut', isKill)
    setTimeout(() => {
      if (!webContents.isDestroyed()) {
        webContents.close()
      }
    }, PLUGIN_OUT_GRACE_MS)
  }

  /**
   * 终止当前或加载中的插件并返回搜索页面，供退出快捷键使用。
   * @returns 无返回值
   */
  public killCurrentPlugin(): void {
    const pluginPath = this.getCurrentPluginPath()
    if (!pluginPath) {
      console.log('[Plugin] 没有正在运行的插件')
      return
    }

    // 页面尚未就绪时也终止其准备任务，防止快捷键返回后重新出现。
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

  /**
   * 切换指定插件视图的开发者工具，并统一执行闭源插件限制。
   * @param webContents 插件视图的 WebContents
   * @param pluginPath 插件物理路径
   */
  public togglePluginDevTools(
    webContents: WebContents,
    pluginPath: string
  ): { success: boolean; error?: string } {
    try {
      if (webContents.isDestroyed()) {
        return { success: false, error: '插件视图不可用' }
      }

      // 已打开时允许关闭，避免权限变化后残留 DevTools 窗口。
      if (webContents.isDevToolsOpened()) {
        webContents.closeDevTools()
        console.log('[Plugin] 已关闭插件开发者工具')
        return { success: true }
      }

      const permission = this.getPluginDevToolsPermission(pluginPath)
      if (!permission.allowed) {
        console.warn('[Plugin] 已拒绝打开闭源插件开发者工具:', pluginPath)
        return { success: false, error: permission.error }
      }

      const mode = getDevToolsMode()
      webContents.openDevTools({ mode })
      console.log('[Plugin] 已打开插件开发者工具')
      return { success: true }
    } catch (error) {
      console.error('[Plugin] 切换插件开发者工具失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 切换当前插件的开发者工具（打开/关闭）
  public async openPluginDevTools(): Promise<{ success: boolean; error?: string }> {
    try {
      if (
        !this.pluginView ||
        this.pluginView.webContents.isDestroyed() ||
        !this.currentPluginPath
      ) {
        console.log('[Plugin] 没有活动的插件视图')
        return { success: false, error: '没有活动的插件' }
      }

      return this.togglePluginDevTools(this.pluginView.webContents, this.currentPluginPath)
    } catch (error) {
      console.error('[Plugin] 切换插件开发者工具失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
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

  /**
   * 设置主窗口插件视图高度，并按当前顶部栏高度同步窗口尺寸和视图偏移。
   * @param height 插件正文期望高度，单位为像素。
   * @param updateCache 是否更新当前插件缓存中的正文高度。
   * @returns 无返回值。
   */
  public setExpendHeight(height: number, updateCache: boolean = true): void {
    if (!this.mainWindow || !this.pluginView) return

    console.log('[Plugin] 设置插件高度:', height)

    // 顶部栏高度由当前紧凑模式统一决定。
    const mainContentHeight = windowManager.getMainWindowHeaderHeight()
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

  /**
   * 根据主窗口尺寸更新当前插件视图边界。
   * @param width 主窗口内容宽度，单位为像素。
   * @param height 主窗口内容高度，单位为像素。
   * @returns 无返回值。
   */
  public updatePluginViewBounds(width: number, height: number): void {
    if (!this.pluginView) return

    const mainContentHeight = windowManager.getMainWindowHeaderHeight()
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

  /**
   * 在顶部栏密度变化后重新布局当前插件，并保持插件正文高度不变。
   * @returns 无返回值。
   */
  public refreshMainWindowHeaderLayout(): void {
    if (!this.pluginView) return

    // 使用当前视图真实高度，避免切换密度时覆盖插件主动设置的高度。
    const { height } = this.pluginView.getBounds()
    this.setExpendHeight(height, false)
  }

  /**
   * 发送插件请求，并在完成、超时或实例销毁时清理回复监听器。
   * @param contents 插件实例
   * @param requestChannel 请求通道
   * @param resultPrefix 回复通道前缀
   * @param data 请求数据
   * @param fallback 失败回退值
   * @param timeoutMs 超时预算
   * @returns 回复或回退值
   */
  private requestPluginReply<T>(
    contents: WebContents,
    requestChannel: string,
    resultPrefix: string,
    data: object,
    fallback: T,
    timeoutMs = 3000
  ): Promise<T> {
    if (contents.isDestroyed()) return Promise.resolve(fallback)
    const callId = Date.now() + '_' + Math.random().toString(36).slice(2)
    const channel = resultPrefix + callId
    return new Promise((resolve) => {
      /**
       * 清理所有终止路径的资源并交付结果。
       * @param value 回复结果
       * @returns 无返回值
       */
      const finish = (value: T): void => {
        clearTimeout(timer)
        contents.ipc.removeListener(channel, handler)
        contents.removeListener('destroyed', destroyed)
        resolve(value)
      }
      const handler = (_event: Electron.IpcMainEvent, value: T): void => finish(value)
      const destroyed = (): void => finish(fallback)
      const timer = setTimeout(() => finish(fallback), timeoutMs)
      contents.ipc.once(channel, handler)
      contents.once('destroyed', destroyed)
      try {
        contents.send(requestChannel, { ...data, callId })
      } catch {
        finish(fallback)
      }
    })
  }

  /**
   * 获取目标功能的运行模式。
   * @param webContents 插件实例
   * @param featureCode 功能代码
   * @returns 模式或超时后的 undefined
   */
  private getPluginMode(
    webContents: WebContents,
    featureCode: string
  ): Promise<string | undefined> {
    return this.requestPluginReply(
      webContents,
      'get-plugin-mode',
      'plugin-mode-result-',
      { featureCode },
      undefined,
      1000
    )
  }

  // ==================== 无界面插件相关方法 ====================

  /**
   * 在当前请求提交后同步设置展示模式并发送本次进入参数。
   * @param plugin 已挂载的插件实例
   * @param request 本次启动请求
   * @param mode 已完成查询的运行模式
   * @returns 无返回值
   */
  private processPluginMode(
    plugin: PluginViewInfo,
    request: PluginLaunchRequest,
    mode: string | undefined
  ): void {
    const { pluginPath, featureCode, payload } = request
    const { view } = plugin
    // 无界面、列表和隐藏功能都先收起内容区，列表渲染后自行报告实际高度。
    if (mode === 'none' || mode === 'list' || this.isFeatureMainHide(pluginPath, featureCode)) {
      this.setExpendHeight(0, false)
    } else {
      this.setExpendHeight(plugin.height || this.pluginDefaultHeight, true)
    }

    if (mode === 'none') {
      // 无界面业务可能异步失败，记录错误而不影响后来进入的插件。
      void this.callHeadlessPluginMethod(pluginPath, featureCode, payload).catch((error) => {
        console.error('[Plugin] 无界面功能执行失败:', { pluginPath, featureCode }, error)
      })
    } else if (mode === 'list') {
      // 无搜索框的列表直接接收方向键；带搜索框的列表随后自行转移焦点。
      view.webContents.focus()
      view.webContents.send('activate-list-mode', { featureCode, action: payload, pluginPath })
    } else {
      view.webContents.focus()
      sendPluginLifecycle(view, 'PluginEnter', payload)
    }
    this.recordEnterState(pluginPath, featureCode, payload.type)
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
   * @param pluginPath 插件路径
   * @param _featureCode 功能代码
   * @param queryData 查询快照
   * @returns 动态结果项
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
      plugin = this.pluginViews.find((v) => v.path === pluginPath)
    }

    if (!plugin || plugin.view.webContents.isDestroyed()) {
      console.warn('[Plugin][MainPush] query aborted: plugin unavailable', { pluginPath })
      return []
    }

    // 其它请求可能已创建视图但仍在加载，查询跟随重定向等待当前文档的回调就绪。
    while (true) {
      const documentReady = plugin.loading.ready
      const ready = await waitForPluginViewReady(documentReady, PLUGIN_MAIN_PUSH_READY_TIMEOUT_MS)
      if (plugin.view.webContents.isDestroyed() || !this.pluginViews.includes(plugin)) return []
      if (documentReady !== plugin.loading.ready) continue
      if (!ready) return []
      break
    }
    const result = await this.requestPluginReply<any>(
      plugin.view.webContents,
      'main-push-query',
      'main-push-result-',
      { queryData },
      null
    )
    if (!result?.success || !Array.isArray(result.results)) return []
    // 保存原始 icon，仅将本地显示 URL 放进内部展示字段。
    return result.results.map((item: any) =>
      item.icon && !/^(http|file:|data:)/.test(item.icon)
        ? { ...item, _resolvedIcon: pathToFileURL(path.join(pluginPath, item.icon)).href }
        : item
    )
  }

  /**
   * 通知插件用户选择了 mainPush 结果
   * @param pluginPath 插件路径
   * @param _featureCode 功能代码
   * @param selectData 选择快照
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

    return this.requestPluginReply<any>(
      plugin.view.webContents,
      'main-push-select',
      'main-push-select-result-',
      { selectData },
      null
    ).then((result) => !!(result?.success && result.shouldEnterPlugin))
  }

  /**
   * 处理主窗口插件 WebContents 上报的 ESC，并按用户设置返回搜索或直接隐藏。
   * @returns 无返回值。
   */
  public handlePluginEsc(): void {
    // 记录 ESC 触发时间
    this.lastPluginEscTime = Date.now()

    const settings = databaseAPI.dbGet('settings-general') || {}
    if (settings.hideMainWindowOnPluginEsc === true) {
      // 隐藏流程会按已强制为 immediately 的自动返回配置在后台退出插件。
      console.log('[Plugin] 插件按下 ESC，直接隐藏主窗口')
      windowManager.hideWindow()
      return
    }

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
   * @param enterParam 插件进入参数；省略时捕获目标插件的启动快照
   * @returns 创建结果
   */
  public async createPluginInDetachedWindow(
    pluginPath: string,
    featureCode: string,
    enterParam?: PluginEnterPayload
  ): Promise<{ success: boolean; error?: string }> {
    const launchSnapshot = structuredClone(enterParam ?? api.getLaunchParam(pluginPath))
    try {
      console.log('[Plugin] 直接在独立窗口中创建插件:', { pluginPath, featureCode })

      if (
        await this.reuseDetachedSingletonIfExists(
          pluginPath,
          featureCode,
          'detached-window',
          launchSnapshot
        )
      ) {
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
          searchPlaceholder: '搜索...',
          toggleDevTools: (webContents, currentPluginPath) =>
            this.togglePluginDevTools(webContents, currentPluginPath)
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
        // 独立插件窗口加载完成后注入与主视图一致的主题色变量。
        void pluginView.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS)
        void pluginView.webContents.insertCSS(buildPluginThemeCSS(getCurrentPluginThemeState()))
        // 升级重开时优先使用快照，避免其他启动动作覆盖插件原进入参数。
        sendPluginLifecycle(pluginView, 'PluginEnter', launchSnapshot)
        this.recordEnterState(pluginPath, featureCode, launchSnapshot.type)
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
   * 将当前在主窗口中运行的插件视图迁移到独立窗口。
   * @returns 分离是否成功以及可选错误信息
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
      const request = this.activeLaunch

      // 读取插件配置
      const pluginJsonPath = path.join(this.currentPluginPath, 'plugin.json')
      const pluginConfig = JSON.parse(fsSync.readFileSync(pluginJsonPath, 'utf-8'))

      const storedSize = this.getStoredDetachedSize(cached.name)
      const defaultViewHeight = this.pluginDefaultHeight

      // 若存在历史尺寸则优先使用
      const windowWidth = storedSize?.width ?? 800
      const viewHeight = storedSize?.height ?? cached.height ?? defaultViewHeight

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

      // 异步焦点查询期间可能发生切换，只能分离仍属于本次操作的当前视图。
      if (this.pluginView !== cached.view || this.activeLaunch !== request) {
        return { success: false, error: '当前插件已切换' }
      }
      sendPluginLifecycle(cached.view, 'PluginDetach')

      // 使用新的分离窗口管理器创建窗口（使用缓存的搜索框状态）
      const detachedWindow = detachedWindowManager.createDetachedWindow(
        cached.path,
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
          autoFocusSubInput: shouldAutoFocusSubInput, // 只有主窗口输入框聚焦时才自动聚焦
          // 独立标题栏可能晚于请求开始加载，因此初始化时同步当前聚合状态。
          aiRequestStatus: aiRequestStatusTracker.get(cached.view.webContents.id),
          toggleDevTools: (webContents, currentPluginPath) =>
            this.togglePluginDevTools(webContents, currentPluginPath)
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
      this.activeLaunch = null

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

  /**
   * 读取「插件名 -> 已授权 internal 通道列表」映射。
   * @returns 归一化后的按通道授权映射
   */
  public getCustomInternalApiPermissions(): Record<string, string[]> {
    const settings = databaseAPI.dbGet('settings-general') || {}
    return normalizeInternalApiPermissionsMap(settings[CUSTOM_INTERNAL_API_PERMISSIONS_KEY])
  }

  /**
   * 计算插件当前生效的高级 API 鉴权信息。
   * 被停用名单命中的插件按通道授权与完全授权同时失效；
   * 硬编码可信插件（内置 + 开发者工具）承载宿主核心功能，不允许被停用。
   * @param pluginName 插件名
   * @param settings 已读取的 settings-general 数据
   * @returns 生效的完全授权标记与按通道授权列表
   */
  private resolveInternalApiAuth(
    pluginName: string,
    settings: Record<string, unknown>
  ): { canUseInternalApi: boolean; internalApiPermissions: string[] } {
    const customInternalApiPluginNames = normalizeCustomInternalApiPluginNames(
      settings[CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY]
    )
    const internalApiPermissions = normalizeInternalApiPermissionsMap(
      settings[CUSTOM_INTERNAL_API_PERMISSIONS_KEY]
    )
    const disabledPluginNames = normalizeInternalApiDisabledPluginList(
      settings[CUSTOM_INTERNAL_API_DISABLED_KEY]
    )

    // 硬编码可信插件跳过停用判定，其余插件一旦进入停用名单即挂起全部高级 API 权限。
    const suspended =
      !isTrustedInternalApiPlugin(pluginName) && disabledPluginNames.includes(pluginName)
    if (suspended) {
      return { canUseInternalApi: false, internalApiPermissions: [] }
    }
    return {
      canUseInternalApi: canPluginUseInternalApi(pluginName, customInternalApiPluginNames),
      internalApiPermissions: internalApiPermissions[pluginName] ?? []
    }
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
    internalApiPermissions: string[]
    isBundledInternal: boolean
    logo?: string
  } | null {
    // 鉴权数据每次调用实时读取，保证设置页授权变更对已打开插件立即生效。
    const settings = databaseAPI.dbGet('settings-general') || {}

    // 1. 先检查主窗口中的插件视图
    for (const pluginViewInfo of this.pluginViews) {
      if (pluginViewInfo.view.webContents === webContents) {
        const auth = this.resolveInternalApiAuth(pluginViewInfo.name, settings)
        return {
          name: pluginViewInfo.name,
          path: pluginViewInfo.path,
          canUseInternalApi: auth.canUseInternalApi,
          internalApiPermissions: auth.internalApiPermissions,
          isBundledInternal: isBundledInternalPlugin(pluginViewInfo.name),
          logo: pluginViewInfo.logo
        }
      }
    }

    // 2. 检查分离窗口中的插件
    const detachedWindows = detachedWindowManager.getAllWindows()
    for (const windowInfo of detachedWindows) {
      if (windowInfo.view.webContents === webContents) {
        const auth = this.resolveInternalApiAuth(windowInfo.pluginName, settings)
        return {
          name: windowInfo.pluginName,
          path: windowInfo.pluginPath,
          canUseInternalApi: auth.canUseInternalApi,
          internalApiPermissions: auth.internalApiPermissions,
          isBundledInternal: isBundledInternalPlugin(windowInfo.pluginName)
        }
      }
    }

    return null
  }

  /**
   * 获取调用 WebContents 对应清单中的规范插件名称。
   * @param webContents 插件页面的 WebContents 实例。
   * @returns 清单名称与运行时插件匹配时返回规范名称，否则返回 null。
   */
  public getPluginManifestNameByWebContents(webContents: WebContents): string | null {
    const pluginInfo = this.getPluginInfoByWebContents(webContents)
    if (!pluginInfo) return null

    try {
      // 开发插件会附加 __dev 后缀，鉴权身份仍使用原始清单名称。
      const manifestName = this.readPluginConfig(pluginInfo.path)?.name
      if (typeof manifestName !== 'string' || !manifestName.trim()) return null
      const canonicalName = manifestName.trim()
      if (pluginInfo.name !== canonicalName && pluginInfo.name !== `${canonicalName}__dev`) {
        return null
      }
      return canonicalName
    } catch {
      return null
    }
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
   * 向所有运行中插件的 WebContents 广播消息（主窗口插件视图 + 分离窗口插件）。
   * 插件 preload 中通过 ipcRenderer.on 注册的监听由此送达。
   * @param channel IPC 通道名
   * @param args 广播参数
   * @returns 无返回值
   */
  public broadcastToPluginWebContents(channel: string, ...args: unknown[]): void {
    const targets = new Set<WebContents>()
    for (const view of this.pluginViews) targets.add(view.view.webContents)
    for (const windowInfo of detachedWindowManager.getAllWindows()) {
      targets.add(windowInfo.view.webContents)
    }
    for (const webContents of targets) {
      if (!webContents.isDestroyed()) webContents.send(channel, ...args)
    }
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
