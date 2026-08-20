import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  electronRegister: vi.fn(),
  electronUnregister: vi.fn(),
  prepareGlobalShortcut: vi.fn(),
  hideWindow: vi.fn(),
  getMainWindow: vi.fn(),
  shouldIgnoreHotkeys: vi.fn(() => false)
}))

vi.mock('electron', () => ({
  app: {},
  globalShortcut: {
    register: mocks.electronRegister,
    unregister: mocks.electronUnregister
  },
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
  default: { shouldIgnoreHotkeys: mocks.shouldIgnoreHotkeys }
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
    hideWindow: mocks.hideWindow,
    getMainWindow: mocks.getMainWindow
  }
}))
vi.mock('../../src/main/core/screenCapture.js', () => ({ primeScreenCaptureFrame: vi.fn() }))
vi.mock('../../src/main/api/shared/database.js', () => ({
  default: { dbGet: vi.fn(), dbPut: vi.fn() }
}))
vi.mock('../../src/main/api/index.js', () => ({
  default: { prepareGlobalShortcut: mocks.prepareGlobalShortcut }
}))

const { SettingsAPI } = await import('../../src/main/api/renderer/settings')

function setWindowState(visible: boolean, focused: boolean): void {
  mocks.getMainWindow.mockReturnValue({
    isVisible: () => visible,
    isFocused: () => focused
  })
}

describe('SettingsAPI hideOnPress', () => {
  let triggerShortcut: (() => void) | undefined
  const launchHandler = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    triggerShortcut = undefined
    mocks.electronRegister.mockImplementation((_shortcut, callback) => {
      triggerShortcut = callback
      return true
    })
    mocks.electronUnregister.mockReturnValue(undefined)
    mocks.prepareGlobalShortcut.mockResolvedValue({
      target: 'demo/action',
      shouldCaptureSelectedText: false
    })
    mocks.shouldIgnoreHotkeys.mockReturnValue(false)
    setWindowState(false, false)
  })

  async function registerAndTrigger(hideOnPress: boolean): Promise<void> {
    const settings = new SettingsAPI()
    settings.setGlobalShortcutHandler(launchHandler)
    const result = await settings.registerGlobalShortcut(
      'Alt+1',
      'demo/action',
      false,
      false,
      hideOnPress
    )
    expect(result).toEqual({ success: true })
    expect(triggerShortcut).toBeTypeOf('function')
    await triggerShortcut!()
    await vi.waitFor(() => {
      expect(mocks.hideWindow.mock.calls.length + launchHandler.mock.calls.length).toBeGreaterThan(
        0
      )
    })
  }

  it('开启后窗口已显示再按会藏窗并恢复上一应用', async () => {
    setWindowState(true, true)
    await registerAndTrigger(true)
    expect(mocks.hideWindow).toHaveBeenCalledWith(true)
    expect(launchHandler).not.toHaveBeenCalled()
  })

  it('关闭时即使窗口已显示也只唤起指令', async () => {
    setWindowState(true, true)
    await registerAndTrigger(false)
    expect(mocks.hideWindow).not.toHaveBeenCalled()
    expect(launchHandler).toHaveBeenCalledWith('demo/action', undefined)
  })

  it('开启但窗口未显示时仍唤起指令', async () => {
    setWindowState(false, false)
    await registerAndTrigger(true)
    expect(mocks.hideWindow).not.toHaveBeenCalled()
    expect(launchHandler).toHaveBeenCalledWith('demo/action', undefined)
  })
})
