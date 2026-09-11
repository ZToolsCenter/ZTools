import { describe, expect, it, vi } from 'vitest'
import {
  fetchOrcaCatalog,
  filterOrcaCatalog,
  loadOrcaCatalog,
  parseOrcaCatalog,
  ORCAROUTER_VERIFIED_SEED,
  type OrcaCatalogEntry
} from '../../src/main/core/provider/orcaCatalog'
import { resolveOrcaEndpoints } from '../../src/main/core/provider/orcaAuth'

/** 覆盖文本、图像输入、embedding、图片生成、视频与 rerank 的目录 fixture。 */
const CATALOG_FIXTURE = {
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
      id: 'orcarouter/auto',
      object: 'model',
      supported_endpoint_types: ['openai', 'gemini'],
      architecture: { input_modalities: ['text'] }
    },
    {
      id: 'google/gemini-embedding-001',
      object: 'model',
      supported_endpoint_types: ['embeddings'],
      architecture: { input_modalities: ['text'] }
    },
    {
      id: 'google/imagen-4.0-fast-generate-001',
      object: 'model',
      supported_endpoint_types: ['image-generation'],
      architecture: { input_modalities: ['text'] }
    },
    {
      id: 'google/veo-3.0-generate-001',
      object: 'model',
      supported_endpoint_types: ['openai-video']
    },
    {
      id: 'jina/jina-reranker-v2',
      object: 'model',
      supported_endpoint_types: ['jina-rerank']
    },
    {
      // 未声明任何能力：必须 fail closed，不得按模型名猜测。
      id: 'vendor/mystery-model',
      object: 'model'
    }
  ]
}

/**
 * 构造一个返回固定 JSON 的 fetch 替身。
 * @param payload 响应体
 * @param status HTTP 状态码
 * @returns 可注入的 fetch 实现
 */
function jsonFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => Buffer.from(JSON.stringify(payload), 'utf8')
  })) as unknown as typeof fetch
}

describe('orca catalog parsing', () => {
  it('keeps vendor/model namespaces and reads declared capabilities only', () => {
    const entries = parseOrcaCatalog(CATALOG_FIXTURE)
    expect(entries).toHaveLength(8)
    expect(entries[0]).toEqual({
      id: 'openai/gpt-5.5',
      supportedEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
      inputModalities: ['text', 'image']
    })
    // 未声明能力的条目保留为空数组，而不是推断出来的能力。
    const mystery = entries.find((entry) => entry.id === 'vendor/mystery-model')
    expect(mystery?.supportedEndpointTypes).toEqual([])
    expect(mystery?.inputModalities).toEqual([])
  })

  it('drops entries without a usable id instead of guessing', () => {
    expect(
      parseOrcaCatalog({ data: [{ object: 'model' }, { id: ' ' }, { id: 'ok/model' }] })
    ).toEqual([{ id: 'ok/model', supportedEndpointTypes: [], inputModalities: [] }])
    expect(parseOrcaCatalog(null)).toEqual([])
    expect(parseOrcaCatalog({ data: 'nope' })).toEqual([])
  })
})

describe('orca catalog capability filtering', () => {
  const entries: OrcaCatalogEntry[] = parseOrcaCatalog(CATALOG_FIXTURE)

  it('keeps only text-capable chat models for the text entry', () => {
    const ids = filterOrcaCatalog(entries, 'chat').map((entry) => entry.id)
    expect(ids).toEqual(['openai/gpt-5.5', 'deepseek/deepseek-v4-pro', 'orcarouter/auto'])
    // 非文本专用模型不得混入文本下拉。
    expect(ids).not.toContain('google/gemini-embedding-001')
    expect(ids).not.toContain('google/imagen-4.0-fast-generate-001')
    expect(ids).not.toContain('google/veo-3.0-generate-001')
    expect(ids).not.toContain('jina/jina-reranker-v2')
    expect(ids).not.toContain('vendor/mystery-model')
  })

  it('fails closed for multimodal entries that do not declare the attached modality', () => {
    const ids = filterOrcaCatalog(entries, 'chat', ['image']).map((entry) => entry.id)
    expect(ids).toEqual(['openai/gpt-5.5'])
    // 仅声明 text 的对话模型必须被排除，而不是按模型名猜测。
    expect(ids).not.toContain('deepseek/deepseek-v4-pro')
    expect(ids).not.toContain('orcarouter/auto')
  })

  it('matches each non-text entry to its own endpoint type', () => {
    expect(filterOrcaCatalog(entries, 'embedding').map((entry) => entry.id)).toEqual([
      'google/gemini-embedding-001'
    ])
    expect(filterOrcaCatalog(entries, 'image').map((entry) => entry.id)).toEqual([
      'google/imagen-4.0-fast-generate-001'
    ])
    expect(filterOrcaCatalog(entries, 'video').map((entry) => entry.id)).toEqual([
      'google/veo-3.0-generate-001'
    ])
    expect(filterOrcaCatalog(entries, 'rerank').map((entry) => entry.id)).toEqual([
      'jina/jina-reranker-v2'
    ])
  })
})

describe('orca catalog fetching', () => {
  it('requests the API origin models endpoint with the requested capability', async () => {
    const fetchImpl = jsonFetch(CATALOG_FIXTURE)
    const models = await fetchOrcaCatalog({
      apiKey: 'sk-orca-fake',
      capability: 'chat',
      config: resolveOrcaEndpoints({}),
      fetchImpl
    })

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]
    expect(url).toBe('https://api.orcarouter.ai/v1/models?capability=chat')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-orca-fake')
    expect(models.map((model) => model.id)).toEqual([
      'openai/gpt-5.5',
      'deepseek/deepseek-v4-pro',
      'orcarouter/auto'
    ])
  })

  it('treats a live catalog as authoritative and never mixes in the seed', async () => {
    const result = await loadOrcaCatalog({
      apiKey: 'sk-orca-fake',
      capability: 'chat',
      config: resolveOrcaEndpoints({}),
      fetchImpl: jsonFetch(CATALOG_FIXTURE)
    })
    expect(result.degraded).toBe(false)
    expect(result.seed).toBe(false)
    expect(result.entries.map((entry) => entry.id)).not.toContain('anthropic/claude-opus-4.8')
  })

  it('falls back to the verified seed only when discovery fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const result = await loadOrcaCatalog({
      apiKey: 'sk-orca-fake',
      capability: 'chat',
      config: resolveOrcaEndpoints({}),
      fetchImpl: failing
    })

    expect(result.degraded).toBe(true)
    expect(result.seed).toBe(true)
    expect(result.entries.map((entry) => entry.id)).toEqual(
      ORCAROUTER_VERIFIED_SEED.map((entry) => entry.id)
    )
  })

  it('filters the degraded seed by the same capability rules', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const multimodal = await loadOrcaCatalog({
      apiKey: 'sk-orca-fake',
      capability: 'chat',
      requiredModalities: ['image'],
      config: resolveOrcaEndpoints({}),
      fetchImpl: failing
    })
    // 种子中未声明 image 输入的模型在附加图片后同样必须被排除。
    expect(multimodal.entries.map((entry) => entry.id)).toEqual([
      'openai/gpt-5.5',
      'anthropic/claude-opus-4.8',
      'google/gemini-3.5-flash'
    ])

    const emptyEmbedding = await loadOrcaCatalog({
      apiKey: 'sk-orca-fake',
      capability: 'embedding',
      config: resolveOrcaEndpoints({}),
      fetchImpl: failing
    })
    expect(emptyEmbedding.entries).toEqual([])
    expect(emptyEmbedding.degraded).toBe(true)
  })

  it('bounds the catalog request and rejects unusable responses', async () => {
    await expect(
      fetchOrcaCatalog({
        apiKey: 'sk-orca-fake',
        config: resolveOrcaEndpoints({}),
        fetchImpl: jsonFetch({ data: [] })
      })
    ).rejects.toThrow()
    await expect(
      fetchOrcaCatalog({
        apiKey: 'sk-orca-fake',
        config: resolveOrcaEndpoints({}),
        fetchImpl: jsonFetch({ data: [] }, 503)
      })
    ).rejects.toThrow()
  })
})
