import { ipcMain } from 'electron'
import windowManager from '../../windowManager.js'
import databaseAPI from '../shared/database'

/**
 * 窗口管理API - 主程序专用
 */
export class WindowAPI {
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
    this.setupWindowEvents()
  }

  private setupIPC(): void {
    ipcMain.on('hide-window', () => this.hideWindow())
    ipcMain.on('resize-window', (_event, height: number) => this.resizeWindow(height))
    ipcMain.on('set-window-opacity', (_event, opacity: number) => this.setWindowOpacity(opacity))
    ipcMain.handle('set-tray-icon-visible', (_event, visible: boolean) =>
      this.setTrayIconVisible(visible)
    )
    ipcMain.handle('set-hide-on-blur', (_event, hide: boolean) => this.setHideOnBlur(hide))
    ipcMain.handle('window:paste', () => windowManager.pasteToActiveWindow())
  }

  private setupWindowEvents(): void {
    // 监听窗口移动事件，保存位置
    let moveTimeout: NodeJS.Timeout | null = null
    this.mainWindow?.on('move', () => {
      if (moveTimeout) clearTimeout(moveTimeout)
      moveTimeout = setTimeout(() => {
        if (this.mainWindow) {
          const [x, y] = this.mainWindow.getPosition()
          databaseAPI.dbPut('window-position', { x, y })
          console.log('保存窗口位置:', { x, y })
        }
      }, 500) // 500ms 防抖
    })
  }

  private hideWindow(isRestorePreWindow: boolean = true): void {
    windowManager.hideWindow(isRestorePreWindow)
  }

  public resizeWindow(height: number): void {
    if (this.mainWindow) {
      console.log('收到调整窗口高度请求:', height)
      const [width] = this.mainWindow.getSize()
      // 限制高度范围: 最小 59px, 最大 600px
      const newHeight = Math.max(59, Math.min(height, 600))
      this.mainWindow.setSize(width, newHeight)
    }
  }

  private setWindowOpacity(opacity: number): void {
    if (this.mainWindow) {
      const clampedOpacity = Math.max(0.3, Math.min(1, opacity))
      this.mainWindow.setOpacity(clampedOpacity)
      console.log('设置窗口不透明度:', clampedOpacity)
    }
  }

  private setTrayIconVisible(visible: boolean): void {
    windowManager.setTrayIconVisible(visible)
    console.log('设置托盘图标可见性:', visible)
  }

  private setHideOnBlur(hide: boolean): void {
    windowManager.setHideOnBlur(hide)
    console.log('设置失去焦点时是否隐藏窗口:', hide)
  }
}

export default new WindowAPI()
