import { ipcMain, screen, desktopCapturer } from 'electron'
import { screenCapture } from '../../core/screenCapture.js'
import os from 'os'

/**
 * 屏幕和坐标相关API - 插件专用
 */
export class PluginScreenAPI {
  public init(): void {
    this.setupIPC()
  }

  private setupIPC(): void {
    // 屏幕截图
    ipcMain.handle('screen-capture', () => screenCapture())

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
        console.error('获取桌面捕获源失败:', error)
        throw error
      }
    })

    // 获取操作系统类型
    ipcMain.on('get-os-type', (event) => {
      event.returnValue = os.type()
    })
  }
}

export default new PluginScreenAPI()
