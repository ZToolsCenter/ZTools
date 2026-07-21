import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbGet = vi.hoisted(() => vi.fn())
const mockDbPut = vi.hoisted(() => vi.fn())
const mockDbRemove = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/api/shared/database.js', () => ({
  default: {
    dbGet: mockDbGet,
    dbPut: mockDbPut,
    dbRemove: mockDbRemove
  }
}))

vi.mock('../../src/shared/pluginRuntimeNamespace.js', () => ({
  isDevelopmentPluginName: vi.fn((name: string) => name.endsWith('__dev')),
  toDevPluginName: vi.fn((name: string) => `${name}__dev`)
}))

vi.mock('../../src/main/core/internalPlugins.js', () => ({
  isBundledInternalPlugin: vi.fn(() => false)
}))

import {
  cleanupLegacyWebSearchReferences,
  migrateHostStorageKeys
} from '../../src/main/core/startupDataMigrations'

describe('startupDataMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes legacy web search command references from flat command lists', () => {
    const stores: Record<string, any[]> = {
      'command-history': [
        { path: '/system', type: 'plugin', featureCode: 'web-search-history' },
        { path: '/system', type: 'plugin', featureCode: 'clear' }
      ],
      'pinned-commands': [
        { path: '/system', type: 'plugin', featureCode: 'web-search-pinned' },
        { path: '/apps/foo', type: 'direct' }
      ],
      'command-usage-stats': [
        { path: '/system', type: 'plugin', featureCode: 'web-search-stats', useCount: 3 },
        { path: '/system', type: 'plugin', featureCode: 'clear', useCount: 1 }
      ],
      'cached-commands': [
        { path: '/system', type: 'plugin', featureCode: 'web-search-cached' },
        { path: '/system', type: 'plugin', featureCode: 'reboot' }
      ],
      'super-panel-pinned': []
    }
    mockDbGet.mockImplementation((key: string) => stores[key] || [])

    cleanupLegacyWebSearchReferences()

    expect(mockDbPut).toHaveBeenCalledWith('command-history', [
      { path: '/system', type: 'plugin', featureCode: 'clear' }
    ])
    expect(mockDbPut).toHaveBeenCalledWith('pinned-commands', [
      { path: '/apps/foo', type: 'direct' }
    ])
    expect(mockDbPut).toHaveBeenCalledWith('command-usage-stats', [
      { path: '/system', type: 'plugin', featureCode: 'clear', useCount: 1 }
    ])
    expect(mockDbPut).toHaveBeenCalledWith('cached-commands', [
      { path: '/system', type: 'plugin', featureCode: 'reboot' }
    ])
  })

  it('removes legacy web search commands from super panel folders', () => {
    const stores: Record<string, any[]> = {
      'command-history': [],
      'pinned-commands': [],
      'command-usage-stats': [],
      'cached-commands': [],
      'super-panel-pinned': [
        {
          id: 'folder-1',
          name: 'Folder',
          isFolder: true,
          items: [
            { path: '/system', type: 'plugin', featureCode: 'web-search-nested' },
            { path: '/system', type: 'plugin', featureCode: 'clear' }
          ]
        },
        {
          id: 'folder-2',
          name: 'Empty Folder',
          isFolder: true,
          items: [{ path: '/system', type: 'plugin', featureCode: 'web-search-only' }]
        },
        { path: '/system', type: 'plugin', featureCode: 'web-search-top' }
      ]
    }
    mockDbGet.mockImplementation((key: string) => stores[key] || [])

    cleanupLegacyWebSearchReferences()

    expect(mockDbPut).toHaveBeenCalledTimes(1)
    expect(mockDbPut).toHaveBeenCalledWith('super-panel-pinned', [
      { path: '/system', type: 'plugin', featureCode: 'clear' }
    ])
  })

  it('renames camel-case host keys and preserves canonical values', () => {
    const stores: Record<string, any> = {
      autoStartPlugin: ['legacy', 'shared'],
      'auto-start-plugin': ['current', 'shared'],
      detachedWindowSizes: { legacy: { width: 400 } },
      'detached-window-sizes': { current: { width: 500 } }
    }
    mockDbGet.mockImplementation((key: string) => stores[key] ?? null)

    migrateHostStorageKeys()

    expect(mockDbPut).toHaveBeenCalledWith('auto-start-plugin', ['current', 'shared', 'legacy'])
    expect(mockDbPut).toHaveBeenCalledWith('detached-window-sizes', {
      legacy: { width: 400 },
      current: { width: 500 }
    })
    expect(mockDbRemove).toHaveBeenCalledWith('autoStartPlugin')
    expect(mockDbRemove).toHaveBeenCalledWith('detachedWindowSizes')
  })

  it('converts the legacy mainPush denylist into the 3.0 allowlist', () => {
    const stores: Record<string, any> = {
      disabledMainPushPlugin: ['blocked'],
      plugins: [{ name: 'enabled' }, { name: 'blocked' }]
    }
    mockDbGet.mockImplementation((key: string) => stores[key] ?? null)

    migrateHostStorageKeys()

    expect(mockDbPut).toHaveBeenCalledWith('enabled-main-push-plugin', ['enabled'])
    expect(mockDbRemove).toHaveBeenCalledWith('disabledMainPushPlugin')
  })
})
