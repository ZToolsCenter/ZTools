/** AI 供应商配置的当前存储版本。 */
export const AI_PROVIDER_STORE_VERSION = 2 as const

/** AI 供应商采用的接口协议格式。 */
export type AiApiFormat = 'openai-chat' | 'anthropic-messages' | 'openai-responses'

/** 新增或历史数据缺失时使用的默认接口格式。 */
export const DEFAULT_AI_API_FORMAT: AiApiFormat = 'openai-chat'

/** 供应商接口格式选项，供设置界面复用。 */
export const AI_API_FORMAT_OPTIONS: ReadonlyArray<{ value: AiApiFormat; label: string }> = [
  { value: 'openai-chat', label: 'OpenAI Chat Completions' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'openai-responses', label: 'OpenAI Responses API' }
]

/** 插件未单独配置时使用的模型上下文窗口。 */
export const DEFAULT_AI_CONTEXT_WINDOW = 262_144

/** 模型支持的输入模态。 */
export type AiInputModality = 'text' | 'image'

/** OpenAI 兼容模型的推理请求协议。 */
export type AiReasoningProtocol = 'auto' | 'passthrough' | 'openai-compatible' | 'deepseek'

/** 统一推理强度标识；供应商协议值由模型映射单独保存。 */
export type AiReasoningEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** 推理强度的稳定顺序，供配置规范化和界面选项复用。 */
export const AI_REASONING_EFFORTS: readonly AiReasoningEffort[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

/** 供应商返回推理文本时使用的字段。 */
export type AiReasoningResponseField =
  | 'auto'
  | 'reasoning_content'
  | 'reasoning'
  | 'reasoning_text'
  | 'reasoning_details'

/** 标准推理档位到供应商实际协议值的映射。 */
export type AiReasoningEffortMap = Partial<Record<AiReasoningEffort, string | null>>

/** 单个模型已明确声明的推理适配配置。 */
export interface AiReasoningConfig {
  protocol: AiReasoningProtocol
  /** 模型支持的标准档位及供应商实际接收的值。 */
  efforts: AiReasoningEffortMap
  /** 调用方未明确选择时使用的档位；缺省时保留供应商默认行为。 */
  defaultEffort?: AiReasoningEffort
  responseField: AiReasoningResponseField
}

/** 模型推理能力；false 表示明确不支持，缺省表示能力未知。 */
export type AiReasoningCapability = false | AiReasoningConfig

/** 插件模型选择器展示的单个推理档位。 */
export interface AiReasoningEffortChoice {
  id: AiReasoningEffort
  label: string
}

/** 插件可见的模型推理能力，不暴露供应商协议映射。 */
export interface AiModelReasoningInfo {
  efforts: AiReasoningEffortChoice[]
  defaultEffort?: AiReasoningEffort
}

/** 模型调用所需的公开能力元数据。 */
export interface AiModelCapabilities {
  contextWindow: number
  inputModalities: AiInputModality[]
  reasoning?: AiReasoningCapability
}

/** 旧版按单个模型保存的配置。 */
export interface LegacyAiModel {
  id: string
  label: string
  apiUrl: string
  apiKey: string
  description?: string
  icon?: string
  cost?: number
}

/** 供应商中已选中的单个远端模型。 */
export interface AiProviderModel {
  /** 插件选择模型时使用的稳定、不透明标识。 */
  ref: string
  /** 供应商改名等场景产生的历史公开选择 ID。 */
  aliases?: string[]
  /** 发送给远端 OpenAI 兼容接口的真实模型 ID。 */
  modelId: string
  description?: string
  icon?: string
  cost?: number
  contextWindow?: number
  inputModalities?: AiInputModality[]
  reasoning?: AiReasoningCapability
}

/** 单个 AI 供应商及其已选模型。 */
export interface AiProvider {
  id: string
  name: string
  apiUrl: string
  apiKey: string
  /** 供应商采用的接口格式。 */
  apiFormat: AiApiFormat
  /** 是否允许插件发现和调用该供应商的模型。 */
  enabled: boolean
  selectedModels: AiProviderModel[]
}

/** AI 供应商持久化文档。 */
export interface AiProviderStore {
  version: typeof AI_PROVIDER_STORE_VERSION
  providers: AiProvider[]
}

/** 新建或编辑供应商时提交的模型。 */
export interface AiProviderModelInput {
  modelId: string
  description?: string
  icon?: string
  cost?: number
  contextWindow?: number
  inputModalities?: AiInputModality[]
  /** null 表示显式清除旧推理配置并恢复供应商默认。 */
  reasoning?: AiReasoningCapability | null
}

/** 新建或编辑供应商时提交的数据。 */
export interface AiProviderInput {
  id?: string
  name: string
  apiUrl: string
  apiKey: string
  /** 供应商采用的接口格式；缺省时回退到默认格式。 */
  apiFormat?: AiApiFormat
  selectedModels: AiProviderModelInput[]
}

/** 从供应商接口拉取到的远端模型摘要。 */
export interface AiRemoteModel {
  id: string
}

/** 暴露给插件用于构建模型选择器的条目。 */
export interface AiModelChoice {
  /** 兼容旧插件的可读选择 ID，格式为“供应商 - 远端模型 ID”。 */
  id: string
  /** 新插件应优先使用的稳定、不透明选择 ID。 */
  value: string
  label: string
  providerId: string
  providerLabel: string
  modelId: string
  description: string
  icon: string
  cost: number
  contextWindow: number
  inputModalities: AiInputModality[]
  reasoning?: AiModelReasoningInfo
}

/** 推理档位的默认展示名称。 */
const AI_REASONING_EFFORT_LABELS: Readonly<Record<AiReasoningEffort, string>> = {
  off: '关闭',
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高'
}

/** 旧版推理强度中“关闭”的字段值。 */
type LegacyAiReasoningEffort = AiReasoningEffort | 'none'

/**
 * 将旧版或新版推理档位规范化为当前稳定标识。
 * @param value 待规范化的档位值
 * @returns 当前支持的档位；无效值返回 undefined
 */
export function normalizeAiReasoningEffort(value: unknown): AiReasoningEffort | undefined {
  if (value === 'none') return 'off'
  return AI_REASONING_EFFORTS.includes(value as AiReasoningEffort)
    ? (value as AiReasoningEffort)
    : undefined
}

/**
 * 规范化模型声明的推理能力，并兼容旧版 effort/supportedEfforts 结构。
 * @param value 模型保存的推理配置
 * @returns 三态推理能力；缺省表示能力未知
 */
export function normalizeAiReasoningCapability(value: unknown): AiReasoningCapability | undefined {
  if (value === false) return false
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const source = value as Record<string, unknown>
  const rawEfforts =
    source.efforts && typeof source.efforts === 'object' && !Array.isArray(source.efforts)
      ? (source.efforts as Record<string, unknown>)
      : {}
  const efforts: AiReasoningEffortMap = {}

  // 新版映射只接纳已声明档位；非 off 档位必须具备可发送的协议值。
  for (const effort of AI_REASONING_EFFORTS) {
    const wireValue = rawEfforts[effort]
    if (wireValue === null && effort === 'off') efforts[effort] = null
    else if (typeof wireValue === 'string' && wireValue.trim()) {
      efforts[effort] = wireValue.trim()
    }
  }

  // 旧结构的列表使用标准值直传；none 保留为供应商 wire value 并升级为 off。
  const legacySupported = Array.isArray(source.supportedEfforts)
    ? (source.supportedEfforts as LegacyAiReasoningEffort[])
    : []
  for (const legacyEffort of legacySupported) {
    const effort = normalizeAiReasoningEffort(legacyEffort)
    if (!effort || effort in efforts) continue
    efforts[effort] = legacyEffort === 'none' ? 'none' : effort
  }

  const legacyDefault = normalizeAiReasoningEffort(source.effort)
  if (legacyDefault && !(legacyDefault in efforts)) {
    efforts[legacyDefault] = source.effort === 'none' ? 'none' : legacyDefault
  }
  if (Object.keys(efforts).length === 0) return undefined

  const protocolValues: AiReasoningProtocol[] = [
    'auto',
    'passthrough',
    'openai-compatible',
    'deepseek'
  ]
  const responseFieldValues: AiReasoningResponseField[] = [
    'auto',
    'reasoning_content',
    'reasoning',
    'reasoning_text',
    'reasoning_details'
  ]
  const requestedDefault = normalizeAiReasoningEffort(source.defaultEffort ?? source.effort)
  const defaultEffort =
    requestedDefault && requestedDefault in efforts ? requestedDefault : undefined
  return {
    protocol: protocolValues.includes(source.protocol as AiReasoningProtocol)
      ? (source.protocol as AiReasoningProtocol)
      : 'auto',
    efforts,
    ...(defaultEffort === undefined ? {} : { defaultEffort }),
    responseField: responseFieldValues.includes(source.responseField as AiReasoningResponseField)
      ? (source.responseField as AiReasoningResponseField)
      : 'auto'
  }
}

/**
 * 将宿主内部推理能力转换为插件可见的选择器元数据。
 * @param capability 已规范化的模型推理能力
 * @returns 可公开的档位列表；能力未知或明确不支持时返回 undefined
 */
export function toAiModelReasoningInfo(
  capability: AiReasoningCapability | undefined
): AiModelReasoningInfo | undefined {
  if (!capability) return undefined
  const efforts = AI_REASONING_EFFORTS.filter((effort) => effort in capability.efforts).map(
    (id) => ({ id, label: AI_REASONING_EFFORT_LABELS[id] })
  )
  if (efforts.length === 0) return undefined
  return {
    efforts,
    ...(capability.defaultEffort === undefined ? {} : { defaultEffort: capability.defaultEffort })
  }
}

/**
 * 规范化模型的上下文、输入模态和推理配置。
 * @param value 可能来自旧存储或设置表单的模型配置
 * @returns 可安全暴露给插件的完整能力元数据
 */
export function normalizeAiModelCapabilities(
  value?: Partial<AiProviderModel | AiProviderModelInput>
): AiModelCapabilities {
  const contextWindow = Math.min(
    2_000_000,
    Math.max(4_096, Math.round(Number(value?.contextWindow) || DEFAULT_AI_CONTEXT_WINDOW))
  )
  const modalities: AiInputModality[] = Array.isArray(value?.inputModalities)
    ? value.inputModalities.filter(
        (item): item is AiInputModality => item === 'text' || item === 'image'
      )
    : ['text']
  const reasoning = normalizeAiReasoningCapability(value?.reasoning)
  return {
    contextWindow,
    inputModalities: Array.from(new Set<AiInputModality>(['text', ...modalities])),
    ...(reasoning === undefined ? {} : { reasoning })
  }
}

/** AI 供应商管理操作的统一结果。 */
export interface AiProviderMutationResult {
  success: boolean
  data?: AiProviderStore
  error?: string
}

/**
 * 判断未知数据是否为新版 AI 供应商文档。
 * @param value 待判断的持久化数据
 * @returns 是否为版本 2 的供应商文档
 */
export function isAiProviderStore(value: unknown): value is AiProviderStore {
  if (!value || typeof value !== 'object') return false

  const store = value as Partial<AiProviderStore>
  return store.version === AI_PROVIDER_STORE_VERSION && Array.isArray(store.providers)
}

/**
 * 规范化 OpenAI 兼容接口地址，避免尾部斜杠造成同一供应商被拆成多组。
 * @param apiUrl 用户填写的接口地址
 * @returns 去除首尾空白和尾部斜杠后的地址
 */
export function normalizeAiApiUrl(apiUrl: string): string {
  return apiUrl.trim().replace(/\/+$/, '')
}

/**
 * 将任意值归一化为合法的接口格式，非法或缺失时回退到默认格式。
 * @param value 待归一化的接口格式
 * @returns 合法的接口格式
 */
export function normalizeAiApiFormat(value: unknown): AiApiFormat {
  for (const option of AI_API_FORMAT_OPTIONS) {
    if (value === option.value) return option.value
  }
  return DEFAULT_AI_API_FORMAT
}
