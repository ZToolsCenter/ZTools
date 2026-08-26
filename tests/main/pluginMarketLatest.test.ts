import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequestPluginMarket = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/api/renderer/pluginMarketConfig', () => ({
  PluginMarketAuthRequiredError: class PluginMarketAuthRequiredError extends Error {},
  PluginMarketAuthMode: { OPTIONAL: 'optional', REQUIRED: 'required' },
  getPluginMarketApiBase: () => 'https://z.zosen.link/api/market',
  requestPluginMarket: mockRequestPluginMarket
}))

vi.mock('../../src/main/utils/httpRequest.js', () => ({
  httpGet: vi.fn()
}))

vi.mock('../../src/main/api/shared/database', () => ({
  default: {
    dbGet: vi.fn(),
    dbPut: vi.fn()
  }
}))

import { PluginMarketAPI } from '../../src/main/api/renderer/pluginMarket'

describe('PluginMarketAPI.fetchLatestPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates concurrent requests and reuses the positive cache', async () => {
    let resolveRequest: ((value: any) => void) | undefined
    mockRequestPluginMarket.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      })
    )
    const api = new PluginMarketAPI()

    const first = api.fetchLatestPlugin('demo', 'darwin')
    const second = api.fetchLatestPlugin('demo', 'darwin')

    expect(mockRequestPluginMarket).toHaveBeenCalledTimes(1)
    resolveRequest?.({
      status: 200,
      data: {
        available: true,
        plugin: { name: 'demo', title: 'Demo', version: '1.2.0' }
      }
    })

    await expect(first).resolves.toMatchObject({
      available: true,
      plugin: { name: 'demo', version: '1.2.0' }
    })
    await expect(second).resolves.toMatchObject({ available: true })
    await expect(api.fetchLatestPlugin('demo', 'darwin')).resolves.toMatchObject({
      available: true
    })
    expect(mockRequestPluginMarket).toHaveBeenCalledTimes(1)
  })

  it('returns a normal unavailable result for an unlisted plugin', async () => {
    mockRequestPluginMarket.mockResolvedValue({
      status: 200,
      data: { available: false, reason: 'not_found' }
    })
    const api = new PluginMarketAPI()

    await expect(api.fetchLatestPlugin('local-only', 'win32')).resolves.toEqual({
      available: false,
      reason: 'not_found'
    })
  })
})
