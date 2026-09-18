import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { globalShortcut } from 'electron'

type MockHandler = (...args: any[]) => void

const mocks = vi.hoisted(() => {
  const appFocus = vi.fn()
  const appHide = vi.fn()
  const appShow = vi.fn()
  const appIsHidden = vi.fn(() => false)
  const dbGet = vi.fn()
  const clipboardGetCurrentWindow = vi.fn()
  const clipboardActivateApp = vi.fn()
  const globalInputOn = vi.fn()
  const globalInputAcquire = vi.fn()
  const globalInputRelease = vi.fn()
  const latestWindow = { current: null as any }

  const createMockWindow = (): any => {
    const handlers: Record<string, MockHandler[]> = {}
    const webContentsHandlers: Record<string, MockHandler[]> = {}

    const emit = (event: string, ...args: any[]): void => {
      for (const handler of handlers[event] || []) {
        handler(...args)
      }
    }

    const win = {
      webContents: {
        setZoomFactor: vi.fn(),
        setVisualZoomLevelLimits: vi.fn(),
        on: vi.fn((event: string, handler: MockHandler) => {
          ;(webContentsHandlers[event] ||= []).push(handler)
        }),
        focus: vi.fn(),
        send: vi.fn(),
        getURL: vi.fn(() => 'app://ztools')
      },
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setPosition: vi.fn(),
      getPosition: vi.fn(() => [100, 100]),
      getBounds: vi.fn(() => ({ x: 100, y: 100, width: 800, height: 600 })),
      isFocused: vi.fn(() => false),
      isVisible: vi.fn(() => false),
      show: vi.fn(() => emit('show')),
      emit,
      hide: vi.fn(),
      minimize: vi.fn(),
      blur: vi.fn(),
      focus: vi.fn(),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      on: vi.fn((event: string, handler: MockHandler) => {
        ;(handlers[event] ||= []).push(handler)
      }),
      once: vi.fn((event: string, handler: MockHandler) => {
        ;(handlers[event] ||= []).push(handler)
      })
    }

    latestWindow.current = win
    return win
  }

  return {
    appFocus,
    appHide,
    appShow,
    appIsHidden,
    dbGet,
    clipboardGetCurrentWindow,
    clipboardActivateApp,
    globalInputOn,
    globalInputAcquire,
    globalInputRelease,
    latestWindow,
    createMockWindow
  }
})

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
  platform: { isMacOS: true, isWindows: false, isLinux: false }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/tmp/ztools'),
    focus: mocks.appFocus,
    hide: mocks.appHide,
    show: mocks.appShow,
    isHidden: mocks.appIsHidden,
    dock: {
      show: vi.fn(),
      hide: vi.fn()
    }
  },
  BrowserWindow: vi.fn(function BrowserWindowMock() {
    return mocks.createMockWindow()
  }),
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false)
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({}))
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      setTemplateImage: vi.fn()
    }))
  },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 300, y: 300 })),
    getDisplayNearestPoint: vi.fn(() => ({
      id: 1,
      workArea: { x: 0, y: 0, width: 1440, height: 900 }
    }))
  },
  Tray: vi.fn(() => ({
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    popUpContextMenu: vi.fn()
  }))
}))

vi.mock('../../src/main/api', () => ({
  default: {
    dbGet: vi.fn(() => null),
    launchPlugin: vi.fn()
  }
}))

vi.mock('../../src/main/api/shared/database', () => ({
  default: {
    dbGet: mocks.dbGet,
    dbPut: vi.fn()
  }
}))

vi.mock('../../src/main/core/doubleTapManager.js', () => ({
  default: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn()
  }
}))

vi.mock('../../src/main/core/globalInputManager.js', () => ({
  default: {
    on: mocks.globalInputOn,
    acquire: mocks.globalInputAcquire,
    release: mocks.globalInputRelease
  }
}))

vi.mock('../../src/main/core/native/index.js', () => ({
  WindowManager: {
    activateWindow: vi.fn()
  }
}))

vi.mock('../../src/main/managers/clipboardManager', () => ({
  default: {
    getCurrentWindow: mocks.clipboardGetCurrentWindow,
    activateApp: mocks.clipboardActivateApp
  }
}))

vi.mock('../../src/main/core/detachedWindowManager', () => ({
  default: {
    hasDetachedWindows: vi.fn(() => false)
  }
}))

vi.mock('../../src/main/core/superPanelManager', () => ({
  default: {
    broadcastToSuperPanel: vi.fn()
  }
}))

vi.mock('../../src/main/utils/windowUtils', () => ({
  applyWindowMaterial: vi.fn(),
  getDefaultWindowMaterial: vi.fn(() => 'none')
}))

vi.mock('../../src/main/managers/pluginManager', () => ({
  default: {
    getCurrentPluginPath: vi.fn(() => null),
    restoreCurrentPluginViewHeightOnWindowShow: vi.fn(),
    isPluginViewFocused: vi.fn(() => false),
    focusPluginView: vi.fn(),
    forceRepaintCurrentView: vi.fn(),
    hidePluginView: vi.fn(),
    handlePluginEsc: vi.fn(),
    shouldSuppressMainHide: vi.fn(() => false)
  }
}))

describe('windowManager macOS activation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.dbGet.mockReturnValue(null)
    mocks.clipboardGetCurrentWindow.mockReturnValue(null)
    mocks.clipboardActivateApp.mockReturnValue(true)
    mocks.appIsHidden.mockReturnValue(false)
    mocks.latestWindow.current = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the main panel without activating the app on macOS', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')

    windowManager.createWindow()
    windowManager.showWindow()

    expect(mocks.latestWindow.current.show).toHaveBeenCalled()
    expect(mocks.latestWindow.current.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true
    })
    expect(mocks.latestWindow.current.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(1)
    expect(mocks.latestWindow.current.setAlwaysOnTop).toHaveBeenLastCalledWith(
      true,
      'modal-panel',
      1
    )
    expect(mocks.appFocus).not.toHaveBeenCalled()
    expect(mocks.latestWindow.current.focus).not.toHaveBeenCalled()

    mocks.latestWindow.current.emit('blur')
    expect(mocks.latestWindow.current.hide).not.toHaveBeenCalled()

    vi.advanceTimersByTime(201)
    mocks.latestWindow.current.emit('blur')
    expect(mocks.latestWindow.current.hide).toHaveBeenCalledTimes(1)
  })
  it('does not restore focus when a hidden main window receives a hide request', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')

    windowManager.createWindow()
    mocks.latestWindow.current.isVisible.mockReturnValue(false)
    windowManager.setPreviousActiveWindow({
      app: 'Previously Focused App',
      bundleId: 'com.example.previous'
    } as any)

    windowManager.hideWindow(true)

    expect(mocks.appHide).not.toHaveBeenCalled()
    expect(mocks.clipboardActivateApp).not.toHaveBeenCalled()
  })

  it('captures the current active window and clears stale state when capture fails', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    const currentWindow = {
      app: 'Current App',
      bundleId: 'com.example.current'
    }

    mocks.clipboardGetCurrentWindow.mockReturnValueOnce(currentWindow).mockReturnValueOnce(null)

    expect(windowManager.captureCurrentActiveWindow()).toEqual(currentWindow)
    expect(windowManager.getPreviousActiveWindow()).toEqual(currentWindow)
    expect(windowManager.captureCurrentActiveWindow()).toBeNull()
    expect(windowManager.getPreviousActiveWindow()).toBeNull()
  })
})

/**
 * 快捷键注册失败原因的平台差异。
 *
 * 只有在「Linux + 主动选择原生 Wayland」时才给出 Wayland 专属说明；
 * macOS/Windows 必须保持完全原有行为（getShortcutRegistrationError 为 null，
 * 设置页回落为「快捷键已被占用」），否则就是移植改动泄漏到了其它平台。
 */
describe('快捷键注册失败原因的平台隔离', () => {
  const realPlatform = process.platform
  const setPlatform = (value: string): void => {
    Object.defineProperty(process, 'platform', { value, configurable: true })
  }

  beforeEach(async () => {
    // windowManager 是单例，失败原因字段会跨用例残留：先做一次成功注册把它清成 null
    vi.mocked(globalShortcut.register).mockReturnValue(true)
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.registerShortcut('Ctrl+Alt+P')
  })

  afterEach(() => {
    setPlatform(realPlatform)
    delete process.env.ZTOOLS_NATIVE_WAYLAND
    delete process.env.XDG_SESSION_TYPE
  })

  it.each(['darwin', 'win32'])('%s 下不设置失败原因（保持原有提示）', async (platformName) => {
    setPlatform(platformName)
    process.env.XDG_SESSION_TYPE = 'wayland'
    process.env.ZTOOLS_NATIVE_WAYLAND = '1'
    vi.mocked(globalShortcut.register).mockReturnValue(false)

    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.registerShortcut('Ctrl+Alt+Q')

    expect(windowManager.getShortcutRegistrationError()).toBeNull()
  })

  it('Linux + 原生 Wayland 下给出可操作的原因', async () => {
    setPlatform('linux')
    process.env.XDG_SESSION_TYPE = 'wayland'
    process.env.ZTOOLS_NATIVE_WAYLAND = '1'
    vi.mocked(globalShortcut.register).mockReturnValue(false)

    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.registerShortcut('Ctrl+Alt+Q')

    expect(windowManager.getShortcutRegistrationError()).toContain('Wayland')
  })

  it('Linux 但未选择原生 Wayland 时同样不设置（回落原有提示）', async () => {
    setPlatform('linux')
    process.env.XDG_SESSION_TYPE = 'wayland'
    vi.mocked(globalShortcut.register).mockReturnValue(false)

    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.registerShortcut('Ctrl+Alt+Q')

    expect(windowManager.getShortcutRegistrationError()).toBeNull()
  })
})
