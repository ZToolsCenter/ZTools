import { beforeEach, describe, expect, it, vi } from 'vitest'

type IPCListener = (...args: unknown[]) => void

const mocks = vi.hoisted(() => {
  const ipcListeners = new Map<string, IPCListener>()
  const latestWindow = { current: null as any }
  const browserWindow = vi.fn(function BrowserWindowMock(
    options: Electron.BrowserWindowConstructorOptions
  ) {
    const handlers = new Map<string, () => void>()
    const win = {
      options,
      webContents: {
        send: vi.fn()
      },
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      minimize: vi.fn(),
      close: vi.fn(),
      once: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
      on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler))
    }
    latestWindow.current = win
    return win
  })

  return { browserWindow, ipcListeners, latestWindow }
})

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => 'D:\\ztools'),
    getVersion: vi.fn(() => '3.1.0'),
    isPackaged: false
  },
  BrowserWindow: mocks.browserWindow,
  dialog: {
    showMessageBox: vi.fn()
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn((channel: string, listener: IPCListener) => {
      mocks.ipcListeners.set(channel, listener)
    })
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }
    }))
  },
  shell: {
    openExternal: vi.fn()
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

vi.mock('@platform-updater', () => ({
  default: vi.fn(() => ({
    initialize: vi.fn(() => Promise.resolve()),
    cleanup: vi.fn(),
    getDownloadStatus: vi.fn(() => ({ hasDownloaded: false, status: 'idle' })),
    checkForUpdates: vi.fn(),
    startUpdate: vi.fn(),
    cancelUpdate: vi.fn(),
    installDownloadedUpdate: vi.fn()
  }))
}))

vi.mock('../../src/main/api/shared/database.js', () => ({
  default: {
    dbGet: vi.fn(() => null)
  }
}))

vi.mock('../../src/main/managers/windowManager', () => ({
  default: {
    setQuitting: vi.fn()
  }
}))

vi.mock('../../src/main/utils/windowUtils.js', () => ({
  applyWindowMaterial: vi.fn(),
  getDefaultWindowMaterial: vi.fn(() => 'none')
}))

vi.mock('../../src/main/api/serverUpdateCatalog', () => ({
  fetchLatestServerUpdate: vi.fn(() =>
    Promise.resolve({ available: true, latestVersion: '3.2.0' })
  ),
  resolvePlatformUpdateInfo: vi.fn(() =>
    Promise.resolve({
      version: '3.2.0',
      changelog: 'Changes',
      sources: []
    })
  )
}))

import { UpdaterAPI } from '../../src/main/api/updater'

describe('updater window controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ipcListeners.clear()
    mocks.latestWindow.current = null
  })

  it('creates a minimizable window and minimizes it through IPC', async () => {
    const updater = new UpdaterAPI()
    updater.init({ webContents: { send: vi.fn() } } as any)

    const result = await updater.checkUpdate()

    expect(result.error).toBeUndefined()
    expect(result).toMatchObject({ success: true })
    expect(mocks.browserWindow).toHaveBeenCalledWith(expect.objectContaining({ minimizable: true }))
    const minimizeListener = mocks.ipcListeners.get('updater:minimize-window')
    expect(minimizeListener).toBeTypeOf('function')

    minimizeListener?.()

    expect(mocks.latestWindow.current.minimize).toHaveBeenCalledOnce()
  })
})
