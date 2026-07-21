import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const moduleLoader = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const preloadPath = require.resolve('../../resources/preload.js')
const originalLoad = moduleLoader._load

// ==================== providerManager 单测：默认项解析回退链 ====================

const mockDbGet = vi.hoisted(() => vi.fn())
const mockDbPut = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))
vi.mock('fs', () => ({
  default: { readFileSync: mockReadFileSync, existsSync: vi.fn() },
  readFileSync: mockReadFileSync,
  existsSync: vi.fn()
}))
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path')
  return { default: actual, ...actual }
})
vi.mock('../../src/main/api/shared/database', () => ({
  default: { dbGet: mockDbGet, dbPut: mockDbPut }
}))

import providerManager from '../../src/main/core/provider/providerManager'

describe('providerManager.getDefaultProviderId / resolveProviderId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbGet.mockReturnValue([])
    mockReadFileSync.mockImplementation(() => {
      throw new Error('no plugin.json')
    })
  })

  it('returns explicit defaultId when set', () => {
    mockDbGet.mockReturnValue({
      enabled: { translation: ['builtin-bergamot'] },
      defaultId: { translation: 'builtin-bergamot' },
      params: {}
    })
    expect(providerManager.getDefaultProviderId('translation')).toBe('builtin-bergamot')
  })

  it('falls back to first enabled when defaultId missing', () => {
    providerManager.registerBuiltinProvider({
      name: 'bergamot',
      type: 'translation',
      label: '离线',
      description: ''
    })
    mockDbGet.mockReturnValue({
      enabled: { translation: ['builtin-bergamot'] },
      defaultId: {},
      params: {}
    })
    expect(providerManager.getDefaultProviderId('translation')).toBe('builtin-bergamot')
  })

  it('falls back to first available provider when enabled list empty', () => {
    providerManager.registerBuiltinProvider({
      name: 'bergamot2',
      type: 'translation',
      label: '离线',
      description: ''
    })
    mockDbGet.mockReturnValue({ enabled: {}, defaultId: {}, params: {} })
    // 没有显式启用项，回退到该类型首个可用 provider
    expect(providerManager.getDefaultProviderId('translation')).toMatch(/^builtin-/)
  })

  it('returns undefined when no provider available', () => {
    // ocr 既无内置也无插件
    mockDbGet.mockReturnValue({ enabled: {}, defaultId: {}, params: {} })
    expect(providerManager.getDefaultProviderId('ocr')).toBeUndefined()
  })

  it('resolveProviderId honors explicit providerId over default', () => {
    mockDbGet.mockReturnValue({
      enabled: { translation: ['builtin-bergamot'] },
      defaultId: { translation: 'builtin-bergamot' },
      params: {}
    })
    expect(providerManager.resolveProviderId('translation', 'plugin:custom:translation')).toBe(
      'plugin:custom:translation'
    )
  })
})

// ==================== preload 暴露的消费者入口 ====================

describe('plugin preload provider consumption surface', () => {
  const ipcInvoke = vi.fn()
  const ipcSendSync = vi.fn()
  const ipcSend = vi.fn()
  const ipcOn = vi.fn()
  const ipcRemoveListener = vi.fn()
  const ipcEmit = vi.fn()

  beforeEach(() => {
    delete require.cache[preloadPath]
    ipcInvoke.mockReset().mockResolvedValue({ text: '你好' })
    ipcSendSync.mockReset()
    ipcSend.mockReset()
    ipcOn.mockReset()
    ipcRemoveListener.mockReset()
    ipcEmit.mockReset()
    ;(globalThis as any).window = { addEventListener: vi.fn() }

    moduleLoader._load = ((request: string) => {
      if (request === 'electron') {
        return {
          ipcRenderer: {
            invoke: ipcInvoke,
            on: ipcOn,
            send: ipcSend,
            sendSync: ipcSendSync,
            removeListener: ipcRemoveListener,
            emit: ipcEmit
          }
        }
      }
      return originalLoad.call(moduleLoader, request, undefined, false)
    }) as typeof originalLoad
  })

  afterEach(() => {
    delete require.cache[preloadPath]
    moduleLoader._load = originalLoad
    delete (globalThis as any).window
  })

  it('exposes providers namespace with getProviders/getDefaultProvider/invokeProvider', async () => {
    require(preloadPath)
    const ztools = (globalThis as any).window.ztools

    expect(typeof ztools.providers.getProviders).toBe('function')
    expect(typeof ztools.providers.getDefaultProvider).toBe('function')
    expect(typeof ztools.providers.invokeProvider).toBe('function')

    await ztools.providers.getProviders('translation')
    await ztools.providers.getDefaultProvider('translation')
    await ztools.providers.invokeProvider('translation', { text: 'hi' }, 'p1')

    // preload 的 ipcInvoke 内部走 'plugin.api' 通道，参数顺序为 (channel, apiName, args)
    expect(ipcInvoke).toHaveBeenNthCalledWith(1, 'plugin.api', 'providersGetProviders', {
      type: 'translation'
    })
    expect(ipcInvoke).toHaveBeenNthCalledWith(2, 'plugin.api', 'providersGetDefault', {
      type: 'translation'
    })
    expect(ipcInvoke).toHaveBeenNthCalledWith(3, 'plugin.api', 'providersInvoke', {
      type: 'translation',
      input: { text: 'hi' },
      providerId: 'p1'
    })
  })

  it('translate sugar invokes translation provider with optional from/to/providerId', async () => {
    require(preloadPath)
    const ztools = (globalThis as any).window.ztools

    await ztools.translate('hello', { from: 'en', to: 'zh', providerId: 'p1' })

    expect(ipcInvoke).toHaveBeenCalledWith('plugin.api', 'providersInvoke', {
      type: 'translation',
      input: { text: 'hello', from: 'en', to: 'zh' },
      providerId: 'p1'
    })
  })

  it('ocr sugar invokes ocr provider with optional lang/providerId', async () => {
    require(preloadPath)
    const ztools = (globalThis as any).window.ztools

    await ztools.ocr('data:image/png;base64,xxx', { lang: 'eng', providerId: 'p2' })

    expect(ipcInvoke).toHaveBeenCalledWith('plugin.api', 'providersInvoke', {
      type: 'ocr',
      input: { image: 'data:image/png;base64,xxx', lang: 'eng' },
      providerId: 'p2'
    })
  })

  it('translate/ocr work without options (providerId undefined)', async () => {
    require(preloadPath)
    const ztools = (globalThis as any).window.ztools

    await ztools.translate('hello')
    await ztools.ocr('img.png')

    expect(ipcInvoke).toHaveBeenNthCalledWith(1, 'plugin.api', 'providersInvoke', {
      type: 'translation',
      input: { text: 'hello', from: undefined, to: undefined },
      providerId: undefined
    })
    expect(ipcInvoke).toHaveBeenNthCalledWith(2, 'plugin.api', 'providersInvoke', {
      type: 'ocr',
      input: { image: 'img.png', lang: undefined },
      providerId: undefined
    })
  })
})
