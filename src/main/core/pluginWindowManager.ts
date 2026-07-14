/**
 * 插件子窗口管理器。
 *
 * 子窗口继承插件会话与虚拟根路径，负责把相对页面和插件 preload 安全解析到目录或 ASAR 内部。
 */

import { BrowserWindow, BrowserWindowConstructorOptions, session } from 'electron'
import path from 'path'
import { pathToFileURL } from 'node:url'
import mainPreload from '../../../resources/preload.js?asset'
import proxyManager from '../managers/proxyManager'
import { GLOBAL_SCROLLBAR_CSS } from './globalStyles'
import { registerPluginPreloadErrorReporter } from './pluginPreloadErrorReporter'

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
   * 创建插件独立窗口
   * @returns win.id（数字）
   */
  public createWindow(
    pluginPath: string,
    pluginName: string,
    sessionPartition: string,
    url: string,
    options: BrowserWindowConstructorOptions,
    senderWebContents: Electron.WebContents
  ): BrowserWindow {
    // 处理 preload 路径（如果是相对路径）
    let preloadPath = options.webPreferences?.preload
    if (preloadPath && !path.isAbsolute(preloadPath)) {
      preloadPath = path.join(pluginPath, preloadPath)
    }

    // 使用插件名称创建 session，确保和插件主视图共享同一个 session
    const sess = session.fromPartition(sessionPartition)
    sess.registerPreloadScript({
      type: 'frame',
      filePath: mainPreload
    })

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
        ...options.webPreferences,
        preload: preloadPath,
        session: sess,
        contextIsolation: false,
        nodeIntegration: false,
        webSecurity: false,
        sandbox: false
      }
    })

    if (preloadPath) {
      registerPluginPreloadErrorReporter({
        webContents: win.webContents,
        pluginName,
        preloadPath
      })
    }

    // 保存窗口信息（以 win.id 为键）
    this.windowInfoMap.set(win.id, {
      window: win,
      parentWebContents: senderWebContents,
      pluginPath,
      pluginName,
      sessionPartition
    })

    // 加载 URL
    if (url.startsWith('http')) {
      win.loadURL(url)
    } else if (url.startsWith('file:///')) {
      win.loadURL(url)
    } else {
      const loadUrl = pathToFileURL(path.join(pluginPath, url)).href
      win.loadURL(loadUrl)
    }

    // 子窗口 dom-ready 时触发父窗口 callback（与 utools 一致）
    win.webContents.on('dom-ready', () => {
      if (senderWebContents.isDestroyed()) return

      // 注入全局滚动条样式 + 默认字体
      win.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS)
      win.webContents.insertCSS(
        'body { font-family: system-ui, "PingFang SC", "Helvetica Neue", "Microsoft Yahei", sans-serif; }'
      )

      // 在父窗口触发 callback（与 utools executeJavaScript 方式一致）
      senderWebContents.executeJavaScript(
        `if (window.ztools && window.ztools.__event__ && typeof window.ztools.__event__.createBrowserWindowCallback === 'function') {
          try { window.ztools.__event__.createBrowserWindowCallback() } catch(e) {}
          delete window.ztools.__event__.createBrowserWindowCallback
        }`
      )
      console.debug(`[pluginWindow:callback] dom-ready → trigger parent callback, winId=${win.id}`)
    })

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

    console.info(
      `[pluginWindow:create] plugin=${pluginName} partition=${sessionPartition} winId=${win.id} url=${url}`
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
}

export default new PluginWindowManager()
