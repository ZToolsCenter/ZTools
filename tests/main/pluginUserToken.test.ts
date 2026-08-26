import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(() => '3.0.2'),
  getDeviceIdPublic: vi.fn(() => 'device-1'),
  getCurrentUserInfo: vi.fn(),
  httpRequest: vi.fn(),
  loadOfficialAccountSession: vi.fn(),
  refreshOfficialAccountTokens: vi.fn(),
  registerPluginApiServices: vi.fn()
}))

vi.mock('electron', () => ({ app: { getVersion: mocks.getVersion } }))
vi.mock('../../src/main/api/plugin/device', () => ({
  default: { getDeviceIdPublic: mocks.getDeviceIdPublic }
}))
vi.mock('../../src/main/core/account/userProfileStore', () => ({
  getCurrentUserInfo: mocks.getCurrentUserInfo
}))
vi.mock('../../src/main/core/account/officialAccountService', () => ({
  loadOfficialAccountSession: mocks.loadOfficialAccountSession,
  refreshOfficialAccountTokens: mocks.refreshOfficialAccountTokens
}))
vi.mock('../../src/main/utils/httpRequest.js', () => ({ httpRequest: mocks.httpRequest }))
vi.mock('../../src/main/api/plugin/pluginApiDispatcher', () => ({
  registerPluginApiServices: mocks.registerPluginApiServices
}))

import { PluginUserAPI } from '../../src/main/api/plugin/user'

describe('plugin getUserTempToken API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVersion.mockReturnValue('3.0.2')
    mocks.getDeviceIdPublic.mockReturnValue('device-1')
  })

  it('identifies the caller and caches a valid temporary token', async () => {
    const expiresAt = Date.now() + 5 * 60_000
    mocks.loadOfficialAccountSession.mockResolvedValue({
      serverUrl: 'wss://z.zosen.link',
      username: 'zing',
      token: 'account-token',
      refreshToken: 'refresh-token'
    })
    mocks.httpRequest.mockResolvedValue({
      status: 200,
      data: { token: 'temporary-token', expiredAt: expiresAt }
    })
    const pluginManager = {
      getPluginManifestNameByWebContents: vi.fn(() => 'quick-translate')
    }
    const api = new PluginUserAPI()
    api.init(pluginManager as any)
    const handler = mocks.registerPluginApiServices.mock.calls[0][0].getUserTempToken
    const event = { sender: { id: 8 } }

    await expect(handler(event)).resolves.toEqual({
      token: 'temporary-token',
      expiredAt: expiresAt
    })
    await expect(handler(event)).resolves.toEqual({
      token: 'temporary-token',
      expiredAt: expiresAt
    })

    expect(mocks.httpRequest).toHaveBeenCalledTimes(1)
    const [url, options] = mocks.httpRequest.mock.calls[0]
    expect(url).toBe('https://z.zosen.link/api/auth/plugin-token')
    expect(options.headers.Authorization).toBe('Bearer account-token')
    expect(JSON.parse(options.body)).toEqual({
      pluginId: 'quick-translate',
      deviceId: 'device-1',
      appVersion: '3.0.2'
    })
  })

  it('refreshes an expired account token and retries once', async () => {
    const expiresAt = Date.now() + 5 * 60_000
    mocks.loadOfficialAccountSession.mockResolvedValue({
      serverUrl: 'wss://z.zosen.link',
      username: 'zing',
      token: 'expired-account-token',
      refreshToken: 'refresh-token'
    })
    mocks.httpRequest
      .mockResolvedValueOnce({ status: 401, data: { error: 'Unauthorized' } })
      .mockResolvedValueOnce({
        status: 200,
        data: { token: 'temporary-token', expiredAt: expiresAt }
      })
    mocks.refreshOfficialAccountTokens.mockResolvedValue({
      status: 'refreshed',
      session: {
        serverUrl: 'wss://z.zosen.link',
        username: 'zing',
        token: 'new-account-token',
        refreshToken: 'new-refresh-token'
      }
    })
    const api = new PluginUserAPI()
    api.init({ getPluginManifestNameByWebContents: () => 'quick-translate' } as any)
    const handler = mocks.registerPluginApiServices.mock.calls[0][0].getUserTempToken

    await expect(handler({ sender: {} })).resolves.toEqual({
      token: 'temporary-token',
      expiredAt: expiresAt
    })
    expect(mocks.httpRequest).toHaveBeenCalledTimes(2)
    expect(mocks.httpRequest.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer new-account-token'
    )
  })

  it('does not issue tokens to logged-out users or unknown callers', async () => {
    const api = new PluginUserAPI()
    api.init({ getPluginManifestNameByWebContents: () => null } as any)
    let handler = mocks.registerPluginApiServices.mock.calls[0][0].getUserTempToken
    await expect(handler({ sender: {} })).rejects.toThrow('无法确认当前插件身份')

    mocks.registerPluginApiServices.mockClear()
    mocks.loadOfficialAccountSession.mockResolvedValue(null)
    const loggedOutApi = new PluginUserAPI()
    loggedOutApi.init({ getPluginManifestNameByWebContents: () => 'quick-translate' } as any)
    handler = mocks.registerPluginApiServices.mock.calls[0][0].getUserTempToken
    await expect(handler({ sender: {} })).rejects.toThrow('请先登录 ZTools 账号')
    expect(mocks.httpRequest).not.toHaveBeenCalled()
  })
})
