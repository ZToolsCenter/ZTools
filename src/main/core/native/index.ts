import os from 'os'
import macZToolsNative from '../../../../resources/lib/mac/ztools_native.node?asset'
import winZToolsNative from '../../../../resources/lib/win/ztools_native.node?asset'

// 根据平台加载对应的原生模块
const platform = os.platform()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require(platform === 'darwin' ? macZToolsNative : winZToolsNative)

// 原生模块接口类型定义
interface NativeAddon {
  startMonitor: (callback: () => void) => void
  stopMonitor: () => void
  startWindowMonitor: (callback: (windowInfo: WindowInfo) => void) => void
  stopWindowMonitor: () => void
  getActiveWindow: () => ActiveWindowResult | null
  activateWindow: (identifier: string | number) => boolean
}

interface WindowInfo {
  appName: string
  bundleId?: string
  processId?: number
}

interface ActiveWindowResult {
  appName: string
  bundleId?: string
  processId?: number
  error?: string
}

/**
 * 剪贴板监控类
 */
export class ClipboardMonitor {
  private _callback: (() => void) | null = null
  private _isMonitoring = false

  /**
   * 启动剪贴板监控
   * @param callback - 剪贴板变化时的回调函数（无参数）
   */
  start(callback: () => void): void {
    if (this._isMonitoring) {
      throw new Error('Monitor is already running')
    }

    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function')
    }

    this._callback = callback
    this._isMonitoring = true
    ;(addon as NativeAddon).startMonitor(() => {
      if (this._callback) {
        this._callback()
      }
    })
  }

  /**
   * 停止剪贴板监控
   */
  stop(): void {
    if (!this._isMonitoring) {
      return
    }

    ;(addon as NativeAddon).stopMonitor()
    this._isMonitoring = false
    this._callback = null
  }

  /**
   * 是否正在监控
   */
  get isMonitoring(): boolean {
    return this._isMonitoring
  }
}

/**
 * 窗口监控类
 */
export class WindowMonitor {
  private _callback: ((windowInfo: WindowInfo) => void) | null = null
  private _isMonitoring = false

  /**
   * 启动窗口监控
   * @param callback - 窗口切换时的回调函数
   * - macOS: { appName: string, bundleId: string }
   * - Windows: { appName: string, processId: number }
   */
  start(callback: (windowInfo: WindowInfo) => void): void {
    if (this._isMonitoring) {
      throw new Error('Window monitor is already running')
    }

    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function')
    }

    this._callback = callback
    this._isMonitoring = true
    ;(addon as NativeAddon).startWindowMonitor((windowInfo) => {
      if (this._callback) {
        this._callback(windowInfo)
      }
    })
  }

  /**
   * 停止窗口监控
   */
  stop(): void {
    if (!this._isMonitoring) {
      return
    }

    ;(addon as NativeAddon).stopWindowMonitor()
    this._isMonitoring = false
    this._callback = null
  }

  /**
   * 是否正在监控
   */
  get isMonitoring(): boolean {
    return this._isMonitoring
  }
}

/**
 * 窗口管理类
 */
export class WindowManager {
  /**
   * 获取当前激活的窗口信息
   * @returns 窗口信息对象
   * - macOS: { appName, bundleId }
   * - Windows: { appName, processId }
   */
  static getActiveWindow(): { appName: string; bundleId?: string; processId?: number } | null {
    const result = (addon as NativeAddon).getActiveWindow()
    if (!result || result.error) {
      return null
    }
    return result
  }

  /**
   * 根据标识符激活指定应用的窗口
   * @param identifier - 应用标识符
   * - macOS: bundleId (string)
   * - Windows: processId (number)
   * @returns 是否激活成功
   */
  static activateWindow(identifier: string | number): boolean {
    if (platform === 'darwin') {
      // macOS: bundleId 是字符串
      if (typeof identifier !== 'string') {
        throw new TypeError('On macOS, identifier must be a bundleId (string)')
      }
    } else if (platform === 'win32') {
      // Windows: processId 是数字
      if (typeof identifier !== 'number') {
        throw new TypeError('On Windows, identifier must be a processId (number)')
      }
    }
    return (addon as NativeAddon).activateWindow(identifier)
  }

  /**
   * 获取当前平台
   * @returns 'darwin' | 'win32'
   */
  static getPlatform(): string {
    return platform
  }
}

// 为了向后兼容，默认导出 ClipboardMonitor
export default ClipboardMonitor
