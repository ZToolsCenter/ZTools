import { ipcMain } from 'electron'

/**
 * 插件生命周期API - 插件专用
 */
export class PluginLifecycleAPI {
  private pluginManager: any = null
  private launchParam: any = null
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: any): void {
    this.pluginManager = pluginManager
    this.mainWindow = mainWindow
    this.setupIPC()
  }

  public setLaunchParam(param: any): void {
    this.launchParam = param
  }

  private setupIPC(): void {
    // 插件进入事件
    ipcMain.handle('onPluginEnter', () => {
      console.log('收到插件进入事件:', this.launchParam)
      return this.launchParam
    })

    // 退出插件
    ipcMain.handle('out-plugin', (event, isKill: boolean = false) => {
      console.log('out-plugin', isKill)
      const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
      console.log('pluginInfo', pluginInfo)
      if (!pluginInfo) {
        return false
      }

      this.pluginManager.hidePluginView()
      this.mainWindow?.webContents.send('back-to-search')

      if (isKill) {
        return this.pluginManager.killPlugin(pluginInfo.path)
      } else {
        return true
      }
    })
  }
}

export default new PluginLifecycleAPI()
