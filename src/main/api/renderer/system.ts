import { app, clipboard, ipcMain, Menu, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import clipboardManager from '../../managers/clipboardManager'
import appleScriptHelper from '../../utils/appleScriptHelper'
import { isWindows11, openDialog } from '../../utils/windowUtils'
import { getAvatarPath } from '../../core/appData/appDataPaths'

// 头像目录
const AVATAR_DIR = getAvatarPath()

/**
 * 系统集成API - 主程序专用
 * 包含终端、访达、剪贴板等系统功能
 */
export class SystemAPI {
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
  }

  private setupIPC(): void {
    // 基础工具
    ipcMain.handle('open-external', (_event, url: string) => this.openExternal(url))
    ipcMain.handle('copy-to-clipboard', (_event, text: string) => this.copyToClipboard(text))

    // 系统集成
    ipcMain.handle('open-terminal', (_event, path: string) => this.openTerminal(path))
    ipcMain.handle('get-finder-path', () => this.getFinderPath())
    ipcMain.handle('get-last-copied-content', (_event, timeLimit?: number) =>
      this.getLastCopiedContent(timeLimit)
    )
    ipcMain.handle('get-frontmost-app', () => this.getFrontmostApp())
    ipcMain.handle('activate-app', (_event, identifier: string, type?: string) =>
      this.activateApp(identifier, type)
    )
    ipcMain.handle('reveal-in-finder', (_event, filePath: string) => this.revealInFinder(filePath))
    ipcMain.handle('check-file-paths', (_event, paths: string[]) => this.checkFilePaths(paths))

    // UI
    ipcMain.handle('show-context-menu', (event, menuItems) =>
      this.showContextMenu(event, menuItems)
    )
    ipcMain.handle('select-avatar', () => this.selectAvatar())
    ipcMain.handle('select-image-file', () => this.selectImageFile())

    // App Info
    ipcMain.handle('get-app-version', () => app.getVersion())
    ipcMain.handle('get-app-name', () => app.getName())
    ipcMain.handle('get-system-versions', () => process.versions)
    ipcMain.on('get-platform', (event) => {
      event.returnValue = process.platform
    })
    ipcMain.handle('is-windows11', () => isWindows11())
  }

  private async openExternal(url: string): Promise<void> {
    try {
      await shell.openExternal(url)
    } catch (error) {
      console.error('[System] 打开外部链接失败:', error)
      throw error
    }
  }

  private async copyToClipboard(text: string): Promise<void> {
    try {
      clipboard.writeText(text)
    } catch (error) {
      console.error('[System] 复制到剪贴板失败:', error)
      throw error
    }
  }

  private async openTerminal(path: string): Promise<void> {
    try {
      await appleScriptHelper.openInTerminal(path)
    } catch (error) {
      console.error('[System] 在终端打开失败:', error)
      throw error
    }
  }

  private async getFinderPath(): Promise<string | null> {
    try {
      return await appleScriptHelper.getFinderPath()
    } catch (error) {
      console.error('[System] 获取访达路径失败:', error)
      return null
    }
  }

  private async getLastCopiedContent(timeLimit?: number): Promise<{
    type: 'text' | 'image' | 'file'
    data: string | Array<{ path: string; name: string; isDirectory: boolean }>
    timestamp: number
  } | null> {
    try {
      return await clipboardManager.getLastCopiedContent(timeLimit)
    } catch (error) {
      console.error('[System] 获取最后复制内容失败:', error)
      return null
    }
  }

  private async getFrontmostApp(): Promise<{
    name: string
    bundleId: string
    path: string
  } | null> {
    try {
      return await appleScriptHelper.getFrontmostApp()
    } catch (error) {
      console.error('[System] 获取当前激活应用失败:', error)
      return null
    }
  }

  private async activateApp(
    identifier: string,
    type: string = 'name'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      let result = false

      switch (type) {
        case 'bundleId':
          result = await appleScriptHelper.activateAppByBundleId(identifier)
          break
        case 'path':
          result = await appleScriptHelper.activateAppByPath(identifier)
          break
        case 'name':
        default:
          result = await appleScriptHelper.activateAppByName(identifier)
          break
      }

      if (result) {
        return { success: true }
      } else {
        return { success: false, error: '激活应用失败' }
      }
    } catch (error: unknown) {
      console.error('[System] 激活应用失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 在文件管理器中显示文件位置（跨平台）
   * macOS: 在 Finder 中显示并选中文件
   * Windows: 在资源管理器中显示并选中文件
   * Linux: 在文件管理器中显示并选中文件
   *
   * Electron 的 shell.showItemInFolder() 是跨平台的 API，
   * 会自动根据操作系统选择相应的文件管理器
   */
  public async revealInFinder(filePath: string): Promise<void> {
    try {
      if (!filePath) {
        throw new Error('文件路径不能为空')
      }

      // Electron 的 shell.showItemInFolder() 是跨平台的
      // 在 macOS 上会自动使用 Finder，Windows 上使用资源管理器，Linux 上使用文件管理器
      shell.showItemInFolder(filePath)
    } catch (error: unknown) {
      const platformName =
        process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
      console.error(`[System] 在${platformName}文件管理器中显示文件失败:`, error)
      throw error
    }
  }

  /**
   * 根据渲染进程提供的菜单描述构建并显示原生右键菜单。
   * @param event 触发菜单的 IPC 事件
   * @param menuItems 菜单项描述列表
   * @returns 菜单创建并展示后结束的 Promise
   */
  private async showContextMenu(event: Electron.IpcMainInvokeEvent, menuItems: any): Promise<void> {
    if (!this.mainWindow) return

    const senderWebContents = event.sender

    const buildTemplate = (items: any[], senderWebContents: Electron.WebContents): any[] => {
      return items.map((item: any) => {
        const menuItem: any = {
          label: item.label,
          enabled: item.enabled !== false
        }

        if (item.submenu) {
          menuItem.submenu = buildTemplate(item.submenu, senderWebContents)
        } else {
          menuItem.click = () => {
            // 将命令发送到触发菜单的窗口，而不是总是发送到主窗口
            senderWebContents.send('context-menu-command', item.id)
          }
        }

        // 支持 checkbox 类型的菜单项
        if (item.type === 'checkbox') {
          menuItem.type = 'checkbox'
          menuItem.checked = item.checked || false
        }

        return menuItem
      })
    }

    const template = buildTemplate(menuItems, senderWebContents)

    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: this.mainWindow })
  }

  public async selectAvatar(): Promise<any> {
    try {
      const result = await openDialog(
        this.mainWindow!,
        {
          title: '选择头像图片',
          filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
          properties: ['openFile']
        },
        '未选择文件'
      )
      if (!result.success) {
        return result
      }
      const originalPath = result.data!.filePaths[0]
      const ext = path.extname(originalPath)
      const fileName = `avatar${ext}`

      await fs.mkdir(AVATAR_DIR, { recursive: true })
      const avatarPath = path.join(AVATAR_DIR, fileName)
      await fs.copyFile(originalPath, avatarPath)

      return { success: true, path: pathToFileURL(avatarPath).href }
    } catch (error: unknown) {
      console.error('[System] 选择头像失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  public async selectImageFile(): Promise<any> {
    try {
      const result = await openDialog(
        this.mainWindow!,
        {
          title: '选择图片',
          filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
          properties: ['openFile']
        },
        '未选择文件'
      )
      if (!result.success) {
        return result
      }
      const filePath = result.data!.filePaths[0]
      return { success: true, path: filePath, url: pathToFileURL(filePath).href }
    } catch (error: unknown) {
      console.error('[System] 选择图片失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  private async checkFilePaths(
    paths: string[]
  ): Promise<Array<{ path: string; isDirectory: boolean; exists: boolean }>> {
    try {
      const results = await Promise.all(
        paths.map(async (filePath) => {
          try {
            const stats = await fs.stat(filePath)
            const result = {
              path: filePath,
              isDirectory: stats.isDirectory(),
              exists: true
            }
            return result
          } catch (error) {
            console.log('[System] 主进程：文件不存在或无权访问:', filePath, error)
            return {
              path: filePath,
              isDirectory: false,
              exists: false
            }
          }
        })
      )
      return results
    } catch (error) {
      console.error('[System] 主进程：检查文件路径失败:', error)
      return []
    }
  }
}

export default new SystemAPI()
