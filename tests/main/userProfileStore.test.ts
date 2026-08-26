import { beforeEach, describe, expect, it, vi } from 'vitest'

const { lmdbGet, lmdbPut } = vi.hoisted(() => ({
  lmdbGet: vi.fn(),
  lmdbPut: vi.fn()
}))

vi.mock('../../src/main/core/lmdb/lmdbInstance', () => ({
  default: {
    get: lmdbGet,
    put: lmdbPut
  }
}))

import { cacheUserProfile, getCurrentUserInfo } from '../../src/main/core/account/userProfileStore'

describe('user profile store', () => {
  beforeEach(() => {
    lmdbGet.mockReset()
    lmdbPut.mockReset()
  })

  it('returns null when no official ZTools account is logged in', () => {
    lmdbGet.mockReturnValueOnce(null)

    expect(getCurrentUserInfo()).toBeNull()
  })

  it('does not expose custom sync-server credentials as a ZTools user', () => {
    lmdbGet.mockReturnValueOnce({
      data: {
        token: 'secret',
        username: 'custom-user',
        serverUrl: 'wss://sync.example.com'
      }
    })

    expect(getCurrentUserInfo()).toBeNull()
  })

  it('returns cached public profile fields for the logged-in user', () => {
    lmdbGet
      .mockReturnValueOnce({
        data: {
          token: 'secret',
          username: 'zing',
          serverUrl: 'wss://z.zosen.link'
        }
      })
      .mockReturnValueOnce({
        data: {
          uid: 'zing',
          nickname: 'Zing Zhang',
          avatarUrl: 'https://z.zosen.link/avatar/zing.png'
        }
      })

    expect(getCurrentUserInfo()).toEqual({
      avatar: 'https://z.zosen.link/avatar/zing.png',
      nickname: 'Zing Zhang',
      uid: 'zing'
    })
    expect(lmdbGet).toHaveBeenNthCalledWith(2, 'ZTOOLS/account-profile-cache:zing')
  })

  it('returns a complete fallback profile while the remote profile is not cached', () => {
    lmdbGet
      .mockReturnValueOnce({
        data: {
          token: 'secret',
          username: 'new-user',
          serverUrl: 'wss://z.zosen.link'
        }
      })
      .mockReturnValueOnce(null)

    expect(getCurrentUserInfo()).toEqual({
      avatar: '',
      nickname: 'new-user',
      uid: 'new-user'
    })
  })

  it('updates the device-level profile cache while preserving its revision', () => {
    lmdbGet.mockReturnValueOnce({ _rev: '3-existing' })

    cacheUserProfile({
      uid: 'zing',
      nickname: 'New nickname',
      avatarUrl: 'https://z.zosen.link/avatar/new.png'
    })

    expect(lmdbPut).toHaveBeenCalledWith({
      _id: 'ZTOOLS/account-profile-cache:zing',
      _rev: '3-existing',
      data: {
        uid: 'zing',
        nickname: 'New nickname',
        avatarUrl: 'https://z.zosen.link/avatar/new.png',
        updatedAt: expect.any(Number)
      }
    })
  })
})
