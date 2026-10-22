import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  windows: [] as any[],
  prepare: vi.fn()
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
  platform: { isMacOS: true }
}))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function () {
    const handlers = new Map<string, (...args: any[]) => void>()
    const win = {
      webContents: { on: vi.fn(), send: vi.fn() },
      on: vi.fn((event, handler) => handlers.set(event, handler)),
      once: vi.fn((event, handler) => handlers.set(event, handler)),
      emit: (event: string) => handlers.get(event)?.(),
      show: vi.fn(),
      focus: vi.fn(),
      hide: vi.fn(),
      loadFile: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setPosition: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }
    mocks.windows.push(win)
    return win
  }),
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  screen: {
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1440, height: 900 }
    }))
  }
}))
vi.mock('../../src/main/utils/macPanelSpace', () => ({ prepareMacPanelForShow: mocks.prepare }))
vi.mock('../../src/main/utils/appBundlePath', () => ({
  getPreloadPath: () => '/tmp/preload.js',
  getRendererPath: () => '/tmp/super-panel.html'
}))
vi.mock('../../src/main/core/native/index.js', () => ({}))
vi.mock('../../src/main/api/shared/database.js', () => ({ default: {} }))
vi.mock('../../src/main/core/dndManager.js', () => ({ default: {} }))
vi.mock('../../src/main/api/renderer/plugins.js', () => ({ default: {} }))
vi.mock('../../src/main/managers/windowManager.js', () => ({ default: {} }))
vi.mock('../../src/main/managers/clipboardManager.js', () => ({ default: {} }))
vi.mock('../../src/main/utils/windowUtils.js', () => ({}))
vi.mock('../../src/main/core/provider/providerManager.js', () => ({ default: {} }))
vi.mock('../../src/main/utils/common', () => ({}))
vi.mock('../../src/main/core/commands/runtime', () => ({ registerCommandHost: vi.fn() }))

describe('super panel Space summons', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.prepare.mockReset()
    mocks.windows = []
  })

  it('migrates both a newly loaded panel and its cached instance before showing', async () => {
    const { default: manager } = await import('../../src/main/core/superPanelManager')
    ;(manager as any).showWindow(100, 100)
    const win = mocks.windows[0]
    win.emit('ready-to-show')
    expect(mocks.prepare).toHaveBeenCalledWith(win)
    expect(win.show).toHaveBeenCalledTimes(1)
    ;(manager as any).showWindow(200, 200)
    expect(mocks.windows).toHaveLength(1)
    expect(mocks.prepare).toHaveBeenCalledTimes(2)
    expect(win.show).toHaveBeenCalledTimes(2)
  })

  it('ignores migration blur and resumes normal blur handling after a failed migration', async () => {
    const { default: manager } = await import('../../src/main/core/superPanelManager')
    ;(manager as any).showWindow(100, 100)
    const win = mocks.windows[0]
    mocks.prepare.mockImplementationOnce(() => {
      win.emit('blur')
      throw new Error('migration failed')
    })

    expect(() => win.emit('ready-to-show')).toThrow('migration failed')
    expect(win.hide).not.toHaveBeenCalled()
    win.emit('blur')
    expect(win.hide).toHaveBeenCalledTimes(1)
  })
})
