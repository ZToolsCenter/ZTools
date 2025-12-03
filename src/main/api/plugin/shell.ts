import { ipcMain, shell } from 'electron'

/**
 * Shell API - 插件专用
 * 提供系统 shell 相关操作
 */
export class PluginShellAPI {
  public init(): void {
    this.setupIPC()
  }

  private setupIPC(): void {
    // 使用系统默认程序打开 URL
    ipcMain.on('shell-open-external', async (event, url: string) => {
      try {
        await shell.openExternal(url)
        event.returnValue = { success: true }
      } catch (error: any) {
        console.error('打开 URL 失败:', error)
        event.returnValue = { success: false, error: error.message }
      }
    })
  }
}

export default new PluginShellAPI()
