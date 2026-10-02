import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dbGet: vi.fn(),
  dbPut: vi.fn(),
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(),
  applyWindowsStartupApproved: vi.fn(),
  applyWindowsDelayedStartup: vi.fn(),
  isPackaged: true
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    },
    setLoginItemSettings: mocks.setLoginItemSettings,
    getLoginItemSettings: mocks.getLoginItemSettings
  },
  globalShortcut: { register: vi.fn(), unregister: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  nativeTheme: {}
}))

vi.mock('../../src/main/core/native/index.js', () => ({
  OptimizedShortcutManager: {
    ensureListener: vi.fn(),
    registerShortcut: vi.fn(),
    unregisterShortcut: vi.fn(),
    stopListener: vi.fn()
  },
  WindowManager: {}
}))

vi.mock('../../src/main/appMain.js', () => ({
  getCurrentShortcut: vi.fn(),
  updateShortcut: vi.fn()
}))

vi.mock('../../src/main/core/dndManager.js', () => ({
  default: { loadConfig: vi.fn(), shouldIgnoreHotkeys: vi.fn(() => false) }
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
  default: {
    captureCurrentActiveWindow: vi.fn(),
    setTrayIconVisible: vi.fn(),
    setCompactMainWindowHeader: vi.fn(),
    updateAutoBackToSearch: vi.fn(),
    updateWindowPositionStrategy: vi.fn()
  }
}))
vi.mock('../../src/main/core/screenCapture.js', () => ({ primeScreenCaptureFrame: vi.fn() }))
vi.mock('../../src/main/api/shared/database.js', () => ({
  default: { dbGet: mocks.dbGet, dbPut: mocks.dbPut }
}))
vi.mock('../../src/main/api/index.js', () => ({
  default: { prepareGlobalShortcut: vi.fn() }
}))
vi.mock('../../src/main/core/detachedWindowManager.js', () => ({
  default: { setCompactWindowHeader: vi.fn() }
}))
vi.mock('../../src/main/core/windowsStartupApproved', () => ({
  applyWindowsStartupApproved: mocks.applyWindowsStartupApproved
}))
vi.mock('../../src/main/core/windowsDelayedStartup', () => ({
  applyWindowsDelayedStartup: mocks.applyWindowsDelayedStartup
}))

const { SettingsAPI } = await import('../../src/main/api/renderer/settings')

describe('SettingsAPI launch at login', () => {
  const platformSpy = vi.spyOn(process, 'platform', 'get')

  beforeEach(() => {
    vi.clearAllMocks()
    platformSpy.mockReturnValue('win32')
    mocks.isPackaged = true
    mocks.dbGet.mockReturnValue({ theme: 'dark' })
    mocks.getLoginItemSettings.mockReturnValue({
      openAtLogin: false,
      executableWillLaunchAtLogin: false
    })
  })

  afterEach(() => {
    platformSpy.mockReturnValue('win32')
  })

  it('persists the preference and writes a Windows login item that StartupApproved will honor', () => {
    const settings = new SettingsAPI()
    settings.setLaunchAtLogin(true)

    expect(mocks.dbPut).toHaveBeenCalledWith('settings-general', {
      theme: 'dark',
      launchAtLogin: true
    })
    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        openAtLogin: true,
        enabled: true,
        name: 'top.z-tools',
        path: process.execPath,
        args: []
      })
    )
    expect(mocks.applyWindowsStartupApproved).toHaveBeenCalledWith('top.z-tools', true)
    expect(mocks.applyWindowsDelayedStartup).toHaveBeenCalledWith(true, process.execPath)
  })

  it('does not overwrite the installed app login item from an unpackaged process', () => {
    mocks.isPackaged = false
    const settings = new SettingsAPI()
    settings.setLaunchAtLogin(true)

    expect(mocks.dbPut).toHaveBeenCalledWith(
      'settings-general',
      expect.objectContaining({ launchAtLogin: true })
    )
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
    expect(mocks.applyWindowsStartupApproved).not.toHaveBeenCalled()
    expect(mocks.applyWindowsDelayedStartup).not.toHaveBeenCalled()
  })

  it('keeps the settings toggle on when the stored preference is on but Windows disabled the startup item', () => {
    mocks.dbGet.mockReturnValue({ launchAtLogin: true })
    mocks.getLoginItemSettings.mockReturnValue({
      openAtLogin: false,
      executableWillLaunchAtLogin: false
    })

    expect(new SettingsAPI().getLaunchAtLogin()).toBe(true)
  })

  it('re-applies a stored enabled preference at startup so Windows can recover a disabled startup item', () => {
    mocks.dbGet.mockImplementation((key: string) => {
      if (key === 'settings-general') return { launchAtLogin: true }
      return null
    })
    mocks.getLoginItemSettings.mockReturnValue({
      openAtLogin: true,
      executableWillLaunchAtLogin: false
    })

    new SettingsAPI().init(
      { webContents: { send: vi.fn() } } as unknown as Electron.BrowserWindow,
      { refreshMainWindowHeaderLayout: vi.fn() } as never
    )

    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        openAtLogin: true,
        enabled: true,
        name: 'top.z-tools'
      })
    )
    expect(mocks.applyWindowsStartupApproved).toHaveBeenCalledWith('top.z-tools', true)
    expect(mocks.applyWindowsDelayedStartup).toHaveBeenCalledWith(true, process.execPath)
  })
})
