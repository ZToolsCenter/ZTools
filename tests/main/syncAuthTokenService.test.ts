import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGet = vi.hoisted(() => vi.fn())
const mockPut = vi.hoisted(() => vi.fn())
const mockHttpRequest = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/core/lmdb/lmdbInstance', () => ({
  default: {
    promises: {
      get: mockGet,
      put: mockPut
    }
  }
}))

vi.mock('../../src/main/utils/httpRequest.js', () => ({
  httpRequest: mockHttpRequest
}))

import { CredentialSessionService } from '../../src/main/core/auth/credentialSessionService'

type StoredDoc = {
  _id: string
  _rev: string
  data: {
    serverUrl: string
    username: string
    token: string
    refreshToken: string
  }
}

describe('CredentialSessionService', () => {
  let storedDoc: StoredDoc
  let service: CredentialSessionService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new CredentialSessionService('AUTH/test-session')
    storedDoc = createStoredDoc('old-token', 'old-refresh-token', 'zing')
    mockGet.mockImplementation(async () => structuredClone(storedDoc))
    mockPut.mockImplementation(async (doc: StoredDoc) => {
      storedDoc = structuredClone({ ...doc, _rev: '2-test' })
      return { ok: true, id: doc._id, rev: '2-test' }
    })
  })

  it('shares one refresh request for concurrent callers using the same stored token', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined
    mockHttpRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )

    const first = service.refresh('old-refresh-token')
    const second = service.refresh('old-refresh-token')
    await vi.waitFor(() => expect(mockHttpRequest).toHaveBeenCalledTimes(1))

    resolveRequest?.({
      status: 200,
      data: { token: 'next-token', refreshToken: 'next-refresh-token' }
    })

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(['refreshed', 'reused']).toContain(firstResult.status)
    expect(['refreshed', 'reused']).toContain(secondResult.status)
    expect(storedDoc.data.token).toBe('next-token')
    expect(storedDoc.data.refreshToken).toBe('next-refresh-token')
  })

  it('reuses a newer persisted token without sending a stale refresh request', async () => {
    storedDoc = createStoredDoc('new-token', 'new-refresh-token', 'zing')

    const result = await service.refresh('stale-refresh-token')

    expect(result.status).toBe('reused')
    expect(result.session.token).toBe('new-token')
    expect(mockHttpRequest).not.toHaveBeenCalled()
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('does not overwrite a different account that is saved while refresh is in flight', async () => {
    storedDoc = createStoredDoc('switch-old-token', 'switch-old-refresh-token', 'zing')
    let resolveRequest: ((value: unknown) => void) | undefined
    mockHttpRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )

    const pending = service.refresh('switch-old-refresh-token')
    await vi.waitFor(() => expect(mockHttpRequest).toHaveBeenCalledTimes(1))
    storedDoc = createStoredDoc('other-token', 'other-refresh-token', 'other-user')
    resolveRequest?.({
      status: 200,
      data: { token: 'stale-result-token', refreshToken: 'stale-result-refresh-token' }
    })

    const result = await pending
    expect(result.status).toBe('reused')
    expect(result.session.username).toBe('other-user')
    expect(storedDoc.data.token).toBe('other-token')
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('retries persistence after an unrelated config revision conflict', async () => {
    storedDoc = createStoredDoc('conflict-token', 'conflict-refresh-token', 'zing')
    mockHttpRequest.mockResolvedValue({
      status: 200,
      data: { token: 'conflict-next-token', refreshToken: 'conflict-next-refresh-token' }
    })
    mockPut
      .mockReset()
      .mockImplementationOnce(async () => {
        storedDoc = {
          ...storedDoc,
          _rev: '2-unrelated',
          data: { ...storedDoc.data, lastSyncTime: 123 } as StoredDoc['data']
        }
        return { error: true, name: 'conflict', message: 'Document update conflict' }
      })
      .mockImplementationOnce(async (doc: StoredDoc) => {
        storedDoc = structuredClone({ ...doc, _rev: '3-test' })
        return { ok: true, id: doc._id, rev: '3-test' }
      })

    const result = await service.refresh('conflict-refresh-token')

    expect(result.status).toBe('refreshed')
    expect(mockPut).toHaveBeenCalledTimes(2)
    expect(storedDoc.data.token).toBe('conflict-next-token')
    expect(storedDoc.data.username).toBe('zing')
  })

  it('clears credentials and notifies listeners after a confirmed invalid refresh token', async () => {
    storedDoc = createStoredDoc('invalid-token', 'invalid-refresh-token', 'zing')
    const invalidated = vi.fn()
    const stopListening = service.onInvalidated(invalidated)
    mockHttpRequest.mockResolvedValue({ status: 401, data: { error: 'Invalid refresh token' } })

    const result = await service.refresh('invalid-refresh-token')
    stopListening()

    expect(result.status).toBe('invalid')
    expect(storedDoc.data.token).toBe('')
    expect(storedDoc.data.refreshToken).toBe('')
    expect(invalidated).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'zing', token: '', refreshToken: '' })
    )
  })

  it('clears credentials without an invalidation event for an explicit logout', async () => {
    const invalidated = vi.fn()
    const stopListening = service.onInvalidated(invalidated)

    const result = await service.clear({ notifyInvalidated: false })
    stopListening()

    expect(result).toMatchObject({ username: 'zing', token: '', refreshToken: '' })
    expect(storedDoc.data.token).toBe('')
    expect(storedDoc.data.refreshToken).toBe('')
    expect(invalidated).not.toHaveBeenCalled()
  })

  it('reuses credentials refreshed by another caller before invalid-token cleanup', async () => {
    const oldDoc = createStoredDoc('race-token', 'race-refresh-token', 'zing')
    const newDoc = createStoredDoc('race-next-token', 'race-next-refresh-token', 'zing')
    storedDoc = oldDoc
    mockGet
      .mockReset()
      .mockResolvedValueOnce(structuredClone(oldDoc))
      .mockResolvedValueOnce(structuredClone(oldDoc))
      .mockResolvedValueOnce(structuredClone(newDoc))
    mockHttpRequest.mockResolvedValue({ status: 401, data: { error: 'Invalid refresh token' } })

    const result = await service.refresh('race-refresh-token')

    expect(result.status).toBe('reused')
    expect(result.session.token).toBe('race-next-token')
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('clears a stale access token when a legacy config has no refresh token', async () => {
    storedDoc = createStoredDoc('legacy-token', '', 'zing')

    const result = await service.refresh()

    expect(result.status).toBe('invalid')
    expect(storedDoc.data.token).toBe('')
    expect(storedDoc.data.refreshToken).toBe('')
  })

  it('keeps credentials when the refresh endpoint is temporarily unavailable', async () => {
    storedDoc = createStoredDoc('offline-token', 'offline-refresh-token', 'zing')
    mockHttpRequest.mockRejectedValue(new Error('network unavailable'))

    const result = await service.refresh('offline-refresh-token')

    expect(result.status).toBe('unavailable')
    expect(storedDoc.data.token).toBe('offline-token')
    expect(storedDoc.data.refreshToken).toBe('offline-refresh-token')
    expect(mockPut).not.toHaveBeenCalled()
  })
})

/**
 * 创建用于刷新服务测试的设备级同步配置文档。
 * @param token 访问令牌。
 * @param refreshToken 刷新令牌。
 * @param username 账号 UID。
 * @returns 可写入模拟存储的配置文档。
 */
function createStoredDoc(token: string, refreshToken: string, username: string): StoredDoc {
  return {
    _id: 'AUTH/test-session',
    _rev: '1-test',
    data: {
      serverUrl: 'wss://z.zosen.link',
      username,
      token,
      refreshToken
    }
  }
}
