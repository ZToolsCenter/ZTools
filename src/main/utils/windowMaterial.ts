import { app, nativeTheme, type BrowserWindow } from 'electron'
import { WindowManager as NativeWindowManager } from '../core/native/index.js'
import { getWindowsWindowOptions, isWindows11 } from './windowUtils'

type WindowMaterial = 'acrylic' | 'none'

const electronAcrylicWindows = new WeakSet<BrowserWindow>()
const nativeAcrylicWindows = new Map<BrowserWindow, { hwnd: Buffer; dark: boolean }>()
let hardwareAccelerationDisabled = false

/**
 * 在启动时禁用硬件加速，并让此进程后续创建的窗口使用兼容的材质路径。
 * @returns 无返回值。
 */
export function disableWindowHardwareAcceleration(): void {
  app.disableHardwareAcceleration()
  hardwareAccelerationDisabled = true
}

/**
 * 在明暗主题变化时刷新仍然存活的原生亚克力窗口。
 * @returns 无返回值。
 */
function refreshNativeAcrylic(): void {
  const dark = nativeTheme.shouldUseDarkColors
  for (const [window, state] of nativeAcrylicWindows) {
    if (window.isDestroyed() || dark === state.dark) continue

    // 先更新透明底色；如果系统拒绝刷新，保留上次生效的材质和底色。
    window.setBackgroundColor(getBackgroundColor(dark, true))
    if (NativeWindowManager.setNativeWindowAcrylic(state.hwnd, dark)) {
      state.dark = dark
    } else {
      window.setBackgroundColor(getBackgroundColor(state.dark, true))
    }
  }
}

/**
 * 获取与明暗主题匹配的 Electron 窗口底色。
 * @param dark 是否为暗色主题。
 * @param acrylic 是否需要透明底色以露出系统材质。
 * @returns Electron 接受的十六进制颜色，八位色按 AARRGGBB 排列。
 */
function getBackgroundColor(dark: boolean, acrylic: boolean): string {
  if (acrylic) return dark ? '#00000000' : '#00FFFFFF'
  return dark ? '#303133' : '#f4f4f4'
}

type HostWindowOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  'backgroundColor' | 'backgroundMaterial' | 'transparent' | 'show'
>

/**
 * 为主搜索和分离窗口选择 Windows 材质的构造参数。
 * @returns 与系统版本和硬件加速开关匹配的窗口参数。
 */
export function getWindowsHostWindowOptions(): HostWindowOptions {
  const dark = nativeTheme.shouldUseDarkColors
  if (!isWindows11()) return { backgroundColor: getBackgroundColor(dark, false) }

  const builtin = getWindowsWindowOptions()
  if (
    builtin.backgroundMaterial === 'acrylic' &&
    !hardwareAccelerationDisabled &&
    !app.commandLine.hasSwitch('disable-gpu')
  ) {
    // 让 Electron 通过 DWM 合成；同时设置 transparent 会挡住内置材质。
    return { ...builtin, show: false }
  }

  // Accent 需要 Chromium 提交带 alpha 的窗口表面；仅设置透明底色不会开启它。
  return { backgroundColor: getBackgroundColor(dark, true), transparent: true, show: false }
}

/**
 * 在窗口加载前记录内置材质，或安装原生 Accent 及其生命周期监听。
 * @param window 新建且尚未显示的 Windows 宿主窗口。
 * @param options 实际传给 BrowserWindow 的构造参数。
 * @returns 无返回值。
 */
export function initializeWindowsHostWindowMaterial(
  window: BrowserWindow,
  options: HostWindowOptions
): void {
  if (options.backgroundMaterial === 'acrylic') {
    recordElectronWindowMaterial(window, options.backgroundMaterial)
    return
  }
  if (!options.transparent || nativeAcrylicWindows.has(window)) return

  // 只对按 Accent 路径创建的透明 HWND 申请原生材质。
  const hwnd = window.getNativeWindowHandle()
  const dark = nativeTheme.shouldUseDarkColors
  if (!NativeWindowManager.setNativeWindowAcrylic(hwnd, dark)) {
    // 首次失败不发布材质状态，渲染层会使用与实色底色匹配的样式。
    console.warn('[WindowMaterial] Windows 原生亚克力初始化失败，使用实色背景')
    window.setBackgroundColor(getBackgroundColor(dark, false))
    return
  }
  // 仅在首个成功窗口启用主题监听，分离窗口共享同一个监听器。
  nativeAcrylicWindows.set(window, { hwnd, dark })
  if (nativeAcrylicWindows.size === 1) nativeTheme.on('updated', refreshNativeAcrylic)

  /**
   * 在每次显示时请求 Windows 重新计算顶层窗口的非客户区。
   * @returns 无返回值。
   */
  const refreshFrameOnShow = (): void => {
    if (window.isDestroyed()) return

    // 刷新原生宿主 HWND；对插件子视图触发重绘不能替代这一步。
    if (!NativeWindowManager.setNativeWindowFrameChanged(hwnd)) {
      console.warn('[WindowMaterial] Windows 原生窗口边框刷新失败，保留已启用的亚克力')
    }
  }

  /**
   * 窗口关闭时解除显示与主题监听，防止持有已销毁的窗口及句柄。
   * @returns 无返回值。
   */
  const cleanup = (): void => {
    // 不再刷新已关闭窗口；最后一个 Accent 窗口关闭后也释放全局监听。
    window.removeListener('show', refreshFrameOnShow)
    nativeAcrylicWindows.delete(window)
    if (nativeAcrylicWindows.size === 0) nativeTheme.removeListener('updated', refreshNativeAcrylic)
  }
  window.on('show', refreshFrameOnShow)
  window.once('closed', cleanup)
}

/**
 * 记录使用 Electron 内置亚克力的窗口。
 * @param window 使用 Electron 背景选项创建的窗口。
 * @param material 传给 Electron 的实际窗口材质选项。
 * @returns 无返回值。
 */
export function recordElectronWindowMaterial(
  window: BrowserWindow,
  material: Electron.BrowserWindowConstructorOptions['backgroundMaterial']
): void {
  if (material === 'acrylic') electronAcrylicWindows.add(window)
}

/**
 * 查询本窗口是否已使用亚克力，不向其它窗口借用状态。
 * @param window 要查询的实际宿主窗口。
 * @returns 窗口使用亚克力则为 acrylic，否则为 none。
 */
export function getHostWindowMaterial(window: BrowserWindow | null): WindowMaterial {
  return window &&
    !window.isDestroyed() &&
    (nativeAcrylicWindows.has(window) || electronAcrylicWindows.has(window))
    ? 'acrylic'
    : 'none'
}

/**
 * 应用整窗不透明度，但不改变亚克力宿主的 Windows 合成样式。
 * @param window 要调整的宿主窗口；宿主不在时不执行操作。
 * @param opacity 保存或传入的不透明度，按支持范围裁剪。
 * @returns 是否向 Electron 应用了不透明度。
 */
export function applyHostWindowOpacity(window: BrowserWindow | null, opacity: number): boolean {
  // Electron 即使收到 1 也会启用 WS_EX_LAYERED，破坏窗口材质合成。
  if (!window || window.isDestroyed() || getHostWindowMaterial(window) === 'acrylic') return false

  window.setOpacity(Math.max(0.3, Math.min(1, opacity)))
  return true
}
