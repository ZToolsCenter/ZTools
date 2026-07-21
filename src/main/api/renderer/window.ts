import { ipcMain, screen } from 'electron'
import { WINDOW_INITIAL_HEIGHT, WINDOW_WIDTH } from '../../common/constants.js'
import windowManager from '../../managers/windowManager.js'

// 窗口材质类型
type WindowMaterial = 'mica' | 'acrylic' | 'none'

/**
 * 窗口管理API - 主程序专用
 */
export class WindowAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private lockedSize: { width: number; height: number } | null = null
  private currentAssemblyTarget: string | null = null

  public init(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
    this.setupWindowEvents()
  }

  private setupIPC(): void {
    ipcMain.on('hide-window', () => this.hideWindow())
    ipcMain.on('resize-window', (_event, height: number) => this.resizeWindow(height))
    ipcMain.on('update-launch-context', (_event, context: any) => this.updateLaunchContext(context))
    ipcMain.handle('get-window-position', () => this.getWindowPosition())
    ipcMain.handle('get-window-material', () => this.getWindowMaterial())
    ipcMain.on('set-window-position', (_event, x: number, y: number) =>
      this.setWindowPosition(x, y)
    )
    // 拖动控制：锁定/解锁窗口尺寸
    ipcMain.on('set-window-size-lock', (_event, lock: boolean) => {
      if (!this.mainWindow) return

      if (lock) {
        // 锁定：记录当前尺寸（宽度使用固定常量，避免多显示器 DPI 缩放导致尺寸漂移）
        const [, height] = this.mainWindow.getSize()
        this.lockedSize = { width: WINDOW_WIDTH, height }
      } else {
        // 解锁：验证并恢复尺寸（用 setBounds 保留位置，避免 Windows 下 x 轴偏移）
        if (this.lockedSize) {
          const [currentX, currentY] = this.mainWindow.getPosition()
          const [, height] = this.mainWindow.getSize()
          if (WINDOW_WIDTH !== this.lockedSize.width || height !== this.lockedSize.height) {
            this.mainWindow.setBounds({
              x: currentX,
              y: currentY,
              width: this.lockedSize.width,
              height: this.lockedSize.height
            })
          }
          this.lockedSize = null
        }
      }
    })
    ipcMain.on('set-window-opacity', (_event, opacity: number) => this.setWindowOpacity(opacity))
    ipcMain.handle('set-tray-icon-visible', (_event, visible: boolean) =>
      this.setTrayIconVisible(visible)
    )
    ipcMain.handle('set-assembly-target', (_event, token: string) => {
      this.currentAssemblyTarget = token
      return true
    })
    ipcMain.handle('end-assembly-plugin', () => {
      return this.currentAssemblyTarget
    })
    ipcMain.on('open-settings', () => this.openSettings())
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
      // 使用固定宽度常量，避免多显示器 DPI 缩放导致 getSize() 返回被缩放的值
      const width = WINDOW_WIDTH
      // 限制高度范围: 最小初始高度, 最大不超过当前屏幕可用高度
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const maxHeight = display.workAreaSize.height
      const newHeight = Math.max(WINDOW_INITIAL_HEIGHT, Math.min(height, maxHeight))

      this.mainWindow.setBounds({
        width,
        height: newHeight
      })

      // 如果当前处于锁定状态，更新锁定的尺寸
      if (this.lockedSize) {
        this.lockedSize = { width, height: newHeight }
        console.log('[WindowAPI] 更新锁定尺寸:', this.lockedSize)
      }
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
    if (this.mainWindow && this.lockedSize) {
      // 拖动时强制保持锁定的尺寸
      this.mainWindow.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: this.lockedSize.width,
        height: this.lockedSize.height
      })
    } else if (this.mainWindow) {
      this.mainWindow.setPosition(x, y)
    }
  }

  public setWindowOpacity(opacity: number): void {
    if (this.mainWindow) {
      const clampedOpacity = Math.max(0.3, Math.min(1, opacity))
      this.mainWindow.setOpacity(clampedOpacity)
      console.log('[WindowAPI] 设置窗口不透明度:', clampedOpacity)
    }
  }

  public setTrayIconVisible(visible: boolean): void {
    windowManager.setTrayIconVisible(visible)
    console.log('[WindowAPI] 设置托盘图标可见性:', visible)
  }

  public setWindowMaterial(material: WindowMaterial): { success: boolean } {
    const result = windowManager.setWindowMaterial(material)
    console.log('[WindowAPI] 设置窗口材质:', material, '结果:', result)
    return result
  }

  public async getWindowMaterial(): Promise<WindowMaterial> {
    const material = await windowManager.getWindowMaterial()
    return material
  }

  private openSettings(): void {
    windowManager.showSettings()
    console.log('[WindowAPI] 打开设置插件')
  }

  /**
   * 更新主窗口当前输入上下文，供应用快捷键启动时复用
   */
  private updateLaunchContext(context: any): void {
    windowManager.updateAppShortcutLaunchContext(context || {})
  }

  public async updateAutoBackToSearch(autoBackToSearch: string): Promise<void> {
    await windowManager.updateAutoBackToSearch(autoBackToSearch)
    console.log('[WindowAPI] 更新自动返回搜索配置:', autoBackToSearch)
  }

  public async updateWindowPositionStrategy(strategy: string): Promise<void> {
    await windowManager.updateWindowPositionStrategy(strategy)
    console.log('[WindowAPI] 更新窗口呼出位置策略:', strategy)
  }
}

export default new WindowAPI()
