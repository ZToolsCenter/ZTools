/**
 * 插件初始化与卸载边界测试。
 *
 * 这里验证正式插件只能通过安装单元事务变更实体，而开发插件仍只移除记录并保留源码目录。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbGet = vi.hoisted(() => vi.fn())
const mockDbPut = vi.hoisted(() => vi.fn())
const mockDbRemove = vi.hoisted(() => vi.fn())
const mockClearPluginData = vi.hoisted(() => vi.fn())
const mockFsRm = vi.hoisted(() => vi.fn())
const mockFsReadFile = vi.hoisted(() => vi.fn())
const mockCleanupForPlugin = vi.hoisted(() => vi.fn())
const mockIpcHandle = vi.hoisted(() => vi.fn())
const mockRecoverPendingTransactions = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  shell: {
    showItemInFolder: vi.fn()
  },
  ipcMain: {
    handle: mockIpcHandle
  }
}))

vi.mock('fs', () => ({
  promises: {
    rm: mockFsRm,
    readFile: mockFsReadFile,
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
    dbRemove: mockDbRemove,
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

vi.mock('../../src/main/core/pluginInstallUnit/service', () => ({
  PluginInstallUnitService: class {
    /** 由测试控制恢复完成时机。 */
    public recoverPendingTransactions = mockRecoverPendingTransactions
  }
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

/** 为只关注卸载后清理的用例提供已提交事务服务。 */
function attachRemovalService(api: PluginsAPI): ReturnType<typeof vi.fn> {
  const removePlugin = vi.fn(async (options: Record<string, any>) => {
    await options.stopPrevious()
    await options.commitApplicationState()
    return { committed: true }
  })
  ;(api as any).pluginInstallUnits = { removePlugin }
  return removePlugin
}

/** 重置插件卸载用例共享的外部边界。 */
function resetPluginRemovalMocks(): void {
  vi.clearAllMocks()
  mockDbGet.mockImplementation((key: string) => {
    if (key === DEV_PROJECT_REGISTRY_DB_KEY) {
      return null
    }
    return []
  })
  mockClearPluginData.mockResolvedValue({ success: true })
  mockFsRm.mockResolvedValue(undefined)
  mockFsReadFile.mockResolvedValue('')
  mockRecoverPendingTransactions.mockResolvedValue({ recovered: [], failed: [] })
}

describe('plugin initialization and development removal', () => {
  beforeEach(resetPluginRemovalMocks)

  it('waits for transaction recovery before registering plugin ipc handlers', async () => {
    let finishRecovery!: () => void
    mockRecoverPendingTransactions.mockReturnValue(
      new Promise((resolve) => {
        finishRecovery = () => resolve({ recovered: [], failed: [] })
      })
    )
    const api = new PluginsAPI()

    const initialization = api.init(
      { webContents: { send: vi.fn() } } as any,
      {} as any
    ) as unknown as Promise<void>

    expect(mockIpcHandle).not.toHaveBeenCalled()
    finishRecovery()
    await initialization
    expect(mockIpcHandle).toHaveBeenCalled()
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
})

describe('installed plugin removal transaction', () => {
  beforeEach(resetPluginRemovalMocks)

  it('deletes the plugin even when stopPluginByName reports not running', async () => {
    const plugin = { name: 'demo', path: 'D:\\plugins\\demo', isDevelopment: false }
    mockDbGet.mockImplementation((key: string) => {
      if (key === 'plugins') {
        return [plugin]
      }
      return []
    })

    const api = new PluginsAPI()
    const stopPluginByName = vi.fn(async () => false)
    const removePluginUsageData = vi.fn()
    const removePlugin = vi.fn(async (options: Record<string, any>) => {
      await options.stopPrevious()
      await options.commitApplicationState()
      return { committed: true }
    })

    ;(api as any).pluginManager = { stopPluginByName }
    ;(api as any).devProjects = { removePluginUsageData }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()
    ;(api as any).pluginInstallUnits = { removePlugin }

    const result = await api.deletePlugin('D:\\plugins\\demo')

    expect(result).toEqual({ success: true })
    expect(stopPluginByName).toHaveBeenCalledWith('demo')
    expect(removePluginUsageData).toHaveBeenCalledWith('demo')
    expect(mockClearPluginData).toHaveBeenCalledWith('demo')
    expect(removePlugin).toHaveBeenCalledWith({
      plugin,
      stopPrevious: expect.any(Function),
      commitApplicationState: expect.any(Function),
      rollbackApplicationState: expect.any(Function)
    })
    expect(mockFsRm).not.toHaveBeenCalled()
  })

  it('can uninstall a plugin while preserving plugin data', async () => {
    mockDbGet.mockImplementation((key: string) => {
      if (key === 'plugins') {
        return [{ name: 'demo', path: 'D:\\plugins\\demo', isDevelopment: false }]
      }
      return []
    })

    const api = new PluginsAPI()
    const stopPluginByName = vi.fn(async () => false)
    const removePluginUsageData = vi.fn()

    ;(api as any).pluginManager = { stopPluginByName }
    ;(api as any).devProjects = { removePluginUsageData }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()
    attachRemovalService(api)

    const result = await api.deletePlugin('D:\\plugins\\demo', { deleteData: false })

    expect(result).toEqual({ success: true })
    expect(stopPluginByName).toHaveBeenCalledWith('demo')
    expect(removePluginUsageData).toHaveBeenCalledWith('demo')
    expect(mockClearPluginData).not.toHaveBeenCalled()
    expect(mockFsRm).not.toHaveBeenCalled()
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
    const stopPluginByName = vi.fn(async () => false)
    const removePluginUsageData = vi.fn()

    ;(api as any).pluginManager = { stopPluginByName }
    ;(api as any).devProjects = { removePluginUsageData }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()
    attachRemovalService(api)

    const result = await api.deletePlugin('D:\\plugins\\demo', { deleteData: true })

    expect(result).toEqual({ success: true })
    expect(mockDbPut).toHaveBeenCalledWith('out-kill-plugin', ['other'])
    expect(mockDbPut).toHaveBeenCalledWith('auto-detach-plugin', [])
    expect(mockDbPut).toHaveBeenCalledWith('auto-start-plugin', ['other'])
    expect(mockDbPut).toHaveBeenCalledWith(ENABLED_MAIN_PUSH_PLUGINS_KEY, ['other'])
  })

  it('returns a warning when committed removal cannot clear plugin data', async () => {
    const plugin = { name: 'demo', path: 'D:\\plugins\\demo', isDevelopment: false }
    mockDbGet.mockImplementation((key: string) => (key === 'plugins' ? [plugin] : []))
    mockClearPluginData.mockResolvedValueOnce({ success: false, error: 'LMDB 写入失败' })
    const api = new PluginsAPI()
    ;(api as any).pluginManager = { stopPluginByName: vi.fn(async () => false) }
    ;(api as any).devProjects = { removePluginUsageData: vi.fn() }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()
    const removePlugin = attachRemovalService(api)

    const result = await api.deletePlugin(plugin.path)

    expect(result).toEqual({ success: true, warning: '插件数据清理失败：LMDB 写入失败' })
    expect(removePlugin).toHaveBeenCalledOnce()
    expect(mockClearPluginData).toHaveBeenCalledWith('demo')
  })
})

describe('plugin removal settings and resources', () => {
  beforeEach(resetPluginRemovalMocks)

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

  it('reads an installed asar README through the plugin virtual root', async () => {
    const plugin = {
      name: 'demo',
      path: '/plugins/demo.asar',
      storageKind: 'asar'
    }
    mockDbGet.mockImplementation((key: string) => (key === 'plugins' ? [plugin] : []))
    mockFsReadFile.mockResolvedValue('# ASAR README')
    const api = new PluginsAPI()

    const result = await api.getPluginReadme('demo')

    expect(result).toEqual({ success: true, content: '# ASAR README' })
    expect(mockFsReadFile).toHaveBeenCalledWith('/plugins/demo.asar/README.md', 'utf8')
  })

  it('cleans provider settings for the uninstalled plugin', async () => {
    mockDbGet.mockImplementation((key: string) => {
      if (key === 'plugins') {
        return [{ name: 'demo', path: 'D:\\plugins\\demo', isDevelopment: false }]
      }
      return []
    })

    const api = new PluginsAPI()
    const stopPluginByName = vi.fn(async () => false)
    const removePluginUsageData = vi.fn()

    ;(api as any).pluginManager = { stopPluginByName }
    ;(api as any).devProjects = { removePluginUsageData }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()
    attachRemovalService(api)

    const result = await api.deletePlugin('D:\\plugins\\demo')

    expect(result).toEqual({ success: true })
    // 卸载时应清理该插件在 provider 配置中的启用/默认/参数
    expect(mockCleanupForPlugin).toHaveBeenCalledWith('demo')
  })

  it('rolls back the removal when provider application state cleanup fails', async () => {
    const plugin = { name: 'demo', path: 'D:\\plugins\\demo', isDevelopment: false }
    mockDbGet.mockImplementation((key: string) => {
      if (key === 'plugins') return [plugin]
      if (key === 'command-history') return [{ pluginName: 'demo' }]
      if (key === 'provider-settings') return { enabled: { text: ['plugin:demo:main'] } }
      return []
    })
    mockCleanupForPlugin.mockImplementationOnce(() => {
      throw new Error('Provider 配置清理失败')
    })
    const api = new PluginsAPI()
    const removePlugin = vi.fn(async (options: Record<string, any>) => {
      await options.stopPrevious()
      try {
        await options.commitApplicationState()
      } catch (error) {
        await options.rollbackApplicationState()
        throw error
      }
      return { committed: true }
    })
    ;(api as any).pluginManager = { stopPluginByName: vi.fn(async () => true) }
    ;(api as any).devProjects = { removePluginUsageData: vi.fn() }
    ;(api as any).mainWindow = { webContents: { send: vi.fn() } }
    ;(api as any).disabledPluginPathSet = new Set<string>()
    ;(api as any).pluginInstallUnits = { removePlugin }

    const result = await api.deletePlugin(plugin.path)

    expect(result).toEqual({ success: false, error: 'Provider 配置清理失败' })
    expect(mockDbPut).toHaveBeenCalledWith('command-history', [{ pluginName: 'demo' }])
    expect(mockDbPut).toHaveBeenCalledWith('provider-settings', {
      enabled: { text: ['plugin:demo:main'] }
    })
  })
})
