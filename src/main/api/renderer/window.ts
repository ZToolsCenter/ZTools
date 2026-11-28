import { MainWindowClient, type MainWindowSource } from '../../common/mainWindowClient'
import { BrowserWindow, ipcMain, screen } from 'electron'
import { WINDOW_WIDTH } from '../../common/constants.js'
import windowManager from '../../managers/windowManager.js'
import { applyHostWindowOpacity, getHostWindowMaterial } from '../../utils/windowMaterial'

/**
 * 窗口管理API - 主程序专用
 */
export class WindowAPI extends MainWindowClient {
  private lockedSize: { width: number; height: number } | null = null

  /**
   * 绑定主窗口来源，初始化本模块的宿主服务。
   * @param mainWindow 主窗口实例或当前宿主提供器。
   * @returns 无返回值。
   */
  public init(mainWindow: MainWindowSource): void {
    this.mainWindow = mainWindow
    this.setupIPC()
    this.setupWindowEvents()
  }

  /**
   * 注册主窗口控制和状态查询 IPC。
   * @returns 无返回值
   */
  private setupIPC(): void {
    // 主程序窗口控制集中注册，不承载插件页面就绪协议。
    ipcMain.handle('take-sleeping-search', (event) =>
      event.sender === this.mainWindow?.webContents ? windowManager.takeSleepingSearch() : null
    )
    ipcMain.on('hide-window', () => this.hideWindow())
    ipcMain.on('resize-window', (_event, height: number) => this.resizeWindow(height))
    ipcMain.on('update-launch-context', (_event, context: any) => this.updateLaunchContext(context))
    ipcMain.handle('get-window-position', () => this.getWindowPosition())
    // 页面的查询只读取其自身窗口，不受主窗口休眠或销毁影响。
    ipcMain.handle('get-window-material', (event) =>
      getHostWindowMaterial(BrowserWindow.fromWebContents(event.sender))
    )
    ipcMain.on('set-window-position', (_event, x: number, y: number) =>
      this.setWindowPosition(x, y)
    )
    // 拖动控制：锁定/解锁窗口尺寸
    ipcMain.on('set-window-size-lock', (_event, lock: boolean) => {
      // DWM 的移动路径始终使用应用记录的尺寸，不依赖原生边界快照。
      if (!this.mainWindow || windowManager.usesDwmMainWindow()) return

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
    ipcMain.on('open-settings', () => this.openSettings())
  }

  /**
   * 为本次窗口实例安装位置记忆，销毁时取消尚未执行的写入。
   * @returns 无返回值。
   */
  public setupWindowEvents(): void {
    const win = this.mainWindow
    this.lockedSize = null
    let moveTimeout: NodeJS.Timeout | null = null
    win?.once('closed', () => {
      if (moveTimeout) clearTimeout(moveTimeout)
    })
    win?.on('move', () => {
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

  /**
   * 调整主窗口高度，并按当前顶部栏密度和屏幕工作区约束结果。
   * @param height 目标窗口高度，单位为像素。
   * @returns 无返回值。
   */
  public resizeWindow(height: number): void {
    if (this.mainWindow) {
      // 限制高度范围：最小为当前顶部栏高度，最大不超过当前屏幕可用高度。
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const maxHeight = display.workAreaSize.height
      const minHeight = windowManager.getMainWindowHeaderHeight()
      const newHeight = Math.max(minHeight, Math.min(height, maxHeight))

      windowManager.resizeMainWindow(newHeight)

      // 如果当前处于锁定状态，更新锁定的尺寸
      if (this.lockedSize) {
        this.lockedSize = { width: WINDOW_WIDTH, height: newHeight }
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

  /**
   * 在保持搜索布局尺寸的前提下移动主窗口。
   * @param x 目标位置横坐标。
   * @param y 目标位置纵坐标。
   * @returns 无返回值。
   */
  public setWindowPosition(x: number, y: number): void {
    windowManager.applyMainWindowPosition(
      Math.round(x),
      Math.round(y),
      this.lockedSize ?? undefined
    )
  }

  /**
   * 将不透明度应用到支持整窗 alpha 的当前主窗口。
   * @param opacity 用户选择的整窗不透明度。
   * @returns 无返回值。
   */
  public setWindowOpacity(opacity: number): void {
    // 设置 IPC 与启动、唤醒共用同一个原生材质保护。
    if (applyHostWindowOpacity(this.mainWindow, opacity)) {
      console.log('[WindowAPI] 设置窗口不透明度:', opacity)
    }
  }

  public setTrayIconVisible(visible: boolean): void {
    windowManager.setTrayIconVisible(visible)
    console.log('[WindowAPI] 设置托盘图标可见性:', visible)
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
