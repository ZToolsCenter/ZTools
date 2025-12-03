import { ipcMain, shell, clipboard, Menu, dialog, app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import clipboardManager from '../../clipboardManager.js'
import appleScriptHelper from '../../utils/appleScriptHelper.js'

// 头像目录
const AVATAR_DIR = path.join(app.getPath('userData'), 'avatar')

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
    ipcMain.handle('get-last-copied-text', (_event, timeLimit: number) =>
      this.getLastCopiedText(timeLimit)
    )
    ipcMain.handle('get-frontmost-app', () => this.getFrontmostApp())
    ipcMain.handle('activate-app', (_event, identifier: string, type?: string) =>
      this.activateApp(identifier, type)
    )

    // UI
    ipcMain.handle('show-context-menu', (_event, menuItems) => this.showContextMenu(menuItems))
    ipcMain.handle('select-avatar', () => this.selectAvatar())
  }

  private async openExternal(url: string): Promise<void> {
    try {
      await shell.openExternal(url)
    } catch (error) {
      console.error('打开外部链接失败:', error)
      throw error
    }
  }

  private async copyToClipboard(text: string): Promise<void> {
    try {
      clipboard.writeText(text)
    } catch (error) {
      console.error('复制到剪贴板失败:', error)
      throw error
    }
  }

  private async openTerminal(path: string): Promise<void> {
    try {
      await appleScriptHelper.openInTerminal(path)
    } catch (error) {
      console.error('在终端打开失败:', error)
      throw error
    }
  }

  private async getFinderPath(): Promise<string | null> {
    try {
      return await appleScriptHelper.getFinderPath()
    } catch (error) {
      console.error('获取访达路径失败:', error)
      return null
    }
  }

  private getLastCopiedText(timeLimit: number): string | null {
    try {
      return clipboardManager.getLastCopiedText(timeLimit)
    } catch (error) {
      console.error('获取最后复制文本失败:', error)
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
      console.error('获取当前激活应用失败:', error)
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
    } catch (error: any) {
      console.error('激活应用失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }

  private async showContextMenu(menuItems: any): Promise<void> {
    if (!this.mainWindow) return

    const template = menuItems.map((item: any) => ({
      label: item.label,
      click: () => {
        this.mainWindow?.webContents.send('context-menu-command', item.id)
      }
    }))

    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: this.mainWindow })
  }

  private async selectAvatar(): Promise<any> {
    try {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        title: '选择头像图片',
        filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '未选择文件' }
      }

      const originalPath = result.filePaths[0]
      const ext = path.extname(originalPath)
      const fileName = `avatar${ext}`

      await fs.mkdir(AVATAR_DIR, { recursive: true })
      const avatarPath = path.join(AVATAR_DIR, fileName)
      await fs.copyFile(originalPath, avatarPath)

      return { success: true, path: `file:///${avatarPath}` }
    } catch (error: any) {
      console.error('选择头像失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }
}

export default new SystemAPI()
