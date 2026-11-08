import { describe, expect, it } from 'vitest'
import {
  BUNDLED_INTERNAL_PLUGIN_NAMES,
  INTERNAL_API_PLUGIN_NAMES,
  canPluginUseInternalApi,
  isBundledInternalPlugin,
  normalizeCustomInternalApiPluginNames,
  normalizeInternalApiChannelList,
  normalizeInternalApiDisabledPluginList,
  normalizeInternalApiPermissionsMap,
  normalizeInternalApiPluginKey,
  normalizeInternalApiRequestsMap,
  registerInternalApiChannel
} from '../../src/main/core/internalPlugins'

describe('internal plugin privilege split', () => {
  it('应将开发者插件识别为仅拥有内部 API 权限', () => {
    expect(INTERNAL_API_PLUGIN_NAMES).toContain('ztools-developer-plugin')
    expect(BUNDLED_INTERNAL_PLUGIN_NAMES).not.toContain('ztools-developer-plugin')
    expect(canPluginUseInternalApi('ztools-developer-plugin')).toBe(true)
    expect(isBundledInternalPlugin('ztools-developer-plugin')).toBe(false)
  })

  it('应归一化用户自定义内部 API 授权插件名称', () => {
    expect(
      normalizeCustomInternalApiPluginNames([
        ' custom-plugin ',
        '',
        'custom-plugin',
        null,
        'another-plugin'
      ])
    ).toEqual(['custom-plugin', 'another-plugin'])
  })

  it('应支持通过用户授权名单授予内部 API 权限', () => {
    expect(canPluginUseInternalApi('custom-plugin')).toBe(false)
    expect(canPluginUseInternalApi('custom-plugin', ['custom-plugin'])).toBe(true)
  })
})

describe('internal api channel registry and normalization', () => {
  it('应只保留已注册且格式合法的通道名并去重', () => {
    registerInternalApiChannel('internal:test-db-get')
    registerInternalApiChannel('internal:test-notify')

    expect(
      normalizeInternalApiChannelList([
        'internal:test-db-get',
        'internal:test-db-get',
        'internal:not-registered',
        'internal:TEST-BAD-CASE',
        'not-internal:db-get',
        '',
        null,
        42
      ])
    ).toEqual(['internal:test-db-get'])
  })

  it('应拒绝格式非法的通道注册', () => {
    // registerInternalApiChannel 仅做格式校验后静默忽略非法输入，不抛错
    expect(() => registerInternalApiChannel('not-a-valid-name')).not.toThrow()
    expect(normalizeInternalApiChannelList(['not-a-valid-name'])).toEqual([])
  })

  it('应归一化按通道授权映射并丢弃空条目', () => {
    registerInternalApiChannel('internal:test-db-put')
    expect(
      normalizeInternalApiPermissionsMap({
        ' plugin-a ': ['internal:test-db-put', 'internal:test-db-put'],
        'plugin-b': [],
        'plugin-c': 'not-a-list',
        '': ['internal:test-db-put']
      })
    ).toEqual({ 'plugin-a': ['internal:test-db-put'] })
    expect(normalizeInternalApiPermissionsMap(null)).toEqual({})
    expect(normalizeInternalApiPermissionsMap(['bad'])).toEqual({})
  })

  it('应归一化待审申请映射并裁剪说明长度', () => {
    registerInternalApiChannel('internal:test-launch')
    const requests = normalizeInternalApiRequestsMap({
      'plugin-a': {
        apis: ['internal:test-launch', 'internal:missing'],
        reason: '同步插件登记',
        requestedAt: 1234567890
      },
      'plugin-b': { apis: [] },
      'plugin-c': 'not-an-object'
    })
    expect(requests['plugin-a']).toEqual({
      apis: ['internal:test-launch'],
      reason: '同步插件登记',
      requestedAt: 1234567890
    })
    expect(requests).not.toHaveProperty('plugin-b')
    expect(requests).not.toHaveProperty('plugin-c')

    const longReason = normalizeInternalApiRequestsMap({
      'plugin-d': { apis: ['internal:test-launch'], reason: 'x'.repeat(600) }
    })
    expect(longReason['plugin-d']?.reason?.length).toBe(500)
  })

  it('应校验授权对象插件名的合法性', () => {
    expect(normalizeInternalApiPluginKey('  webdav-sync ')).toBe('webdav-sync')
    expect(normalizeInternalApiPluginKey('')).toBe('')
    expect(normalizeInternalApiPluginKey(null)).toBe('')
    expect(normalizeInternalApiPluginKey('x'.repeat(201))).toBe('')
  })

  it('应归一化停用授权插件名单并去重', () => {
    expect(
      normalizeInternalApiDisabledPluginList([' plugin-a ', '', 'plugin-a', null, 'plugin-b'])
    ).toEqual(['plugin-a', 'plugin-b'])
    expect(normalizeInternalApiDisabledPluginList('plugin-a')).toEqual([])
    expect(normalizeInternalApiDisabledPluginList(undefined)).toEqual([])
  })
})
