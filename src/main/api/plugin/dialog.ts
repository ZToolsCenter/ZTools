import { ipcMain, dialog, BrowserWindow, app } from 'electron'

/**
 * 对话框API - 插件专用
 */
export class PluginDialogAPI {
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
  }

  private setupIPC(): void {
    // 获取系统路径
    ipcMain.on('get-path', (event, name: string) => {
      try {
        let result = ''
        switch (name) {
          case 'home':
            result = app.getPath('home')
            break
          case 'appData':
            result = app.getPath('appData')
            break
          case 'userData':
            result = app.getPath('userData')
            break
          case 'temp':
            result = app.getPath('temp')
            break
          case 'exe':
            result = app.getPath('exe')
            break
          case 'desktop':
            result = app.getPath('desktop')
            break
          case 'documents':
            result = app.getPath('documents')
            break
          case 'downloads':
            result = app.getPath('downloads')
            break
          case 'music':
            result = app.getPath('music')
            break
          case 'pictures':
            result = app.getPath('pictures')
            break
          case 'videos':
            result = app.getPath('videos')
            break
          case 'logs':
            result = app.getPath('logs')
            break
          default:
            result = ''
        }
        event.returnValue = result
      } catch (error) {
        console.error('获取系统路径失败:', name, error)
        event.returnValue = ''
      }
    })

    // 显示文件保存对话框
    ipcMain.on('show-save-dialog', (event, options: any) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender) || this.mainWindow
        if (!win) {
          event.returnValue = undefined
          return
        }
        const result = dialog.showSaveDialogSync(win, options)
        event.returnValue = result
      } catch (error) {
        console.error('显示文件保存对话框失败:', error)
        event.returnValue = undefined
      }
    })

    // 显示文件打开对话框
    ipcMain.on('show-open-dialog', (event, options: Electron.OpenDialogSyncOptions) => {
      try {
        const result = dialog.showOpenDialogSync(this.mainWindow!, options)
        event.returnValue = result || []
      } catch (error) {
        console.error('显示文件打开对话框失败:', error)
        event.returnValue = []
      }
    })
  }
}

export default new PluginDialogAPI()
