import { ipcMain } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import windowManager from '../../managers/windowManager'
import { getPluginInstanceContext } from '../../core/commands/pluginLaunchContext'

/**
 * 插件生命周期API - 插件专用
 */
export class PluginLifecycleAPI {
  private pluginManager: PluginManager | null = null
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.pluginManager = pluginManager
    this.mainWindow = mainWindow
    this.setupIPC()
  }

  /**
   * 注册实例级生命周期上下文查询与插件退出接口。
   * @returns 无返回值
   */
  private setupIPC(): void {
    // 插件进入事件
    ipcMain.handle('onPluginEnter', (event) => getPluginInstanceContext(event.sender))

    // 退出插件
    ipcMain.handle('out-plugin', (event, isKill: boolean = false) => {
      console.log('[PluginLifecycle] out-plugin', isKill)
      const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
      console.log('[PluginLifecycle] pluginInfo', pluginInfo)
      if (!pluginInfo) {
        return false
      }

      this.pluginManager?.hidePluginView()
      windowManager.notifyBackToSearch()
      // 主窗口获取焦点（确保前端的 focus() 调用能生效）
      this.mainWindow?.webContents.focus()

      if (isKill) {
        return this.pluginManager?.killPlugin(pluginInfo.path)
      } else {
        // 发送插件退出事件（isKill=false 表示正常退出）
        event.sender.send('plugin-out', false)
        return true
      }
    })
  }
}

export default new PluginLifecycleAPI()
