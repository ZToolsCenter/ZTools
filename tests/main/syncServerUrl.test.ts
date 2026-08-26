import { describe, expect, it } from 'vitest'
import {
  isOfficialSyncServerUrl,
  normalizeSyncServerUrl,
  OFFICIAL_SYNC_SERVER_URL
} from '../../src/shared/syncServerUrl'

describe('syncServerUrl', () => {
  it.each([
    ['http://127.0.0.1:23518', 'ws://127.0.0.1:23518'],
    ['https://sync.example.com/', 'wss://sync.example.com'],
    ['ws://localhost:8080/', 'ws://localhost:8080'],
    ['wss://SYNC.EXAMPLE.COM', 'wss://sync.example.com']
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSyncServerUrl(input)).toBe(expected)
  })

  it.each([
    ['', '请填写服务器地址'],
    ['ftp://sync.example.com', '仅支持'],
    ['https://user:secret@sync.example.com', '不能包含账号或密码'],
    ['https://sync.example.com/api', '暂不支持子路径'],
    ['https://sync.example.com/?tenant=a', '不能包含查询参数']
  ])('rejects invalid server address %s', (input, message) => {
    expect(() => normalizeSyncServerUrl(input)).toThrow(message)
  })

  it('recognizes the current and trusted legacy official service addresses', () => {
    expect(isOfficialSyncServerUrl('https://z.zosen.link/')).toBe(true)
    expect(isOfficialSyncServerUrl('https://z-tools.top/')).toBe(true)
    expect(isOfficialSyncServerUrl(OFFICIAL_SYNC_SERVER_URL)).toBe(true)
    expect(isOfficialSyncServerUrl('https://private.example.com')).toBe(false)
  })
})
