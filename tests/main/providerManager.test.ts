import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbGet = vi.hoisted(() => vi.fn())
const mockDbPut = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    existsSync: vi.fn()
  },
  readFileSync: mockReadFileSync,
  existsSync: vi.fn()
}))

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path')
  return { default: actual, ...actual }
})

vi.mock('../../src/main/api/shared/database', () => ({
  default: {
    dbGet: mockDbGet,
    dbPut: mockDbPut
  }
}))

import providerManager from '../../src/main/core/provider/providerManager'

describe('providerManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认无已安装插件、无配置
    mockDbGet.mockReturnValue([])
    mockReadFileSync.mockImplementation(() => {
      throw new Error('no plugin.json')
    })
  })

  describe('registerBuiltinProvider', () => {
    it('registers a builtin provider and exposes it via getAllProviders', () => {
      providerManager.registerBuiltinProvider({
        name: 'bergamot',
        type: 'translation',
        label: '离线翻译',
        description: 'd'
      })
      const all = providerManager.getAllProviders()
      const builtin = all.find((p) => p.id === 'builtin-bergamot')
      expect(builtin).toBeDefined()
      expect(builtin?.source).toBe('builtin')
      expect(builtin?.type).toBe('translation')
    })

    it('throws when name or type is missing', () => {
      expect(() =>
        providerManager.registerBuiltinProvider({
          name: '',
          type: 'ocr',
          label: 'x',
          description: ''
        })
      ).toThrow()
    })
  })

  describe('getDeclaredProvidersByPath', () => {
    it('parses valid providers from plugin.json', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          providers: {
            translation: { type: 'translation', label: '云翻译', description: 'd' },
            ocr: { type: 'ocr', label: '云OCR' }
          }
        })
      )
      const declared = providerManager.getDeclaredProvidersByPath('/fake/plugin')
      expect(declared.translation?.label).toBe('云翻译')
      expect(declared.ocr?.type).toBe('ocr')
    })

    it('drops unknown provider types and malformed declarations', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          providers: {
            // 不支持的 type
            ai: { type: 'ai', label: 'should be dropped' },
            // 结构错误
            translation: 'not-an-object'
          }
        })
      )
      const declared = providerManager.getDeclaredProvidersByPath('/fake/plugin')
      expect(declared.translation).toBeUndefined()
      expect(declared.ocr).toBeUndefined()
    })

    it('preserves multiple declarations of the same type (different keys)', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          providers: {
            baidu: { type: 'translation', label: '百度' },
            google: { type: 'translation', label: '谷歌' },
            ocr: { type: 'ocr', label: '云 OCR' }
          }
        })
      )
      const declared = providerManager.getDeclaredProvidersByPath('/fake/plugin')
      expect(Object.keys(declared)).toEqual(['baidu', 'google', 'ocr'])
      expect(declared.baidu?.type).toBe('translation')
      expect(declared.google?.type).toBe('translation')
      expect(declared.ocr?.type).toBe('ocr')
    })

    it('returns empty when plugin.json is unreadable', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })
      expect(providerManager.getDeclaredProvidersByPath('/missing')).toEqual({})
    })
  })

  describe('getAllProviders aggregates plugin providers', () => {
    it('lists plugin providers from installed plugins', () => {
      mockDbGet.mockReturnValue([
        { name: 'cloud-trans', path: '/p/cloud-trans', title: '云翻译', logo: 'l.png' }
      ])
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          providers: { translation: { type: 'translation', label: '云翻译', description: 'd' } }
        })
      )
      const list = providerManager.getAllProviders('translation')
      const pluginProvider = list.find((p) => p.source === 'plugin')
      expect(pluginProvider).toBeDefined()
      expect(pluginProvider?.id).toBe('plugin:cloud-trans:translation')
      expect(pluginProvider?.pluginName).toBe('cloud-trans')
      expect(pluginProvider?.pluginLogo).toBe('l.png')
    })

    it('lists multiple providers of the same type from one plugin (multi-declaration)', () => {
      mockDbGet.mockReturnValue([
        { name: 'multi-trans', path: '/p/multi-trans', title: '多云翻译' }
      ])
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          providers: {
            baidu: { type: 'translation', label: '百度翻译', description: 'b' },
            google: { type: 'translation', label: '谷歌翻译', description: 'g' },
            ocr: { type: 'ocr', label: '云 OCR', description: 'o' }
          }
        })
      )
      const translations = providerManager.getAllProviders('translation')
      const pluginProviders = translations.filter((p) => p.source === 'plugin')
      expect(pluginProviders).toHaveLength(2)
      const byId = Object.fromEntries(pluginProviders.map((p) => [p.id, p]))
      expect(byId['plugin:multi-trans:baidu']).toBeDefined()
      expect(byId['plugin:multi-trans:baidu'].label).toBe('百度翻译')
      expect(byId['plugin:multi-trans:baidu'].key).toBe('baidu')
      expect(byId['plugin:multi-trans:google']).toBeDefined()
      expect(byId['plugin:multi-trans:google'].label).toBe('谷歌翻译')
      expect(byId['plugin:multi-trans:google'].key).toBe('google')

      // ocr 声明不会混入 translation 列表
      expect(pluginProviders.every((p) => p.type === 'translation')).toBe(true)

      // 按 ocr 过滤应只剩一条
      const ocrList = providerManager.getAllProviders('ocr')
      expect(ocrList.filter((p) => p.source === 'plugin')).toHaveLength(1)
      expect(ocrList.find((p) => p.source === 'plugin')?.id).toBe('plugin:multi-trans:ocr')
    })
  })

  describe('settings persistence', () => {
    it('setEnabled adds the provider to the enabled list and persists', () => {
      providerManager.registerBuiltinProvider({
        name: 'bergamot',
        type: 'translation',
        label: '离线',
        description: ''
      })
      mockDbGet.mockReturnValue({ enabled: {}, defaultId: {}, params: {} })
      providerManager.setEnabled('builtin-bergamot', true)
      expect(mockDbPut).toHaveBeenCalledWith(
        'provider-settings',
        expect.objectContaining({
          enabled: expect.objectContaining({ translation: ['builtin-bergamot'] })
        })
      )
    })

    it('setDefault sets default and auto-enables the provider', () => {
      providerManager.registerBuiltinProvider({
        name: 'bergamot',
        type: 'translation',
        label: '离线',
        description: ''
      })
      mockDbGet.mockReturnValue({ enabled: {}, defaultId: {}, params: {} })
      providerManager.setDefault('translation', 'builtin-bergamot')
      const calls = mockDbPut.mock.calls
      const last = calls[calls.length - 1][1] as {
        enabled: Record<string, string[]>
        defaultId: Record<string, string>
      }
      expect(last.defaultId.translation).toBe('builtin-bergamot')
      expect(last.enabled.translation).toContain('builtin-bergamot')
    })

    it('disabling the default provider clears the default', () => {
      providerManager.registerBuiltinProvider({
        name: 'bergamot',
        type: 'translation',
        label: '离线',
        description: ''
      })
      mockDbGet.mockReturnValue({
        enabled: { translation: ['builtin-bergamot'] },
        defaultId: { translation: 'builtin-bergamot' },
        params: {}
      })
      providerManager.setEnabled('builtin-bergamot', false)
      const last = mockDbPut.mock.calls[mockDbPut.mock.calls.length - 1][1] as {
        defaultId: Record<string, string | undefined>
        enabled: Record<string, string[]>
      }
      expect(last.defaultId.translation).toBeUndefined()
      expect(last.enabled.translation).not.toContain('builtin-bergamot')
    })
  })

  describe('cleanupForPlugin', () => {
    it('removes plugin-scoped enabled/default/params entries', () => {
      mockDbGet.mockReturnValue({
        enabled: {
          translation: ['plugin:demo:translation', 'plugin:other:translation'],
          ocr: ['plugin:demo:ocr']
        },
        defaultId: { translation: 'plugin:demo:translation' },
        params: { 'plugin:demo:translation': { k: 'v' }, 'plugin:other:translation': { k2: 'v2' } }
      })
      providerManager.cleanupForPlugin('demo')
      const last = mockDbPut.mock.calls[mockDbPut.mock.calls.length - 1][1] as {
        enabled: Record<string, string[]>
        defaultId: Record<string, string | undefined>
        params: Record<string, unknown>
      }
      expect(last.enabled.translation).toEqual(['plugin:other:translation'])
      expect(last.enabled.ocr).toEqual([])
      expect(last.defaultId.translation).toBeUndefined()
      expect(last.params['plugin:demo:translation']).toBeUndefined()
      expect(last.params['plugin:other:translation']).toEqual({ k2: 'v2' })
    })
  })

  describe('invoke', () => {
    it('calls the builtin provider invoke when set as default', async () => {
      const invokeFn = vi.fn().mockResolvedValue({ text: '你好' })
      providerManager.registerBuiltinProvider({
        name: 'bergamot',
        type: 'translation',
        label: '离线',
        description: '',
        invoke: invokeFn as never
      })
      mockDbGet.mockReturnValue({
        enabled: { translation: ['builtin-bergamot'] },
        defaultId: { translation: 'builtin-bergamot' },
        params: {}
      })
      const result = await providerManager.invoke('translation', { text: 'hello' })
      expect(invokeFn).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }))
      expect(result).toEqual({ text: '你好' })
    })

    it('throws when no provider is available', async () => {
      mockDbGet.mockReturnValue({ enabled: {}, defaultId: {}, params: {} })
      // ocr 没有任何内置/插件 provider
      await expect(providerManager.invoke('ocr', { image: 'x' })).rejects.toThrow(
        /没有可用的 ocr 提供商/
      )
    })

    it('throws when builtin provider has no invoke implementation', async () => {
      providerManager.registerBuiltinProvider({
        name: 'noimpl',
        type: 'translation',
        label: '空',
        description: ''
      })
      mockDbGet.mockReturnValue({
        enabled: { translation: ['builtin-noimpl'] },
        defaultId: { translation: 'builtin-noimpl' },
        params: {}
      })
      await expect(providerManager.invoke('translation', { text: 'x' })).rejects.toThrow(/暂不可用/)
    })
  })
})
