import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  const nativeGetActiveWindow = vi.fn()
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
      setParentWindow: vi.fn(),
      getParentWindow: vi.fn(() => null),
      getOpacity: vi.fn(() => 1),
      setOpacity: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setPosition: vi.fn(),
      getPosition: vi.fn(() => [100, 100]),
      getBounds: vi.fn(() => ({ x: 100, y: 100, width: 800, height: 600 })),
      isFocused: vi.fn(() => false),
      isVisible: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      show: vi.fn(() => emit('show')),
      showInactive: vi.fn(() => emit('show')),
      emit,
      hide: vi.fn(),
      destroy: vi.fn(),
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
    nativeGetActiveWindow,
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
      hide: vi.fn(),
      isVisible: vi.fn(() => false)
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
    // 光标固定在“副屏”（x<0），用于验证窗口/锚点的跨显示器同步
    getCursorScreenPoint: vi.fn(() => ({ x: -600, y: 800 })),
    getDisplayNearestPoint: vi.fn((point: { x: number; y: number }) =>
      point.x < 0
        ? { id: 2, workArea: { x: -1728, y: 254, width: 1728, height: 1117 } }
        : { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } }
    )
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
    activateWindow: vi.fn(),
    getActiveWindow: mocks.nativeGetActiveWindow
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
    vi.resetModules()
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.dbGet.mockReturnValue(null)
    mocks.clipboardGetCurrentWindow.mockReturnValue(null)
    mocks.clipboardActivateApp.mockReturnValue(true)
    mocks.appIsHidden.mockReturnValue(false)
    mocks.nativeGetActiveWindow.mockReturnValue(null)
    mocks.latestWindow.current = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the main panel without activating the app on macOS', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')

    windowManager.createWindow()
    windowManager.showWindow()

    const mainWindow = windowManager.getMainWindow()!
    expect((mainWindow as any).show).toHaveBeenCalled()
    expect((mainWindow as any).setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    expect((mainWindow as any).setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(1)
    expect((mainWindow as any).setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'modal-panel', 1)
    expect(mocks.appFocus).not.toHaveBeenCalled()
    expect((mainWindow as any).focus).not.toHaveBeenCalled()
    ;(mainWindow as any).hide.mockClear()
    ;(mainWindow as any).emit('blur')
    expect((mainWindow as any).hide).not.toHaveBeenCalled()

    vi.advanceTimersByTime(201)
    ;(mainWindow as any).emit('blur')
    expect((mainWindow as any).hide).toHaveBeenCalledTimes(1)
  })

  it('migrates into a fullscreen Space without activating the app', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    mocks.nativeGetActiveWindow.mockReturnValue({
      app: 'Keynote',
      pid: 4242,
      isFullscreen: true,
      x: 0,
      y: 0,
      width: 1440,
      height: 900
    })

    windowManager.createWindow()
    const mainWindow = mocks.latestWindow.current
    windowManager.showWindow()

    expect(mocks.appFocus).not.toHaveBeenCalled()
    expect(mainWindow.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    expect(mainWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(1)
    expect(mainWindow.show).toHaveBeenCalled()
    expect(mainWindow.focus).not.toHaveBeenCalled()
    // 只在透明迁移期间挂到锚点，正式显示前恢复为独立窗口。
    expect(mainWindow.setParentWindow).toHaveBeenCalledTimes(2)
    expect(mainWindow.setParentWindow.mock.calls[0][0]).not.toBe(mainWindow)
    expect(mainWindow.setParentWindow).toHaveBeenLastCalledWith(null)
    expect(mainWindow.setOpacity.mock.calls).toEqual([[0], [1]])
    expect(mainWindow.showInactive).toHaveBeenCalledTimes(1)
    expect(mainWindow.hide).toHaveBeenCalledTimes(1)
    expect(
      mainWindow.webContents.send.mock.calls.filter(
        ([channel]: [string]) => channel === 'focus-search'
      )
    ).toHaveLength(1)
    expect(mainWindow.setParentWindow.mock.invocationCallOrder[1]).toBeLessThan(
      mainWindow.show.mock.invocationCallOrder[0]
    )

    // 锚点只参与本次迁移；下次呼出仍按主窗口的目标显示器重新创建。
    const anchor = mainWindow.setParentWindow.mock.calls[0][0]
    anchor.setPosition.mockClear()
    mainWindow.setPosition.mockClear()
    windowManager.showWindow()
    expect(anchor.destroy).toHaveBeenCalledTimes(1)
    expect(mainWindow.setPosition).toHaveBeenCalled()
  })

  it('keeps desktop summons independent after a fullscreen summon', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.createWindow()
    const mainWindow = mocks.latestWindow.current
    windowManager.showWindow()
    expect(mainWindow.setParentWindow).toHaveBeenLastCalledWith(null)
    mainWindow.setParentWindow.mockClear()

    mocks.nativeGetActiveWindow.mockReturnValue({ pid: 4242, isFullscreen: true })
    windowManager.showWindow()
    expect(mainWindow.setParentWindow).toHaveBeenLastCalledWith(null)
    const firstAnchor = mainWindow.setParentWindow.mock.calls[0][0]

    // 普通桌面同样登记 Space，正式显示时仍保持独立窗口。
    mocks.nativeGetActiveWindow.mockReturnValue({ pid: 4242, isFullscreen: false })
    mainWindow.setParentWindow.mockClear()
    mainWindow.showInactive.mockClear()
    mainWindow.show.mockClear()
    windowManager.showWindow()
    expect(mainWindow.setParentWindow).toHaveBeenLastCalledWith(null)
    expect(mainWindow.showInactive).toHaveBeenCalledTimes(1)
    expect(mainWindow.show).toHaveBeenCalledTimes(1)
    expect(firstAnchor.destroy).toHaveBeenCalledTimes(1)

    // 普通桌面和全屏都不会复用已销毁锚点。
    windowManager.showWindow()
    expect(firstAnchor.destroy).toHaveBeenCalledTimes(1)
    mocks.nativeGetActiveWindow.mockReturnValue({ pid: 4242, isFullscreen: true })
    windowManager.showWindow()
    const nextAnchor = mainWindow.setParentWindow.mock.calls.at(-2)[0]
    expect(nextAnchor).not.toBe(firstAnchor)
    expect(mainWindow.setParentWindow).toHaveBeenLastCalledWith(null)
    expect(nextAnchor.destroy).toHaveBeenCalledTimes(1)
  })

  it('restores opacity and parenting if fullscreen migration fails', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.createWindow()
    const mainWindow = mocks.latestWindow.current
    mainWindow.getOpacity.mockReturnValue(0.8)
    mainWindow.showInactive.mockImplementationOnce(() => {
      throw new Error('Space migration failed')
    })
    mocks.nativeGetActiveWindow.mockReturnValue({ pid: 4242, isFullscreen: true })

    expect(() => windowManager.showWindow()).toThrow('Space migration failed')
    expect(mainWindow.setParentWindow).toHaveBeenLastCalledWith(null)
    expect(mainWindow.setOpacity).toHaveBeenLastCalledWith(0.8)

    // 失败清理后再次呼出仍然恢复输入焦点，不残留透明迁移标志。
    mocks.nativeGetActiveWindow.mockReturnValue(null)
    windowManager.showWindow()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('focus-search', null)
  })

  it('keeps the non-activating panel when the foreground app is not fullscreen', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    mocks.nativeGetActiveWindow.mockReturnValue({
      app: 'Finder',
      pid: 4242,
      isFullscreen: false,
      x: 0,
      y: 0,
      width: 1440,
      height: 900
    })

    windowManager.createWindow()
    const mainWindow = mocks.latestWindow.current
    windowManager.showWindow()

    expect(mocks.appFocus).not.toHaveBeenCalled()
    expect(mainWindow.focus).not.toHaveBeenCalled()
    expect(mainWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(1)
    expect(mainWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'modal-panel', 1)
    expect(mainWindow.show).toHaveBeenCalled()
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

  it('migrates to the current Space even when native fullscreen information is missing', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    // AX 信息缺失时仍可能位于全屏 Space，不能将迁移绑定到 isFullscreen。
    mocks.nativeGetActiveWindow.mockReturnValue({ app: 'Warp.app', pid: 4242 })
    windowManager.createWindow()
    const mainWindow = mocks.latestWindow.current

    windowManager.showWindow()

    expect(mainWindow.setParentWindow.mock.calls[0]?.[0]).toBeDefined()
    expect(mainWindow.setParentWindow).toHaveBeenLastCalledWith(null)
    expect(mainWindow.show).toHaveBeenCalledTimes(1)
    expect(mocks.appFocus).not.toHaveBeenCalled()
  })

  it('uses a fresh anchor on each desktop summon and releases it after migration', async () => {
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.createWindow()
    const mainWindow = mocks.latestWindow.current

    windowManager.showWindow()
    const firstAnchor = mainWindow.setParentWindow.mock.calls[0]?.[0]
    expect(firstAnchor).toBeDefined()
    expect(firstAnchor.destroy).toHaveBeenCalledTimes(1)

    // 已销毁的全屏 Space 不能通过复用旧锚点重新带回主窗口。
    windowManager.showWindow()
    const nextAnchor = mainWindow.setParentWindow.mock.calls[2]?.[0]
    expect(nextAnchor).toBeDefined()
    expect(nextAnchor).not.toBe(firstAnchor)
    expect(nextAnchor.destroy).toHaveBeenCalledTimes(1)
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
