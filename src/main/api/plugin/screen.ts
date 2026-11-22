import { MainWindowClient, type MainWindowSource } from '../../common/mainWindowClient'
import { ipcMain, screen, desktopCapturer, BrowserWindow } from 'electron'
import { screenCapture } from '../../core/screenCapture.js'
import { ColorPicker } from '../../core/native/index.js'
import os from 'os'

/**
 * hex 转 rgb 字符串，如 '#59636E' → 'rgb(89, 99, 110)'
 */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * 屏幕和坐标相关API - 插件专用
 */
export class PluginScreenAPI extends MainWindowClient {
  /**
   * 绑定主窗口来源，初始化本模块的宿主服务。
   * @param mainWindow 主窗口实例或当前宿主提供器。
   * @returns 无返回值。
   */
  public init(mainWindow: MainWindowSource): void {
    this.mainWindow = mainWindow
    this.setupIPC()
  }

  private setupIPC(): void {
    // 屏幕截图
    ipcMain.handle('screen-capture', () => screenCapture(this.mainWindow || undefined))

    // 获取主显示器信息
    ipcMain.on('get-primary-display', (event) => {
      const display = screen.getPrimaryDisplay()
      event.returnValue = display
    })

    // 获取所有显示器
    ipcMain.on('get-all-displays', (event) => {
      const displays = screen.getAllDisplays()
      event.returnValue = displays
    })

    // 获取鼠标光标的屏幕坐标
    ipcMain.on('get-cursor-screen-point', (event) => {
      const point = screen.getCursorScreenPoint()
      event.returnValue = point
    })

    // 获取最接近指定点的显示器
    ipcMain.on('get-display-nearest-point', (event, point: Electron.Point) => {
      const display = screen.getDisplayNearestPoint(point)
      event.returnValue = display
    })

    // DIP 坐标转屏幕物理坐标
    ipcMain.on('dip-to-screen-point', (event, point: Electron.Point) => {
      const p = screen.dipToScreenPoint(point)
      event.returnValue = p
    })

    // DIP 区域转屏幕物理区域
    ipcMain.on(
      'dip-to-screen-rect',
      (event, rect: { x: number; y: number; width: number; height: number }) => {
        // Mac 平台直接返回 rect
        if (process.platform === 'darwin') {
          event.returnValue = rect
          return
        }
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) {
          console.error('[PluginScreen] 无法获取调用者的窗口')
          event.returnValue = rect
          return
        }
        const result = screen.dipToScreenRect(window, rect)
        event.returnValue = result
      }
    )

    // 屏幕物理坐标转 DIP 坐标
    ipcMain.on('screen-to-dip-point', (event, point: Electron.Point) => {
      const p = screen.screenToDipPoint(point)
      event.returnValue = p
    })

    // 获取桌面捕获源
    ipcMain.handle('desktop-capture-sources', async (_event, options: Electron.SourcesOptions) => {
      try {
        const sources = await desktopCapturer.getSources(options)
        return sources
      } catch (error) {
        console.error('[PluginScreen] 获取桌面捕获源失败:', error)
        throw error
      }
    })

    // 获取操作系统类型
    ipcMain.on('get-os-type', (event) => {
      event.returnValue = os.type()
    })

    // 屏幕取色
    ipcMain.handle('screen-color-pick', async () => {
      return new Promise<{ success: boolean; hex: string | null; rgb: string | null }>(
        (resolve) => {
          try {
            ColorPicker.start((result) => {
              if (result.success && result.hex) {
                resolve({ success: true, hex: result.hex, rgb: hexToRgb(result.hex) })
              } else {
                resolve({ success: false, hex: null, rgb: null })
              }
            })
          } catch (error) {
            console.error('[PluginScreen] 屏幕取色失败:', error)
            resolve({ success: false, hex: null, rgb: null })
          }
        }
      )
    })
  }
}

export default new PluginScreenAPI()
