import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  electronRegister: vi.fn(),
  electronUnregister: vi.fn(),
  ensureListener: vi.fn(),
  registerShortcut: vi.fn(),
  unregisterShortcut: vi.fn(),
  stopListener: vi.fn(),
  prepareGlobalShortcut: vi.fn(),
  appIsPackaged: vi.fn(() => false),
  appGetPath: vi.fn(() => '/tmp'),
  captureCurrentActiveWindow: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.appIsPackaged()
    },
    getPath: mocks.appGetPath
  },
  globalShortcut: {
    register: mocks.electronRegister,
    unregister: mocks.electronUnregister
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  nativeTheme: {}
}))

vi.mock('../../src/main/core/native/index.js', () => ({
  OptimizedShortcutManager: {
    ensureListener: mocks.ensureListener,
    registerShortcut: mocks.registerShortcut,
    unregisterShortcut: mocks.unregisterShortcut,
    stopListener: mocks.stopListener
  },
  WindowManager: {}
}))

vi.mock('../../src/main/appMain.js', () => ({
  getCurrentShortcut: vi.fn(),
  updateShortcut: vi.fn()
}))

vi.mock('../../src/main/core/dndManager.js', () => ({
  default: { shouldIgnoreHotkeys: vi.fn(() => false) }
}))

vi.mock('../../src/main/core/doubleTapManager.js', () => ({
  default: {
    acquireKeyboardState: vi.fn(() => vi.fn()),
    register: vi.fn(),
    unregister: vi.fn()
  }
}))

vi.mock('../../src/main/managers/proxyManager.js', () => ({ default: {} }))
vi.mock('../../src/main/managers/windowManager.js', () => ({
  default: { captureCurrentActiveWindow: mocks.captureCurrentActiveWindow }
}))
vi.mock('../../src/main/core/screenCapture.js', () => ({ primeScreenCaptureFrame: vi.fn() }))
vi.mock('../../src/main/api/shared/database.js', () => ({
  default: { dbGet: vi.fn(), dbPut: vi.fn() }
}))
vi.mock('../../src/main/api/index.js', () => ({
  default: { prepareGlobalShortcut: mocks.prepareGlobalShortcut }
}))

const { SettingsAPI } = await import('../../src/main/api/renderer/settings')

const tempDirectories: string[] = []

describe('SettingsAPI optimized shortcut fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureListener.mockImplementation(() => {
      throw new Error('listener startup timed out')
    })
    mocks.unregisterShortcut.mockReturnValue({ success: true })
    mocks.electronRegister.mockReturnValue(true)
    mocks.prepareGlobalShortcut.mockResolvedValue({
      target: 'demo/action',
      shouldCaptureSelectedText: false
    })
  })

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('native listener startup failure falls back to Electron globalShortcut', async () => {
    // native 优化快捷键仅 Windows 生效，在其它平台跑测试时需模拟 win32 以覆盖降级逻辑。
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const settings = new SettingsAPI()

    const result = await settings.registerGlobalShortcut('Alt+F', 'demo/action', false, true)

    expect(result).toMatchObject({ success: true, degraded: true })
    expect(mocks.ensureListener).toHaveBeenCalledOnce()
    expect(mocks.unregisterShortcut).toHaveBeenCalledWith('Alt+F')
    expect(mocks.stopListener).toHaveBeenCalledOnce()
    expect(mocks.electronRegister).toHaveBeenCalledWith('Alt+F', expect.any(Function))
    platformSpy.mockRestore()
  })

  it('Linux 打包版 setLaunchAtLogin 写入/删除 XDG 自启文件', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-settings-autostart-'))
    tempDirectories.push(home)
    mocks.appIsPackaged.mockReturnValue(true)
    mocks.appGetPath.mockImplementation((name: string) =>
      name === 'home' ? home : path.join(home, 'ZTools')
    )
    const desktopFile = path.join(home, '.config', 'autostart', 'ztools.desktop')
    const settings = new SettingsAPI()

    settings.setLaunchAtLogin(true)
    expect(fs.existsSync(desktopFile)).toBe(true)
    expect(fs.readFileSync(desktopFile, 'utf8')).toContain('[Desktop Entry]')

    settings.setLaunchAtLogin(false)
    expect(fs.existsSync(desktopFile)).toBe(false)

    platformSpy.mockRestore()
  })

  it('Linux 开发模式 setLaunchAtLogin 不写文件且读取为 false', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-settings-autostart-'))
    tempDirectories.push(home)
    mocks.appIsPackaged.mockReturnValue(false)
    mocks.appGetPath.mockImplementation((name: string) =>
      name === 'home' ? home : path.join(home, 'ZTools')
    )
    const settings = new SettingsAPI()

    settings.setLaunchAtLogin(true)
    expect(fs.existsSync(path.join(home, '.config', 'autostart', 'ztools.desktop'))).toBe(false)
    expect(settings.getLaunchAtLogin()).toBe(false)

    platformSpy.mockRestore()
  })

  it('captures the active window before handling a global shortcut', async () => {
    const settings = new SettingsAPI()
    const handler = vi.fn()
    settings.setGlobalShortcutHandler(handler)

    await settings.registerGlobalShortcut('Alt+F', 'demo/action', false, false)
    const shortcutHandler = mocks.electronRegister.mock.calls.at(-1)?.[1]

    shortcutHandler()
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith('demo/action', undefined))

    expect(mocks.captureCurrentActiveWindow).toHaveBeenCalledOnce()
    expect(mocks.captureCurrentActiveWindow.mock.invocationCallOrder[0]).toBeLessThan(
      handler.mock.invocationCallOrder[0]
    )
  })
})
