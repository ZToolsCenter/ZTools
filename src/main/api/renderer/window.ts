import { ipcMain } from 'electron'
import windowManager from '../../windowManager.js'

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
    ipcMain.handle('get-window-position', () => this.getWindowPosition())
    ipcMain.on('set-window-position', (_event, x: number, y: number) =>
      this.setWindowPosition(x, y)
    )
    ipcMain.on('set-window-opacity', (_event, opacity: number) => this.setWindowOpacity(opacity))
    ipcMain.handle('set-tray-icon-visible', (_event, visible: boolean) =>
      this.setTrayIconVisible(visible)
    )
    ipcMain.handle('set-hide-on-blur', (_event, hide: boolean) => this.setHideOnBlur(hide))
  }

  private setupWindowEvents(): void {
    let moveTimeout: NodeJS.Timeout | null = null
    this.mainWindow?.on('move', () => {
      if (moveTimeout) clearTimeout(moveTimeout)
      moveTimeout = setTimeout(() => {
        if (this.mainWindow) {
          const [x, y] = this.mainWindow.getPosition()
          const displayId = windowManager.getCurrentDisplayId()
          if (displayId !== null) {
            windowManager.saveWindowPosition(displayId, x, y)
          }
        }
      }, 500)
    })
  }

  private hideWindow(isRestorePreWindow: boolean = true): void {
    windowManager.hideWindow(isRestorePreWindow)
  }

  public resizeWindow(height: number): void {
    if (this.mainWindow) {
      // console.log('收到调整窗口高度请求:', height)
      const [width] = this.mainWindow.getSize()
      // 限制高度范围: 最小 59px, 最大 600px
      const newHeight = Math.max(59, Math.min(height, 600))
      this.mainWindow.setSize(width, newHeight)
    }
  }

  public getWindowPosition(): { x: number; y: number } {
    if (this.mainWindow) {
      const [x, y] = this.mainWindow.getPosition()
      return { x, y }
    }
    return { x: 0, y: 0 }
  }

  public setWindowPosition(x: number, y: number): void {
    if (this.mainWindow) {
      this.mainWindow.setPosition(x, y)
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
