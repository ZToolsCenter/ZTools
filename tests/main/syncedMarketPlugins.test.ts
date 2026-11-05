import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => {
  const store = new Map<string, any>()
  return {
    store,
    dbGet: vi.fn((key: string) => store.get(key) ?? null),
    dbPut: vi.fn((key: string, data: any) => {
      store.set(key, data)
      return { ok: true }
    }),
    reset() {
      store.clear()
      this.dbGet.mockClear()
      this.dbPut.mockClear()
    }
  }
})

vi.mock('../../src/main/api/shared/database', () => ({
  default: {
    dbGet: (key: string) => dbState.dbGet(key),
    dbPut: (key: string, data: any) => dbState.dbPut(key, data)
  }
}))

vi.mock('../../src/main/core/internalPlugins', () => ({
  isBundledInternalPlugin: (name: string) => name === 'setting'
}))

import {
  isMarketSyncCandidate,
  readSyncedMarketPlugins,
  reconcileSyncedMarketPlugins,
  removeSyncedMarketPlugin,
  seedSyncedMarketPluginsIfMissing,
  setSyncedMarketPluginInstaller,
  upsertSyncedMarketPlugin,
  writeSyncedMarketPlugins
} from '../../src/main/core/sync/syncedMarketPlugins'
import { HOST_STORAGE_KEYS } from '../../src/shared/storageKeys'

describe('syncedMarketPlugins', () => {
  beforeEach(() => {
    dbState.reset()
    setSyncedMarketPluginInstaller(null)
  })

  afterEach(() => {
    setSyncedMarketPluginInstaller(null)
  })

  it('treats market and legacy untagged formal plugins as sync candidates', () => {
    expect(isMarketSyncCandidate({ name: 'demo', installedFrom: 'market' })).toBe(true)
    expect(isMarketSyncCandidate({ name: 'legacy' })).toBe(true)
    expect(isMarketSyncCandidate({ name: 'local', installedFrom: 'local' })).toBe(false)
    expect(isMarketSyncCandidate({ name: 'npm', installedFrom: 'npm' })).toBe(false)
    expect(isMarketSyncCandidate({ name: 'dev', isDevelopment: true })).toBe(false)
    expect(isMarketSyncCandidate({ name: 'setting' })).toBe(false)
  })

  it('upserts and removes market plugin entries without noop writes', () => {
    expect(upsertSyncedMarketPlugin({ name: 'demo', version: '1.0.0' })).toBe(true)
    expect(readSyncedMarketPlugins()).toEqual({
      plugins: [{ name: 'demo', version: '1.0.0' }]
    })
    expect(upsertSyncedMarketPlugin({ name: 'demo', version: '1.0.0' })).toBe(false)
    expect(upsertSyncedMarketPlugin({ name: 'other' })).toBe(true)
    expect(removeSyncedMarketPlugin('demo')).toBe(true)
    expect(readSyncedMarketPlugins().plugins.map((item) => item.name)).toEqual(['other'])
    expect(removeSyncedMarketPlugin('demo')).toBe(false)
  })

  it('seeds missing manifest from installed market candidates once', () => {
    const seeded = seedSyncedMarketPluginsIfMissing([
      { name: 'market-a', version: '1.0.0', installedFrom: 'market' },
      { name: 'local-b', installedFrom: 'local' },
      { name: 'legacy-c', version: '2.0.0' }
    ])
    expect(seeded).toBe(true)
    expect(readSyncedMarketPlugins().plugins).toEqual([
      { name: 'legacy-c', version: '2.0.0' },
      { name: 'market-a', version: '1.0.0' }
    ])
    expect(seedSyncedMarketPluginsIfMissing([{ name: 'market-a', installedFrom: 'market' }])).toBe(
      false
    )
  })

  it('reconciles by installing missing market plugins and never uninstalls extras', async () => {
    writeSyncedMarketPlugins([
      { name: 'need-install', version: '1.0.0' },
      { name: 'already-here', version: '2.0.0' }
    ])
    dbState.store.set(HOST_STORAGE_KEYS.plugins, [
      { name: 'already-here', version: '2.0.0', installedFrom: 'market' },
      { name: 'local-only', installedFrom: 'local' }
    ])

    const install = vi.fn(async (plugin: { name: string }) => {
      const current = dbState.store.get(HOST_STORAGE_KEYS.plugins) || []
      dbState.store.set(HOST_STORAGE_KEYS.plugins, [
        ...current,
        { name: plugin.name, installedFrom: 'market' }
      ])
      return { success: true }
    })
    setSyncedMarketPluginInstaller(install)

    await reconcileSyncedMarketPlugins()

    expect(install).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledWith({ name: 'need-install', version: '1.0.0' })
    const installedNames = (dbState.store.get(HOST_STORAGE_KEYS.plugins) as any[]).map(
      (plugin) => plugin.name
    )
    expect(installedNames).toContain('local-only')
    expect(installedNames).toContain('need-install')
  })
})
