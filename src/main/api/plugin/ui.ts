import { ipcMain, Notification, nativeTheme } from 'electron'

/**
 * 插件UI控制API - 插件专用
 */
export class PluginUIAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: any = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: any): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  private setupIPC(): void {
    // 显示系统通知
    ipcMain.handle('show-notification', (event, body: string) => this.showNotification(event, body))

    // 设置插件高度
    ipcMain.handle('set-expend-height', (_event, height: number) => this.setExpendHeight(height))

    // 子输入框相关
    ipcMain.handle('set-sub-input', (_event, placeholder?: string) => this.setSubInput(placeholder))
    ipcMain.on('notify-sub-input-change', (_event, text: string) => this.notifySubInputChange(text))

    // 隐藏插件
    ipcMain.on('hide-plugin', () => this.hidePlugin())

    // 获取是否深色主题
    ipcMain.on('is-dark-colors', (event) => {
      event.returnValue = nativeTheme.shouldUseDarkColors
    })
  }

  private showNotification(event: Electron.IpcMainInvokeEvent, body: string): void {
    if (Notification.isSupported()) {
      const options: Electron.NotificationConstructorOptions = {
        title: 'zTools',
        body: body
      }

      const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
      if (pluginInfo) {
        options.title = pluginInfo.name
        if (pluginInfo.logo) {
          options.icon = pluginInfo.logo.replace('file:///', '')
        }
      }

      new Notification(options).show()
    }
  }

  private setExpendHeight(height: number): void {
    if (this.pluginManager) {
      this.pluginManager.setExpendHeight(height)
    }
  }

  private setSubInput(placeholder?: string): { success: boolean } {
    try {
      const pluginPath = this.pluginManager?.getCurrentPluginPath()
      if (!pluginPath) {
        console.warn('没有活动的插件,无法设置子输入框')
        return { success: false }
      }

      this.mainWindow?.webContents.send('update-sub-input-placeholder', {
        pluginPath,
        placeholder: placeholder || '搜索'
      })

      this.pluginManager.setSubInputPlaceholder(placeholder || '搜索')
      console.log('设置子输入框 placeholder:', { pluginPath, placeholder })
      return { success: true }
    } catch (error: any) {
      console.error('设置子输入框失败:', error)
      return { success: false }
    }
  }

  private notifySubInputChange(text: string): void {
    if (this.pluginManager) {
      this.pluginManager.sendPluginMessage('sub-input-change', { text })
    }
  }

  private hidePlugin(): void {
    if (this.pluginManager) {
      this.pluginManager.hidePluginView()
    }
  }
}

export default new PluginUIAPI()
