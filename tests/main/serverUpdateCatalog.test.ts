import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '3.1.0' } }))
vi.mock('../../src/main/api/renderer/pluginMarketConfig', () => ({
  DEFAULT_SYNC_SERVER_URL: 'wss://z-tools.top',
  syncServerUrlToHttp: () => 'https://z-tools.top'
}))
vi.mock('../../src/main/utils/httpRequest', () => ({ httpRequest: vi.fn() }))
vi.mock('../../src/main/api/shared/database', () => ({
  default: { dbGet: vi.fn() }
}))

import { getUpdateSystemType } from '../../src/main/api/serverUpdateCatalog'
import { resolveUpdateChannel } from '../../src/shared/updateChannel'

describe('getUpdateSystemType', () => {
  it('selects the Windows installer matching the current architecture', () => {
    expect(getUpdateSystemType('win32', 'x64')).toBe('windows-x64-installer')
    expect(getUpdateSystemType('win32', 'arm64')).toBe('windows-arm64-installer')
  })
})

describe('resolveUpdateChannel', () => {
  it('keeps regular releases on the stable channel by default', () => {
    expect(resolveUpdateChannel('3.1.0')).toBe('stable')
  })

  it('lets regular releases opt in to beta updates', () => {
    expect(resolveUpdateChannel('3.1.0', true)).toBe('beta')
  })

  it('keeps prerelease builds on the beta channel regardless of preference', () => {
    expect(resolveUpdateChannel('3.1.0-beta.2', false)).toBe('beta')
  })
})
