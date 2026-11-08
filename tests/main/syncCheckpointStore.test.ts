import { describe, expect, it } from 'vitest'
import { SyncCheckpointStore } from '../../src/main/core/sync/syncCheckpointStore'
import { LEGACY_OFFICIAL_SYNC_SERVER_URLS } from '../../src/shared/syncServerUrl'

describe('SyncCheckpointStore server isolation', () => {
  it('keeps the historical key for the official service', () => {
    const { db, meta } = createFakeDatabase()
    const store = new SyncCheckpointStore(db as any)
    const legacyServerUrl = `${LEGACY_OFFICIAL_SYNC_SERVER_URLS[0].replace('wss:', 'https:')}/`

    const checkpoint = store.commitPull(store.load('same-user', 'same-device', legacyServerUrl), 42)
    const migratedCheckpoint = store.load('same-user', 'same-device', 'https://z-tools.top/')

    expect(checkpoint.serverUrl).toBe(legacyServerUrl)
    expect(migratedCheckpoint.remotePullSeq).toBe(42)
    expect(migratedCheckpoint.serverUrl).toBe('https://z-tools.top/')
    expect(meta.has('_sync_checkpoint:same-user:same-device')).toBe(true)
  })

  it('uses separate progress for the same account on different private servers', () => {
    const { db } = createFakeDatabase()
    const store = new SyncCheckpointStore(db as any)

    store.commitPull(store.load('same-user', 'same-device', 'https://one.example.com'), 18)

    expect(store.load('same-user', 'same-device', 'https://one.example.com/').remotePullSeq).toBe(
      18
    )
    expect(store.load('same-user', 'same-device', 'https://two.example.com').remotePullSeq).toBe(0)
    expect(store.load('same-user', 'same-device', 'wss://z-tools.top').remotePullSeq).toBe(0)
  })
})

/**
 * 创建仅实现 checkpoint 存储所需接口的内存数据库。
 * @returns 数据库替身及可用于断言的 metadata Map。
 */
function createFakeDatabase(): {
  db: {
    getMetaDb: () => {
      get: (key: string) => unknown
      putSync: (key: string, value: unknown) => void
    }
  }
  meta: Map<string, unknown>
} {
  const meta = new Map<string, unknown>()
  return {
    db: {
      getMetaDb: () => ({
        get: (key: string): unknown => meta.get(key),
        putSync: (key: string, value: unknown): void => {
          meta.set(key, value)
        }
      })
    },
    meta
  }
}
