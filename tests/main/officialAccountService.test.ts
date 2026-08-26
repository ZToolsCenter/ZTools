import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getAsync: vi.fn(),
  put: vi.fn()
}))

vi.mock('../../src/main/core/lmdb/lmdbInstance', () => ({
  default: {
    get: mocks.get,
    promises: {
      get: mocks.getAsync,
      put: mocks.put
    }
  }
}))

import {
  loadOfficialAccountSession,
  loadOfficialAccountSessionSync,
  OFFICIAL_ACCOUNT_DOCUMENT_ID
} from '../../src/main/core/account/officialAccountService'

describe('official account server migration', () => {
  let storedDoc: {
    _id: string
    _rev: string
    data: {
      serverUrl: string
      username: string
      token: string
      refreshToken: string
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    storedDoc = {
      _id: OFFICIAL_ACCOUNT_DOCUMENT_ID,
      _rev: '1-test',
      data: {
        serverUrl: 'wss://z-tools.top',
        username: 'legacy-user',
        token: 'legacy-access-token',
        refreshToken: 'legacy-refresh-token'
      }
    }
    mocks.get.mockImplementation(() => structuredClone(storedDoc))
    mocks.getAsync.mockImplementation(async () => structuredClone(storedDoc))
    mocks.put.mockImplementation(async (doc: typeof storedDoc) => {
      storedDoc = structuredClone({ ...doc, _rev: '2-test' })
      return { ok: true, id: doc._id, rev: '2-test' }
    })
  })

  it('migrates a trusted legacy session without changing its tokens', async () => {
    const session = await loadOfficialAccountSession()

    expect(session).toEqual({
      serverUrl: 'wss://z.zosen.link',
      username: 'legacy-user',
      token: 'legacy-access-token',
      refreshToken: 'legacy-refresh-token'
    })
    expect(storedDoc.data).toEqual(session)
    expect(mocks.put).toHaveBeenCalledTimes(1)
  })

  it('keeps legacy users logged in for synchronous readers before persistence runs', () => {
    expect(loadOfficialAccountSessionSync()).toEqual({
      serverUrl: 'wss://z.zosen.link',
      username: 'legacy-user',
      token: 'legacy-access-token',
      refreshToken: 'legacy-refresh-token'
    })
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('rejects sessions from servers outside the explicit migration allowlist', async () => {
    storedDoc.data.serverUrl = 'wss://private.example.com'

    await expect(loadOfficialAccountSession()).resolves.toBeNull()
    expect(mocks.put).not.toHaveBeenCalled()
  })
})
