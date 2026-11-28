import { EventEmitter } from 'node:events'
import os from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, nativeTheme } from 'electron'
import {
  applyHostWindowOpacity,
  getHostWindowMaterial,
  getWindowsHostWindowOptions,
  initializeWindowsHostWindowMaterial,
  recordElectronWindowMaterial
} from '../../src/main/utils/windowMaterial'
import { getWindowsWindowOptions } from '../../src/main/utils/windowUtils'

const { applyAccent, refreshFrame } = vi.hoisted(() => ({
  applyAccent: vi.fn(),
  refreshFrame: vi.fn()
}))
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

vi.mock('electron', () => ({
  app: { commandLine: { hasSwitch: vi.fn(() => false) } },
  nativeTheme: Object.assign(new EventEmitter(), { shouldUseDarkColors: false })
}))

vi.mock('../../src/main/core/native/index.js', () => ({
  WindowManager: { setNativeWindowAcrylic: applyAccent, setNativeWindowFrameChanged: refreshFrame }
}))

/**
 * 构造可观测的窗口替身，用于验证 HWND 和主题监听生命周期。
 * @returns 窗口替身及其底色、销毁状态和句柄的 mock。
 */
function createWindow() {
  const hwnd = Buffer.from([1, 2, 3, 4])
  const win = Object.assign(new EventEmitter(), {
    getNativeWindowHandle: vi.fn(() => hwnd),
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
    setOpacity: vi.fn()
  })
  return { win, hwnd, host: win as unknown as Electron.BrowserWindow }
}

/**
 * 按当前测试的 Windows 版本构造并初始化 Accent 宿主。
 * @param host 窗口替身。
 * @returns 无返回值。
 */
function initializeAccentWindow(host: Electron.BrowserWindow): void {
  initializeWindowsHostWindowMaterial(host, getWindowsHostWindowOptions())
}

describe('Windows 窗口亚克力', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' })
    vi.spyOn(os, 'release').mockReturnValue('10.0.22000')
    vi.mocked(app.commandLine.hasSwitch).mockReturnValue(false)
    Reflect.set(nativeTheme, 'shouldUseDarkColors', false)
    applyAccent.mockReset().mockReturnValue(true)
    refreshFrame.mockReset().mockReturnValue(true)
  })

  afterEach(() => {
    nativeTheme.removeAllListeners('updated')
    Object.defineProperty(process, 'platform', originalPlatform)
    vi.restoreAllMocks()
  })

  it('Build 22000 使用透明 HWND 上的原生 Accent', () => {
    expect(getWindowsHostWindowOptions()).toEqual({
      backgroundColor: '#00FFFFFF',
      transparent: true,
      show: false
    })
    expect(getWindowsWindowOptions()).toEqual({ backgroundColor: '#f4f4f4' })
  })

  it('Build 22621 起优先使用 Electron DWM，不启用透明窗口或原生 Accent', () => {
    vi.mocked(os.release).mockReturnValue('10.0.22621')
    const { win, host } = createWindow()
    const options = getWindowsHostWindowOptions()
    expect(options).toEqual({
      backgroundColor: '#00000000',
      backgroundMaterial: 'acrylic',
      show: false
    })
    initializeWindowsHostWindowMaterial(host, options)
    expect(getHostWindowMaterial(host)).toBe('acrylic')
    expect(applyAccent).not.toHaveBeenCalled()
    expect(win.getNativeWindowHandle).not.toHaveBeenCalled()
    expect(applyHostWindowOpacity(host, 1)).toBe(false)
    expect(win.setOpacity).not.toHaveBeenCalled()
  })

  it('Build 22621 禁用 GPU 时仍使用透明 HWND 上的原生 Accent', () => {
    vi.mocked(os.release).mockReturnValue('10.0.22621')
    vi.mocked(app.commandLine.hasSwitch).mockImplementation((name) => name === 'disable-gpu')
    expect(getWindowsHostWindowOptions()).toEqual({
      backgroundColor: '#00FFFFFF',
      transparent: true,
      show: false
    })
  })

  it('Windows 10 使用实色，不取句柄或调用原生入口', () => {
    vi.mocked(os.release).mockReturnValue('10.0.19045')
    const { win, host } = createWindow()
    const options = getWindowsHostWindowOptions()
    expect(options).toEqual({ backgroundColor: '#f4f4f4' })
    initializeWindowsHostWindowMaterial(host, options)
    expect(win.getNativeWindowHandle).not.toHaveBeenCalled()
    expect(applyAccent).not.toHaveBeenCalled()
    expect(getHostWindowMaterial(host)).toBe('none')
  })

  it('原生 Accent 宿主在每次显示时刷新自己的边框，关闭后不再刷新', () => {
    const main = createWindow()
    const detached = createWindow()
    const fallback = createWindow()
    applyAccent.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false)
    initializeAccentWindow(main.host)
    initializeAccentWindow(detached.host)
    initializeAccentWindow(fallback.host)
    initializeAccentWindow(main.host)
    expect(refreshFrame).not.toHaveBeenCalled()

    // 边框刷新失败不应撤销已经设置成功的 Accent，重显时可以重试。
    refreshFrame.mockReturnValueOnce(false)
    main.win.emit('show')
    expect(getHostWindowMaterial(main.host)).toBe('acrylic')
    fallback.win.emit('show')
    main.win.emit('hide')
    main.win.emit('show')
    detached.win.emit('show')
    expect(refreshFrame.mock.calls).toEqual([[main.hwnd], [main.hwnd], [detached.hwnd]])

    main.win.emit('closed')
    detached.win.emit('closed')
    main.win.emit('show')
    detached.win.emit('show')
    expect(refreshFrame).toHaveBeenCalledTimes(3)
  })

  it('只有初始化成功的存活窗口才在明暗变化时重新应用 Accent', () => {
    const main = createWindow()
    const detached = createWindow()
    const updater = createWindow()
    applyAccent.mockReturnValueOnce(true).mockReturnValueOnce(false)
    initializeAccentWindow(main.host)
    initializeAccentWindow(detached.host)
    recordElectronWindowMaterial(updater.host, 'acrylic')
    expect(applyAccent).toHaveBeenNthCalledWith(1, main.hwnd, false)
    expect(detached.win.setBackgroundColor).toHaveBeenCalledWith('#f4f4f4')
    expect(getHostWindowMaterial(main.host)).toBe('acrylic')
    expect(getHostWindowMaterial(detached.host)).toBe('none')
    expect(getHostWindowMaterial(updater.host)).toBe('acrylic')

    Reflect.set(nativeTheme, 'shouldUseDarkColors', true)
    nativeTheme.emit('updated')
    expect(main.win.setBackgroundColor).toHaveBeenLastCalledWith('#00000000')
    expect(applyAccent).toHaveBeenNthCalledWith(3, main.hwnd, true)
    expect(detached.win.setBackgroundColor).toHaveBeenCalledTimes(1)

    main.win.emit('closed')
    Reflect.set(nativeTheme, 'shouldUseDarkColors', false)
    nativeTheme.emit('updated')
    expect(applyAccent).toHaveBeenCalledTimes(3)
    expect(getHostWindowMaterial(main.host)).toBe('none')
  })

  it('主题刷新失败时保留已经启用的材质及生效底色', () => {
    const { win, host } = createWindow()
    initializeAccentWindow(host)
    applyAccent.mockReturnValueOnce(false)
    Reflect.set(nativeTheme, 'shouldUseDarkColors', true)
    nativeTheme.emit('updated')
    expect(win.setBackgroundColor.mock.calls).toEqual([['#00000000'], ['#00FFFFFF']])
    expect(getHostWindowMaterial(host)).toBe('acrylic')
    win.emit('closed')
  })

  it('原生 Accent 宿主不调用整窗透明度，实色回退仍可设置', () => {
    const acrylic = createWindow()
    const fallback = createWindow()
    applyAccent.mockReturnValueOnce(true).mockReturnValueOnce(false)
    initializeAccentWindow(acrylic.host)
    initializeAccentWindow(fallback.host)

    // 100% 和非默认值都不能触发原生宿主的分层样式。
    expect(applyHostWindowOpacity(acrylic.host, 1)).toBe(false)
    expect(applyHostWindowOpacity(acrylic.host, 0.6)).toBe(false)
    expect(acrylic.win.setOpacity).not.toHaveBeenCalled()

    expect(applyHostWindowOpacity(fallback.host, 0.1)).toBe(true)
    expect(fallback.win.setOpacity).toHaveBeenCalledExactlyOnceWith(0.3)
    acrylic.win.emit('closed')
  })
})
