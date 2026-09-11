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

/** 单个模型可接受的温度配置。 */
export type AiTemperatureCapability =
  | false
  | { mode: 'fixed'; value: number }
  | { mode: 'range'; min: number; max: number; default: number }

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
  /** 调用方未明确选择时使用的档位；历史输入缺省时规范化为首个自定义档位。 */
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
  temperature?: AiTemperatureCapability
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

/** OrcaRouter 官方推理 origin（含 `/v1`）；认证使用不同的 origin。 */
export const ORCAROUTER_API_BASE_URL = 'https://api.orcarouter.ai/v1'

/** OrcaRouter 官方认证 origin；授权与授权码兑换都发往这里。 */
export const ORCAROUTER_AUTH_BASE_URL = 'https://www.orcarouter.ai'

/** OrcaRouter 密钥控制台地址，供设置页展示。 */
export const ORCAROUTER_CONSOLE_URL = 'https://www.orcarouter.ai/console/authorized-apps'

/** 已声明为 first-class 的供应商预设 ID。 */
export type AiProviderPresetId = 'custom' | 'orcarouter'

/** 供应商预设：用于把具名供应商接入配置与模型发现。 */
export interface AiProviderPreset {
  id: AiProviderPresetId
  /** 预设展示名称，作为新建供应商时的默认名称。 */
  name: string
  /** 默认接口地址。 */
  apiUrl: string
  apiFormat: AiApiFormat
  /** 支持的认证入口；空数组表示仅支持手填密钥。 */
  authMethods: OrcaCredentialSource[]
}

/** 凭据来源：手填 API Key，或 OAuth 2.0 + PKCE 授权。 */
export type OrcaCredentialSource = 'api-key' | 'pkce'

/** 凭据状态；`needsReauth` 表示上游已拒绝该代次凭据。 */
export type OrcaCredentialStatus = 'active' | 'needsReauth'

/**
 * 一条已持久化的 OrcaRouter 凭据。
 *
 * 两种认证入口都只产生同一个普通 OrcaRouter API key，下游不区分来源。
 */
export interface AiProviderCredential {
  source: OrcaCredentialSource
  key: string
  scope: string
  userId?: string
  /** 单调递增的代次；迟到的失败不得污染重新登录后的新凭据。 */
  generation: number
  status: OrcaCredentialStatus
  updatedAt: number
}

/** 暴露给界面的凭据状态；永远不包含密钥本体。 */
export interface AiProviderCredentialView {
  providerId: string
  /** 是否已配置可用凭据。 */
  configured: boolean
  presetId?: AiProviderPresetId
  /** 当前凭据来自哪个认证入口。 */
  source?: OrcaCredentialSource
  status?: OrcaCredentialStatus
  scope?: string
  /** 已脱敏的密钥，仅用于确认“已保存了哪一把”。 */
  maskedKey?: string
  updatedAt?: number
}

/** 供应商预设注册表；OrcaRouter 在此作为具名供应商出现。 */
export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'custom',
    name: '',
    apiUrl: '',
    apiFormat: DEFAULT_AI_API_FORMAT,
    authMethods: []
  },
  {
    id: 'orcarouter',
    name: 'OrcaRouter',
    apiUrl: ORCAROUTER_API_BASE_URL,
    apiFormat: 'openai-chat',
    // 两种入口始终并列可用：没有浏览器也能用手填密钥，没有密钥也能用 PKCE 登录。
    authMethods: ['api-key', 'pkce']
  }
]

/**
 * 判断供应商是否为 OrcaRouter 预设（按预设 ID，或按官方接口地址兜底）。
 * @param provider 供应商或其配置片段
 * @returns 是否为 OrcaRouter 供应商
 */
export function isOrcaRouterProvider(provider: { presetId?: string; apiUrl?: string }): boolean {
  if (provider?.presetId === 'orcarouter') return true
  return normalizeAiApiUrl(provider?.apiUrl ?? '') === ORCAROUTER_API_BASE_URL
}

/**
 * 判断未知值是否为已持久化的 OrcaRouter 凭据。
 * @param value 待判断的持久化数据
 * @returns 是否为合法的凭据结构
 */
export function isAiProviderCredential(value: unknown): value is AiProviderCredential {
  if (!value || typeof value !== 'object') return false
  const credential = value as Partial<AiProviderCredential>
  return (
    (credential.source === 'api-key' || credential.source === 'pkce') &&
    typeof credential.key === 'string' &&
    credential.key.length > 0 &&
    typeof credential.generation === 'number' &&
    (credential.status === 'active' || credential.status === 'needsReauth')
  )
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
  temperature?: AiTemperatureCapability
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
  /** 命中的预设 ID；OrcaRouter 由此在配置中保持 first-class。 */
  presetId?: AiProviderPresetId
  /** 统一凭据；API Key 与 PKCE 两种入口都写入这里，下游不区分来源。 */
  credential?: AiProviderCredential
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
  /** 供应商目录中该模型声明的端点类型，用于能力过滤。 */
  supportedEndpointTypes?: string[]
  /** null 表示显式清除旧推理配置并恢复供应商默认。 */
  reasoning?: AiReasoningCapability | null
  temperature?: AiTemperatureCapability | null
}

/** 新建或编辑供应商时提交的数据。 */
export interface AiProviderInput {
  id?: string
  name: string
  apiUrl: string
  apiKey: string
  /** 供应商采用的接口格式；缺省时回退到默认格式。 */
  apiFormat?: AiApiFormat
  /** 供应商预设 ID；OrcaRouter 由此获得具名供应商身份。 */
  presetId?: AiProviderPresetId
  /** 统一凭据；null 表示显式清除（例如退出登录）。 */
  credential?: AiProviderCredential | null
  selectedModels: AiProviderModelInput[]
}

/** 模型目录发现使用的 AI 入口能力。 */
export type AiModelCapability = 'chat' | 'embedding' | 'image' | 'video' | 'rerank'

/** 模型目录发现请求。 */
export interface AiModelDiscoveryRequest {
  /** 目标供应商内部 ID；缺省时按接口地址识别。 */
  providerId?: string
  apiUrl: string
  /** 可选密钥；缺省时从供应商已保存的凭据读取。 */
  apiKey?: string
  /** 当前入口能力，决定下拉中可出现的模型。 */
  capability?: AiModelCapability
  /** 该入口实际上传的非 text 模态；未声明能力的模型会被排除。 */
  requiredModalities?: AiInputModality[]
}

/** 模型目录发现结果。 */
export interface AiModelDiscoveryResult {
  models: AiRemoteModel[]
  /** 是否退回到已验证的冷启动种子。 */
  degraded: boolean
  /** 目录是否来自实时请求。 */
  live: boolean
  /** 降级原因，仅在 degraded 时提供。 */
  error?: string
}

/** 从供应商接口拉取到的远端模型摘要。 */
export interface AiRemoteModel {
  id: string
  /** 供应商声明的端点类型；未声明时为空数组，能力过滤必须 fail closed。 */
  supportedEndpointTypes?: string[]
  /** 供应商声明的输入模态；未声明时为空数组。 */
  inputModalities?: string[]
  /** 该模型是否通过当前入口的能力过滤。 */
  compatible?: boolean
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
  temperature?: AiTemperatureCapability
}

/** ZTools Server 返回的官方模型思考档位。 */
export interface OfficialAiReasoningEffort {
  id: AiReasoningEffort
  label: string
}

/** ZTools Server 返回的单个官方模型。 */
export interface OfficialAiModel {
  id: string
  choiceId: string
  name: string
  icon?: string
  family: string
  enabled: boolean
  capabilities: {
    chat: boolean
    tools: boolean
    stream: boolean
    contextWindow: number
    inputModalities: AiInputModality[]
    reasoning: {
      supported: boolean
      requestMode?: AiReasoningProtocol
      efforts: OfficialAiReasoningEffort[]
      effortMappings?: AiReasoningEffortMap
      defaultEffort?: AiReasoningEffort
      responseField?: AiReasoningResponseField
    }
    temperature?:
      | { mode: 'unsupported' }
      | { mode: 'fixed'; value: number }
      | { mode: 'range'; min: number; max: number; default: number }
  }
  pricing?: {
    unit: string
    input: string
    output: string
    cacheRead: string
  }
}

/** ZTools Server 返回的官方模型目录。 */
export interface OfficialAiModelCatalog {
  provider: { id: string; name: string }
  models: OfficialAiModel[]
}

/** 设置页使用的官方模型供应商状态。 */
export interface OfficialAiProviderStatus {
  loggedIn: boolean
  catalog: OfficialAiModelCatalog
}

/** 当前 ZTools 账号的官方 AI 积分。 */
export interface OfficialAiCreditAccount {
  balance: string
  totalRecharged: string
  syncedAt: number
  provisioned: boolean
  syncStatus: string
}

/** Server 返回的官方 AI 每日签到活动。 */
export interface OfficialAiCheckinCampaign {
  id: number
  name: string
  rewardAmount: string
  startDate: string
  endDate: string
  enabled: boolean
  status: 'active' | 'upcoming' | 'ended' | 'disabled'
}

/** 当前账号今天的官方 AI 签到状态。 */
export interface OfficialAiCheckinStatus {
  available: boolean
  serverDate: string
  campaign?: OfficialAiCheckinCampaign
  checkedIn: boolean
  status?: 'pending' | 'retry' | 'credited'
  rewardAmount?: string
  creditedAt?: number
  balance?: string
}

/** 爱发电支付订单在 ZTools 与 Server 之间共享的状态。 */
export interface OfficialAiRechargeOrder {
  id: string
  amount: string
  creditAmount: string
  status:
    | 'pending'
    | 'crediting'
    | 'paid_pending_credit'
    | 'credited'
    | 'amount_mismatch'
    | 'failed'
    | 'expired'
  paymentUrl?: string
  expiresAt: number
  paidAt?: number
  creditedAt?: number
  createdAt: number
  updatedAt: number
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
  const supportedEfforts = AI_REASONING_EFFORTS.filter((effort) => effort in efforts)
  const requestedDefault = normalizeAiReasoningEffort(source.defaultEffort ?? source.effort)
  // 自定义能力始终具备明确默认档位，避免缺省值重新落入供应商默认语义。
  const defaultEffort =
    requestedDefault && requestedDefault in efforts ? requestedDefault : supportedEfforts[0]
  return {
    protocol: protocolValues.includes(source.protocol as AiReasoningProtocol)
      ? (source.protocol as AiReasoningProtocol)
      : 'auto',
    efforts,
    defaultEffort,
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
 * 规范化模型的上下文、输入模态、推理和温度配置。
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
  const temperature = normalizeAiTemperatureCapability(value?.temperature)
  const normalizedModalities = Array.from(new Set<AiInputModality>(modalities))
  if (normalizedModalities.length === 0) normalizedModalities.push('text')
  return {
    contextWindow,
    inputModalities: normalizedModalities,
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(temperature === undefined ? {} : { temperature })
  }
}

/**
 * 规范化模型温度能力，拒绝越界值；未声明能力时不推断温度默认值。
 * @param value 模型保存的温度配置
 * @returns 可安全用于请求适配器的温度能力
 */
export function normalizeAiTemperatureCapability(
  value: unknown
): AiTemperatureCapability | undefined {
  if (value === false) return false
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const mode = source.mode
  if (mode === 'fixed') {
    const fixed = Number(source.value)
    return Number.isFinite(fixed) && fixed >= 0 && fixed <= 2 ? { mode, value: fixed } : undefined
  }
  if (mode === 'range') {
    const min = Number(source.min)
    const max = Number(source.max)
    const defaultValue = Number(source.default)
    return Number.isFinite(min) &&
      Number.isFinite(max) &&
      Number.isFinite(defaultValue) &&
      min >= 0 &&
      max <= 2 &&
      min <= defaultValue &&
      defaultValue <= max
      ? { mode, min, max, default: defaultValue }
      : undefined
  }
  if (mode === 'unsupported') return false
  return undefined
}

/**
 * 冷启动种子模型已验证的能力元数据。
 *
 * 仅在实时目录不可用时用于生成降级目录；条目不冒充完整实时列表，且始终标记 degraded。
 * 保留已验证的上下文窗口、输入模态与推理档位，避免降级时丢失能力信息。
 */
export const ORCAROUTER_SEED_MODEL_METADATA: Readonly<
  Record<string, Pick<AiProviderModel, 'contextWindow' | 'inputModalities' | 'reasoning'>>
> = {
  'openai/gpt-5.5': {
    contextWindow: 400_000,
    inputModalities: ['text', 'image'],
    // 已验证的推理档位；协议值由宿主持有，插件只看到标准档位。
    reasoning: {
      protocol: 'openai-compatible',
      efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
      defaultEffort: 'medium',
      responseField: 'auto'
    }
  },
  'anthropic/claude-opus-4.8': {
    contextWindow: 200_000,
    inputModalities: ['text', 'image'],
    reasoning: {
      protocol: 'auto',
      efforts: { low: 'low', medium: 'medium', high: 'high' },
      defaultEffort: 'medium',
      responseField: 'auto'
    }
  },
  'google/gemini-3.5-flash': {
    contextWindow: 1_000_000,
    inputModalities: ['text', 'image']
  },
  'deepseek/deepseek-v4-pro': {
    contextWindow: 128_000,
    inputModalities: ['text']
  },
  'orcarouter/auto': {
    contextWindow: 262_144,
    inputModalities: ['text']
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
