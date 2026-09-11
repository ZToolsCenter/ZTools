import { resolveOrcaEndpoints, type OrcaEndpointConfig, type OrcaFetch } from './orcaAuth.js'

/** AI 入口对应的能力过滤类型。 */
export type OrcaModelCapability = 'chat' | 'embedding' | 'image' | 'video' | 'rerank'

/** 目录中单条模型记录的原始结构（仅声明我们读取的字段）。 */
interface RawOrcaModel {
  id?: unknown
  supported_endpoint_types?: unknown
  architecture?: { input_modalities?: unknown } | null
}

/** 目录条目中真正影响能力过滤的元数据。 */
export interface OrcaCatalogEntry {
  /** 供应商原样的模型 ID，保留 vendor/model 命名空间。 */
  id: string
  /** 该模型支持的调用端点类型。 */
  supportedEndpointTypes: string[]
  /** 模型声明的输入模态；未声明时为空数组，必须 fail closed。 */
  inputModalities: string[]
}

/** 一次目录读取的结果。 */
export interface OrcaCatalogResult {
  /** 通过当前能力过滤的模型条目。 */
  entries: OrcaCatalogEntry[]
  /** 目录是否来自实时请求；false 表示使用了已验证的 fallback。 */
  degraded: boolean
  /** 是否为仓库内置的离线种子。 */
  seed: boolean
}

/** 目录请求允许持有的最大响应字节数。 */
const MAX_CATALOG_BYTES = 512 * 1024

/** 目录请求允许接受的最大条目数，防止异常响应占用过多内存。 */
const MAX_CATALOG_ITEMS = 2_000

/** 目录请求超时时间。 */
const CATALOG_TIMEOUT_MS = 15_000

/** 文本入口必须命中的端点类型之一。 */
const TEXT_ENDPOINT_TYPES = ['openai', 'anthropic', 'gemini', 'openai-response']

/** 明确属于非文本专用、需要从文本下拉中排除的端点类型。 */
const NON_TEXT_ENDPOINT_TYPES = ['image-generation', 'openai-video', 'jina-rerank', 'embeddings']

/**
 * 冷启动种子模型：仅在实时目录不可用时展示，并且始终标记为 degraded。
 *
 * 这些条目来自 OrcaRouter 公开目录中已验证的模型，保留命名空间与能力标注，
 * 不用于冒充完整实时列表。
 */
export const ORCAROUTER_VERIFIED_SEED: ReadonlyArray<OrcaCatalogEntry> = [
  {
    id: 'openai/gpt-5.5',
    supportedEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
    inputModalities: ['text', 'image']
  },
  {
    id: 'anthropic/claude-opus-4.8',
    supportedEndpointTypes: ['openai', 'anthropic'],
    inputModalities: ['text', 'image']
  },
  {
    id: 'google/gemini-3.5-flash',
    supportedEndpointTypes: ['openai', 'gemini', 'openai-response'],
    inputModalities: ['text', 'image']
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    supportedEndpointTypes: ['openai', 'anthropic'],
    inputModalities: ['text']
  },
  {
    id: 'orcarouter/auto',
    supportedEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
    inputModalities: ['text']
  }
]

/**
 * 将未知值归一化为字符串数组。
 * @param value 目录字段原始值
 * @returns 去重后的非空字符串列表
 */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed && !result.includes(trimmed)) result.push(trimmed)
  }
  return result
}

/**
 * 解析单条目录记录；结构不符合预期时返回 null，而不是猜测能力。
 * @param raw 目录中的单条记录
 * @returns 已解析的目录条目；ID 缺失时返回 null
 */
export function parseOrcaCatalogEntry(raw: unknown): OrcaCatalogEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as RawOrcaModel
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) return null
  return {
    id,
    supportedEndpointTypes: toStringList(record.supported_endpoint_types),
    inputModalities: toStringList(record.architecture?.input_modalities)
  }
}

/**
 * 解析目录响应体。
 * @param payload 已读取的 JSON 响应体
 * @returns 通过结构校验的条目列表
 */
export function parseOrcaCatalog(payload: unknown): OrcaCatalogEntry[] {
  const data =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { data?: unknown }).data
      : payload
  if (!Array.isArray(data)) return []

  const entries: OrcaCatalogEntry[] = []
  for (const item of data.slice(0, MAX_CATALOG_ITEMS)) {
    const entry = parseOrcaCatalogEntry(item)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * 按入口能力过滤目录条目。
 *
 * 未声明能力的模型一律 fail closed：无法从目录元数据证明兼容时不会出现在下拉中。
 *
 * @param entries 已解析的目录条目
 * @param capability 当前 AI 入口的能力类型
 * @param requiredModalities 该入口实际上传的非 text 模态（如 image）
 * @returns 与入口匹配的条目
 */
export function filterOrcaCatalog(
  entries: readonly OrcaCatalogEntry[],
  capability: OrcaModelCapability,
  requiredModalities: readonly string[] = []
): OrcaCatalogEntry[] {
  return entries.filter((entry) => {
    const endpoints = entry.supportedEndpointTypes
    switch (capability) {
      case 'chat': {
        const supported = endpoints.some((type) => TEXT_ENDPOINT_TYPES.includes(type))
        if (!supported) return false
        if (endpoints.some((type) => NON_TEXT_ENDPOINT_TYPES.includes(type))) {
          // 同时声明 image-generation / jina-rerank 等专用端点的模型不属于文本入口。
          if (!endpoints.some((type) => TEXT_ENDPOINT_TYPES.includes(type))) return false
          if (endpoints.includes('image-generation') && endpoints.length === 1) return false
        }
        // 多模态入口必须由 architecture.input_modalities 明确声明实际使用的模态。
        return requiredModalities.every((modality) => entry.inputModalities.includes(modality))
      }
      case 'embedding':
        return endpoints.includes('embeddings')
      case 'image':
        return endpoints.includes('image-generation')
      case 'video':
        return endpoints.includes('openai-video')
      case 'rerank':
        return endpoints.includes('jina-rerank')
      default:
        return false
    }
  })
}

/**
 * 从指定 origin 读取 OrcaRouter 模型目录。
 *
 * 只有返回结构合法的响应才会被接受；任何失败都抛出错误，由调用方决定是否退回种子目录。
 *
 * @param options API key、入口能力、要求模态与端点配置
 * @returns 已过滤的目录条目
 * @throws 网络失败、响应非法或上游拒绝时抛出错误
 */
export async function fetchOrcaCatalog(options: {
  apiKey: string
  capability?: OrcaModelCapability
  requiredModalities?: readonly string[]
  config?: OrcaEndpointConfig
  fetchImpl?: OrcaFetch
  timeoutMs?: number
}): Promise<OrcaCatalogEntry[]> {
  const config = options.config ?? resolveOrcaEndpoints()
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as OrcaFetch)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? CATALOG_TIMEOUT_MS)

  try {
    const url = new URL(`${config.apiBaseUrl.replace(/\/+$/, '')}/models`)
    if (options.capability) url.searchParams.set('capability', options.capability)
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.apiKey.trim()}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`模型目录请求失败（HTTP ${response.status}）`)
    }

    const buffer = await response.arrayBuffer()
    const text = Buffer.from(buffer.slice(0, MAX_CATALOG_BYTES)).toString('utf8')
    const parsed = parseOrcaCatalog(JSON.parse(text))
    if (parsed.length === 0) throw new Error('模型目录返回为空')
    return filterOrcaCatalog(parsed, options.capability ?? 'chat', options.requiredModalities)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 读取目录并按需退回已验证的种子。
 *
 * 实时目录成功时其结果就是权威目录，不会混入种子条目；失败时只返回标注为 degraded 的
 * 已验证种子，绝不退回自由文本输入。
 *
 * @param options API key、入口能力与端点配置
 * @returns 目录结果及降级标记
 */
export async function loadOrcaCatalog(options: {
  apiKey: string
  capability?: OrcaModelCapability
  requiredModalities?: readonly string[]
  config?: OrcaEndpointConfig
  fetchImpl?: OrcaFetch
}): Promise<OrcaCatalogResult> {
  try {
    const entries = await fetchOrcaCatalog(options)
    return { entries, degraded: false, seed: false }
  } catch {
    return {
      entries: filterOrcaCatalog(
        ORCAROUTER_VERIFIED_SEED,
        options.capability ?? 'chat',
        options.requiredModalities ?? []
      ),
      degraded: true,
      seed: true
    }
  }
}
