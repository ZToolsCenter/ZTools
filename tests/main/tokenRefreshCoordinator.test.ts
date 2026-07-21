import { describe, expect, it, vi } from 'vitest'
import { coordinateTokenRefresh } from '../../src/main/core/sync/tokenRefreshCoordinator'

describe('coordinateTokenRefresh', () => {
  it('shares one refresh for concurrent callers using the same refresh token', async () => {
    let resolveRefresh: ((value: { token: string; refreshToken: string }) => void) | undefined
    const refresh = vi.fn(
      () =>
        new Promise<{ token: string; refreshToken: string }>((resolve) => {
          resolveRefresh = resolve
        })
    )

    const first = coordinateTokenRefresh('shared-refresh-token', refresh)
    const second = coordinateTokenRefresh('shared-refresh-token', refresh)

    expect(refresh).toHaveBeenCalledTimes(1)
    resolveRefresh?.({ token: 'next-token', refreshToken: 'next-refresh-token' })
    await expect(first).resolves.toEqual({
      token: 'next-token',
      refreshToken: 'next-refresh-token'
    })
    await expect(second).resolves.toEqual({
      token: 'next-token',
      refreshToken: 'next-refresh-token'
    })
  })

  it('briefly reuses a completed refresh while callers persist the result', async () => {
    const tokens = { token: 'next-token', refreshToken: 'next-refresh-token' }
    const refresh = vi.fn().mockResolvedValue(tokens)

    await expect(coordinateTokenRefresh('persisting-refresh-token', refresh)).resolves.toEqual(
      tokens
    )
    await expect(coordinateTokenRefresh('persisting-refresh-token', refresh)).resolves.toEqual(
      tokens
    )

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
