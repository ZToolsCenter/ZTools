import {
  normalizeAiReasoningEffort,
  type AiApiFormat,
  type AiReasoningCapability,
  type AiReasoningEffort
} from '../../shared/aiProviderShared.js'

/** OpenAI Chat Completions 支持的文本内容块。 */
export interface AiTextContentPart {
  type: 'text'
  text: string
}

/** OpenAI Chat Completions 支持的图片内容块。 */
export interface AiImageContentPart {
  type: 'image_url'
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
}

/** 插件可提交的消息。 */
export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<AiTextContentPart | AiImageContentPart>
  reasoning_content?: string
  tool_calls?: AiToolCall[]
  tool_call_id?: string
  name?: string
  /** 由宿主返回并由插件原样带回的协议私有回放状态。 */
  replay_state?: AiChatReplayState
}

/** 可跨 IPC 和插件存储边界安全传递的协议原生回放状态。 */
export interface AiChatReplayState {
  version: 1
  apiFormat: AiApiFormat
  providerId: string
  model: string
  response?: Record<string, unknown>
  blocks?: Array<Record<string, unknown>>
}

/**
 * 检查回放状态是否属于当前协议、供应商和模型。
 * @param state 插件历史消息携带的未知回放状态
 * @param apiFormat 当前供应商协议
 * @param providerId 当前供应商 ID
 * @param model 当前远端模型 ID
 * @returns 状态可由当前适配器原生回放时返回 true
 */
export function isCompatibleAiChatReplayState(
  state: unknown,
  apiFormat: AiApiFormat,
  providerId: string,
  model: string
): state is AiChatReplayState {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false
  const value = state as Record<string, unknown>
  return (
    value.version === 1 &&
    value.apiFormat === apiFormat &&
    value.providerId === providerId &&
    value.model === model &&
    (value.blocks === undefined || Array.isArray(value.blocks))
  )
}

/** 单个 Function Calling 工具定义。 */
export interface AiChatTool {
  type: 'function'
  function?: {
    name: string
    description: string
    parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  }
}

/** 完整工具调用。 */
export interface AiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** 单轮 AI 请求选项。 */
export interface AiChatOption {
  model?: string
  messages: AiChatMessage[]
  tools?: AiChatTool[]
  toolChoice?: 'auto' | 'none' | 'required'
  /** 当前请求选择的标准推理档位；缺省时使用模型默认或供应商默认。 */
  reasoningEffort?: AiReasoningEffort | 'none'
  /** @deprecated 兼容早期插件，仅读取其中的 effort。 */
  reasoning?: { effort?: AiReasoningEffort | 'none' }
  /** 宿主解析模型后注入的内部推理能力，不接受插件自行声明。 */
  modelReasoning?: AiReasoningCapability
  temperature?: number
  maxTokens?: number
  timeout?: number
  streamBatchIntervalMs?: number
}

/** 单轮流式事件。 */
export type AiChatEvent =
  | { type: 'request'; requestId: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'reasoning_end' }
  | { type: 'content'; delta: string }
  | {
      type: 'tool_call'
      index: number
      id: string
      name: string
      argumentsDelta: string
    }
  | { type: 'usage'; usage: AiTokenUsage }

/** 统一 token 用量。 */
export interface AiTokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  reasoning_tokens?: number
}

/** 单轮完整响应。 */
export interface AiChatResult {
  role: 'assistant'
  content: string | null
  reasoning_content: string | null
  tool_calls: AiToolCall[]
  finish_reason: string
  usage?: AiTokenUsage
  replay_state?: AiChatReplayState
}

/** 协议适配器接收的单轮流式输入。 */
export interface AiChatProtocolInput {
  model: string
  messages: AiChatMessage[]
  tools?: AiChatTool[]
  toolChoice?: 'auto' | 'none' | 'required'
  temperature?: number
  maxTokens?: number
  /** 宿主解析后的模型推理能力，不接受插件自行声明。 */
  modelReasoning?: AiReasoningCapability
  /** 本次请求选择的标准推理档位。 */
  reasoningEffort?: AiReasoningEffort | 'none'
}

/** 协议适配器实时返回的文本或推理增量。 */
export interface AiChatProtocolDelta {
  content?: string
  reasoningContent?: string
  toolCall?: {
    index: number
    id: string
    name: string
    argumentsDelta: string
  }
  usage?: AiTokenUsage
}

/** 协议适配器完成一轮流式请求后返回的统一结果。 */
export interface AiChatProtocolTurn {
  content: string
  reasoningContent?: string
  toolCalls: AiToolCall[]
  finishReason?: string
  usage?: AiTokenUsage
  replayState?: AiChatReplayState
}

/** 三种 AI 协议适配器共同实现的最小流式契约。 */
export interface AiChatProtocolStream {
  /**
   * 执行一次协议原生的流式请求。
   * @param input 已规范化的单轮请求
   * @param signal 请求中止信号
   * @param onDelta 正文与推理增量接收器
   * @returns 完整的单轮响应
   */
  stream(
    input: AiChatProtocolInput,
    signal: AbortSignal,
    onDelta: (delta: AiChatProtocolDelta) => void
  ): Promise<AiChatProtocolTurn>
}

/** 可安全跨 IPC 返回给插件的错误信息。 */
export interface AiChatFailure {
  name: string
  message: string
  code: string
  status?: number
  providerCode?: string
  requestId?: string
  retryAfterMs?: number
}

const DEFAULT_RESPONSE_FIELDS = [
  'reasoning_content',
  'reasoning',
  'reasoning_text',
  'reasoning_details'
]

/**
 * 将模型推理配置映射为供应商请求字段和响应字段顺序。
 * @param model 远端模型 ID
 * @param capability 宿主保存的模型推理能力
 * @param requestedEffort 插件为本次请求选择的标准推理档位
 * @returns 推理协议、请求扩展字段和响应候选字段
 * @throws 请求档位无效或不受模型支持时抛出 UNSUPPORTED_REASONING_EFFORT
 */
export function resolveAiReasoningPolicy(
  model: string,
  capability: AiReasoningCapability | undefined,
  requestedEffort?: AiReasoningEffort | 'none'
): {
  request: Record<string, unknown>
  responseFields: string[]
  effort?: AiReasoningEffort
  wireValue?: string | null
} {
  const modelId = model.toLowerCase()
  const inferredProtocol = /deepseek[-_/.:]?v4/.test(modelId)
    ? 'deepseek'
    : /(?:^|\/)gpt-5(?:[.-]|$)/.test(modelId) || /(?:^|\/)(?:o1|o3|o4)(?:[.-]|$)/.test(modelId)
      ? 'openai-compatible'
      : 'passthrough'
  const config = capability && typeof capability === 'object' ? capability : undefined
  const protocol =
    config?.protocol && config.protocol !== 'auto' ? config.protocol : inferredProtocol
  const normalizedRequested =
    requestedEffort === undefined ? undefined : normalizeAiReasoningEffort(requestedEffort)
  if (requestedEffort !== undefined && normalizedRequested === undefined) {
    const error = new Error(`无效的推理强度“${String(requestedEffort)}”`) as Error & {
      normalizedCode?: string
    }
    error.normalizedCode = 'UNSUPPORTED_REASONING_EFFORT'
    throw error
  }
  const effort = normalizedRequested ?? config?.defaultEffort
  const request: Record<string, unknown> = {}
  let wireValue: string | null | undefined
  if (effort !== undefined) {
    if (!config || !Object.prototype.hasOwnProperty.call(config.efforts, effort)) {
      const error = new Error(`模型“${model}”不支持推理强度“${effort}”`) as Error & {
        normalizedCode?: string
      }
      error.normalizedCode = 'UNSUPPORTED_REASONING_EFFORT'
      throw error
    }

    wireValue = config.efforts[effort]
    if (protocol === 'openai-compatible' && typeof wireValue === 'string') {
      request.reasoning_effort = wireValue
    }
    if (protocol === 'deepseek') {
      request.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' }
      if (effort !== 'off' && typeof wireValue === 'string') {
        request.reasoning_effort = wireValue
      }
    }
  }
  return {
    request,
    effort,
    wireValue,
    responseFields:
      config?.responseField && config.responseField !== 'auto'
        ? [config.responseField]
        : [...DEFAULT_RESPONSE_FIELDS]
  }
}

/**
 * 从兼容供应商的多种推理字段中提取文本。
 * @param delta 当前流式增量对象
 * @param fields 按优先级排列的候选字段
 * @returns 首个有效推理文本；不存在时返回空字符串
 */
export function extractAiReasoningDelta(delta: unknown, fields: string[]): string {
  if (!delta || typeof delta !== 'object') return ''
  const record = delta as Record<string, unknown>
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      const text = value
        .map((item) =>
          typeof item === 'string'
            ? item
            : typeof item === 'object' && item
              ? String((item as Record<string, unknown>).text || '')
              : ''
        )
        .join('')
      if (text) return text
    }
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>
      const text = item.text ?? item.content ?? item.reasoning
      if (typeof text === 'string' && text) return text
    }
  }
  return ''
}

/**
 * 规范化 OpenAI SDK 返回的 token 用量。
 * @param usage SDK usage 对象
 * @returns 有效用量；缺少有效数字时返回 undefined
 */
export function normalizeAiTokenUsage(usage: unknown): AiTokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const value = usage as Record<string, unknown>
  const promptDetails = readUsageDetails(value.prompt_tokens_details ?? value.input_tokens_details)
  const completionDetails = readUsageDetails(
    value.completion_tokens_details ?? value.output_tokens_details
  )
  const promptTokens = Number(value.prompt_tokens ?? value.input_tokens)
  const completionTokens = Number(value.completion_tokens ?? value.output_tokens)
  const explicitTotalTokens = Number(value.total_tokens ?? value.total)
  const totalTokens = Number.isFinite(explicitTotalTokens)
    ? explicitTotalTokens
    : (Number.isFinite(promptTokens) ? promptTokens : 0) +
      (Number.isFinite(completionTokens) ? completionTokens : 0)
  if (![promptTokens, completionTokens, explicitTotalTokens].some(Number.isFinite)) return undefined
  const cacheReadTokens = Number(value.cache_read_input_tokens ?? promptDetails?.cached_tokens)
  const cacheWriteTokens = Number(value.cache_creation_input_tokens)
  const reasoningTokens = Number(completionDetails?.reasoning_tokens)
  return {
    prompt_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completion_tokens: Number.isFinite(completionTokens) ? completionTokens : 0,
    total_tokens: Number.isFinite(totalTokens) ? totalTokens : 0,
    ...(Number.isFinite(cacheReadTokens) ? { cache_read_tokens: cacheReadTokens } : {}),
    ...(Number.isFinite(cacheWriteTokens) ? { cache_write_tokens: cacheWriteTokens } : {}),
    ...(Number.isFinite(reasoningTokens) ? { reasoning_tokens: reasoningTokens } : {})
  }
}

/**
 * 将 usage 的可选详情字段收窄为普通对象。
 * @param value SDK 返回的详情字段
 * @returns 可读取的详情对象；格式不正确时返回 undefined
 */
function readUsageDetails(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * 将提供商或传输异常归一为插件可稳定处理的错误结构。
 * @param error SDK、网络层或本模块抛出的异常
 * @returns 不包含密钥和请求正文的错误快照
 */
export function normalizeAiChatFailure(error: unknown): AiChatFailure {
  const source = error && typeof error === 'object' ? (error as Record<string, unknown>) : {}
  const message = error instanceof Error ? error.message : String(error || 'AI 请求失败')
  const status = Number(source.status)
  const providerCode = typeof source.code === 'string' ? source.code : undefined
  const headers = source.headers as { get?: (name: string) => string | null } | undefined
  const requestId =
    (typeof source.request_id === 'string' && source.request_id) ||
    headers?.get?.('x-request-id') ||
    headers?.get?.('request-id') ||
    undefined
  const retryAfter = headers?.get?.('retry-after-ms') || headers?.get?.('retry-after')
  const retryValue = Number(retryAfter)
  let code = typeof source.normalizedCode === 'string' ? source.normalizedCode : 'UNKNOWN'
  if (source.name === 'AbortError' || /aborted|已中止|已取消/i.test(message)) code = 'ABORTED'
  else if (source.normalizedCode === 'STREAM_CLOSED') code = 'STREAM_CLOSED'
  else if (status === 401 || status === 403) code = 'AUTH'
  else if (status === 404) code = 'NOT_FOUND'
  else if (status === 408 || /timeout|timed out/i.test(message)) code = 'TIMEOUT'
  else if (status === 429) code = 'RATE_LIMIT'
  else if (status >= 500 || /upstream.{0,30}(?:failed|error|unavailable)/i.test(message))
    code = 'SERVER'
  else if (status === 400 || status === 422) code = 'INVALID_REQUEST'
  else if (/network|fetch failed|econn|socket|connection/i.test(message)) code = 'TRANSPORT'
  return {
    name: error instanceof Error ? error.name : 'Error',
    message,
    code,
    status: Number.isInteger(status) ? status : undefined,
    providerCode,
    requestId,
    retryAfterMs: Number.isFinite(retryValue)
      ? headers?.get?.('retry-after-ms')
        ? retryValue
        : retryValue * 1_000
      : undefined
  }
}

/**
 * 将协议适配器桥接为插件侧统一的单轮流式事件。
 * @param adapter 已绑定供应商配置的协议适配器
 * @param model 供应商接收的真实模型 ID
 * @param option 插件提交的单轮请求选项
 * @param signal 请求中止信号
 * @param onEvent 插件侧流式事件接收器
 * @returns 统一的完整助手响应
 * @throws 请求中止或适配器返回空响应时抛出结构化传输错误
 */
export async function streamSingleAiProtocolChat(
  adapter: AiChatProtocolStream,
  model: string,
  option: AiChatOption,
  signal: AbortSignal,
  onEvent: (event: AiChatEvent) => void
): Promise<AiChatResult> {
  let streamedContent = ''
  let streamedReasoning = ''
  let reasoningActive = false
  const streamedToolCallIndexes = new Set<number>()
  const streamedToolCallIds = new Set<string>()

  /**
   * 在正文、工具或流结束边界关闭活动思考段。
   * @returns 本次是否发布了结束事件
   */
  const endReasoning = (): boolean => {
    if (!reasoningActive) return false
    reasoningActive = false
    onEvent({ type: 'reasoning_end' })
    return true
  }

  const turn = await adapter.stream(
    {
      model,
      messages: option.messages,
      tools: option.tools,
      toolChoice: option.toolChoice,
      temperature: option.temperature,
      maxTokens: option.maxTokens,
      modelReasoning: option.modelReasoning,
      reasoningEffort: option.reasoningEffort ?? option.reasoning?.effort
    },
    signal,
    (delta) => {
      if (delta.reasoningContent) {
        reasoningActive = true
        streamedReasoning += delta.reasoningContent
        onEvent({ type: 'reasoning', delta: delta.reasoningContent })
      }
      if (delta.content) {
        endReasoning()
        streamedContent += delta.content
        onEvent({ type: 'content', delta: delta.content })
      }
      if (delta.toolCall) {
        endReasoning()
        streamedToolCallIndexes.add(delta.toolCall.index)
        if (delta.toolCall.id) streamedToolCallIds.add(delta.toolCall.id)
        onEvent({ type: 'tool_call', ...delta.toolCall })
      }
      if (delta.usage) {
        onEvent({ type: 'usage', usage: delta.usage })
      }
    }
  )

  if (signal.aborted) {
    const error = new Error('AI 请求已中止') as Error & { normalizedCode?: string }
    error.normalizedCode = 'ABORTED'
    throw error
  }

  // 某些兼容端点只在完成事件提供最终文本，补发未流式投递的尾部。
  const reasoningRemainder = turn.reasoningContent?.startsWith(streamedReasoning)
    ? turn.reasoningContent.slice(streamedReasoning.length)
    : ''
  if (reasoningRemainder) {
    reasoningActive = true
    onEvent({ type: 'reasoning', delta: reasoningRemainder })
  }
  const contentRemainder = turn.content.startsWith(streamedContent)
    ? turn.content.slice(streamedContent.length)
    : ''
  if (contentRemainder) {
    endReasoning()
    onEvent({ type: 'content', delta: contentRemainder })
  }
  endReasoning()

  // 只为未在流中发布过的工具调用补发完整参数，避免重复事件。
  turn.toolCalls.forEach((toolCall, index) => {
    if (streamedToolCallIds.has(toolCall.id) || streamedToolCallIndexes.has(index)) return
    onEvent({
      type: 'tool_call',
      index,
      id: toolCall.id,
      name: toolCall.function.name,
      argumentsDelta: toolCall.function.arguments
    })
  })

  if (!turn.content && !turn.reasoningContent && turn.toolCalls.length === 0) {
    const error = new Error('模型返回了不包含任何内容的完整响应') as Error & {
      normalizedCode?: string
    }
    error.normalizedCode = 'EMPTY_RESPONSE'
    throw error
  }

  return {
    role: 'assistant',
    content: turn.content || null,
    reasoning_content: turn.reasoningContent || null,
    tool_calls: turn.toolCalls,
    // 工具调用和自然结束原因在不同协议中名称不同，插件侧统一为 OpenAI 兼容值。
    finish_reason:
      turn.toolCalls.length || turn.finishReason === 'tool_use'
        ? 'tool_calls'
        : turn.finishReason === 'end_turn'
          ? 'stop'
          : turn.finishReason || 'stop',
    usage: turn.usage,
    ...(turn.replayState ? { replay_state: turn.replayState } : {})
  }
}
