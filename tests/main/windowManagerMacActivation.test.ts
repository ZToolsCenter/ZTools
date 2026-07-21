import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockHandler = (...args: any[]) => void

const mocks = vi.hoisted(() => {
  const appFocus = vi.fn()
  const dbGet = vi.fn()
  const clipboardGetCurrentWindow = vi.fn()
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
    dbGet,
    clipboardGetCurrentWindow,
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
    getCurrentWindow: mocks.clipboardGetCurrentWindow
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
})
