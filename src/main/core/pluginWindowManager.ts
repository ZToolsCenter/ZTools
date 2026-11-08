import {
  BrowserWindow,
  session,
  type BrowserWindowConstructorOptions,
  type WebFrameMain
} from 'electron'
import path from 'path'
import mainPreload from '../../../resources/preload.js?asset'
import proxyManager from '../managers/proxyManager'
import { GLOBAL_SCROLLBAR_CSS } from './globalStyles'
import { buildPluginThemeCSS, getCurrentPluginThemeState } from './pluginTheme'
import { resolvePluginWindowUrl } from '../utils/pluginUrl'
import { ensurePluginSessionPreload } from './pluginSessionPreload'

/**
 * 插件可用的 BrowserWindow / WebContents 方法白名单
 *
 * 严格对齐 utools Fe 常量，不增不减。
 * 计数：windowMethods(94) + windowInvokes(1) + webContentsMethods(59) + webContentsInvokes(11) = 165
 */
export const winIpc = {
  windowMethods: [
    'destroy',
    'close',
    'focus',
    'blur',
    'isFocused',
    'isDestroyed',
    'show',
    'showInactive',
    'hide',
    'isVisible',
    'maximize',
    'unmaximize',
    'isMaximized',
    'minimize',
    'restore',
    'isMinimized',
    'setFullScreen',
    'isFullScreen',
    'setSimpleFullScreen',
    'isSimpleFullScreen',
    'isNormal',
    'setAspectRatio',
    'setBackgroundColor',
    'previewFile',
    'closeFilePreview',
    'setBounds',
    'getBounds',
    'getBackgroundColor',
    'setContentBounds',
    'getContentBounds',
    'getNormalBounds',
    'setEnabled',
    'isEnabled',
    'setSize',
    'getSize',
    'setContentSize',
    'getContentSize',
    'setMinimumSize',
    'getMinimumSize',
    'setMaximumSize',
    'getMaximumSize',
    'setResizable',
    'isResizable',
    'setMovable',
    'isMovable',
    'setMinimizable',
    'isMinimizable',
    'setMaximizable',
    'isMaximizable',
    'setFullScreenable',
    'isFullScreenable',
    'setClosable',
    'isClosable',
    'setAlwaysOnTop',
    'isAlwaysOnTop',
    'moveAbove',
    'moveTop',
    'center',
    'setPosition',
    'getPosition',
    'setTitle',
    'getTitle',
    'setSheetOffset',
    'flashFrame',
    'setSkipTaskbar',
    'setKiosk',
    'isKiosk',
    'isTabletMode',
    'getMediaSourceId',
    'getNativeWindowHandle',
    'setRepresentedFilename',
    'getRepresentedFilename',
    'setDocumentEdited',
    'isDocumentEdited',
    'focusOnWebView',
    'blurWebView',
    'setProgressBar',
    'setHasShadow',
    'hasShadow',
    'setOpacity',
    'getOpacity',
    'setShape',
    'showDefinitionForSelection',
    'setIcon',
    'setWindowButtonVisibility',
    'setVisibleOnAllWorkspaces',
    'isVisibleOnAllWorkspaces',
    'setIgnoreMouseEvents',
    'setContentProtection',
    'setFocusable',
    'setAutoHideCursor',
    'setVibrancy',
    'setTrafficLightPosition',
    'getTrafficLightPosition'
  ] as const,

  windowInvokes: ['capturePage'] as const,

  webContentsMethods: [
    'isDestroyed',
    'focus',
    'isFocused',
    'isLoading',
    'isLoadingMainFrame',
    'isWaitingForResponse',
    'isCrashed',
    'setUserAgent',
    'getUserAgent',
    'setIgnoreMenuShortcuts',
    'setAudioMuted',
    'isAudioMuted',
    'isCurrentlyAudible',
    'setZoomFactor',
    'getZoomFactor',
    'setZoomLevel',
    'getZoomLevel',
    'undo',
    'redo',
    'cut',
    'copy',
    'copyImageAt',
    'paste',
    'pasteAndMatchStyle',
    'delete',
    'selectAll',
    'unselect',
    'replace',
    'replaceMisspelling',
    'findInPage',
    'stopFindInPage',
    'isBeingCaptured',
    'incrementCapturerCount',
    'decrementCapturerCount',
    'getPrinters',
    'openDevTools',
    'closeDevTools',
    'isDevToolsOpened',
    'isDevToolsFocused',
    'toggleDevTools',
    'send',
    'sendToFrame',
    'enableDeviceEmulation',
    'disableDeviceEmulation',
    'sendInputEvent',
    'showDefinitionForSelection',
    'isOffscreen',
    'startPainting',
    'stopPainting',
    'isPainting',
    'setFrameRate',
    'getFrameRate',
    'invalidate',
    'getWebRTCIPHandlingPolicy',
    'setWebRTCIPHandlingPolicy',
    'getOSProcessId',
    'getProcessId',
    'getBackgroundThrottling',
    'setBackgroundThrottling'
  ] as const,

  webContentsInvokes: [
    'insertCSS',
    'removeInsertedCSS',
    'executeJavaScript',
    'executeJavaScriptInIsolatedWorld',
    'setVisualZoomLevelLimits',
    'insertText',
    'capturePage',
    'print', // 特殊处理：callback→Promise 包装
    'printToPDF',
    'savePage',
    'takeHeapSnapshot'
  ] as const
} as const

/**
 * 插件窗口信息
 */
interface PluginWindowInfo {
  window: BrowserWindow
  parentWebContents: Electron.WebContents
  pluginPath: string
  pluginName: string
  sessionPartition: string
}

class PluginWindowManager {
  /** win.id → 窗口信息 */
  private windowInfoMap: Map<number, PluginWindowInfo> = new Map()

  /**
   * 创建独立窗口并在首次 DOM 就绪时通知发起创建的文档。
   * @param pluginPath 插件实体路径。
   * @param pluginName 插件名称。
   * @param sessionPartition 共享 Session 分区名称。
   * @param url 独立窗口的本地页面地址。
   * @param options 窗口创建配置。
   * @param senderWebContents 创建窗口的插件实例。
   * @param callbackFrame 接收创建通知的文档；未传回调时为 null。
   * @returns 已登记的独立窗口。
   * @throws 地址无效或 Electron 创建窗口失败时抛出原始错误。
   */
  public createWindow(
    pluginPath: string,
    pluginName: string,
    sessionPartition: string,
    url: string,
    options: BrowserWindowConstructorOptions = {},
    senderWebContents: Electron.WebContents,
    callbackFrame: WebFrameMain | null
  ): BrowserWindow {
    // 先解析 URL，避免非法地址留下已创建但未加载的窗口。
    const loadUrl = resolvePluginWindowUrl(pluginPath, url)

    // 处理 preload 路径（如果是相对路径）
    let preloadPath = options?.webPreferences?.preload
    if (preloadPath && !path.isAbsolute(preloadPath)) {
      preloadPath = path.join(pluginPath, preloadPath)
    }

    // 使用插件名称创建 session，确保和插件主视图共享同一个 session
    const sess = session.fromPartition(sessionPartition)
    ensurePluginSessionPreload(sess, mainPreload)

    // 应用代理配置到插件 session
    proxyManager
      .applyProxyToSession(sess, `插件窗口 ${pluginName} (${sessionPartition})`)
      .catch((error) => {
        console.error(
          `[pluginWindow:create] 插件窗口 ${pluginName} (${sessionPartition}) 应用代理配置失败:`,
          error
        )
      })

    const win = new BrowserWindow({
      ...options,
      webPreferences: {
        ...options?.webPreferences,
        preload: preloadPath,
        session: sess,
        contextIsolation: false,
        nodeIntegration: false,
        webSecurity: false,
        sandbox: false
      }
    })

    // 保存窗口信息（以 win.id 为键）
    this.windowInfoMap.set(win.id, {
      window: win,
      parentWebContents: senderWebContents,
      pluginPath,
      pluginName,
      sessionPartition
    })

    const winId = win.id
    const contents = win.webContents
    let pendingFrame = callbackFrame
    let hasCommittedDocument = false

    // Chromium 的错误页也可能触发 dom-ready，只有成功的主文档导航才允许回调。
    contents.once('did-navigate', () => {
      hasCommittedDocument = true
    })

    /**
     * 送达或取消该窗口的一次性创建通知。
     * @param ready 独立窗口是否已到达首次 DOM 就绪。
     * @returns 无返回值。
     */
    function finishCreation(ready: boolean): void {
      // 先消费通知目标，后续导航、重载或关闭不会重复通知。
      const target = pendingFrame
      pendingFrame = null
      if (!target) return
      try {
        if (!target.detached) target.send('plugin-window:creation-complete', winId, ready)
      } catch (error) {
        // 创建者可能在消息送达前已导航或退出，不影响独立窗口。
        console.warn(`[pluginWindow:callback] winId=${winId} 创建通知发送失败:`, error)
      }
    }

    contents.on('dom-ready', () => {
      // 子窗口 DOM 就绪后注入全局样式、主题色和默认字体。
      void contents.insertCSS(GLOBAL_SCROLLBAR_CSS)
      void contents.insertCSS(buildPluginThemeCSS(getCurrentPluginThemeState()))
      void contents.insertCSS(
        'body { font-family: system-ui, "PingFang SC", "Helvetica Neue", "Microsoft Yahei", sans-serif; }'
      )
      // 保留首次 DOM 就绪时机，后续文档只重新注入样式。
      if (hasCommittedDocument) finishCreation(true)
    })
    contents.once('destroyed', () => finishCreation(false))

    win.webContents.on('render-process-gone', (_event, details) => {
      if (win.isDestroyed()) return
      console.warn(
        `[pluginWindow:render-process-gone] winId=${win.id} plugin=${pluginName} reason=${details.reason} exitCode=${details.exitCode}`
      )
      win.destroy()
    })

    // 监听窗口关闭
    win.on('closed', () => {
      console.info(
        `[pluginWindow:destroy] winId=${win.id} unregistered from plugin=${pluginName} partition=${sessionPartition}`
      )
      this.windowInfoMap.delete(win.id)
    })

    // 先监听生命周期再加载，失败时取消未送达的回调。
    void win.loadURL(loadUrl).catch(() => finishCreation(false))

    console.info(
      `[pluginWindow:create] plugin=${pluginName} partition=${sessionPartition} winId=${win.id} url=${url} → ${loadUrl}`
    )

    return win
  }

  /**
   * 根据 win.id 获取窗口所属的插件名称（用于所有权校验）
   */
  public getPluginNameByWindowId(winId: number): string | null {
    return this.windowInfoMap.get(winId)?.pluginName ?? null
  }

  /**
   * 根据 win.id 获取窗口所属的插件路径，用于同名变体之间的权限校验。
   */
  public getPluginPathByWindowId(winId: number): string | null {
    return this.windowInfoMap.get(winId)?.pluginPath ?? null
  }

  /**
   * 发送消息到父窗口
   */
  public sendToParent(senderWebContents: Electron.WebContents, channel: string, args: any[]): void {
    const senderId = senderWebContents.id
    for (const windowInfo of this.windowInfoMap.values()) {
      if (windowInfo.window.webContents === senderWebContents) {
        const parent = windowInfo.parentWebContents
        if (parent && !parent.isDestroyed()) {
          parent.send('__ipc_sendto_relay__', { senderId, channel, args })
          return
        }
        break
      }
    }
    console.warn('[pluginWindow:method] 父窗口不存在或已销毁')
  }

  /**
   * 根据 webContentsId 获取插件路径
   */
  public getPluginPathByWebContentsId(webContentsId: number): string | null {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed() && windowInfo.window.webContents.id === webContentsId) {
        return windowInfo.pluginPath
      }
    }
    return null
  }

  /**
   * 根据 webContentsId 获取插件名称
   */
  public getPluginNameByWebContentsId(webContentsId: number): string | null {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed() && windowInfo.window.webContents.id === webContentsId) {
        return windowInfo.pluginName
      }
    }
    return null
  }

  /**
   * 关闭指定插件的所有窗口
   */
  public closeByPlugin(pluginPath: string): void {
    const windowIdsToClose: number[] = []

    for (const [winId, windowInfo] of this.windowInfoMap.entries()) {
      if (windowInfo.pluginPath === pluginPath) {
        windowIdsToClose.push(winId)
      }
    }

    for (const winId of windowIdsToClose) {
      const windowInfo = this.windowInfoMap.get(winId)
      if (windowInfo && !windowInfo.window.isDestroyed()) {
        windowInfo.window.destroy()
      }
      this.windowInfoMap.delete(winId)
    }

    console.log(
      `[pluginWindow:destroy] 已关闭插件 ${pluginPath} 的 ${windowIdsToClose.length} 个窗口`
    )
  }

  /**
   * 检查指定插件是否有打开的窗口
   */
  public hasWindowsByPlugin(pluginPath: string): boolean {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (windowInfo.pluginPath === pluginPath && !windowInfo.window.isDestroyed()) {
        return true
      }
    }
    return false
  }

  /**
   * 检查 WebContents 是否属于 browser 窗口
   */
  public isBrowserWindow(webContents: Electron.WebContents): boolean {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed() && windowInfo.window.webContents.id === webContents.id) {
        return true
      }
    }
    return false
  }

  /**
   * 关闭所有窗口
   */
  public closeAll(): void {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.close()
      }
    }
    this.windowInfoMap.clear()
  }

  /**
   * 广播消息到所有插件窗口
   */
  public broadcastToAll(channel: string, ...args: any[]): void {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.webContents.send(channel, ...args)
      }
    }
  }

  /**
   * 在所有插件自建窗口中执行主题更新脚本。
   * @param script 要在插件页面主世界执行的 JavaScript。
   * @returns 所有窗口完成执行后的 Promise。
   */
  public async executeJavaScriptOnAllWindows(script: string): Promise<void> {
    const tasks: Promise<unknown>[] = []
    // 快照窗口集合，避免执行期间窗口关闭导致遍历状态变化。
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed() && !windowInfo.window.webContents.isDestroyed()) {
        // 捕获窗口销毁竞态导致的同步异常，避免主题广播被单个窗口中断。
        tasks.push(
          Promise.resolve().then(() =>
            windowInfo.window.webContents.executeJavaScript(script, true)
          )
        )
      }
    }
    await Promise.allSettled(tasks)
  }
}

export default new PluginWindowManager()
