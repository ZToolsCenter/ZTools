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

import {
  PluginMarketAuthRequiredError,
  PluginMarketAuthMode,
  requestPluginMarket
} from '../../src/main/api/renderer/pluginMarketConfig'

describe('requestPluginMarket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({
      _id: 'SYNC/config',
      _rev: '1-test',
      data: {
        serverUrl: 'wss://z-tools.top',
        token: 'expired-token',
        refreshToken: 'expired-refresh-token'
      }
    })
  })

  it('retries an optional market request anonymously when token refresh fails', async () => {
    mockHttpRequest
      .mockResolvedValueOnce({ status: 401, data: { error: 'Unauthorized' } })
      .mockResolvedValueOnce({ status: 401, data: { error: 'Invalid refresh token' } })
      .mockResolvedValueOnce({
        status: 200,
        data: { name: '2048', downloadUrl: 'https://example.com/2048.zpx' }
      })

    const response = await requestPluginMarket('/plugins/download?name=2048', {
      headers: { Authorization: 'Bearer caller-token' }
    })

    expect(response.status).toBe(200)
    expect(mockHttpRequest).toHaveBeenCalledTimes(3)
    expect(mockHttpRequest.mock.calls[0][1].headers.Authorization).toBe('Bearer expired-token')
    expect(mockHttpRequest.mock.calls[2][1].headers.Authorization).toBeUndefined()
  })

  it('does not anonymously retry a required market request', async () => {
    mockHttpRequest
      .mockResolvedValueOnce({ status: 401, data: { error: 'Unauthorized' } })
      .mockResolvedValueOnce({ status: 401, data: { error: 'Invalid refresh token' } })

    await expect(
      requestPluginMarket('/plugins/comments', { method: 'POST' }, PluginMarketAuthMode.REQUIRED)
    ).rejects.toBeInstanceOf(PluginMarketAuthRequiredError)
    expect(mockHttpRequest).toHaveBeenCalledTimes(2)
  })

  it('persists refreshed tokens and retries with the new access token', async () => {
    const oldConfig = {
      _id: 'SYNC/config',
      _rev: '1-test',
      data: {
        serverUrl: 'wss://z-tools.top',
        token: 'expired-token',
        refreshToken: 'expired-refresh-token'
      }
    }
    const newConfig = {
      ...oldConfig,
      data: {
        ...oldConfig.data,
        token: 'new-token',
        refreshToken: 'new-refresh-token'
      }
    }
    mockGet
      .mockReset()
      .mockResolvedValueOnce(oldConfig)
      .mockResolvedValueOnce(oldConfig)
      .mockResolvedValueOnce(oldConfig)
      .mockResolvedValueOnce(newConfig)

    mockHttpRequest
      .mockResolvedValueOnce({ status: 401, data: { error: 'Unauthorized' } })
      .mockResolvedValueOnce({
        status: 200,
        data: { token: 'new-token', refreshToken: 'new-refresh-token' }
      })
      .mockResolvedValueOnce({ status: 200, data: { items: [] } })

    const response = await requestPluginMarket('/plugins/comments?pluginName=2048')

    expect(response.status).toBe(200)
    expect(mockHttpRequest).toHaveBeenCalledTimes(3)
    expect(mockHttpRequest.mock.calls[2][1].headers.Authorization).toBe('Bearer new-token')
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'SYNC/config',
        data: expect.objectContaining({
          token: 'new-token',
          refreshToken: 'new-refresh-token'
        })
      })
    )
  })
})
