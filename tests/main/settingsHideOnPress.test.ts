import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  electronRegister: vi.fn(),
  electronUnregister: vi.fn(),
  prepareGlobalShortcut: vi.fn(),
  hideWindow: vi.fn(),
  showWindow: vi.fn(),
  getMainWindow: vi.fn(),
  shouldIgnoreHotkeys: vi.fn(() => false),
  dbGet: vi.fn()
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
    showWindow: mocks.showWindow,
    getMainWindow: mocks.getMainWindow
  }
}))
vi.mock('../../src/main/core/screenCapture.js', () => ({ primeScreenCaptureFrame: vi.fn() }))
vi.mock('../../src/main/api/shared/database.js', () => ({
  default: { dbGet: mocks.dbGet, dbPut: vi.fn() }
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

function setGlobalHideOnPress(enabled: boolean): void {
  mocks.dbGet.mockImplementation((key: string) => {
    if (key === 'settings-general') {
      return { hideOnPress: enabled }
    }
    return null
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
    setGlobalHideOnPress(false)
  })

  async function registerShortcut(target = 'demo/action'): Promise<void> {
    mocks.prepareGlobalShortcut.mockResolvedValue({
      target,
      shouldCaptureSelectedText: false
    })
    const settings = new SettingsAPI()
    settings.setGlobalShortcutHandler(launchHandler)
    const result = await settings.registerGlobalShortcut('Alt+1', target, false, false)
    expect(result).toEqual({ success: true })
    expect(triggerShortcut).toBeTypeOf('function')
  }

  async function pressShortcut(): Promise<void> {
    const hideBefore = mocks.hideWindow.mock.calls.length
    const showBefore = mocks.showWindow.mock.calls.length
    const launchBefore = launchHandler.mock.calls.length
    await triggerShortcut!()
    await vi.waitFor(() => {
      expect(
        mocks.hideWindow.mock.calls.length +
          mocks.showWindow.mock.calls.length +
          launchHandler.mock.calls.length
      ).toBeGreaterThan(hideBefore + showBefore + launchBefore)
    })
  }

  async function registerAndTrigger(target = 'demo/action'): Promise<void> {
    await registerShortcut(target)
    await pressShortcut()
  }

  it('ZTools 前台再按 hide，不 launch', async () => {
    setGlobalHideOnPress(true)
    setWindowState(true, true)
    await registerAndTrigger()
    expect(mocks.hideWindow).toHaveBeenCalledWith(true)
    expect(mocks.showWindow).not.toHaveBeenCalled()
    expect(launchHandler).not.toHaveBeenCalled()
  })

  it('不在前台按绑了插件/App 的快捷键必须 launch', async () => {
    setGlobalHideOnPress(true)
    setWindowState(false, false)
    await registerAndTrigger('apps/Calculator')
    expect(launchHandler).toHaveBeenCalledWith('apps/Calculator', undefined)
    expect(mocks.hideWindow).not.toHaveBeenCalled()
    expect(mocks.showWindow).not.toHaveBeenCalled()
  })

  it('别的 App 前台（主窗可见但未聚焦）再按必须 launch', async () => {
    setGlobalHideOnPress(true)
    setWindowState(true, false)
    await registerAndTrigger('plugin/screenshot')
    expect(launchHandler).toHaveBeenCalledWith('plugin/screenshot', undefined)
    expect(mocks.hideWindow).not.toHaveBeenCalled()
    expect(mocks.showWindow).not.toHaveBeenCalled()
  })

  it('launch App 后再按仍 launch，不 show 首页', async () => {
    setGlobalHideOnPress(true)
    setWindowState(false, false)
    await registerAndTrigger('apps/Finder')
    expect(launchHandler).toHaveBeenCalledTimes(1)
    expect(launchHandler).toHaveBeenCalledWith('apps/Finder', undefined)
    expect(mocks.showWindow).not.toHaveBeenCalled()
    expect(mocks.hideWindow).not.toHaveBeenCalled()

    setWindowState(false, false)
    await pressShortcut()
    expect(launchHandler).toHaveBeenCalledTimes(2)
    expect(mocks.showWindow).not.toHaveBeenCalled()
    expect(mocks.hideWindow).not.toHaveBeenCalled()
  })

  it('未配置时默认关，窗口已显示也只唤起', async () => {
    mocks.dbGet.mockImplementation(() => ({}))
    setWindowState(true, true)
    await registerAndTrigger()
    expect(mocks.hideWindow).not.toHaveBeenCalled()
    expect(mocks.showWindow).not.toHaveBeenCalled()
    expect(launchHandler).toHaveBeenCalledWith('demo/action', undefined)
  })

  it('关闭时即使窗口已显示也只唤起指令', async () => {
    setGlobalHideOnPress(false)
    setWindowState(true, true)
    await registerAndTrigger()
    expect(mocks.hideWindow).not.toHaveBeenCalled()
    expect(mocks.showWindow).not.toHaveBeenCalled()
    expect(launchHandler).toHaveBeenCalledWith('demo/action', undefined)
  })
})
