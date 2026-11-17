import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockHandler = (...args: any[]) => void

const mocks = vi.hoisted(() => {
  const appFocus = vi.fn()
  const dbGet = vi.fn()
  const clipboardGetCurrentWindow = vi.fn()
  const globalInputOn = vi.fn()
  const globalInputAcquire = vi.fn()
  const globalInputRelease = vi.fn()
  const nativeGetActiveWindow = vi.fn()
  const latestWindow = { current: null as any }

  const globalShortcutRegister = vi.fn(() => true)
  const globalShortcutUnregister = vi.fn()
  const doubleTapRegister = vi.fn()
  const doubleTapUnregister = vi.fn()

  const pluginMocks = {
    getCurrentPluginPath: vi.fn((): string | null => null),
    getCurrentPluginView: vi.fn((): unknown => null),
    hidePluginView: vi.fn(),
    focusPluginView: vi.fn(),
    restoreCurrentPluginViewHeightOnWindowShow: vi.fn(),
    isPluginViewFocused: vi.fn(() => false),
    forceRepaintCurrentView: vi.fn(),
    handlePluginEsc: vi.fn(),
    shouldSuppressMainHide: vi.fn(() => false)
  }

  // 托盘事件处理器存根，用于在测试中模拟托盘点击
  const trayHandlers: Record<string, MockHandler> = {}

  const createMockWindow = (): any => {
    const handlers: Record<string, MockHandler[]> = []

    const emit = (event: string, ...args: any[]): void => {
      for (const handler of handlers[event] || []) {
        handler(...args)
      }
    }

    const win = {
      webContents: {
        setZoomFactor: vi.fn(),
        setVisualZoomLevelLimits: vi.fn(),
        on: vi.fn(),
        focus: vi.fn(),
        send: vi.fn(),
        getURL: vi.fn(() => 'app://ztools')
      },
      setVisibleOnAllWorkspaces: vi.fn(),
      setParentWindow: vi.fn(),
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
    dbGet,
    clipboardGetCurrentWindow,
    globalInputOn,
    globalInputAcquire,
    globalInputRelease,
    nativeGetActiveWindow,
    latestWindow,
    createMockWindow,
    globalShortcutRegister,
    globalShortcutUnregister,
    doubleTapRegister,
    doubleTapUnregister,
    pluginMocks,
    trayHandlers
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
      hide: vi.fn(),
      isVisible: vi.fn(() => false)
    }
  },
  BrowserWindow: vi.fn(function BrowserWindowMock() {
    return mocks.createMockWindow()
  }),
  globalShortcut: {
    register: mocks.globalShortcutRegister,
    unregister: mocks.globalShortcutUnregister,
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false)
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({}))
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      setTemplate: vi.fn(),
      setTemplateImage: vi.fn()
    }))
  },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
    getDisplayNearestPoint: vi.fn(() => ({
      id: 1,
      workArea: { x: 0, y: 0, width: 1440, height: 900 }
    }))
  },
  Tray: vi.fn(function TrayMock() {
    return {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn((event: string, handler: MockHandler) => {
        mocks.trayHandlers[event] = handler
      }),
      popUpContextMenu: vi.fn()
    }
  })
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
    register: mocks.doubleTapRegister,
    unregister: mocks.doubleTapUnregister,
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
    activateApp: vi.fn()
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
  default: mocks.pluginMocks
}))

/**
 * 创建窗口、托盘并注册呼出快捷键，返回捕获到的快捷键回调。
 * @returns 普通快捷键与双击修饰键快捷键的回调。
 */
async function setupWithShortcut(): Promise<{
  hotkeyCallback: () => void
  doubleTapCallback: () => void
}> {
  const { default: windowManager } = await import('../../src/main/managers/windowManager')

  windowManager.createWindow()
  windowManager.createTray()

  windowManager.registerShortcut('Alt+Space')
  const hotkeyCallback = mocks.globalShortcutRegister.mock.calls.at(-1)?.[1] as () => void

  windowManager.registerShortcut('Ctrl+Ctrl')
  const doubleTapCallback = mocks.doubleTapRegister.mock.calls.at(-1)?.[1] as () => void

  if (typeof hotkeyCallback !== 'function' || typeof doubleTapCallback !== 'function') {
    throw new Error('未能捕获呼出快捷键回调')
  }

  return { hotkeyCallback, doubleTapCallback }
}

/**
 * 收集主窗口 webContents 收到的指定 IPC 事件次数。
 * @param channel 目标 IPC 事件名。
 * @returns 该事件被发送的次数。
 */
function countSentChannel(channel: string): number {
  return mocks.latestWindow.current.webContents.send.mock.calls.filter(
    ([name]: [string]) => name === channel
  ).length
}

describe('windowManager 呼出快捷键回到空白搜索框', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.dbGet.mockReturnValue(null)
    mocks.clipboardGetCurrentWindow.mockReturnValue(null)
    mocks.nativeGetActiveWindow.mockReturnValue(null)
    mocks.latestWindow.current = null
    mocks.pluginMocks.getCurrentPluginPath.mockReturnValue(null)
    mocks.pluginMocks.getCurrentPluginView.mockReturnValue(null)
    Object.keys(mocks.trayHandlers).forEach((key) => delete mocks.trayHandlers[key])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('快捷键唤起时退出上次停留的插件页面并聚焦搜索框', async () => {
    const { hotkeyCallback } = await setupWithShortcut()
    const mainWindow = mocks.latestWindow.current

    // 模拟上次动作停留在设置插件页面
    mocks.pluginMocks.getCurrentPluginPath.mockReturnValue('/plugins/setting')
    mocks.pluginMocks.getCurrentPluginView.mockReturnValue({ webContents: { focus: vi.fn() } })

    hotkeyCallback()

    // 先退出插件视图，再通知渲染进程返回搜索页（渲染层负责清空搜索框）
    expect(mocks.pluginMocks.hidePluginView).toHaveBeenCalledTimes(1)
    expect(countSentChannel('back-to-search')).toBe(1)
    // 窗口已显示且焦点交给主窗口搜索框，而不是恢复插件视图
    expect(mainWindow.show).toHaveBeenCalled()
    expect(countSentChannel('focus-search')).toBeGreaterThanOrEqual(1)
    expect(mocks.pluginMocks.focusPluginView).not.toHaveBeenCalled()
  })

  it('已在搜索页时快捷键唤起不触发多余的重置事件', async () => {
    const { hotkeyCallback } = await setupWithShortcut()
    const mainWindow = mocks.latestWindow.current

    hotkeyCallback()

    expect(mocks.pluginMocks.hidePluginView).not.toHaveBeenCalled()
    expect(countSentChannel('back-to-search')).toBe(0)
    expect(mainWindow.show).toHaveBeenCalled()
    expect(countSentChannel('focus-search')).toBeGreaterThanOrEqual(1)
  })

  it('快捷键隐藏窗口时不退出插件页面', async () => {
    const { hotkeyCallback } = await setupWithShortcut()
    const mainWindow = mocks.latestWindow.current

    mocks.pluginMocks.getCurrentPluginPath.mockReturnValue('/plugins/setting')
    mainWindow.isFocused.mockReturnValue(true)
    mainWindow.isVisible.mockReturnValue(true)

    hotkeyCallback()

    expect(mainWindow.hide).toHaveBeenCalledTimes(1)
    expect(mocks.pluginMocks.hidePluginView).not.toHaveBeenCalled()
    expect(countSentChannel('back-to-search')).toBe(0)
  })

  it('双击修饰键唤起同样回到搜索框', async () => {
    const { doubleTapCallback } = await setupWithShortcut()
    const mainWindow = mocks.latestWindow.current

    mocks.pluginMocks.getCurrentPluginPath.mockReturnValue('/plugins/setting')
    mocks.pluginMocks.getCurrentPluginView.mockReturnValue({ webContents: { focus: vi.fn() } })

    doubleTapCallback()

    expect(mocks.pluginMocks.hidePluginView).toHaveBeenCalledTimes(1)
    expect(countSentChannel('back-to-search')).toBe(1)
    expect(mainWindow.show).toHaveBeenCalled()
    expect(mocks.pluginMocks.focusPluginView).not.toHaveBeenCalled()
  })

  it('托盘点击唤起保留原有的插件视图恢复行为', async () => {
    await setupWithShortcut()
    const mainWindow = mocks.latestWindow.current

    mocks.pluginMocks.getCurrentPluginPath.mockReturnValue('/plugins/setting')
    mocks.pluginMocks.getCurrentPluginView.mockReturnValue({ webContents: { focus: vi.fn() } })
    // 模拟隐藏前焦点停留在插件视图
    const { default: windowManager } = await import('../../src/main/managers/windowManager')
    windowManager.updateFocusTarget('plugin')

    mocks.trayHandlers['click']?.()

    expect(mainWindow.show).toHaveBeenCalled()
    expect(mocks.pluginMocks.hidePluginView).not.toHaveBeenCalled()
    expect(countSentChannel('back-to-search')).toBe(0)
    // 托盘路径继续恢复插件视图焦点
    expect(mocks.pluginMocks.focusPluginView).toHaveBeenCalledTimes(1)
  })
})
