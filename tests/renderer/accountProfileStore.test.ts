import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('setting account profile store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('replaces the device cache with the remote profile for every consumer', async () => {
    let resolveRemote: ((value: unknown) => void) | null = null
    const dbPut = vi.fn().mockResolvedValue(undefined)
    const internal = {
      accountGetSession: vi.fn().mockResolvedValue({
        success: true,
        session: { username: 'zing', token: 'token' }
      }),
      dbGet: vi.fn().mockResolvedValue({
        uid: 'zing',
        nickname: '旧昵称',
        avatarUrl: 'https://example.com/old.png',
        updatedAt: 1
      }),
      dbPut,
      syncGetAccountProfile: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRemote = resolve
          })
      )
    }
    vi.stubGlobal('window', { ztools: { internal } })

    const profileStore =
      await import('../../internal-plugins/setting/src/composables/useAccountProfile')
    const leftMenu = profileStore.useAccountProfile()
    const accountPage = profileStore.useAccountProfile()
    const refreshing = leftMenu.refresh()

    await vi.waitFor(() => expect(leftMenu.state.nickname).toBe('旧昵称'))
    resolveRemote?.({
      success: true,
      profile: {
        uid: 'zing',
        nickname: '新昵称',
        avatarUrl: 'https://example.com/new.png'
      }
    })
    await refreshing

    expect(leftMenu.state.nickname).toBe('新昵称')
    expect(accountPage.state.avatarUrl).toBe('https://example.com/new.png')
    expect(dbPut).toHaveBeenCalledWith(
      'account-profile-cache:zing',
      expect.objectContaining({
        uid: 'zing',
        nickname: '新昵称',
        avatarUrl: 'https://example.com/new.png'
      })
    )
  })

  it('ignores an older refresh that finishes after a forced plugin re-entry refresh', async () => {
    let resolveOlder: ((value: unknown) => void) | null = null
    const internal = {
      accountGetSession: vi.fn().mockResolvedValue({
        success: true,
        session: { username: 'zing', token: 'token' }
      }),
      dbGet: vi.fn().mockResolvedValue(null),
      dbPut: vi.fn().mockResolvedValue(undefined),
      syncGetAccountProfile: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOlder = resolve
            })
        )
        .mockResolvedValueOnce({
          success: true,
          profile: {
            uid: 'zing',
            nickname: '最新昵称',
            avatarUrl: 'https://example.com/latest.png'
          }
        })
    }
    vi.stubGlobal('window', { ztools: { internal } })

    const profileStore =
      await import('../../internal-plugins/setting/src/composables/useAccountProfile')
    const { state, refresh } = profileStore.useAccountProfile()
    const olderRefresh = refresh()
    await vi.waitFor(() => expect(internal.syncGetAccountProfile).toHaveBeenCalledTimes(1))

    await refresh({ force: true })
    resolveOlder?.({
      success: true,
      profile: {
        uid: 'zing',
        nickname: '过期昵称',
        avatarUrl: 'https://example.com/stale.png'
      }
    })
    await olderRefresh

    expect(state.nickname).toBe('最新昵称')
    expect(state.avatarUrl).toBe('https://example.com/latest.png')
  })
})
