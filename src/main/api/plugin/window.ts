import { BrowserWindow, ipcMain, webContents } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import pluginWindowManager, { winIpc } from '../../core/pluginWindowManager.js'
import windowManager from '../../managers/windowManager.js'
import detachedWindowManager from '../../core/detachedWindowManager.js'
import { registerPluginApiServices } from './pluginApiDispatcher'
import { getPluginSessionPartition } from '../../../shared/pluginRuntimeNamespace'
import { getUrlScheme } from '../../utils/pluginUrl'

/**
 * 插件独立窗口管理API - 插件专用
 */
export class PluginWindowAPI {
  private pluginManager: PluginManager | null = null
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.pluginManager = pluginManager
    this.mainWindow = mainWindow
    this.setupIPC()
    this.registerPluginApiHandlers()
  }

  /**
   * 通过 plugin.api 注册独立窗口创建和代理方法。
   * @returns 无返回值。
   */
  private registerPluginApiHandlers(): void {
    const pluginManager = this.pluginManager!

    registerPluginApiServices({
      /**
       * 同步创建窗口，并按需将创建通知绑定到发起调用的文档。
       * @param event 插件同步 IPC 事件。
       * @param request 本地页面地址、窗口选项及是否需要创建通知。
       * @returns 无返回值；窗口代理元数据通过 IPC 返回。
       */
      createBrowserWindow: (
        event: Electron.IpcMainEvent,
        {
          url,
          options,
          wantsCallback
        }: {
          url: string
          options: Electron.BrowserWindowConstructorOptions
          wantsCallback?: boolean
        }
      ) => {
        const pluginInfo = pluginManager.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          event.returnValue = new Error('plugin not found')
          return
        }

        // 参数校验：url 必须是非空字符串
        if (typeof url !== 'string' || !url.trim()) {
          event.returnValue = new Error('createBrowserWindow: url 必须是非空字符串')
          return
        }

        // URL 安全校验：只允许无 scheme 的相对路径与 file:// 绝对地址。
        // 用 scheme 匹配而非 startsWith('http')：既放行 `http-api.html` 这类相对文件名，
        // 也拦住 HTTP:（大写）、data:、javascript:、ws: 等旧检查漏掉的协议。
        const scheme = getUrlScheme(url)
        if (scheme && scheme !== 'file') {
          event.returnValue = new Error('The URL must be a local address starting with file://')
          return
        }

        // resolvePluginWindowUrl 在 url 缺少路径部分时会抛错，需要转成 Error 返回值，
        // 否则 sendSync 返回空值会让插件端在 result.methods.forEach 处炸出难以诊断的 TypeError
        let win: Electron.BrowserWindow
        try {
          win = pluginWindowManager.createWindow(
            pluginInfo.path,
            pluginInfo.name,
            getPluginSessionPartition(pluginInfo.name),
            url,
            options,
            event.sender,
            wantsCallback === true ? event.senderFrame : null
          )
        } catch (error) {
          console.error('[pluginWindow:create] 创建插件窗口失败', error)
          event.returnValue = error instanceof Error ? error : new Error(String(error))
          return
        }

        // 返回白名单数组（与 utools 返回值结构一致）
        event.returnValue = {
          id: win.id,
          methods: winIpc.windowMethods,
          invokes: winIpc.windowInvokes,
          webContents: {
            id: win.webContents.id,
            methods: winIpc.webContentsMethods,
            invokes: winIpc.webContentsInvokes
          }
        }
      },

      // ── 同步 API：BrowserWindow/WebContents 同步方法分发 ──
      pluginBrowserWindowMethod: (
        event: Electron.IpcMainEvent,
        {
          id,
          target,
          method,
          args
        }: { id: number; target?: 'webContents'; method: string; args: any[] }
      ) => {
        const win = BrowserWindow.fromId(id)

        // 窗口不存在
        if (!win) {
          if (method === 'isDestroyed') {
            event.returnValue = true
            return
          }
          console.warn(`[pluginWindow:method] winId=${id} not found, method=${method}`)
          event.returnValue = new Error('window not exist')
          return
        }

        // 所有权校验（两级查找）：
        // 1. 先查主插件视图和分离窗口（pluginManager 管理）
        // 2. 再查子窗口（pluginWindowManager 管理，覆盖孙窗口嵌套场景）
        const callerInfo = pluginManager.getPluginInfoByWebContents(event.sender)
        const callerPath =
          callerInfo?.path ?? pluginWindowManager.getPluginPathByWebContentsId(event.sender.id)
        const ownerPath = pluginWindowManager.getPluginPathByWindowId(id)

        if (!callerPath || callerPath !== ownerPath) {
          console.warn(`[pluginWindow:auth] pluginPath=${callerPath} denied access to winId=${id}`)
          event.returnValue = new Error('window id error')
          return
        }

        if (target === 'webContents') {
          if (!(winIpc.webContentsMethods as readonly string[]).includes(method)) {
            event.returnValue = new Error(`webContents function "${method}" not found`)
            return
          }
          try {
            event.returnValue = (win.webContents as any)[method](...args)
          } catch (e) {
            event.returnValue = e
          }
        } else {
          if (!(winIpc.windowMethods as readonly string[]).includes(method)) {
            event.returnValue = new Error(`BrowserWindow function "${method}" not found`)
            return
          }
          try {
            event.returnValue = (win as any)[method](...args)
          } catch (e) {
            event.returnValue = e
          }
        }
      },

      // ── 异步 API：BrowserWindow/WebContents 异步方法分发 ──
      pluginBrowserWindowInvoke: async (
        event: Electron.IpcMainInvokeEvent,
        {
          id,
          target,
          method,
          args
        }: { id: number; target?: 'webContents'; method: string; args: any[] }
      ) => {
        const win = BrowserWindow.fromId(id)
        if (!win) throw new Error('window not exist')

        // 所有权校验（两级查找）：
        // 1. 先查主插件视图和分离窗口（pluginManager 管理）
        // 2. 再查子窗口（pluginWindowManager 管理，覆盖孙窗口嵌套场景）
        const callerInfo = pluginManager.getPluginInfoByWebContents(event.sender)
        const callerPath =
          callerInfo?.path ?? pluginWindowManager.getPluginPathByWebContentsId(event.sender.id)
        const ownerPath = pluginWindowManager.getPluginPathByWindowId(id)

        if (!callerPath || callerPath !== ownerPath) {
          console.warn(`[pluginWindow:auth] pluginPath=${callerPath} denied access to winId=${id}`)
          throw new Error('window id error')
        }

        if (target === 'webContents') {
          // print 特殊处理：callback → Promise（与 utools 一致）
          if (method === 'print') {
            return new Promise((resolve, reject) => {
              win.webContents.print(args[0] || null, (success, failureReason) => {
                if (success) return resolve(undefined)
                reject(new Error('errorType ' + failureReason))
              })
            })
          }

          if (!(winIpc.webContentsInvokes as readonly string[]).includes(method)) {
            throw new Error(`webContents function "${method}" not found`)
          }
          return await (win.webContents as any)[method](...args)
        } else {
          if (!(winIpc.windowInvokes as readonly string[]).includes(method)) {
            throw new Error(`BrowserWindow function "${method}" not found`)
          }
          return await (win as any)[method](...args)
        }
      }
    })
  }

  /**
   * 注册插件窗口相关的 IPC 监听。
   * @returns 无返回值。
   */
  private setupIPC(): void {
    // 发送消息到父窗口
    ipcMain.on('send-to-parent', (event, channel: string, ...args: any[]) => {
      pluginWindowManager.sendToParent(event.sender, channel, args)
    })

    ipcMain.on('show-main-window', (event) => {
      event.returnValue = this.showMainWindow(event.sender)
    })

    // 隐藏主窗口
    ipcMain.handle('hide-main-window', (_event, isRestorePreWindow: boolean = true) => {
      windowManager.hideWindow(isRestorePreWindow)
    })

    // ipcRenderer.sendTo polyfill
    ipcMain.on('ipc-send-to', (event, webContentsId: number, channel: string, ...args: any[]) => {
      const senderId = event.sender.id
      try {
        const targetWebContents = webContents.fromId(webContentsId)
        if (targetWebContents && !targetWebContents.isDestroyed()) {
          targetWebContents.send('__ipc_sendto_relay__', { senderId, channel, args })
        } else {
          console.warn(`[pluginWindow:method] 目标 webContents 不存在或已销毁: ${webContentsId}`)
        }
      } catch (error) {
        console.error('[pluginWindow:method] 转发消息失败:', error)
      }
    })

    // 获取窗口类型（同步方法，供插件使用）
    ipcMain.on('get-window-type', (event) => {
      try {
        const windowType = this.getWindowType(event.sender)
        event.returnValue = windowType
      } catch (error) {
        console.error('[pluginWindow:method] get-window-type error:', error)
        event.returnValue = 'main'
      }
    })
  }

  /**
   * 从主窗口上下文唤起主窗口，拒绝独立窗口的调用。
   * @param sender 发起调用的 WebContents。
   * @returns 主窗口显示时返回 true；调用被拒绝或唤起失败时返回 false。
   */
  private showMainWindow(sender: Electron.WebContents): boolean {
    try {
      // 根据调用时的窗口归属判断，插件视图分离后也应立即生效。
      const mainWindow = this.mainWindow
      if (!mainWindow || mainWindow.isDestroyed() || this.getWindowType(sender) !== 'main') {
        return false
      }

      // 复用正常唤起流程，并以实际可见性处理唤醒黑名单等拦截情况。
      windowManager.showWindow()
      return !mainWindow.isDestroyed() && mainWindow.isVisible()
    } catch (error) {
      // 同步 IPC 即使唤起失败也必须返回结果，避免调用方继续等待。
      console.error('[pluginWindow] 唤起主窗口失败:', error)
      return false
    }
  }

  /**
   * 获取窗口类型
   * @param webContents 调用者的 WebContents
   * @returns 'main' | 'detach' | 'browser'
   */
  private getWindowType(webContents: Electron.WebContents): 'main' | 'detach' | 'browser' {
    // 检查是否是主窗口
    if (this.mainWindow && webContents.id === this.mainWindow.webContents.id) {
      return 'main'
    }

    // 检查是否是分离窗口
    if (detachedWindowManager.isDetachedWindow(webContents)) {
      return 'detach'
    }

    // 检查是否是 browser 窗口
    if (pluginWindowManager.isBrowserWindow(webContents)) {
      return 'browser'
    }

    // 默认返回 main（可能是插件的 WebContentsView）
    return 'main'
  }
}

export default new PluginWindowAPI()
