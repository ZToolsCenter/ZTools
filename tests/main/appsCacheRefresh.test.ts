import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    store,
    scanApplications: vi.fn(),
    getUwpApps: vi.fn(),
    getPackageSnapshot: vi.fn(),
    dbGet: vi.fn((key: string) => store.get(key)),
    dbPut: vi.fn((key: string, value: unknown) => store.set(key, value))
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: {}
}))

vi.mock('../../src/main/core/commandLauncher', () => ({ launchApp: vi.fn() }))
vi.mock('../../src/main/core/commandScanner', () => ({
  scanApplications: mocks.scanApplications
}))
vi.mock('../../src/main/core/native', () => ({
  UwpManager: {
    getUwpApps: mocks.getUwpApps,
    getPackageSnapshot: mocks.getPackageSnapshot
  }
}))
vi.mock('../../src/main/api/shared/database', () => ({
  default: { dbGet: mocks.dbGet, dbPut: mocks.dbPut }
}))
vi.mock('../../src/main/api/plugin/feature', () => ({ pluginFeatureAPI: {} }))
vi.mock('../../src/main/core/systemSettings/windowsSettings.js', () => ({ WINDOWS_SETTINGS: [] }))
vi.mock('../../src/main/api/renderer/plugins', () => ({ default: {} }))
vi.mock('../../src/main/api/renderer/systemCommands', () => ({ executeSystemCommand: vi.fn() }))
vi.mock('../../src/main/api/renderer/systemSettings', () => ({ systemSettingsAPI: {} }))

import { AppsAPI } from '../../src/main/api/renderer/commands'

describe.runIf(process.platform === 'win32')('AppsAPI 应用缓存刷新', () => {
  beforeEach(() => {
    mocks.store.clear()
    vi.clearAllMocks()
    mocks.getUwpApps.mockReturnValue([])
    mocks.getPackageSnapshot.mockReturnValue([])
  })

  it('Windows 来源扫描不完整时保留旧缓存且不写数据库', async () => {
    const oldApps = [{ name: 'Old App', path: 'C:\\OldApp.lnk' }]
    mocks.store.set('cached-commands', oldApps)
    mocks.store.set('cached-commands-version', 5)
    mocks.scanApplications.mockResolvedValue({
      apps: [{ name: 'Partial App', path: 'C:\\PartialApp.lnk' }],
      complete: false,
      errors: ['flat:C:\\Desktop: scan timed out']
    })
    const api = new AppsAPI() as unknown as {
      scanAndCacheApps: () => Promise<{ apps: unknown[]; cacheUpdated: boolean }>
    }

    const result = await api.scanAndCacheApps()

    expect(result).toEqual({ apps: oldApps, cacheUpdated: false })
    expect(mocks.dbPut).not.toHaveBeenCalled()
    expect(mocks.getUwpApps).not.toHaveBeenCalled()
  })

  it('首次扫描不完整时临时返回部分结果但不持久化', async () => {
    mocks.scanApplications.mockResolvedValue({
      apps: [{ name: 'Partial App', path: 'C:\\PartialApp.lnk' }],
      complete: false,
      errors: ['recursive:C:\\Start Menu: runner exited']
    })
    mocks.getUwpApps.mockReturnValue([
      { name: 'Store App', appId: 'Publisher.StoreApp', icon: 'C:\\StoreApp.png' }
    ])
    const api = new AppsAPI() as unknown as {
      scanAndCacheApps: () => Promise<{ apps: Array<{ path: string }>; cacheUpdated: boolean }>
    }

    const result = await api.scanAndCacheApps()

    expect(result.cacheUpdated).toBe(false)
    expect(result.apps.map((app) => app.path)).toEqual([
      'C:\\PartialApp.lnk',
      'uwp:Publisher.StoreApp'
    ])
    expect(mocks.dbPut).not.toHaveBeenCalled()
  })

  it('独立 UWP 刷新保留 Win32 条目且不调用快捷方式扫描器', async () => {
    mocks.store.set('cached-commands-version', 5)
    mocks.store.set('cached-commands', [
      { name: 'Win32 App', path: 'C:\\Win32App.lnk' },
      { name: 'Old Store App', path: 'uwp:Publisher.OldStoreApp' }
    ])
    mocks.getUwpApps.mockReturnValue([
      { name: 'New Store App', appId: 'Publisher.NewStoreApp', icon: 'C:\\NewStoreApp.png' }
    ])
    mocks.getPackageSnapshot.mockReturnValue(['Publisher.NewStoreApp_2.0.0.0_x64'])
    const api = new AppsAPI()

    await api.refreshUwpAppsCache()

    expect(mocks.scanApplications).not.toHaveBeenCalled()
    expect(mocks.store.get('cached-commands')).toEqual([
      { name: 'Win32 App', path: 'C:\\Win32App.lnk' },
      {
        name: 'New Store App',
        path: 'uwp:Publisher.NewStoreApp',
        icon: expect.stringContaining('ztools-icon://')
      }
    ])
    expect(mocks.store.get('cached-uwp-package-snapshot')).toEqual([
      'Publisher.NewStoreApp_2.0.0.0_x64'
    ])
  })
})
