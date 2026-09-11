import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbGet = vi.hoisted(() => vi.fn())
const mockDbPut = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/api/shared/database.js', () => ({
  default: { dbGet: mockDbGet, dbPut: mockDbPut }
}))

import aiProviderService, { resolveProviderCredential } from '../../src/main/core/aiProviderService'
import {
  OrcaApiKeyAdapter,
  persistOrcaCredential
} from '../../src/main/core/provider/orcaCredentials'
import type { AiProvider, AiProviderStore } from '../../src/shared/aiProviderShared'

/** 与真实目录同构的响应，覆盖文本、图像输入与图片生成。 */
const CATALOG_RESPONSE = {
  object: 'list',
  data: [
    {
      id: 'openai/gpt-5.5',
      object: 'model',
      supported_endpoint_types: ['openai', 'openai-response', 'anthropic', 'gemini'],
      architecture: { input_modalities: ['text', 'image'] }
    },
    {
      id: 'deepseek/deepseek-v4-pro',
      object: 'model',
      supported_endpoint_types: ['openai', 'anthropic'],
      architecture: { input_modalities: ['text'] }
    },
    {
      id: 'google/imagen-4.0-fast-generate-001',
      object: 'model',
      supported_endpoint_types: ['image-generation'],
      architecture: { input_modalities: ['text'] }
    }
  ]
}

/**
 * 构造一个返回固定目录的 fetch 替身，并记录请求。
 * @param payload 响应体
 * @param status HTTP 状态码
 * @returns 可注入并检查的 fetch 实现
 */
function catalogFetch(
  payload: unknown,
  status = 200
): typeof fetch & {
  mock: { calls: [string, RequestInit][] }
} {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => Buffer.from(JSON.stringify(payload), 'utf8')
  })) as unknown as typeof fetch & { mock: { calls: [string, RequestInit][] } }
}

describe('OrcaRouter provider discovery and credentials', () => {
  let stored: AiProviderStore

  beforeEach(() => {
    vi.clearAllMocks()
    stored = { version: 2, providers: [] }
    mockDbGet.mockImplementation(() => stored)
    mockDbPut.mockImplementation((_key: string, value: AiProviderStore) => {
      stored = value
      return { ok: true }
    })
    vi.unstubAllGlobals()
  })

  /**
   * 创建一个已保存凭据的 OrcaRouter 供应商。
   * @param source 凭据来源
   * @returns 已保存的供应商
   */
  function seedOrcaProvider(source: 'api-key' | 'pkce'): AiProvider {
    const provider: AiProvider = {
      id: 'orca-provider',
      name: 'OrcaRouter',
      apiUrl: 'https://api.orcarouter.ai/v1',
      apiKey: 'sk-orca-seeded',
      apiFormat: 'openai-chat',
      enabled: true,
      presetId: 'orcarouter',
      selectedModels: [],
      credential: {
        source,
        key: 'sk-orca-seeded',
        scope: 'api',
        generation: 1,
        status: 'active',
        updatedAt: 1
      }
    }
    stored = { version: 2, providers: [provider] }
    return provider
  }

  it('keeps OrcaRouter as a first-class named provider preset', () => {
    seedOrcaProvider('api-key')
    const result = aiProviderService.discoverModels
    expect(typeof result).toBe('function')
    expect(aiProviderService.getStore().providers[0].presetId).toBe('orcarouter')
  })

  it('binds both authentication entry points to the same downstream credential', async () => {
    seedOrcaProvider('api-key')

    // API Key adapter 路径。
    const apiKeyResult = await new OrcaApiKeyAdapter().acquire({
      source: 'api-key',
      key: 'sk-orca-same-shape'
    })
    const apiKeyCredential = persistOrcaCredential(
      {
        read: () => stored.providers[0].credential ?? null,
        write: (credential) => {
          stored.providers[0].credential = credential
        },
        clear: () => undefined
      },
      'api-key',
      apiKeyResult
    )

    // PKCE adapter 路径产出同一种结果结构。
    const pkceResult = { key: 'sk-orca-same-shape', scope: 'api', userId: 'u-9' }
    const pkceCredential = persistOrcaCredential(
      {
        read: () => stored.providers[0].credential ?? null,
        write: (credential) => {
          stored.providers[0].credential = credential
        },
        clear: () => undefined
      },
      'pkce',
      pkceResult
    )

    expect(apiKeyResult).toMatchObject({ key: 'sk-orca-same-shape', scope: 'api' })
    expect(Object.keys(apiKeyResult).sort()).toEqual(['key', 'scope'])
    expect(pkceCredential.generation).toBe(apiKeyCredential.generation + 1)

    // 下游只读取同一把密钥，不关心凭据来源。
    const resolved = resolveProviderCredential(stored.providers[0])
    expect(resolved).toMatchObject({ key: 'sk-orca-same-shape', needsReauth: false })
    expect(pkceCredential.source).toBe('pkce')
    expect(apiKeyCredential.source).toBe('api-key')
  })

  it('discovers text models from the live capability-filtered catalog', async () => {
    seedOrcaProvider('pkce')
    const fetchImpl = catalogFetch(CATALOG_RESPONSE)
    const result = await aiProviderService.discoverModels(
      {
        providerId: 'orca-provider',
        apiUrl: 'https://api.orcarouter.ai/v1',
        capability: 'chat'
      },
      { fetchImpl }
    )

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.orcarouter.ai/v1/models?capability=chat')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-orca-seeded')
    expect(result.degraded).toBe(false)
    expect(result.live).toBe(true)
    // 图片生成模型不得出现在文本入口的下拉中。
    expect(result.models.map((model) => model.id)).toEqual([
      'openai/gpt-5.5',
      'deepseek/deepseek-v4-pro'
    ])
  })

  it('narrows selector options to image-capable chat models after an attachment', async () => {
    seedOrcaProvider('pkce')
    const result = await aiProviderService.discoverModels(
      {
        providerId: 'orca-provider',
        apiUrl: 'https://api.orcarouter.ai/v1',
        capability: 'chat',
        requiredModalities: ['image']
      },
      { fetchImpl: catalogFetch(CATALOG_RESPONSE) }
    )

    // 仅声明 text 输入的对话模型必须被排除，未声明能力的模型同样 fail closed。
    expect(result.models.map((model) => model.id)).toEqual(['openai/gpt-5.5'])
  })

  it('filters the image-generation entry to image-generation endpoints only', async () => {
    seedOrcaProvider('api-key')
    const result = await aiProviderService.discoverModels(
      {
        providerId: 'orca-provider',
        apiUrl: 'https://api.orcarouter.ai/v1',
        capability: 'image'
      },
      { fetchImpl: catalogFetch(CATALOG_RESPONSE) }
    )

    expect(result.models.map((model) => model.id)).toEqual(['google/imagen-4.0-fast-generate-001'])
  })

  it('degrades to the verified seed with metadata intact and never to free text', async () => {
    seedOrcaProvider('api-key')
    const failing = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const result = await aiProviderService.discoverModels(
      {
        providerId: 'orca-provider',
        apiUrl: 'https://api.orcarouter.ai/v1',
        capability: 'chat'
      },
      { fetchImpl: failing }
    )

    expect(result.live).toBe(false)
    expect(result.degraded).toBe(true)
    expect(result.error).toBeTruthy()
    const ids = result.models.map((model) => model.id)
    expect(ids).toContain('openai/gpt-5.5')
    expect(ids).toContain('orcarouter/auto')

    // 降级时仍保留已验证的推理档位与输入模态，不能只剩模型 ID。
    const gpt = result.models.find((model) => model.id === 'openai/gpt-5.5')
    expect(gpt?.contextWindow).toBe(400_000)
    expect(gpt?.inputModalities).toEqual(['text', 'image'])
    expect(Object.keys(gpt?.reasoning?.efforts ?? {}).sort()).toEqual([
      'high',
      'low',
      'medium',
      'xhigh'
    ])
  })

  it('keeps non-OrcaRouter providers on their existing /models behaviour', async () => {
    const provider: AiProvider = {
      id: 'custom-provider',
      name: 'Custom',
      apiUrl: 'https://custom.example.test/v1',
      apiKey: 'sk-custom',
      apiFormat: 'openai-chat',
      enabled: true,
      selectedModels: []
    }
    stored = { version: 2, providers: [provider] }

    // 非 OrcaRouter 供应商仍走原有的 /models 路径，且不会接触目录逻辑。
    const spy = vi
      .spyOn(aiProviderService, 'fetchRemoteModels')
      .mockResolvedValue([{ id: 'custom-model' }])
    const result = await aiProviderService.discoverModels({
      providerId: 'custom-provider',
      apiUrl: provider.apiUrl
    })
    expect(spy).toHaveBeenCalledWith(provider.apiUrl, 'sk-custom')
    expect(result).toMatchObject({ degraded: false, live: true })
    expect(result.models).toEqual([{ id: 'custom-model' }])
    spy.mockRestore()
  })

  it('marks only the rejected credential generation as needing reauthentication', () => {
    seedOrcaProvider('pkce')
    const applied = aiProviderService.markCredentialNeedsReauth('orca-provider', 99)
    expect(applied.success).toBe(true)
    expect(stored.providers[0].credential?.status).toBe('active')

    const rejected = aiProviderService.markCredentialNeedsReauth('orca-provider', 1)
    expect(rejected.success).toBe(true)
    expect(stored.providers[0].credential?.status).toBe('needsReauth')
    // 旧密钥保留到新登录成功之前，不做静默删除。
    expect(stored.providers[0].credential?.key).toBe('sk-orca-seeded')
    expect(resolveProviderCredential(stored.providers[0])?.needsReauth).toBe(true)
  })

  it('clears the credential only on an explicit logout', () => {
    seedOrcaProvider('api-key')
    const cleared = aiProviderService.clearCredential('orca-provider')
    expect(cleared.success).toBe(true)
    expect(stored.providers[0].credential).toBeUndefined()
    expect(stored.providers[0].apiKey).toBe('')
  })
})
