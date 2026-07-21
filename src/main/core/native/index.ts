import os from 'os'
import { execSync, spawnSync } from 'child_process'
import { clipboard } from 'electron'
import macZToolsNative from '../../../../resources/lib/mac/ztools_native.node?asset'
import winZToolsNative from '../../../../resources/lib/win/ztools_native.node?asset'

// 根据平台加载对应的原生模块
// 注意：?asset 导入是 Vite 构建期转换，只能做静态导入（得到路径字符串）
// 真正的模块加载在下方 require() 中，按平台各自加载，Linux 不加载任何原生模块
const platform = os.platform()

let addon: any = null
if (platform === 'darwin') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  addon = require(macZToolsNative)
} else if (platform === 'win32') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  addon = require(winZToolsNative)
}

// 原生模块接口类型定义
interface UwpAppInfo {
  name: string
  appId: string
  icon: string
  installLocation: string
}

export interface WindowsShortcutInfo {
  name: string
  path: string
  icon?: string
  targetPath?: string
  sourceType?: 'lnk' | 'url' | 'lnk-url' | string
}

export interface FileLocationWindowInfo {
  platform?: 'win32' | 'darwin'
  kind?: 'windows-explorer' | 'windows-file-dialog' | 'mac-finder' | 'mac-file-dialog'
  preciseTarget?: boolean
  hwnd?: number
  windowId?: number
  finderId?: number
  pid?: number
  bundleId?: string
  app?: string
  title?: string
  className?: string
  axRole?: string
  axSubrole?: string
  path?: string
  url?: string
}

interface NativeAddon {
  startMonitor: (callback: () => void) => void
  stopMonitor: () => void
  setClipboardPollingBoost?: (intervalMs: number, durationMs: number) => void
  startWindowMonitor: (callback: (windowInfo: WindowInfo) => void) => void
  stopWindowMonitor: () => void
  getActiveWindow: () => ActiveWindowResult | null
  activateWindow: (identifier: string | number) => boolean
  simulatePaste: () => boolean
  simulateKeyboardTap: (key: string, ...modifiers: string[]) => boolean
  ensureOptimizedShortcutListener: (
    callback: (payload: { shortcut: string; primed: boolean }) => void
  ) => void
  stopOptimizedShortcutListener: () => void
  registerOptimizedShortcut: (shortcut: string) => { success: boolean; error?: string }
  unregisterOptimizedShortcut: (shortcut: string) => { success: boolean; error?: string }
  getOptimizedShortcutCount: () => number
  primeScreenshotFrame: () => boolean
  startRegionCapture: (
    callback: (result: { success: boolean; width?: number; height?: number }) => void
  ) => void
  startRegionCaptureWithPrimedFrame: (
    callback: (result: { success: boolean; width?: number; height?: number }) => void
  ) => void
  getClipboardFiles: () => ClipboardFile[]
  setClipboardFiles: (files: Array<string | { path: string }>) => boolean
  simulateMouseMove: (x: number, y: number) => boolean
  simulateMouseClick: (x: number, y: number) => boolean
  simulateMouseDoubleClick: (x: number, y: number) => boolean
  simulateMouseRightClick: (x: number, y: number) => boolean
  startMouseMonitor: (
    buttonType: MouseButtonType,
    longPressMs: number,
    callback: () => void | { shouldBlock?: boolean }
  ) => void
  stopMouseMonitor: () => void
  getUwpApps: () => UwpAppInfo[]
  launchUwpApp: (appId: string) => boolean
  getFileIcon: (filePath: string) => Promise<Buffer>
  resolveMuiStrings: (refs: string[]) => { [ref: string]: string }
  scanWindowsShortcuts: (
    scanPaths: string[],
    rootScanPaths: string[],
    skipFolders: string[]
  ) => WindowsShortcutInfo[]
  startColorPicker: (callback: (result: { success: boolean; hex: string | null }) => void) => void
  stopColorPicker: () => void
  /** 通过 Unicode 输入法模拟键入单个字符/字素簇 */
  unicodeType: (segment: string) => boolean
  /** Windows: 通过 COM IShellWindows 查询指定窗口句柄对应的 Explorer 文件夹路径 */
  getExplorerFolderPath: (hwnd: number) => string | null
  /** Windows/macOS: 获取文件管理器窗口 */
  getAllExplorerWindows: () => Array<FileLocationWindowInfo | string>
  /** Windows/macOS: 设置文件管理器或文件选择对话框地址栏路径 */
  setAddressBar: (identifier: number | string | FileLocationWindowInfo, address: string) => boolean
  /** Windows: 判断窗口是否是可安全修改地址栏的文件定位窗口 */
  isFileLocationWindow?: (hwnd: number) => boolean
  /** Windows: 读取指定浏览器窗口的当前 URL，结果通过 callback 返回 */
  readBrowserWindowUrl: (
    browserName: string,
    hwnd: number,
    callback: (url: string | null) => void
  ) => void
  /**
   * 获取当前选中的内容（支持文本、文件、图像）
   * 实现方式：
   * - Windows: 优先使用 UI Automation API，回退到剪贴板方法
   * - macOS: 使用模拟复制方法（Cmd+C）
   * 自动暂停 clipboardMonitor，防止误触发监听
   */
  getSelectedContent: () => Array<
    | { type: 'text'; data: string }
    | { type: 'file'; data: string[] }
    | { type: 'image'; data: string }
  >
}

interface WindowInfo {
  app: string // 应用名称（如 "Finder.app"）
  platform?: 'win32' | 'darwin'
  kind?: FileLocationWindowInfo['kind']
  preciseTarget?: boolean
  bundleId?: string // macOS 独有
  pid?: number // 进程ID (macOS 和 Windows 都有)
  title?: string // 窗口标题
  x?: number // 窗口 x 坐标
  y?: number // 窗口 y 坐标
  width?: number // 窗口宽度
  height?: number // 窗口高度
  appPath?: string // 应用路径
  className?: string // Windows 窗口类名（用于区分 CabinetWClass/Progman/WorkerW 等）
  hwnd?: number // Windows 窗口句柄（用于 COM 查询 Explorer 路径）
  windowId?: number
  finderId?: number
  axRole?: string
  axSubrole?: string
  path?: string
  url?: string
}

interface ActiveWindowResult {
  app: string
  bundleId?: string
  pid?: number
  error?: string
}

interface ClipboardFile {
  path: string
  name: string
  isDirectory: boolean
}

// 鼠标按钮类型
type MouseButtonType = 'middle' | 'right' | 'back' | 'forward'

/**
 * 剪贴板监控类
 */
export class ClipboardMonitor {
  private _callback: (() => void) | null = null
  private _isMonitoring = false
  private _pollTimer: ReturnType<typeof setInterval> | null = null

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

    if (platform === 'linux') {
      // Linux 降级：使用 Electron clipboard 轮询（每 500ms 检测一次变化）
      let lastText = clipboard.readText()
      this._pollTimer = setInterval(() => {
        const current = clipboard.readText()
        if (current !== lastText) {
          lastText = current
          if (this._callback) {
            this._callback()
          }
        }
      }, 500)
    } else {
      ;(addon as NativeAddon).startMonitor(() => {
        if (this._callback) {
          this._callback()
        }
      })
    }
  }

  /**
   * 停止剪贴板监控
   */
  stop(): void {
    if (!this._isMonitoring) {
      return
    }

    if (platform === 'linux') {
      if (this._pollTimer !== null) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
    } else {
      ;(addon as NativeAddon).stopMonitor()
    }
    this._isMonitoring = false
    this._callback = null
  }

  /**
   * 是否正在监控
   */
  get isMonitoring(): boolean {
    return this._isMonitoring
  }

  /**
   * macOS: 临时提升剪贴板轮询频率（仅在当前进程内有效）
   * @param intervalMs - 轮询间隔（毫秒），建议设置为 20-50ms
   * @param durationMs - 持续时间（毫秒）
   */
  static setClipboardPollingBoost(intervalMs: number, durationMs: number): void {
    const boostFn = (addon as NativeAddon).setClipboardPollingBoost
    if (platform === 'darwin' && typeof boostFn === 'function') {
      boostFn(intervalMs, durationMs)
    }
  }

  /**
   * 获取剪贴板中的文件列表
   * @returns {Array<{path: string, name: string, isDirectory: boolean}>} 文件列表
   * - path: 文件完整路径
   * - name: 文件名
   * - isDirectory: 是否是目录
   */
  static getClipboardFiles(): ClipboardFile[] {
    if (platform === 'win32') {
      return (addon as NativeAddon).getClipboardFiles()
    } else if (platform === 'darwin') {
      // macOS 暂不支持
      throw new Error('getClipboardFiles is not yet supported on macOS')
    }
    return []
  }

  /**
   * 设置剪贴板中的文件列表
   * @param {Array<string|{path: string}>} files - 文件路径数组
   * - 支持直接传递字符串路径数组: ['C:\\file1.txt', 'C:\\file2.txt']
   * - 支持传递对象数组: [{path: 'C:\\file1.txt'}, {path: 'C:\\file2.txt'}]
   * @returns {boolean} 是否设置成功
   * @example
   * // 使用字符串数组
   * ClipboardMonitor.setClipboardFiles(['C:\\test.txt', 'C:\\folder']);
   *
   * // 使用对象数组（兼容 getClipboardFiles 的返回格式）
   * const files = ClipboardMonitor.getClipboardFiles();
   * ClipboardMonitor.setClipboardFiles(files);
   */
  static setClipboardFiles(files: Array<string | { path: string }>): boolean {
    if (!Array.isArray(files)) {
      throw new TypeError('files must be an array')
    }

    if (files.length === 0) {
      throw new Error('files array cannot be empty')
    }

    if (platform === 'win32' || platform === 'darwin') {
      return (addon as NativeAddon).setClipboardFiles(files)
    }
    return false
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
   * - macOS: { app, bundleId, title, x, y, width, height, appPath, pid }
   * - Windows: { app, pid, title, x, y, width, height, appPath }
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

    if (platform === 'linux') {
      // Linux 降级：暂不支持窗口焦点监控，静默忽略
      console.warn('[WindowMonitor] Linux 平台暂不支持原生窗口监控，功能已降级')
    } else {
      ;(addon as NativeAddon).startWindowMonitor((windowInfo) => {
        if (this._callback) {
          this._callback(windowInfo)
        }
      })
    }
  }

  /**
   * 停止窗口监控
   */
  stop(): void {
    if (!this._isMonitoring) {
      return
    }

    if (platform !== 'linux') {
      ;(addon as NativeAddon).stopWindowMonitor()
    }
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
   * - macOS: { app, bundleId, pid }
   * - Windows: { app, pid }
   */
  static getActiveWindow(): { app: string; bundleId?: string; pid?: number } | null {
    if (platform === 'linux') {
      return null
    }

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
    if (platform === 'linux') {
      // Linux 平台尝试使用 wmctrl 激活窗口
      try {
        if (typeof identifier === 'number') {
          // 如果是 PID，查找对应的窗口 ID
          // 使用 execSync 确保操作同步执行
          const stdout = execSync('wmctrl -lp').toString()
          const lines = stdout.split('\n')
          for (const line of lines) {
            const parts = line.split(/\s+/).filter(Boolean)
            if (parts.length >= 3 && parts[2] === identifier.toString()) {
              const wid = parts[0]
              spawnSync('wmctrl', ['-ia', wid])
              break
            }
          }
        } else if (typeof identifier === 'string' && identifier.startsWith('0x')) {
          // 如果是窗口 ID
          spawnSync('wmctrl', ['-ia', identifier])
        } else {
          // 如果是字符串，尝试按标题/类名激活
          spawnSync('wmctrl', ['-a', identifier])
        }
        return true
      } catch (e) {
        console.error('[Native] Linux activateWindow 失败:', e)
        return false
      }
    }

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

  /**
   * 模拟粘贴操作（Command+V on macOS, Ctrl+V on Windows）
   * @returns {boolean} 是否成功
   */
  static simulatePaste(): boolean {
    if (platform === 'linux') {
      return false
    }
    return (addon as NativeAddon).simulatePaste()
  }

  /**
   * 模拟键盘按键
   * @param {string} key - 要模拟的按键
   * @param {...string} modifiers - 修饰键（shift、ctrl、alt、meta）
   * @returns {boolean} 是否成功
   * @example
   * // 模拟按下字母 'a'
   * WindowManager.simulateKeyboardTap('a');
   *
   * // 模拟 Command+C (macOS) 或 Ctrl+C (Windows)
   * WindowManager.simulateKeyboardTap('c', 'meta');
   *
   * // 模拟 Shift+Tab
   * WindowManager.simulateKeyboardTap('tab', 'shift');
   *
   * // 模拟 Command+Shift+S (macOS)
   * WindowManager.simulateKeyboardTap('s', 'meta', 'shift');
   */
  static simulateKeyboardTap(key: string, ...modifiers: string[]): boolean {
    if (platform === 'linux') {
      return false
    }

    if (typeof key !== 'string' || !key) {
      throw new TypeError('key must be a non-empty string')
    }
    return (addon as NativeAddon).simulateKeyboardTap(key, ...modifiers)
  }

  /**
   * 模拟 Unicode 字符输入（逐字符输入，类似输入法）
   * @param {string} segment - 要输入的字符/字素簇
   * @returns {boolean} 是否成功
   */
  static unicodeType(segment: string): boolean {
    if (platform === 'linux') {
      return false
    }
    return (addon as NativeAddon).unicodeType(segment)
  }

  /**
   * Windows: 通过 COM IShellWindows 查询指定窗口句柄对应的 Explorer 文件夹路径
   * @param hwnd - 窗口句柄（从 WindowInfo.hwnd 获取）
   * @returns 文件夹路径（file:/// URL 格式），失败返回 null
   */
  static getExplorerFolderPath(hwnd: number): string | null {
    if (platform !== 'win32') {
      throw new Error('getExplorerFolderPath is only available on Windows')
    }
    return (addon as NativeAddon).getExplorerFolderPath(hwnd)
  }

  /**
   * Windows/macOS: 获取所有文件管理器窗口
   * @returns 文件管理器窗口列表
   */
  static getAllExplorerWindows(): Array<FileLocationWindowInfo | string> {
    if (platform !== 'win32' && platform !== 'darwin') {
      throw new Error('getAllExplorerWindows is only available on Windows and macOS')
    }
    return (addon as NativeAddon).getAllExplorerWindows()
  }

  static isFileLocationWindow(hwnd: number): boolean {
    if (platform !== 'win32') {
      throw new Error('isFileLocationWindow is only available on Windows')
    }
    if (typeof hwnd !== 'number' || !Number.isFinite(hwnd) || hwnd <= 0) {
      throw new TypeError('hwnd must be a positive number')
    }
    return Boolean((addon as NativeAddon).isFileLocationWindow?.(hwnd))
  }

  /**
   * Windows/macOS: 设置文件管理器或文件选择对话框地址栏路径
   * @param target 目标窗口标识或窗口信息
   * @param address 要跳转的路径或地址
   * @returns 是否设置成功
   */
  static setAddressBar(target: number | string | FileLocationWindowInfo, address: string): boolean {
    if (platform !== 'win32' && platform !== 'darwin') {
      throw new Error('setAddressBar is only available on Windows and macOS')
    }
    if (typeof address !== 'string' || address.trim() === '') {
      throw new TypeError('address must be a non-empty string')
    }

    const identifier =
      typeof target === 'object' && target !== null
        ? platform === 'darwin'
          ? target
          : target.hwnd
        : target

    if (platform === 'win32') {
      if (typeof identifier !== 'number' || !Number.isFinite(identifier) || identifier <= 0) {
        throw new TypeError('target must include a valid hwnd')
      }
    } else if (typeof identifier === 'object' && identifier !== null) {
      if (!identifier.preciseTarget) {
        throw new TypeError('target must include precise macOS window identity')
      }
    } else if (
      (typeof identifier !== 'number' || !Number.isFinite(identifier) || identifier <= 0) &&
      (typeof identifier !== 'string' || identifier.trim() === '')
    ) {
      throw new TypeError('target must include a valid bundleId or pid')
    }

    return Boolean((addon as NativeAddon).setAddressBar(identifier, address))
  }

  /**
   * Windows: 读取指定浏览器窗口的当前 URL
   * @param browserName 浏览器标识（如 chrome/msedge/firefox）
   * @param hwnd 窗口句柄（从 WindowInfo.hwnd 获取）
   * @returns URL 字符串，失败返回 null
   */
  static readBrowserWindowUrl(browserName: string, hwnd: number): Promise<string | null> {
    if (platform !== 'win32') {
      throw new Error('readBrowserWindowUrl is only available on Windows')
    }
    if (typeof browserName !== 'string' || browserName.trim() === '') {
      throw new TypeError('browserName must be a non-empty string')
    }
    if (typeof hwnd !== 'number' || !Number.isFinite(hwnd) || hwnd <= 0) {
      throw new TypeError('hwnd must be a positive number')
    }

    return new Promise((resolve) => {
      ;(addon as NativeAddon).readBrowserWindowUrl(browserName, hwnd, (url) => {
        resolve(typeof url === 'string' && url.trim() !== '' ? url : null)
      })
    })
  }

  /**
   * 模拟鼠标移动到指定屏幕位置
   * @param x 距离屏幕左侧的位置（像素）
   * @param y 距离屏幕顶部的位置（像素）
   * @returns 是否成功
   */
  static simulateMouseMove(x: number, y: number): boolean {
    if (platform === 'linux') {
      return false
    }

    if (typeof x !== 'number' || typeof y !== 'number') {
      throw new TypeError('x and y must be numbers')
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError('x and y must be finite numbers')
    }
    return (addon as NativeAddon).simulateMouseMove(x, y)
  }

  /**
   * 模拟鼠标左键单击
   * @param x 距离屏幕左侧的位置（像素）
   * @param y 距离屏幕顶部的位置（像素）
   * @returns 是否成功
   */
  static simulateMouseClick(x: number, y: number): boolean {
    if (platform === 'linux') {
      return false
    }

    if (typeof x !== 'number' || typeof y !== 'number') {
      throw new TypeError('x and y must be numbers')
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError('x and y must be finite numbers')
    }
    return (addon as NativeAddon).simulateMouseClick(x, y)
  }

  /**
   * 模拟鼠标左键双击
   * @param x 距离屏幕左侧的位置（像素）
   * @param y 距离屏幕顶部的位置（像素）
   * @returns 是否成功
   */
  static simulateMouseDoubleClick(x: number, y: number): boolean {
    if (platform === 'linux') {
      return false
    }

    if (typeof x !== 'number' || typeof y !== 'number') {
      throw new TypeError('x and y must be numbers')
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError('x and y must be finite numbers')
    }
    return (addon as NativeAddon).simulateMouseDoubleClick(x, y)
  }

  /**
   * 模拟鼠标右键单击
   * @param x 距离屏幕左侧的位置（像素）
   * @param y 距离屏幕顶部的位置（像素）
   * @returns 是否成功
   */
  static simulateMouseRightClick(x: number, y: number): boolean {
    if (platform === 'linux') {
      return false
    }

    if (typeof x !== 'number' || typeof y !== 'number') {
      throw new TypeError('x and y must be numbers')
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError('x and y must be finite numbers')
    }
    return (addon as NativeAddon).simulateMouseRightClick(x, y)
  }

  /**
   * 获取当前选中的内容（支持文本、文件、图像）
   *
   * 实现方式：
   * - Windows: 优先使用 UI Automation API，回退到剪贴板方法（适用于 Cursor/VS Code 等编辑器）
   * - macOS: 使用模拟复制方法（Cmd+C）
   *
   * 在模拟复制时会自动暂停内部的 clipboardMonitor，防止误触发监听自身发起的事件
   *
   * @returns {Array<{type: string, data: any}>} 选中内容数组
   * - type: 'text' | 'file' | 'image'
   * - data: 根据类型不同：
   *   - text: 字符串
   *   - file: 文件路径字符串数组
   *   - image: base64 编码的 PNG 图像（带 format 和 encoding 字段）
   *
   * @example
   * const contents = WindowManager.getSelectedContent();
   * contents.forEach(item => {
   *   switch (item.type) {
   *     case 'text':
   *       console.log('Selected text:', item.data);
   *       break;
   *     case 'file':
   *       console.log('Selected files:', item.data);
   *       break;
   *     case 'image':
   *       console.log('Selected image (base64):', item.data.substring(0, 50) + '...');
   *       break;
   *   }
   * });
   */
  static getSelectedContent(): Array<
    | { type: 'text'; data: string }
    | { type: 'file'; data: string[] }
    | { type: 'image'; data: string }
  > {
    if (platform === 'linux') {
      return []
    }
    return (addon as NativeAddon).getSelectedContent()
  }
}

/**
 * 鼠标监控类
 */
export type MouseMonitorResult = { shouldBlock?: boolean } | void

export class MouseMonitor {
  private static _callback: (() => MouseMonitorResult) | null = null
  private static _isMonitoring = false

  /**
   * 启动鼠标监控
   * @param buttonType - 按钮类型：'middle' | 'right' | 'back' | 'forward'
   * @param longPressMs - 长按阈值（毫秒）
   *   - 0: 监听点击（mouseUp 时触发）
   *   - >0: 监听长按（按住达到该时长后触发）
   *   - 注意：'right' 只支持长按（longPressMs 必须 > 0）
   * @param callback - 鼠标事件回调函数
   * - 返回值: 无返回值或 { shouldBlock?: boolean }
   *   - shouldBlock: true 时 C++ 侧拦截原始鼠标事件，不传递给目标窗口
   */
  static start(
    buttonType: MouseButtonType,
    longPressMs: number,
    callback: () => MouseMonitorResult
  ): void {
    if (MouseMonitor._isMonitoring) {
      throw new Error('Mouse monitor is already running')
    }

    const validButtons: MouseButtonType[] = ['middle', 'right', 'back', 'forward']
    if (!validButtons.includes(buttonType)) {
      throw new TypeError(`buttonType must be one of: ${validButtons.join(', ')}`)
    }

    if (typeof longPressMs !== 'number' || longPressMs < 0) {
      throw new TypeError('longPressMs must be a non-negative number')
    }

    if (buttonType === 'right' && longPressMs === 0) {
      throw new TypeError("'right' button only supports long press (longPressMs must be > 0)")
    }

    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function')
    }

    MouseMonitor._callback = callback
    MouseMonitor._isMonitoring = true
    if (platform === 'linux') {
      return
    }
    ;(addon as NativeAddon).startMouseMonitor(buttonType, longPressMs, () => {
      if (MouseMonitor._callback) {
        return MouseMonitor._callback()
      }
    })
  }

  /**
   * 停止鼠标监控
   */
  static stop(): void {
    if (!MouseMonitor._isMonitoring) {
      return
    }

    if (platform !== 'linux') {
      ;(addon as NativeAddon).stopMouseMonitor()
    }
    MouseMonitor._isMonitoring = false
    MouseMonitor._callback = null
  }

  /**
   * 是否正在监控
   */
  static get isMonitoring(): boolean {
    return MouseMonitor._isMonitoring
  }
}

export class OptimizedShortcutManager {
  private static _callback: ((payload: { shortcut: string; primed: boolean }) => void) | null = null
  private static _isListening = false

  /**
   * 启动 native 优化快捷键监听。
   */
  static ensureListener(callback: (payload: { shortcut: string; primed: boolean }) => void): void {
    if (platform !== 'win32') {
      return
    }

    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function')
    }

    OptimizedShortcutManager._callback = callback
    if (OptimizedShortcutManager._isListening) {
      return
    }

    ;(addon as NativeAddon).ensureOptimizedShortcutListener((payload) => {
      OptimizedShortcutManager._callback?.(payload)
    })
    OptimizedShortcutManager._isListening = true
  }

  /**
   * 停止 native 优化快捷键监听。
   */
  static stopListener(): void {
    if (platform !== 'win32') {
      return
    }
    if (!OptimizedShortcutManager._isListening) {
      return
    }

    ;(addon as NativeAddon).stopOptimizedShortcutListener()
    OptimizedShortcutManager._isListening = false
    OptimizedShortcutManager._callback = null
  }

  /**
   * 注册一个由 native 接管监听的优化快捷键。
   */
  static registerShortcut(shortcut: string): { success: boolean; error?: string } {
    if (platform !== 'win32') {
      return { success: false, error: 'optimized shortcut is only supported on Windows' }
    }
    return (addon as NativeAddon).registerOptimizedShortcut(shortcut)
  }

  /**
   * 注销一个由 native 接管监听的优化快捷键。
   */
  static unregisterShortcut(shortcut: string): { success: boolean; error?: string } {
    if (platform !== 'win32') {
      return { success: false, error: 'optimized shortcut is only supported on Windows' }
    }
    return (addon as NativeAddon).unregisterOptimizedShortcut(shortcut)
  }

  /**
   * 获取当前由 native 接管的优化快捷键数量。
   */
  static getShortcutCount(): number {
    if (platform !== 'win32') {
      return 0
    }
    return (addon as NativeAddon).getOptimizedShortcutCount()
  }
}

/**
 * 区域截图类
 */
export class ScreenCapture {
  /**
   * 预抓取当前虚拟屏幕帧
   */
  static prime(): boolean {
    if (platform === 'darwin') {
      throw new Error('ScreenCapture is not yet supported on macOS')
    }

    return (addon as NativeAddon).primeScreenshotFrame()
  }

  /**
   * 启动区域截图
   * @param {Function} callback - 截图完成时的回调函数
   * - 参数: { success: boolean, width?: number, height?: number, x?: number, y?: number }
   * - success: 是否成功截图
   * - width: 截图宽度（成功时）
   * - height: 截图高度（成功时）
   * - x: 截图左上角 x 坐标（成功时，macOS 暂不支持）
   * - y: 截图左上角 y 坐标（成功时，macOS 暂不支持）
   */
  static start(
    callback: (result: {
      success: boolean
      width?: number
      height?: number
      x?: number
      y?: number
    }) => void
  ): void {
    if (platform === 'darwin') {
      // macOS 暂不支持
      throw new Error('ScreenCapture is not yet supported on macOS')
    }

    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function')
    }

    ;(addon as NativeAddon).startRegionCaptureWithPrimedFrame((result) => {
      callback(result)
    })
  }
}

/**
 * UWP 应用管理类
 */
export class UwpManager {
  /**
   * 获取已安装的 UWP 应用列表
   * @returns {Array<{name: string, appId: string, icon: string, installLocation: string}>} 应用列表
   * - name: 应用显示名称
   * - appId: AppUserModelID（用于启动应用）
   * - icon: 应用图标路径
   * - installLocation: 应用安装目录
   */
  static getUwpApps(): UwpAppInfo[] {
    if (platform !== 'win32') {
      throw new Error('getUwpApps is only supported on Windows')
    }
    return (addon as NativeAddon).getUwpApps()
  }

  /**
   * 启动 UWP 应用
   * @param {string} appId - AppUserModelID（从 getUwpApps 获取）
   * @returns {boolean} 是否启动成功
   */
  static launchUwpApp(appId: string): boolean {
    if (platform !== 'win32') {
      throw new Error('launchUwpApp is only supported on Windows')
    }
    if (typeof appId !== 'string' || !appId) {
      throw new TypeError('appId must be a non-empty string')
    }
    return (addon as NativeAddon).launchUwpApp(appId)
  }
}

/**
 * 应用图标提取类
 */
export class IconExtractor {
  /**
   * 异步获取文件/应用的图标（PNG 格式 Buffer）
   * @param {string} filePath - 文件路径（可以是 .exe、.lnk、.dll 或任何文件类型）
   * @returns {Promise<Buffer>} Promise，resolve 为 PNG 格式的图标数据
   * @example
   * // 获取 exe 的图标
   * const icon = await IconExtractor.getFileIcon('C:\\Windows\\notepad.exe');
   *
   * // 保存为文件
   * const fs = require('fs');
   * const icon = await IconExtractor.getFileIcon('C:\\Windows\\notepad.exe');
   * if (icon) fs.writeFileSync('icon.png', icon);
   */
  static getFileIcon(filePath: string): Promise<Buffer> {
    if (platform !== 'win32' && platform !== 'darwin') {
      throw new Error('getFileIcon is only supported on Windows and macOS')
    }
    if (typeof filePath !== 'string' || !filePath) {
      throw new TypeError('filePath must be a non-empty string')
    }
    return (addon as NativeAddon).getFileIcon(filePath)
  }
}

/**
 * MUI 资源字符串解析类
 */
export class MuiResolver {
  /**
   * 批量解析 MUI 资源字符串
   * @param refs - MUI 引用字符串数组，如 ['@%SystemRoot%\\system32\\shell32.dll,-22067']
   * @returns 解析结果 Map，key 为原始引用，value 为解析后的本地化字符串
   */
  static resolve(refs: string[]): Map<string, string> {
    if (platform !== 'win32') {
      throw new Error('MuiResolver is only supported on Windows')
    }
    if (!Array.isArray(refs)) {
      throw new TypeError('refs must be an array of strings')
    }
    const result = (addon as NativeAddon).resolveMuiStrings(refs)
    return new Map(Object.entries(result))
  }
}

export class WindowsShortcutScanner {
  static scan(
    scanPaths: string[],
    rootScanPaths: string[],
    skipFolders: string[]
  ): WindowsShortcutInfo[] {
    if (platform !== 'win32') {
      throw new Error('WindowsShortcutScanner is only supported on Windows')
    }
    if (!Array.isArray(scanPaths) || !Array.isArray(rootScanPaths) || !Array.isArray(skipFolders)) {
      throw new TypeError('scanPaths, rootScanPaths and skipFolders must be arrays')
    }
    return (addon as NativeAddon).scanWindowsShortcuts(scanPaths, rootScanPaths, skipFolders)
  }
}

/**
 * 取色器类（仅 macOS）
 * 进入取色模式后，鼠标附近会出现 9x9 像素放大网格
 * 点击鼠标左键确认取色，按 ESC 键取消
 */
export class ColorPicker {
  private static _callback: ((result: { success: boolean; hex: string | null }) => void) | null =
    null
  private static _isActive = false

  /**
   * 启动取色器
   * @param callback - 取色完成时的回调函数
   * - 成功: { success: true, hex: '#59636E' }
   * - 取消: { success: false, hex: null }
   */
  static start(callback: (result: { success: boolean; hex: string | null }) => void): void {
    if (ColorPicker._isActive) {
      throw new Error('Color picker is already active')
    }

    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function')
    }

    ColorPicker._callback = callback
    ColorPicker._isActive = true

    if (platform === 'linux') {
      // Linux 暂不支持 ColorPicker，直接返回失败
      ColorPicker._isActive = false
      if (ColorPicker._callback) {
        const cb = ColorPicker._callback
        ColorPicker._callback = null
        cb({ success: false, hex: null })
      }
      return
    }

    ;(addon as NativeAddon).startColorPicker((result) => {
      ;(addon as NativeAddon).stopColorPicker()

      ColorPicker._isActive = false
      if (ColorPicker._callback) {
        const cb = ColorPicker._callback
        ColorPicker._callback = null
        cb(result)
      }
    })
  }

  /**
   * 停止取色器（手动取消）
   */
  static stop(): void {
    if (!ColorPicker._isActive) {
      return
    }

    if (platform !== 'linux') {
      ;(addon as NativeAddon).stopColorPicker()
    }
    ColorPicker._isActive = false
    ColorPicker._callback = null
  }

  /**
   * 是否正在取色
   */
  static get isActive(): boolean {
    return ColorPicker._isActive
  }
}

// 为了向后兼容，默认导出 ClipboardMonitor
export default ClipboardMonitor

// 导出类型
export type { ClipboardFile, WindowInfo, ActiveWindowResult, MouseButtonType, UwpAppInfo }
