import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbGet = vi.hoisted(() => vi.fn())
const mockDbPut = vi.hoisted(() => vi.fn())
const mockClearPluginData = vi.hoisted(() => vi.fn())
const mockFsRm = vi.hoisted(() => vi.fn())
const mockCleanupForPlugin = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  shell: {
    showItemInFolder: vi.fn()
  },
  ipcMain: {
    handle: vi.fn()
  }
}))

vi.mock('fs', () => ({
  promises: {
    rm: mockFsRm,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    cp: vi.fn(),
    stat: vi.fn()
  }
}))

vi.mock('../../src/main/api/shared/database', () => ({
  default: {
    dbGet: mockDbGet,
    dbPut: mockDbPut,
    clearPluginData: mockClearPluginData
  }
}))

vi.mock('../../src/main/core/internalPlugins', () => ({
  isBundledInternalPlugin: vi.fn(() => false)
}))

vi.mock('../../src/main/utils/zpxArchive.js', () => ({
  packZpx: vi.fn()
}))

vi.mock('../../src/main/managers/windowManager', () => ({
  default: {
    notifyBackToSearch: vi.fn()
  }
}))

vi.mock('../../src/main/api/plugin/feature', () => ({
  pluginFeatureAPI: {
    loadDynamicFeatures: vi.fn(() => [])
  }
}))

vi.mock('../../src/main/core/lmdb/lmdbInstance', () => ({
  default: {
    allDocs: vi.fn(() => []),
    get: vi.fn(() => null)
  }
}))

vi.mock('../../src/main/utils/httpRequest.js', () => ({
  httpGet: vi.fn()
}))

vi.mock('../../src/main/api/renderer/pluginInstaller', () => ({
  PluginInstallerAPI: class {}
}))

vi.mock('../../src/main/api/renderer/pluginMarket', () => ({
  PluginMarketAPI: class {}
}))

vi.mock('../../src/main/core/provider/providerManager', () => ({
  default: {
    cleanupForPlugin: mockCleanupForPlugin
  }
}))

import {
  DEV_PROJECT_REGISTRY_DB_KEY,
  type DevProjectRegistry
} from '../../src/main/api/renderer/pluginDevelopmentRegistry'
import { PluginDevProjectsAPI } from '../../src/main/api/renderer/pluginDevProjects'
import { PluginsAPI } from '../../src/main/api/renderer/plugins'
import { ENABLED_MAIN_PUSH_PLUGINS_KEY } from '../../src/shared/pluginSettings'

describe('plugin removal cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbGet.mockImplementation((key: string) => {
      if (key === DEV_PROJECT_REGISTRY_DB_KEY) {
        return null
      }
      return []
    })
    mockClearPluginData.mockResolvedValue({ success: true })
    mockFsRm.mockResolvedValue(undefined)
  })
  it('removes all matching development entries when deleting a dev project', async () => {
    const registry: DevProjectRegistry = {
      version: 3,
      projects: {
        demo: {
          name: 'demo',
          configSnapshot: { name: 'demo', title: 'Demo', version: '1.0.0' },
          addedAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          sortOrder: 0,
          projectPath: 'D:\\workspace\\demo',
          configPath: 'D:\\workspace\\demo\\plugin.json',
          status: 'ready',
          lastValidatedAt: '2026-04-15T00:00:00.000Z'
        }
      }
    }
    mockDbGet.mockImplementation((key: string) => {
      if (key === DEV_PROJECT_REGISTRY_DB_KEY) {
        return registry
      }
      return []
    })

    const killPlugin = vi.fn()
    const writeInstalledPlugins = vi.fn()
    const api = new PluginDevProjectsAPI({
      mainWindow: null,
      pluginManager: { killPlugin } as any,
      readInstalledPlugins: () => [
        { name: 'demo', path: 'D:\\plugins\\demo' },
        { name: 'demo__dev', isDevelopment: true, path: 'D:\\workspace\\demo' },
        { name: 'demo__dev', isDevelopment: true, path: 'D:\\workspace\\demo-copy' }
      ],
      writeInstalledPlugins,
      notifyPluginsChanged: vi.fn(),
      validatePluginConfig: vi.fn(() => ({ valid: true })),
      resolvePluginLogo: vi.fn(),
      getRunningPlugins: vi.fn(() => [])
    })

    const result = await api.removeDevProject('demo')

    expect(result).toEqual({ success: true, pluginName: 'demo' })
    expect(killPlugin).toHaveBeenCalledWith('D:\\workspace\\demo')
    expect(writeInstalledPlugins).toHaveBeenCalledWith([
      { name: 'demo', path: 'D:\\plugins\\demo' }
    ])
    expect(mockDbPut).toHaveBeenCalledWith(DEV_PROJECT_REGISTRY_DB_KEY, {
      version: 3,
      projects: {}
    })
  })

  it('falls back to the registry path when the installed dev plugin has no path', async () => {
    const registry: DevProjectRegistry = {
      version: 3,
      projects: {
        demo: {
          name: 'demo',
          configSnapshot: { name: 'demo', title: 'Demo', version: '1.0.0' },
          addedAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          sortOrder: 0,
          projectPath: 'D:\\workspace\\demo',
          configPath: 'D:\\workspace\\demo\\plugin.json',
          status: 'ready',
          lastValidatedAt: '2026-04-15T00:00:00.000Z'
        }
      }
    }
    mockDbGet.mockImplementation((key: string) => {
      if (key === DEV_PROJECT_REGISTRY_DB_KEY) {
        return registry
      }
      return []
    })

    const killPlugin = vi.fn()
    const api = new PluginDevProjectsAPI({
      mainWindow: null,
      pluginManager: { killPlugin } as any,
      readInstalledPlugins: () => [{ name: 'demo__dev', isDevelopment: true }],
      writeInstalledPlugins: vi.fn(),
      notifyPluginsChanged: vi.fn(),
      validatePluginConfig: vi.fn(() => ({ valid: true })),
      resolvePluginLogo: vi.fn(),
      getRunningPlugins: vi.fn(() => [])
    })

    await api.removeDevProject('demo')

    expect(killPlugin).toHaveBeenCalledWith('D:\\workspace\\demo')
  })

  it('deletes the plugin even when killPlugin reports not running', async () => {
    mockDbGet.mockImplementation((key: string) => {
      if (key === 'plugins') {
        return [{ name: 'demo', path: 'D:\\plugins\\demo', isDevelopment: false }]
      }
      return []
    })

    const api = new PluginsAPI()
    const killPlugin = vi.fn(() => false)
    const removePluginUsageData = vi.fn()

    ;(api as any).pluginManager = { killPlugin }
    ;(api as any).devProjects = { removePluginUsageData }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()

    const result = await api.deletePlugin('D:\\plugins\\demo')

    expect(result).toEqual({ success: true })
    expect(killPlugin).toHaveBeenCalledWith('D:\\plugins\\demo')
    expect(removePluginUsageData).toHaveBeenCalledWith('demo')
    expect(mockClearPluginData).toHaveBeenCalledWith('demo')
    expect(mockDbPut).toHaveBeenCalledWith('plugins', [])
    expect(mockFsRm).toHaveBeenCalledWith('D:\\plugins\\demo', { recursive: true, force: true })
  })

  it('can uninstall a plugin while preserving plugin data', async () => {
    mockDbGet.mockImplementation((key: string) => {
      if (key === 'plugins') {
        return [{ name: 'demo', path: 'D:\\plugins\\demo', isDevelopment: false }]
      }
      return []
    })

    const api = new PluginsAPI()
    const killPlugin = vi.fn()
    const removePluginUsageData = vi.fn()

    ;(api as any).pluginManager = { killPlugin }
    ;(api as any).devProjects = { removePluginUsageData }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()

    const result = await api.deletePlugin('D:\\plugins\\demo', { deleteData: false })

    expect(result).toEqual({ success: true })
    expect(killPlugin).toHaveBeenCalledWith('D:\\plugins\\demo')
    expect(removePluginUsageData).toHaveBeenCalledWith('demo')
    expect(mockClearPluginData).not.toHaveBeenCalled()
    expect(mockDbPut).toHaveBeenCalledWith('plugins', [])
    expect(mockFsRm).toHaveBeenCalledWith('D:\\plugins\\demo', { recursive: true, force: true })
  })

  it('cleans plugin settings when uninstalling and clearing plugin data', async () => {
    mockDbGet.mockImplementation((key: string) => {
      if (key === 'plugins') {
        return [{ name: 'demo', path: 'D:\\plugins\\demo', isDevelopment: false }]
      }
      if (key === 'out-kill-plugin') {
        return ['demo', 'other']
      }
      if (key === 'auto-detach-plugin') {
        return ['demo']
      }
      if (key === 'auto-start-plugin') {
        return [{ pluginName: 'demo' }, { pluginName: 'other' }]
      }
      if (key === ENABLED_MAIN_PUSH_PLUGINS_KEY) {
        return ['demo', 'other']
      }
      return []
    })

    const api = new PluginsAPI()
    const killPlugin = vi.fn()
    const removePluginUsageData = vi.fn()

    ;(api as any).pluginManager = { killPlugin }
    ;(api as any).devProjects = { removePluginUsageData }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()

    const result = await api.deletePlugin('D:\\plugins\\demo', { deleteData: true })

    expect(result).toEqual({ success: true })
    expect(mockDbPut).toHaveBeenCalledWith('out-kill-plugin', ['other'])
    expect(mockDbPut).toHaveBeenCalledWith('auto-detach-plugin', [])
    expect(mockDbPut).toHaveBeenCalledWith('auto-start-plugin', ['other'])
    expect(mockDbPut).toHaveBeenCalledWith(ENABLED_MAIN_PUSH_PLUGINS_KEY, ['other'])
  })

  it('updates mainPush availability by plugin name and notifies command reload', async () => {
    mockDbGet.mockImplementation((key: string) => {
      if (key === ENABLED_MAIN_PUSH_PLUGINS_KEY) {
        return ['other']
      }
      return []
    })

    const api = new PluginsAPI()
    const send = vi.fn()
    ;(api as any).mainWindow = { webContents: { send } }

    const result = await api.setPluginMainPushEnabled('demo', true)

    expect(result).toEqual({ success: true })
    expect(mockDbPut).toHaveBeenCalledWith(ENABLED_MAIN_PUSH_PLUGINS_KEY, ['other', 'demo'])
    expect(send).toHaveBeenCalledWith('plugins-changed')
  })

  it('persists disabled plugins by stable plugin name', async () => {
    mockDbGet.mockImplementation((key: string) => {
      if (key === 'plugins') return [{ name: 'demo', path: '/plugins/demo-1.0.0.asar' }]
      return []
    })
    const api = new PluginsAPI()
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).pluginManager = { killPlugin: vi.fn() }
    ;(api as any).disabledPluginPathSet = new Set<string>()

    const result = await api.setPluginDisabled('/plugins/demo-1.0.0.asar', true)

    expect(result).toEqual({ success: true })
    expect(mockDbPut).toHaveBeenCalledWith('disabled-plugins', ['demo'])
    expect(api.getDisabledPlugins()).toEqual(['/plugins/demo-1.0.0.asar'])
  })

  it('cleans provider settings for the uninstalled plugin', async () => {
    mockDbGet.mockImplementation((key: string) => {
      if (key === 'plugins') {
        return [{ name: 'demo', path: 'D:\\plugins\\demo', isDevelopment: false }]
      }
      return []
    })

    const api = new PluginsAPI()
    const killPlugin = vi.fn(() => false)
    const removePluginUsageData = vi.fn()

    ;(api as any).pluginManager = { killPlugin }
    ;(api as any).devProjects = { removePluginUsageData }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()

    const result = await api.deletePlugin('D:\\plugins\\demo')

    expect(result).toEqual({ success: true })
    // 卸载时应清理该插件在 provider 配置中的启用/默认/参数
    expect(mockCleanupForPlugin).toHaveBeenCalledWith('demo')
  })
})
