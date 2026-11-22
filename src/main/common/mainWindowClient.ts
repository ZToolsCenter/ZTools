import type { BrowserWindow } from 'electron'

export type MainWindowSource = BrowserWindow | (() => BrowserWindow | null)

/** 常驻服务在使用窗口时解析宿主，避免休眠后保留已销毁的 BrowserWindow。 */
export class MainWindowClient {
  private source: MainWindowSource | null = null

  /**
   * 获取当前主窗口，休眠期间可为空。
   * @returns 当前可用的窗口或 null。
   */
  protected get mainWindow(): BrowserWindow | null {
    return typeof this.source === 'function' ? this.source() : this.source
  }

  /**
   * 接受固定窗口或随宿主生命周期更新的窗口来源。
   * @param source 窗口实例、窗口提供器或 null。
   * @returns 无返回值。
   */
  protected set mainWindow(source: MainWindowSource | null) {
    this.source = source
  }
}
