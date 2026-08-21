import { app, BrowserWindow, ipcMain, Menu, WebContentsView } from 'electron'
import { fileURLToPath, pathToFileURL } from 'url'
import { v4 as uuidv4 } from 'uuid'
import databaseAPI from '../api/shared/database'
import { applyWindowMaterial } from '../utils/windowUtils'
import { GLOBAL_SCROLLBAR_CSS } from './globalStyles.js'
import lmdbInstance from './lmdb/lmdbInstance'
import devToolsShortcut, { getDevToolsMode } from '../utils/devToolsShortcut'
import { WINDOW_WIDTH } from '../common/constants'
import { registerExternalLinkInterceptor } from '../managers/pluginManager'
import pluginWindowManager from './pluginWindowManager'
import { getDetachedWindowSizeKey } from '../../shared/pluginRuntimeNamespace'
import { getPreloadPath, getRendererPath } from '../utils/appBundlePath'
import type { AiRequestStatus } from '../../shared/aiRequestStatus'

export const DETACHED_TITLEBAR_HEIGHT = 52
const MIN_WINDOW_WIDTH = 400
const MIN_WINDOW_HEIGHT = 300
const MIN_VIEW_HEIGHT = MIN_WINDOW_HEIGHT - DETACHED_TITLEBAR_HEIGHT

/**
 * 分离窗口信息
 */
interface DetachedWindowInfo {
  window: BrowserWindow
  view: WebContentsView
  pluginPath: string
  pluginName: string
  pluginLogo?: string
  isAlwaysOnTop: boolean
  lastFocusTarget: 'titlebar' | 'plugin' // 记录最后一次焦点位置，用于窗口恢复
  savedFocusTarget: 'titlebar' | 'plugin' // 窗口失焦时快照的焦点状态
}

export interface DetachedPluginUpgradeSnapshot {
  windowId: string
  pluginName: string
  pluginPath: string
  width: number
  viewHeight: number
}

/**
 * 分离窗口管理器 - 专门管理从主窗口分离出来的插件窗口
 */
class DetachedWindowManager {
  private detachedWindowMap: Map<string, DetachedWindowInfo> = new Map()
  private resizeSaveTimers: Map<string, NodeJS.Timeout> = new Map()
  private lastSavedSizeByPlugin: Map<string, { width: number; height: number }> = new Map()
  private suppressedSizePersistenceWindows = new Set<string>()

  /**
   * 应用窗口材质（Windows 11）
   */
  private async applyWindowMaterial(win: BrowserWindow): Promise<void> {
    try {
      const settings = await lmdbInstance.promises.get('ZTOOLS/settings-general')
      const material = (settings?.data?.windowMaterial as 'mica' | 'acrylic' | 'none') || 'none'

      console.log('[DetachedWindow] 分离窗口应用材质:', material)
      applyWindowMaterial(win, material)
    } catch (error) {
      console.error('[DetachedWindow] 读取窗口材质配置失败，使用默认值 (mica):', error)
      applyWindowMaterial(win, 'none')
    }
  }

  /**
   * 将分离窗口尺寸持久化到数据库（按插件名归档）
   */
  private persistWindowSize(pluginName: string, width: number, viewHeight: number): void {
    try {
      const normalizedWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(width))
      const normalizedHeight = Math.max(MIN_VIEW_HEIGHT, Math.round(viewHeight))
      const sizeKey = getDetachedWindowSizeKey(pluginName)

      const lastSaved = this.lastSavedSizeByPlugin.get(sizeKey)
      if (
        lastSaved &&
        lastSaved.width === normalizedWidth &&
        lastSaved.height === normalizedHeight
      ) {
        return
      }

      const existing = databaseAPI.dbGet('detached-window-sizes') || {}
      const next = {
        ...(typeof existing === 'object' && existing !== null ? existing : {}),
        [sizeKey]: {
          width: normalizedWidth,
          height: normalizedHeight
        }
      }

      databaseAPI.dbPut('detached-window-sizes', next)
      this.lastSavedSizeByPlugin.set(sizeKey, {
        width: normalizedWidth,
        height: normalizedHeight
      })
    } catch (error) {
      console.error('[DetachedWindow] 保存分离窗口尺寸失败:', error)
    }
  }

  /**
   * 防抖保存尺寸，避免频繁写入
   */
  private schedulePersistWindowSize(
    windowId: string,
    pluginName: string,
    width: number,
    viewHeight: number
  ): void {
    const existingTimer = this.resizeSaveTimers.get(windowId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      this.persistWindowSize(pluginName, width, viewHeight)
      this.resizeSaveTimers.delete(windowId)
    }, 300)

    this.resizeSaveTimers.set(windowId, timer)
  }

  /**
   * 创建承载指定插件视图的独立窗口，并初始化自定义标题栏状态。
   * @param pluginPath 插件物理路径
   * @param pluginName 插件运行时名称
   * @param pluginView 待迁移的插件 WebContentsView
   * @param options 独立窗口尺寸、标题栏和焦点配置
   * @returns 创建成功的独立窗口；创建失败时返回 null
   */
  public createDetachedWindow(
    pluginPath: string,
    pluginName: string,
    pluginView: WebContentsView,
    options: {
      width: number
      height: number
      title: string
      logo?: string
      searchQuery?: string // 搜索框当前值
      searchPlaceholder?: string // 搜索框占位符
      subInputVisible?: boolean // 子输入框是否可见
      autoFocusSubInput?: boolean // 是否自动聚焦子输入框
      aiRequestStatus?: AiRequestStatus // 分离前该插件已有的 AI 请求状态
    }
  ): BrowserWindow | null {
    try {
      const windowId = uuidv4()

      // 创建窗口（macOS 和 Windows 都使用无边框，macOS 保留交通灯）
      const isMac = process.platform === 'darwin'
      const isWindows = process.platform === 'win32'

      const windowConfig: Electron.BrowserWindowConstructorOptions = {
        width: options.width,
        height: options.height + DETACHED_TITLEBAR_HEIGHT,
        title: options.title,
        frame: false, // 两个平台都无边框
        titleBarStyle: isMac ? 'hiddenInset' : undefined, // macOS 保留交通灯按钮
        ...(isMac && {
          trafficLightPosition: { x: 15, y: 18 } // macOS 交通灯垂直居中
        }),
        resizable: true,
        minWidth: WINDOW_WIDTH,
        minHeight: 52,
        hasShadow: true, // 启用窗口阴影（可调整为 false 来移除阴影）
        webPreferences: {
          preload: getPreloadPath(),
          backgroundThrottling: false, // 窗口最小化时是否继续动画和定时器
          contextIsolation: true, // 启用上下文隔离
          nodeIntegration: false, // 渲染进程禁止直接使用 Node
          spellcheck: false, // 禁用拼写检查
          webSecurity: false
        }
      }

      // macOS 系统配置：设置透明度和毛玻璃效果（与主窗口一致）
      if (isMac) {
        windowConfig.transparent = true
        windowConfig.vibrancy = 'fullscreen-ui'
      }
      // Windows 系统配置（与主窗口保持一致）
      else if (isWindows) {
        windowConfig.backgroundColor = '#00000000' // 完全透明，让 Mica 材质显示
        // 设置插件窗口独立图标
        if (options.logo) {
          try {
            windowConfig.icon = options.logo.startsWith('file:')
              ? fileURLToPath(options.logo)
              : options.logo
          } catch (error) {
            console.warn('[DetachedWindow] 设置窗口图标失败:', error)
          }
        }
      }

      const win = new BrowserWindow(windowConfig)

      // Windows 11 应用窗口材质（与主窗口保持一致）
      if (isWindows) {
        this.applyWindowMaterial(win)
        // 设置插件窗口ID，避免任务栏窗口合并
        win.setAppDetails({
          appId: 'ZTools.' + pluginName
        })
      }

      // 窗口直接加载标题栏 HTML
      const titlebarUrl =
        process.env.NODE_ENV === 'development'
          ? 'http://localhost:5174/detached-titlebar.html'
          : pathToFileURL(getRendererPath('detached-titlebar.html')).href

      win.loadURL(titlebarUrl)

      // 标题栏加载完成后发送插件信息，并添加插件视图
      win.webContents.on('did-finish-load', () => {
        console.log('[DetachedWindow] 标题栏加载完成，发送插件信息', {
          pluginName,
          options
        })
        win.webContents.send('init-titlebar', {
          pluginName,
          pluginPath,
          pluginLogo: options.logo,
          platform: process.platform,
          title: options.title, // 窗口标题
          searchQuery: options.searchQuery || '', // 搜索框初始值
          searchPlaceholder: options.searchPlaceholder || '搜索...', // 搜索框占位符
          subInputVisible: options.subInputVisible !== undefined ? options.subInputVisible : true, // 子输入框可见性
          aiRequestStatus: options.aiRequestStatus ?? 'idle'
        })

        // 注入全局滚动条样式到独立窗口的标题栏
        win.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS)

        // 添加插件视图（在标题栏下方）
        const bounds = win.getContentBounds()
        pluginView.setBounds({
          x: 0,
          y: DETACHED_TITLEBAR_HEIGHT,
          width: bounds.width,
          height: bounds.height - DETACHED_TITLEBAR_HEIGHT
        })
        win.contentView.addChildView(pluginView)

        // 如果需要自动聚焦子输入框，延迟聚焦搜索框（等待 DOM 渲染完成）
        if (options.autoFocusSubInput === true) {
          setTimeout(() => {
            win.webContents.focus()
            win.webContents.send('focus-sub-input')
          }, 100) // 延迟 100ms，确保 Vue 组件已经渲染
        } else {
          // 插件视图聚焦：分离前焦点在插件上，分离后恢复插件焦点
          setTimeout(() => {
            if (!pluginView.webContents.isDestroyed()) {
              pluginView.webContents.focus()
            }
          }, 100)
        }
      })

      // 监听窗口大小变化
      win.on('resize', () => {
        if (!win.isDestroyed()) {
          const newBounds = win.getContentBounds()
          // 只需要更新插件视图大小（标题栏由窗口自动处理）
          pluginView.setBounds({
            x: 0,
            y: DETACHED_TITLEBAR_HEIGHT,
            width: newBounds.width,
            height: newBounds.height - DETACHED_TITLEBAR_HEIGHT
          })

          // 升级期间的 0 高度是临时状态，不得覆盖用户保存的窗口尺寸。
          if (!this.suppressedSizePersistenceWindows.has(windowId)) {
            this.schedulePersistWindowSize(
              windowId,
              pluginName,
              newBounds.width,
              newBounds.height - DETACHED_TITLEBAR_HEIGHT
            )
          }
        }
      })

      // 保存窗口信息
      const windowInfo: DetachedWindowInfo = {
        window: win,
        view: pluginView,
        pluginPath,
        pluginName,
        pluginLogo: options.logo,
        isAlwaysOnTop: false,
        lastFocusTarget: options.autoFocusSubInput ? 'titlebar' : 'plugin',
        savedFocusTarget: options.autoFocusSubInput ? 'titlebar' : 'plugin'
      }
      this.detachedWindowMap.set(windowId, windowInfo)

      // 监听窗口关闭
      win.on('closed', () => {
        this.detachedWindowMap.delete(windowId)
        this.suppressedSizePersistenceWindows.delete(windowId)
        const timer = this.resizeSaveTimers.get(windowId)
        if (timer) {
          clearTimeout(timer)
          this.resizeSaveTimers.delete(windowId)
        }
        // 关闭该插件通过 createBrowserWindow 创建的所有独立窗口
        pluginWindowManager.closeByPlugin(pluginPath)
        // 销毁插件视图的 webContents
        if (!pluginView.webContents.isDestroyed()) {
          pluginView.webContents.close()
        }
        console.log(`[DetachedWindow] 分离窗口已关闭: ${pluginName}`)
        // 更新 Dock 图标显示状态
        this.updateDockVisibility()
      })

      // 设置 IPC 通信（标题栏控制窗口）
      this.setupTitlebarIPC(windowId)

      // 显示窗口
      win.show()

      // 焦点跟踪：实时记录焦点在标题栏还是插件视图
      win.webContents.on('focus', () => {
        windowInfo.lastFocusTarget = 'titlebar'
      })

      pluginView.webContents.on('focus', () => {
        windowInfo.lastFocusTarget = 'plugin'
        if (!pluginView.webContents.isDestroyed()) {
          devToolsShortcut.register(pluginView.webContents)
        }
      })

      pluginView.webContents.on('blur', () => {
        devToolsShortcut.unregister()
      })

      // 拦截外部链接跳转，使用系统默认浏览器打开
      registerExternalLinkInterceptor(pluginView.webContents)

      // 窗口失焦时快照焦点状态（此时 lastFocusTarget 还是正确的）
      win.on('blur', () => {
        windowInfo.savedFocusTarget = windowInfo.lastFocusTarget
      })

      // 窗口从后台恢复时，用快照状态恢复焦点
      // （此时 webContents focus 事件已经把 lastFocusTarget 覆盖成 titlebar 了）
      win.on('focus', () => {
        if (windowInfo.savedFocusTarget === 'plugin') {
          if (!pluginView.webContents.isDestroyed()) {
            pluginView.webContents.focus()
          }
        }
      })

      // 更新 Dock 图标显示状态
      this.updateDockVisibility()

      console.log(`[DetachedWindow] 创建分离窗口成功: ${pluginName}`)
      return win
    } catch (error) {
      console.error('[DetachedWindow] 创建分离窗口失败:', error)
      return null
    }
  }

  /**
   * 设置标题栏 IPC 通信
   */
  private setupTitlebarIPC(windowId: string): void {
    const windowInfo = this.detachedWindowMap.get(windowId)
    if (!windowInfo) return

    const { window: win, view: pluginView } = windowInfo

    // 使用闭包保存 windowInfo，避免后续查找
    const handleTitlebarAction = (_event: Electron.IpcMainEvent, action: string): void => {
      // 验证事件来自这个窗口
      if (_event.sender.id !== win.webContents.id) return
      if (win.isDestroyed()) return

      switch (action) {
        case 'minimize':
          win.minimize()
          break
        case 'maximize':
          if (win.isMaximized()) {
            win.unmaximize()
          } else {
            win.maximize()
          }
          break
        case 'close':
          win.close()
          break
        case 'toggle-pin':
          windowInfo.isAlwaysOnTop = !windowInfo.isAlwaysOnTop
          win.setAlwaysOnTop(windowInfo.isAlwaysOnTop)
          win.webContents.send('pin-state-changed', windowInfo.isAlwaysOnTop)
          break
        case 'open-devtools':
          if (!pluginView.webContents.isDestroyed()) {
            // 切换开发者工具（打开/关闭）
            if (pluginView.webContents.isDevToolsOpened()) {
              pluginView.webContents.closeDevTools()
            } else {
              const mode = getDevToolsMode()
              if (!pluginView.webContents.isDestroyed()) {
                pluginView.webContents.openDevTools({ mode })
              }
            }
          }
          break
      }
    }

    const handleSearchInput = (_event: Electron.IpcMainEvent, value: string): void => {
      // 验证事件来自这个窗口
      if (_event.sender.id !== win.webContents.id) return
      if (!pluginView.webContents.isDestroyed()) {
        // 发送对象格式，和主窗口保持一致
        pluginView.webContents.send('sub-input-change', { text: value })
      }
    }

    const handleTitlebarDblClick = (_event: Electron.IpcMainEvent): void => {
      // 验证事件来自这个窗口
      if (_event.sender.id !== win.webContents.id) return
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }

    const handleSendArrowKey = (_event: Electron.IpcMainEvent, keyEvent: any): void => {
      // 验证事件来自这个窗口
      if (_event.sender.id !== win.webContents.id) return
      if (!pluginView.webContents.isDestroyed()) {
        // 发送方向键到插件
        pluginView.webContents.sendInputEvent(keyEvent)
      }
    }

    const handleShowPluginMenu = (_event: Electron.IpcMainEvent, menuItems: any[]): void => {
      // 验证事件来自这个窗口
      if (_event.sender.id !== win.webContents.id) return

      // 构建菜单
      const menu = Menu.buildFromTemplate(
        menuItems.map((item: any) => ({
          label: item.label,
          type: item.type,
          checked: item.checked,
          click: () => {
            // 返回点击结果给标题栏
            win.webContents.send('detached-menu-result', { id: item.id })
          }
        }))
      )

      // 显示菜单
      menu.popup({ window: win })
    }

    // 监听标题栏发送的窗口控制命令
    ipcMain.on('titlebar-action', handleTitlebarAction)

    // 监听搜索框输入
    ipcMain.on('search-input', handleSearchInput)

    // 监听双击标题栏（macOS 行为：最大化/还原）
    if (process.platform === 'darwin') {
      ipcMain.on('titlebar-dblclick', handleTitlebarDblClick)
    }

    // 监听方向键事件
    ipcMain.on('send-arrow-key', handleSendArrowKey)

    // 监听插件设置菜单请求
    ipcMain.on('show-plugin-menu', handleShowPluginMenu)

    // 窗口关闭时移除监听器
    win.once('closed', () => {
      ipcMain.off('titlebar-action', handleTitlebarAction)
      ipcMain.off('search-input', handleSearchInput)
      ipcMain.off('send-arrow-key', handleSendArrowKey)
      ipcMain.off('show-plugin-menu', handleShowPluginMenu)
      if (process.platform === 'darwin') {
        ipcMain.off('titlebar-dblclick', handleTitlebarDblClick)
      }
    })
  }

  /**
   * 聚焦指定插件的分离窗口（单例模式使用）
   * 如果插件已有分离窗口，则聚焦该窗口并返回 true
   */
  public focusByPlugin(pluginPath: string): boolean {
    for (const windowInfo of this.detachedWindowMap.values()) {
      if (windowInfo.pluginPath === pluginPath && !windowInfo.window.isDestroyed()) {
        if (windowInfo.window.isMinimized()) windowInfo.window.restore()
        // fix: macOS 上分离窗口即使已经是显示状态，也可能被其他 App/window 完全盖住，
        // 单独 focus() 不一定能提升窗口层级，所以先 show() 再 focus()，确保重入插件时窗口前置。
        if (process.platform === 'darwin') windowInfo.window.show()
        windowInfo.window.focus()
        return true
      }
    }
    return false
  }

  /**
   * 获取指定插件的分离窗口中的 WebContentsView（单例重入使用）
   */
  public getViewByPlugin(pluginPath: string): WebContentsView | null {
    for (const windowInfo of this.detachedWindowMap.values()) {
      if (windowInfo.pluginPath === pluginPath && !windowInfo.window.isDestroyed()) {
        return windowInfo.view
      }
    }
    return null
  }

  /**
   * 保存指定独立窗口的尺寸，并将插件内容区收起到 0 高度等待升级。
   * @param pluginName 需要升级的插件名称
   * @param pluginPath 当前插件物理路径
   * @param webContents 发起升级的独立标题栏 WebContents
   * @returns 独立窗口升级快照；调用来源或插件不匹配时返回 null
   */
  public collapsePluginForUpgrade(
    pluginName: string,
    pluginPath: string,
    webContents: Electron.WebContents
  ): DetachedPluginUpgradeSnapshot | null {
    for (const [windowId, info] of this.detachedWindowMap.entries()) {
      if (
        info.window.isDestroyed() ||
        info.window.webContents.id !== webContents.id ||
        info.pluginName !== pluginName ||
        info.pluginPath !== pluginPath
      ) {
        continue
      }

      // 先保存真实内容尺寸，再抑制升级收起动作触发的尺寸持久化。
      const bounds = info.window.getContentBounds()
      const snapshot: DetachedPluginUpgradeSnapshot = {
        windowId,
        pluginName,
        pluginPath,
        width: bounds.width,
        viewHeight: Math.max(0, bounds.height - DETACHED_TITLEBAR_HEIGHT)
      }
      this.suppressedSizePersistenceWindows.add(windowId)

      // 保留标题栏及升级进度，隐藏即将被替换的插件内容。
      info.view.setBounds({
        x: 0,
        y: DETACHED_TITLEBAR_HEIGHT,
        width: bounds.width,
        height: 0
      })
      info.window.setContentSize(bounds.width, DETACHED_TITLEBAR_HEIGHT)
      return snapshot
    }

    return null
  }

  /**
   * 在升级失败且旧独立窗口仍存活时恢复原插件内容高度。
   * @param snapshot 升级开始前保存的独立窗口快照
   * @returns 是否成功恢复原独立窗口
   */
  public restorePluginAfterFailedUpgrade(snapshot: DetachedPluginUpgradeSnapshot): boolean {
    const info = this.detachedWindowMap.get(snapshot.windowId)
    if (
      !info ||
      info.window.isDestroyed() ||
      info.pluginName !== snapshot.pluginName ||
      info.pluginPath !== snapshot.pluginPath
    ) {
      return false
    }

    // 恢复前解除持久化抑制，让原始尺寸继续作为用户窗口尺寸保存。
    this.suppressedSizePersistenceWindows.delete(snapshot.windowId)
    info.window.setContentSize(snapshot.width, snapshot.viewHeight + DETACHED_TITLEBAR_HEIGHT)
    info.view.setBounds({
      x: 0,
      y: DETACHED_TITLEBAR_HEIGHT,
      width: snapshot.width,
      height: snapshot.viewHeight
    })
    info.window.show()
    info.window.focus()
    return true
  }

  /**
   * 关闭指定插件的所有分离窗口
   */
  public closeByPlugin(pluginPath: string): void {
    const windowIdsToClose: string[] = []

    for (const [windowId, windowInfo] of this.detachedWindowMap.entries()) {
      if (windowInfo.pluginPath === pluginPath) {
        windowIdsToClose.push(windowId)
      }
    }

    for (const windowId of windowIdsToClose) {
      const windowInfo = this.detachedWindowMap.get(windowId)
      if (windowInfo && !windowInfo.window.isDestroyed()) {
        windowInfo.window.destroy()
      }
      this.detachedWindowMap.delete(windowId)
    }

    console.log(
      `[DetachedWindow] 已关闭插件 ${pluginPath} 的 ${windowIdsToClose.length} 个分离窗口`
    )
  }

  /**
   * 关闭所有分离窗口
   */
  public closeAll(): void {
    for (const windowInfo of this.detachedWindowMap.values()) {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.close()
      }
    }
    this.detachedWindowMap.clear()
    // 更新 Dock 图标显示状态
    this.updateDockVisibility()
  }

  /**
   * 获取所有分离窗口
   */
  public getAllWindows(): DetachedWindowInfo[] {
    return Array.from(this.detachedWindowMap.values())
  }

  /**
   * 检查是否有分离窗口
   */
  public hasDetachedWindows(): boolean {
    return this.detachedWindowMap.size > 0
  }

  /**
   * 根据插件 webContents ID 查找对应的分离窗口
   */
  public getWindowByPluginWebContents(webContentsId: number): BrowserWindow | null {
    for (const windowInfo of this.detachedWindowMap.values()) {
      if (windowInfo.view.webContents.id === webContentsId) {
        return windowInfo.window
      }
    }
    return null
  }

  /**
   * 更新 macOS Dock 图标显示状态
   * 如果有分离窗口，显示 Dock 图标；否则隐藏
   */
  private updateDockVisibility(): void {
    if (process.platform === 'darwin') {
      if (this.hasDetachedWindows()) {
        app.dock?.show()
      } else {
        app.dock?.hide()
      }
    }
  }

  /**
   * 更新所有分离窗口的材质
   */
  public updateAllWindowsMaterial(material: 'mica' | 'acrylic' | 'none'): void {
    for (const [windowId, info] of this.detachedWindowMap.entries()) {
      try {
        // 更新主进程窗口材质
        applyWindowMaterial(info.window, material)
        console.log(`[DetachedWindow] 分离窗口 ${windowId} 材质已更新为 ${material}`)

        // 通知渲染进程更新样式
        info.window.webContents.send('update-window-material', material)
      } catch (error) {
        console.error(`[DetachedWindow] 更新分离窗口 ${windowId} 材质失败:`, error)
      }
    }
  }

  /**
   * 设置分离窗口中插件视图的高度
   */
  public setExpendHeight(webContentsId: number, height: number): void {
    for (const info of this.detachedWindowMap.values()) {
      if (info.view.webContents.id === webContentsId) {
        if (info.window.isDestroyed()) return

        const bounds = info.window.getContentBounds()
        const newWindowHeight = height + DETACHED_TITLEBAR_HEIGHT

        // 调整窗口大小
        info.window.setContentSize(bounds.width, newWindowHeight)

        // 调整插件视图大小
        info.view.setBounds({
          x: 0,
          y: DETACHED_TITLEBAR_HEIGHT,
          width: bounds.width,
          height: height
        })

        console.log('[DetachedWindow] 设置分离窗口插件高度:', height)
        return
      }
    }
  }

  /**
   * 检查 WebContents 是否属于分离窗口
   */
  public isDetachedWindow(webContents: Electron.WebContents): boolean {
    for (const info of Array.from(this.detachedWindowMap.values())) {
      // 检查窗口的主 WebContents
      if (!info.window.isDestroyed() && info.window.webContents.id === webContents.id) {
        return true
      }
      // 检查插件视图的 WebContents
      if (!info.view.webContents.isDestroyed() && info.view.webContents.id === webContents.id) {
        return true
      }
    }
    return false
  }

  /**
   * 广播消息到所有分离窗口
   */
  public broadcastToAllWindows(channel: string, ...args: any[]): void {
    for (const [windowId, info] of this.detachedWindowMap.entries()) {
      try {
        if (!info.window.isDestroyed()) {
          // 向标题栏页面发送
          info.window.webContents.send(channel, ...args)
        }
        if (!info.view.webContents.isDestroyed()) {
          // 向插件内容页面发送
          info.view.webContents.send(channel, ...args)
        }
      } catch (error) {
        console.error(`[DetachedWindow] 广播消息到分离窗口 ${windowId} 失败:`, error)
      }
    }
  }

  /**
   * 在所有分离窗口的插件内容页面中执行主题更新脚本。
   * @param script 要在插件页面主世界执行的 JavaScript。
   * @returns 所有插件页面完成执行后的 Promise。
   */
  public async executeJavaScriptOnPluginViews(script: string): Promise<void> {
    const tasks: Promise<unknown>[] = []
    // 只操作插件内容视图，不修改分离窗口的宿主标题栏页面。
    for (const info of this.detachedWindowMap.values()) {
      if (!info.view.webContents.isDestroyed()) {
        // 捕获窗口销毁竞态导致的同步异常，避免主题广播被单个窗口中断。
        tasks.push(
          Promise.resolve().then(() => info.view.webContents.executeJavaScript(script, true))
        )
      }
    }
    await Promise.allSettled(tasks)
  }
}

export default new DetachedWindowManager()
