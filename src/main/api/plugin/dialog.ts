import { ipcMain, dialog, app } from 'electron'
import fs from 'fs'
import type { PluginManager } from '../../managers/pluginManager'
import detachedWindowManager from '../../core/detachedWindowManager'
import pluginWindowManager from '../../core/pluginWindowManager'
import { getPluginDataPath } from '../../core/appData/appDataPaths'
import windowManager from '../../managers/windowManager'

/**
 * 对话框API - 插件专用
 */
export class PluginDialogAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: PluginManager | null = null

  /**
   * 初始化对话框 API 并注册 IPC 处理器。
   * @param mainWindow 主窗口
   * @param pluginManager 插件运行管理器（用于解析发起调用的插件名）
   * @returns 无返回值
   */
  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  /**
   * 解析发起该 IPC 调用的插件名。
   * 依次匹配主窗口内的插件视图、插件独立子窗口、插件会话隔离分区。
   * @param event 插件侧发起的 IPC 事件
   * @returns 插件名；无法定位到插件时返回 null
   */
  private resolvePluginName(event: Electron.IpcMainEvent): string | null {
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
    if (pluginInfo) {
      return pluginInfo.name
    }

    const pluginName = pluginWindowManager.getPluginNameByWebContentsId(event.sender.id)
    if (pluginName) {
      return pluginName
    }

    const partition = (event.sender.session as any)?.partition
    if (typeof partition === 'string' && partition.startsWith('persist:')) {
      const partitionPluginName = partition.slice('persist:'.length)
      return partitionPluginName || null
    }

    return null
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
          case 'pluginData': {
            // 返回当前插件的专属数据目录，缺失时自动创建，插件拿到即可写入。
            const pluginName = this.resolvePluginName(event)
            if (!pluginName) {
              result = ''
              break
            }
            const pluginDataPath = getPluginDataPath(pluginName)
            try {
              fs.mkdirSync(pluginDataPath, { recursive: true })
              result = pluginDataPath
            } catch (mkdirError) {
              console.error('[PluginDialog] 创建插件数据目录失败:', pluginName, mkdirError)
              result = ''
            }
            break
          }
          default:
            result = ''
        }
        event.returnValue = result
      } catch (error) {
        console.error('[PluginDialog] 获取系统路径失败:', name, error)
        event.returnValue = ''
      }
    })

    // 显示文件保存对话框
    ipcMain.on('show-save-dialog', (event, options: any) => {
      try {
        // 判断插件是在主窗口还是分离窗口
        const targetWindow =
          detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow

        if (!targetWindow) {
          event.returnValue = undefined
          return
        }
        windowManager
          .withBlurHideSuppressed(() => dialog.showSaveDialog(targetWindow, options))
          .then((data: Electron.SaveDialogReturnValue) => {
            event.returnValue = data.canceled ? undefined : data.filePath
          })
          .catch((error: Error) => {
            console.error('[PluginDialog] 显示文件保存对话框失败:', error)
            event.returnValue = undefined
          })
      } catch (error) {
        console.error('[PluginDialog] 显示文件保存对话框失败:', error)
        event.returnValue = undefined
      }
    })

    // 显示文件打开对话框
    ipcMain.on('show-open-dialog', (event, options: Electron.OpenDialogSyncOptions) => {
      try {
        // 判断插件是在主窗口还是分离窗口
        const targetWindow =
          detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow

        if (!targetWindow) {
          event.returnValue = []
          return
        }
        windowManager
          .withBlurHideSuppressed(() => dialog.showOpenDialog(targetWindow, options))
          .then((data: Electron.OpenDialogReturnValue) => {
            event.returnValue = data.canceled ? [] : data.filePaths
          })
          .catch((error: Error) => {
            console.error('[PluginDialog] 显示文件打开对话框失败:', error)
            event.returnValue = []
          })
      } catch (error) {
        console.error('[PluginDialog] 显示文件打开对话框失败:', error)
        event.returnValue = []
      }
    })
  }
}

export default new PluginDialogAPI()
