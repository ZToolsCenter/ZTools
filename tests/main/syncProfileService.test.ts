import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  docs: new Map<string, any>(),
  put: vi.fn(),
  saveOfficialAccountSession: vi.fn(),
  switchAccount: vi.fn()
}))

vi.mock('../../src/main/core/lmdb/lmdbInstance', () => ({
  default: {
    promises: {
      get: vi.fn(async (id: string) => structuredClone(mocks.docs.get(id) || null)),
      put: mocks.put
    }
  },
  storageManager: {
    switchAccount: mocks.switchAccount
  }
}))

vi.mock('../../src/main/core/account/officialAccountService', () => ({
  clearOfficialRejectedAccessToken: vi.fn(),
  loadOfficialAccountSession: vi.fn(),
  refreshOfficialAccountTokens: vi.fn(),
  saveOfficialAccountSession: mocks.saveOfficialAccountSession
}))

import {
  migrateLegacySyncConfig,
  saveSyncProfile
} from '../../src/main/core/sync/syncProfileService'

describe('migrateLegacySyncConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.docs.clear()
    mocks.put.mockImplementation(async (doc: any) => {
      const next = structuredClone({ ...doc, _rev: '2-test' })
      mocks.docs.set(doc._id, next)
      return { ok: true, id: doc._id, rev: '2-test' }
    })
  })

  it('moves an official legacy login into the device session and the user data space', async () => {
    mocks.docs.set('SYNC/config', {
      _id: 'SYNC/config',
      _rev: '1-test',
      data: {
        enabled: true,
        serverUrl: 'https://z-tools.top/',
        username: 'official-user',
        token: 'official-token',
        refreshToken: 'official-refresh-token',
        syncInterval: 60,
        lastSyncTime: 123,
        deviceId: 'device-1'
      }
    })

    await migrateLegacySyncConfig()
    await migrateLegacySyncConfig()

    expect(mocks.saveOfficialAccountSession).toHaveBeenCalledWith({
      username: 'official-user',
      token: 'official-token',
      refreshToken: 'official-refresh-token'
    })
    expect(mocks.switchAccount).toHaveBeenCalledWith('official-user')
    expect(mocks.docs.get('SYNC/profile')?.data).toEqual({
      provider: 'official',
      enabled: true,
      serverUrl: 'wss://z.zosen.link',
      syncInterval: 60,
      lastSyncTime: 123,
      deviceId: 'device-1'
    })
    expect(mocks.docs.get('SYNC/separated-auth-migrated')?.data.completed).toBe(true)
    expect(mocks.put).toHaveBeenCalledTimes(2)
  })

  it('moves private legacy credentials without switching the official account data space', async () => {
    mocks.docs.set('SYNC/config', {
      _id: 'SYNC/config',
      _rev: '1-test',
      data: {
        enabled: true,
        serverUrl: 'ws://192.168.1.20:23517',
        username: 'private-user',
        token: 'private-token',
        refreshToken: 'private-refresh-token'
      }
    })

    await migrateLegacySyncConfig()

    expect(mocks.saveOfficialAccountSession).not.toHaveBeenCalled()
    expect(mocks.switchAccount).not.toHaveBeenCalled()
    expect(mocks.docs.get('SYNC/private-session')?.data).toEqual({
      serverUrl: 'ws://192.168.1.20:23517',
      username: 'private-user',
      token: 'private-token',
      refreshToken: 'private-refresh-token'
    })
    expect(mocks.docs.get('SYNC/profile')?.data).toMatchObject({
      provider: 'private',
      enabled: true,
      serverUrl: 'ws://192.168.1.20:23517'
    })
    expect(mocks.docs.get('SYNC/separated-auth-migrated')?.data.completed).toBe(true)
  })
})

describe('saveSyncProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.docs.clear()
    mocks.put.mockImplementation(async (doc: any) => {
      const next = structuredClone({ ...doc, _rev: '2-test' })
      mocks.docs.set(doc._id, next)
      return { ok: true, id: doc._id, rev: '2-test' }
    })
  })

  it('does not inherit the official URL when selecting an unconfigured private provider', async () => {
    mocks.docs.set('SYNC/profile', {
      _id: 'SYNC/profile',
      _rev: '1-test',
      data: {
        provider: 'official',
        enabled: true,
        serverUrl: 'wss://z.zosen.link',
        syncInterval: 30,
        lastSyncTime: 123
      }
    })

    const profile = await saveSyncProfile({ provider: 'private', enabled: false })

    expect(profile).toEqual({
      provider: 'private',
      enabled: false,
      serverUrl: '',
      syncInterval: 30,
      lastSyncTime: 123,
      deviceId: undefined
    })
    expect(mocks.docs.get('SYNC/profile')?.data).toEqual(profile)
  })
})
