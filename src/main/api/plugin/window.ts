import { ipcMain, webContents } from 'electron'
import pluginWindowManager from '../../core/pluginWindowManager.js'

/**
 * 插件独立窗口管理API - 插件专用
 */
export class PluginWindowAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: any = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: any): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  private setupIPC(): void {
    // 创建独立窗口
    ipcMain.on(
      'create-browser-window',
      (
        event,
        url: string,
        options: Electron.BrowserWindowConstructorOptions,
        callbackId: string
      ) => {
        const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          console.error('创建窗口失败: 未找到插件信息')
          event.returnValue = null
          return
        }
        event.returnValue = pluginWindowManager.createWindow(
          pluginInfo.path,
          pluginInfo.name,
          url,
          options,
          callbackId,
          event.sender
        )
      }
    )

    // 窗口方法调用
    ipcMain.handle(
      'browser-window-action',
      (_event, windowId: string, path: string[], args: any[]) => {
        return pluginWindowManager.executeMethod(windowId, path, args)
      }
    )

    ipcMain.handle('browser-window-get-prop', (_event, windowId: string, path: string[]) => {
      return pluginWindowManager.getPropertyByPath(windowId, path)
    })

    ipcMain.on('browser-window-get-prop-sync', (event, windowId: string, path: string[]) => {
      event.returnValue = pluginWindowManager.getPropertyInfo(windowId, path)
    })

    ipcMain.on(
      'browser-window-call-sync',
      (event, windowId: string, path: string[], args: any[]) => {
        event.returnValue = pluginWindowManager.callMethodSync(windowId, path, args)
      }
    )

    ipcMain.handle('browser-window-wait-task', async (_event, taskId: string) => {
      return await pluginWindowManager.waitForTask(taskId)
    })

    // 发送消息到父窗口
    ipcMain.on('send-to-parent', (event, channel: string, ...args: any[]) => {
      pluginWindowManager.sendToParent(event.sender, channel, args)
    })

    // 隐藏主窗口
    ipcMain.handle('hide-main-window', () => {
      this.mainWindow?.hide()
      // TODO: 需要调用 windowManager 的逻辑
    })

    // ipcRenderer.sendTo polyfill
    ipcMain.on('ipc-send-to', (_event, webContentsId: number, channel: string, ...args: any[]) => {
      try {
        const targetWebContents = webContents.fromId(webContentsId)
        if (targetWebContents && !targetWebContents.isDestroyed()) {
          targetWebContents.send(channel, ...args)
          console.log(`转发消息: ${channel} -> webContentsId: ${webContentsId}`)
        } else {
          console.warn(`目标 webContents 不存在或已销毁: ${webContentsId}`)
        }
      } catch (error) {
        console.error('转发消息失败:', error)
      }
    })
  }
}

export default new PluginWindowAPI()
