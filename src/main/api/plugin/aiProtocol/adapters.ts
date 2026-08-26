import OpenAI from 'openai'
import type { AiProvider } from '../../../../shared/aiProviderShared.js'
import type {
  AiChatMessage,
  AiChatProtocolDelta,
  AiChatProtocolInput,
  AiChatReplayState,
  AiChatTool,
  AiToolCall
} from '../../../core/aiChatTransport.js'
import {
  extractAiReasoningDelta,
  isCompatibleAiChatReplayState,
  normalizeAiTokenUsage,
  resolveAiReasoningPolicy
} from '../../../core/aiChatTransport.js'
import {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  fromAnthropicContent,
  fromResponsesOutput,
  toAnthropicMessages,
  toAnthropicTools,
  toResponsesInput,
  toResponsesTools,
  type AiReplayContext,
  type AssistantTurn
} from './converters'

export type { AssistantTurn }

/** 单轮调用的输入：模型、消息历史、工具与生成参数。 */
export type AdapterInput = AiChatProtocolInput

/** 流式增量回调携带的字段，缺省表示本轮该字段无增量。 */
export type AdapterDelta = AiChatProtocolDelta

/** 三种接口格式的统一调用契约。 */
export interface AiProtocolAdapter {
  /**
   * 非流式调用，返回单轮完整回复。
   * @param input 模型、消息与工具
   * @param signal 中止信号
   * @returns 归一化的助手回复
   */
  complete(input: AdapterInput, signal: AbortSignal): Promise<AssistantTurn>
  /**
   * 流式调用，实时回传增量并在结束时返回完整回复。
   * @param input 模型、消息与工具
   * @param signal 中止信号
   * @param onDelta 接收文本与推理增量的回调
   * @returns 归一化的助手回复
   */
  stream(
    input: AdapterInput,
    signal: AbortSignal,
    onDelta: (delta: AdapterDelta) => void
  ): Promise<AssistantTurn>
}

/**
 * 按供应商配置的接口格式选择对应适配器。
 * @param provider 已解析的供应商连接配置
 * @param timeout 请求超时毫秒数；缺省时使用 SDK 默认值
 * @returns 该供应商的接口适配器
 */
export function createAdapter(provider: AiProvider, timeout?: number): AiProtocolAdapter {
  switch (provider.apiFormat) {
    case 'openai-chat':
      return new OpenAiChatAdapter(provider, createOpenAiClient(provider, timeout))
    case 'openai-responses':
      return new OpenAiResponsesAdapter(provider, createOpenAiClient(provider, timeout))
    case 'anthropic-messages':
      return new AnthropicMessagesAdapter(provider)
    default:
      // 理论上不会到达，防御未知格式以避免静默失败。
      throw new Error(`不支持的接口格式: ${String(provider.apiFormat)}`)
  }
}

/**
 * 使用供应商凭据创建 OpenAI 兼容客户端，供 Chat 与 Responses 适配器复用。
 * @param provider 供应商连接配置
 * @param timeout 请求超时毫秒数；缺省时使用 SDK 默认值
 * @returns OpenAI SDK 客户端
 */
function createOpenAiClient(provider: AiProvider, timeout?: number): OpenAI {
  return new OpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.apiUrl,
    maxRetries: 0,
    ...(timeout === undefined ? {} : { timeout })
  })
}

/**
 * 规范化插件提交的采样温度。
 * @param value 插件提交的温度值
 * @param maximum 当前协议允许的最大值
 * @returns 有效温度；缺省或非数字时返回 undefined
 */
function normalizeTemperature(value: number | undefined, maximum: number): number | undefined {
  const temperature = Number(value)
  return Number.isFinite(temperature) ? Math.min(maximum, Math.max(0, temperature)) : undefined
}

/**
 * 规范化插件提交的最大输出 token 数。
 * @param value 插件提交的 token 上限
 * @param fallback 缺省时使用的协议默认值
 * @returns 1 到 32768 之间的整数，或缺省值
 */
function normalizeMaxTokens(value: number | undefined, fallback?: number): number | undefined {
  const maxTokens = Number(value)
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return fallback
  return Math.min(32_768, Math.max(1, Math.round(maxTokens)))
}

const CHAT_REASONING_FIELDS = new Set([
  'reasoning_content',
  'reasoning',
  'reasoning_text',
  'reasoning_details'
])

/**
 * 构造适配器用于创建和校验回放状态的身份。
 * @param provider 当前供应商
 * @param model 当前远端模型 ID
 * @returns 当前请求的稳定回放身份
 */
function createReplayContext(provider: AiProvider, model: string): AiReplayContext {
  return { apiFormat: provider.apiFormat, providerId: provider.id, model }
}

/**
 * 从 Chat 助手消息恢复供应商原始推理字段。
 * @param message 待转换的标准助手消息
 * @param provider 当前供应商
 * @param model 当前远端模型 ID
 * @returns 可合并进 Chat assistant message 的原生推理字段
 */
function readChatReasoningReplay(
  message: AiChatMessage,
  provider: AiProvider,
  model: string
): Record<string, unknown> {
  if (!isCompatibleAiChatReplayState(message.replay_state, 'openai-chat', provider.id, model)) {
    return {}
  }
  const result: Record<string, unknown> = {}
  for (const block of message.replay_state.blocks ?? []) {
    const field = typeof block.field === 'string' ? block.field : ''
    if (block.type !== 'reasoning' || !CHAT_REASONING_FIELDS.has(field)) continue
    const value = block.value
    const previous = result[field]
    if (typeof previous === 'string' && typeof value === 'string') {
      result[field] = previous + value
    } else if (Array.isArray(previous) && Array.isArray(value)) {
      result[field] = [...previous, ...value]
    } else if (value !== undefined) {
      result[field] = value
    }
  }
  return result
}

/**
 * 采集 Chat 响应中的原始推理字段，保留字段身份和结构。
 * @param source Chat 完整消息或流式 delta
 * @returns 可序列化的推理回放块
 */
function collectChatReasoningReplayBlocks(source: unknown): Array<Record<string, unknown>> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return []
  const record = source as Record<string, unknown>
  const blocks: Array<Record<string, unknown>> = []
  for (const field of CHAT_REASONING_FIELDS) {
    if (record[field] === undefined) continue
    const value = toJsonValue(record[field])
    if (value !== undefined) blocks.push({ type: 'reasoning', field, value })
  }
  return blocks
}

/**
 * 将 SDK 值复制为不含原型或不可序列化成员的 JSON 值。
 * @param value 待保存的供应商原始值
 * @returns 可安全跨 IPC 传递的副本；无法序列化时返回 undefined
 */
function toJsonValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    return undefined
  }
}

/**
 * 创建 Chat Completions 的版本化回放状态。
 * @param provider 当前供应商
 * @param model 当前远端模型 ID
 * @param blocks 原始推理字段块
 * @param responseId 可选的 Chat 响应 ID
 * @returns 可附加到统一助手结果的回放状态
 */
function createChatReplayState(
  provider: AiProvider,
  model: string,
  blocks: Array<Record<string, unknown>>,
  responseId?: string
): AiChatReplayState {
  return {
    version: 1,
    apiFormat: 'openai-chat',
    providerId: provider.id,
    model,
    ...(responseId ? { response: { id: responseId } } : {}),
    blocks
  }
}

/**
 * 将标准推理档位映射为 Responses API 的 reasoning 和 include 参数。
 * @param input 当前单轮请求
 * @returns 可合并进 Responses 请求体的推理参数
 */
function buildResponsesReasoning(input: AdapterInput): Record<string, unknown> {
  const policy = resolveAiReasoningPolicy(input.model, input.modelReasoning, input.reasoningEffort)
  if (!policy.effort) return {}
  if (policy.effort === 'off') {
    const disabledEffort = typeof policy.wireValue === 'string' ? policy.wireValue : 'none'
    return { reasoning: { effort: disabledEffort } }
  }
  const effort = typeof policy.wireValue === 'string' ? policy.wireValue : policy.effort
  return {
    reasoning: { effort, summary: 'auto' },
    include: ['reasoning.encrypted_content']
  }
}

const ANTHROPIC_THINKING_BUDGETS: Record<string, number> = {
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
  xhigh: 16_384,
  max: 32_768
}

/**
 * 将标准推理档位映射为 Anthropic extended thinking 预算。
 * @param input 当前单轮请求
 * @param maxTokens 已规范化的最大输出 token 数
 * @returns Anthropic thinking 参数；未启用推理时返回 undefined
 * @throws 输出上限无法容纳 Anthropic 最低 thinking 预算时抛出 INVALID_REQUEST
 */
function buildAnthropicThinking(
  input: AdapterInput,
  maxTokens: number
): Record<string, unknown> | undefined {
  const policy = resolveAiReasoningPolicy(input.model, input.modelReasoning, input.reasoningEffort)
  if (!policy.effort || policy.effort === 'off') return undefined
  if (maxTokens < 2048) {
    const error = new Error('Anthropic extended thinking 要求 maxTokens 至少为 2048') as Error & {
      normalizedCode?: string
    }
    error.normalizedCode = 'INVALID_REQUEST'
    throw error
  }
  const numericWireValue = Number(policy.wireValue)
  const requestedBudget =
    typeof policy.wireValue === 'string' && Number.isFinite(numericWireValue)
      ? Math.round(numericWireValue)
      : ANTHROPIC_THINKING_BUDGETS[policy.effort] || 1024
  // 至少为正文保留 1024 token，并满足 Anthropic 的最低 thinking 预算。
  const budgetTokens = Math.max(1024, Math.min(requestedBudget, maxTokens - 1024))
  return { type: 'enabled', budget_tokens: budgetTokens }
}

/**
 * 将插件消息转为 OpenAI Chat Completions 的消息参数。
 * @param messages 标准消息历史
 * @param provider 当前供应商
 * @param model 当前远端模型 ID
 * @returns OpenAI SDK 消息参数数组
 */
function convertMessages(
  messages: AiChatMessage[],
  provider: AiProvider,
  model: string
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    // 助手消息保留 reasoning_content 与 tool_calls，解决 DeepSeek thinking mode 透传。
    if (msg.role === 'assistant') {
      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: msg.content || ''
      }
      const replayedReasoning = readChatReasoningReplay(msg, provider, model)
      if (Object.keys(replayedReasoning).length) {
        Object.assign(assistantMsg, replayedReasoning)
      } else if (msg.reasoning_content) {
        // 旧历史没有匹配的 replay state 时继续使用兼容性最好的 reasoning_content。
        assistantMsg.reasoning_content = msg.reasoning_content
      }
      if (msg.tool_calls?.length) {
        assistantMsg.tool_calls = msg.tool_calls
      }
      return assistantMsg as unknown as OpenAI.ChatCompletionMessageParam
    }
    if (msg.role === 'tool') {
      return {
        role: 'tool' as const,
        content: (typeof msg.content === 'string' ? msg.content : '') || '',
        tool_call_id: msg.tool_call_id || ''
      }
    }
    // user 消息支持字符串或内容块数组（多模态）。
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      return {
        role: 'user' as const,
        content: msg.content as OpenAI.ChatCompletionContentPart[]
      }
    }
    return {
      role: msg.role as 'system' | 'user',
      content: (typeof msg.content === 'string' ? msg.content : '') || ''
    }
  })
}

/**
 * 将插件工具定义转为 OpenAI Chat Completions 的工具参数。
 * @param tools 可选的工具列表
 * @returns OpenAI SDK 工具参数数组
 */
function convertChatTools(tools?: AiChatTool[]): OpenAI.ChatCompletionTool[] {
  return (tools ?? [])
    .filter((tool) => tool.function)
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.function!.name,
        description: tool.function!.description,
        parameters: tool.function!.parameters as OpenAI.FunctionParameters
      }
    }))
}

/**
 * 从 Chat Completions 返回中提取函数类型的工具调用。
 * @param toolCalls 模型返回的原始工具调用
 * @returns 归一化的 ToolCall 数组
 */
function extractChatToolCalls(toolCalls?: OpenAI.ChatCompletionMessageToolCall[]): AiToolCall[] {
  if (!toolCalls?.length) return []
  return toolCalls
    .filter(
      (toolCall): toolCall is OpenAI.ChatCompletionMessageFunctionToolCall =>
        toolCall.type === 'function'
    )
    .map((toolCall) => ({
      id: toolCall.id,
      type: 'function' as const,
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments
      }
    }))
}

/**
 * OpenAI Chat Completions 适配器，沿用既有调用与透传逻辑。
 */
class OpenAiChatAdapter implements AiProtocolAdapter {
  constructor(
    private readonly provider: AiProvider,
    private readonly client: OpenAI
  ) {}

  /**
   * 通过 Chat Completions 执行非流式单轮请求。
   * @param input 模型、消息、工具与生成参数
   * @param signal 请求中止信号
   * @returns 归一化的助手回复
   */
  public async complete(input: AdapterInput, signal: AbortSignal): Promise<AssistantTurn> {
    const tools = convertChatTools(input.tools)
    const temperature = normalizeTemperature(input.temperature, 2) ?? 0.2
    const maxTokens = normalizeMaxTokens(input.maxTokens)
    const reasoning = resolveAiReasoningPolicy(
      input.model,
      input.modelReasoning,
      input.reasoningEffort
    )
    const response = await this.client.chat.completions.create(
      {
        model: input.model,
        messages: convertMessages(input.messages, this.provider, input.model),
        ...(tools.length ? { tools, tool_choice: input.toolChoice || 'auto' } : {}),
        ...(temperature === undefined ? {} : { temperature }),
        ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
        ...reasoning.request
      },
      { signal }
    )

    const choice = response.choices[0]
    if (!choice) return { content: '', toolCalls: [] }
    const assistantMsg = choice.message
    // 按模型配置提取供应商返回的非标准推理字段。
    const reasoningContent = extractAiReasoningDelta(assistantMsg, reasoning.responseFields)
    const replayBlocks = collectChatReasoningReplayBlocks(assistantMsg)
    return {
      content: assistantMsg.content || '',
      reasoningContent,
      toolCalls: extractChatToolCalls(assistantMsg.tool_calls),
      finishReason: choice.finish_reason || undefined,
      usage: normalizeAiTokenUsage(response.usage),
      replayState: createChatReplayState(this.provider, input.model, replayBlocks, response.id)
    }
  }

  /**
   * 通过 Chat Completions 执行流式单轮请求。
   * @param input 模型、消息、工具与生成参数
   * @param signal 请求中止信号
   * @param onDelta 正文与推理增量接收器
   * @returns 流结束后的完整助手回复
   */
  public async stream(
    input: AdapterInput,
    signal: AbortSignal,
    onDelta: (delta: AdapterDelta) => void
  ): Promise<AssistantTurn> {
    const tools = convertChatTools(input.tools)
    const temperature = normalizeTemperature(input.temperature, 2) ?? 0.2
    const maxTokens = normalizeMaxTokens(input.maxTokens)
    const reasoning = resolveAiReasoningPolicy(
      input.model,
      input.modelReasoning,
      input.reasoningEffort
    )
    const stream = await this.client.chat.completions.create(
      {
        model: input.model,
        messages: convertMessages(input.messages, this.provider, input.model),
        stream: true,
        stream_options: { include_usage: true },
        ...(tools.length ? { tools, tool_choice: input.toolChoice || 'auto' } : {}),
        ...(temperature === undefined ? {} : { temperature }),
        ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
        ...reasoning.request
      },
      { signal }
    )

    let fullContent = ''
    let fullReasoning = ''
    let finishReason: string | undefined
    let usage: ReturnType<typeof normalizeAiTokenUsage>
    let responseId: string | undefined
    const replayBlocks: Array<Record<string, unknown>> = []
    // 工具调用按 index 累积参数片段，流结束后统一归一化。
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()

    for await (const chunk of stream) {
      if (chunk.id) responseId = chunk.id
      const delta = chunk.choices[0]?.delta
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason
      }
      const chunkUsage = normalizeAiTokenUsage(chunk.usage)
      if (delta) {
        replayBlocks.push(...collectChatReasoningReplayBlocks(delta))
        const reasoningDelta = extractAiReasoningDelta(delta, reasoning.responseFields)
        const contentDelta = delta.content || ''

        if (contentDelta || reasoningDelta) {
          fullContent += contentDelta
          fullReasoning += reasoningDelta || ''
          onDelta({
            content: contentDelta || undefined,
            reasoningContent: reasoningDelta || undefined
          })
        }

        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const existing = toolCalls.get(toolCall.index)
            if (existing) {
              if (toolCall.id) existing.id = toolCall.id
              if (toolCall.function?.name) existing.name = toolCall.function.name
              existing.arguments += toolCall.function?.arguments || ''
            } else {
              toolCalls.set(toolCall.index, {
                id: toolCall.id || '',
                name: toolCall.function?.name || '',
                arguments: toolCall.function?.arguments || ''
              })
            }
            const current = toolCalls.get(toolCall.index)!
            onDelta({
              toolCall: {
                index: toolCall.index,
                id: current.id,
                name: current.name,
                argumentsDelta: toolCall.function?.arguments || ''
              }
            })
          }
        }
      }
      // usage 表示本分片之前全部增量的统计结果，固定在正文和工具事件之后发布。
      if (chunkUsage) {
        usage = chunkUsage
        onDelta({ usage: chunkUsage })
      }
    }

    if (!finishReason) {
      const error = new Error(
        signal.aborted ? 'AI 请求已中止' : 'OpenAI Chat 流在完成标记前关闭'
      ) as Error & {
        normalizedCode?: string
      }
      error.normalizedCode = signal.aborted ? 'ABORTED' : 'STREAM_CLOSED'
      throw error
    }

    return {
      content: fullContent,
      reasoningContent: fullReasoning || undefined,
      toolCalls: Array.from(toolCalls.values()).map((toolCall) => ({
        id: toolCall.id,
        type: 'function' as const,
        function: { name: toolCall.name, arguments: toolCall.arguments }
      })),
      finishReason,
      usage,
      replayState: createChatReplayState(this.provider, input.model, replayBlocks, responseId)
    }
  }
}

/**
 * OpenAI Responses API 适配器。
 */
class OpenAiResponsesAdapter implements AiProtocolAdapter {
  constructor(
    private readonly provider: AiProvider,
    private readonly client: OpenAI
  ) {}

  /**
   * 通过 Responses API 执行非流式单轮请求。
   * @param input 模型、消息、工具与生成参数
   * @param signal 请求中止信号
   * @returns 归一化的助手回复
   */
  public async complete(input: AdapterInput, signal: AbortSignal): Promise<AssistantTurn> {
    const tools = toResponsesTools(input.tools)
    const temperature = normalizeTemperature(input.temperature, 2)
    const maxOutputTokens = normalizeMaxTokens(input.maxTokens)
    const context = createReplayContext(this.provider, input.model)
    const reasoning = buildResponsesReasoning(input)
    // store:false 使请求无状态化，工具调用历史由输入项完整回传。
    const params = {
      model: input.model,
      input: toResponsesInput(input.messages, context),
      store: false,
      ...(tools ? { tools, ...(input.toolChoice ? { tool_choice: input.toolChoice } : {}) } : {}),
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
      ...reasoning
    } as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming
    const response = await this.client.responses.create(params, { signal })
    return {
      ...fromResponsesOutput(response.output, context, {
        id: response.id,
        status: response.status
      }),
      finishReason: response.output.some((item) => item.type === 'function_call')
        ? 'tool_calls'
        : 'stop',
      usage: normalizeAiTokenUsage(response.usage)
    }
  }

  /**
   * 通过 Responses API 执行流式单轮请求。
   * @param input 模型、消息、工具与生成参数
   * @param signal 请求中止信号
   * @param onDelta 正文与推理增量接收器
   * @returns 流结束后的完整助手回复
   * @throws 响应失败、不完整或缺少完成事件时抛出错误
   */
  public async stream(
    input: AdapterInput,
    signal: AbortSignal,
    onDelta: (delta: AdapterDelta) => void
  ): Promise<AssistantTurn> {
    const tools = toResponsesTools(input.tools)
    const temperature = normalizeTemperature(input.temperature, 2)
    const maxOutputTokens = normalizeMaxTokens(input.maxTokens)
    const context = createReplayContext(this.provider, input.model)
    const reasoning = buildResponsesReasoning(input)
    const params = {
      model: input.model,
      input: toResponsesInput(input.messages, context),
      store: false,
      stream: true,
      ...(tools ? { tools, ...(input.toolChoice ? { tool_choice: input.toolChoice } : {}) } : {}),
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
      ...reasoning
    } as unknown as OpenAI.Responses.ResponseCreateParamsStreaming
    const stream = await this.client.responses.create(params, { signal })

    let completed: OpenAI.Responses.Response | null = null
    let usage: ReturnType<typeof normalizeAiTokenUsage>
    // 协议 output_index 包含 reasoning、message 等所有输出项；对外工具索引必须单独连续编号。
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    const outputToolIndexes = new Map<number, number>()
    const itemToolIndexes = new Map<string, number>()
    let nextToolCallIndex = 0
    for await (const event of stream) {
      // 文本与推理增量实时回传，工具调用在 completed 事件中一次性归一化。
      if (event.type === 'response.output_text.delta') {
        onDelta({ content: event.delta })
      } else if (event.type === 'response.reasoning_text.delta') {
        onDelta({ reasoningContent: event.delta })
      } else if (event.type === 'response.output_item.added') {
        const eventRecord = event as unknown as Record<string, unknown>
        const item = eventRecord.item as Record<string, unknown> | undefined
        if (item?.type === 'function_call') {
          const outputIndex = Number(eventRecord.output_index)
          const itemId = typeof item.id === 'string' ? item.id : ''
          const index =
            (itemId ? itemToolIndexes.get(itemId) : undefined) ??
            (Number.isFinite(outputIndex) ? outputToolIndexes.get(outputIndex) : undefined) ??
            nextToolCallIndex++
          if (Number.isFinite(outputIndex)) outputToolIndexes.set(outputIndex, index)
          if (itemId) itemToolIndexes.set(itemId, index)
          const existing = toolCalls.get(index) ?? { id: '', name: '', arguments: '' }
          if (typeof item.call_id === 'string' && item.call_id) existing.id = item.call_id
          if (typeof item.name === 'string' && item.name) existing.name = item.name
          toolCalls.set(index, existing)
        }
      } else if (event.type === 'response.function_call_arguments.delta') {
        const eventRecord = event as unknown as Record<string, unknown>
        const itemId = typeof eventRecord.item_id === 'string' ? eventRecord.item_id : ''
        const outputIndex = Number(eventRecord.output_index)
        const index =
          (itemId ? itemToolIndexes.get(itemId) : undefined) ??
          (Number.isFinite(outputIndex) ? outputToolIndexes.get(outputIndex) : undefined) ??
          nextToolCallIndex++
        // delta 可能先于 added 到达，首次看到时也要固定协议索引与连续工具索引的关系。
        if (Number.isFinite(outputIndex)) outputToolIndexes.set(outputIndex, index)
        if (itemId) itemToolIndexes.set(itemId, index)
        const existing = toolCalls.get(index) ?? { id: itemId, name: '', arguments: '' }
        // Responses 的 item_id 与工具 call_id 可能不同，已有 output_item 信息优先保留。
        if (itemId && !existing.id) existing.id = itemId
        const argumentsDelta = typeof eventRecord.delta === 'string' ? eventRecord.delta : ''
        existing.arguments += argumentsDelta
        toolCalls.set(index, existing)
        onDelta({
          toolCall: {
            index,
            id: existing.id,
            name: existing.name,
            argumentsDelta
          }
        })
      } else if (event.type === 'response.completed') {
        completed = event.response
        usage = normalizeAiTokenUsage(event.response.usage)
      } else if (event.type === 'response.failed' || event.type === 'response.incomplete') {
        throw new Error('Responses API 返回失败或不完整事件')
      }
    }
    if (!completed) throw new Error('Responses API 未返回完整响应')
    const turn = fromResponsesOutput(completed.output, context, {
      id: completed.id,
      status: completed.status
    })
    return {
      ...turn,
      finishReason: turn.toolCalls.length ? 'tool_calls' : 'stop',
      usage
    }
  }
}

/**
 * Anthropic Messages API 适配器，使用原生 fetch 以避免新增依赖并兼容自定义中转地址。
 */
class AnthropicMessagesAdapter implements AiProtocolAdapter {
  constructor(private readonly provider: AiProvider) {}

  /**
   * 通过 Anthropic Messages 执行非流式单轮请求。
   * @param input 模型、消息、工具与生成参数
   * @param signal 请求中止信号
   * @returns 归一化的助手回复
   */
  public async complete(input: AdapterInput, signal: AbortSignal): Promise<AssistantTurn> {
    const response = await this.request(this.buildBody(input, false), signal)
    // 非流式响应体为单个 JSON 对象，content 字段即模型输出块。
    const json = (await response.json()) as {
      content?: unknown
      stop_reason?: unknown
      usage?: unknown
    }
    const turn = fromAnthropicContent(json.content, createReplayContext(this.provider, input.model))
    return {
      ...turn,
      finishReason: turn.toolCalls.length ? 'tool_calls' : String(json.stop_reason || 'end_turn'),
      usage: normalizeAiTokenUsage(json.usage)
    }
  }

  /**
   * 通过 Anthropic Messages 执行流式单轮请求。
   * @param input 模型、消息、工具与生成参数
   * @param signal 请求中止信号
   * @param onDelta 正文与推理增量接收器
   * @returns 流结束后的完整助手回复
   */
  public async stream(
    input: AdapterInput,
    signal: AbortSignal,
    onDelta: (delta: AdapterDelta) => void
  ): Promise<AssistantTurn> {
    const response = await this.request(this.buildBody(input, true), signal)
    return parseAnthropicSse(
      response.body,
      onDelta,
      createReplayContext(this.provider, input.model)
    )
  }

  /**
   * 构造 Anthropic Messages 请求体。
   * @param input 模型、消息与工具
   * @param stream 是否流式
   * @returns 请求体对象
   */
  private buildBody(input: AdapterInput, stream: boolean): Record<string, unknown> {
    const context = createReplayContext(this.provider, input.model)
    const { system, messages } = toAnthropicMessages(input.messages, context)
    const temperature = normalizeTemperature(input.temperature, 1)
    const maxTokens = normalizeMaxTokens(input.maxTokens, ANTHROPIC_DEFAULT_MAX_TOKENS)!
    const thinking = buildAnthropicThinking(input, maxTokens)
    // 强制工具选择与 extended thinking 在 Anthropic 协议中互斥，提前返回稳定错误。
    if (thinking && input.toolChoice === 'required') {
      const error = new Error(
        'Anthropic extended thinking 不支持 required toolChoice，请使用 auto 或关闭推理'
      ) as Error & { normalizedCode?: string }
      error.normalizedCode = 'INVALID_REQUEST'
      throw error
    }
    // max_tokens 是 Anthropic 必填字段，缺省时使用较高默认值减少截断。
    const body: Record<string, unknown> = {
      model: input.model,
      messages,
      max_tokens: maxTokens,
      stream
    }
    // Anthropic extended thinking 不接受 temperature，启用时交由模型使用默认采样策略。
    if (temperature !== undefined && !thinking) body.temperature = temperature
    if (thinking) body.thinking = thinking
    if (system) body.system = system
    const tools = input.toolChoice === 'none' ? undefined : toAnthropicTools(input.tools)
    if (tools) body.tools = tools
    if (tools && input.toolChoice) {
      body.tool_choice = { type: input.toolChoice === 'required' ? 'any' : 'auto' }
    }
    return body
  }

  /**
   * 发起 Anthropic 请求并校验响应状态。
   * @param body 请求体
   * @param signal 中止信号
   * @returns fetch 响应
   * @throws 鉴权或参数错误时抛出携带状态码与响应文本的错误
   */
  private async request(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const endpoint = buildAnthropicEndpoint(this.provider.apiUrl)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.provider.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal
    })
    if (!response.ok) {
      // 读取错误响应体以便定位鉴权或参数问题。
      const errorText = await response.text().catch(() => '')
      const error = new Error(
        `Anthropic 请求失败 (${response.status}): ${errorText || response.statusText}`
      ) as Error & { status?: number }
      error.status = response.status
      throw error
    }
    return response
  }
}

/**
 * 根据供应商地址构造 Anthropic Messages 接口地址。
 * @param apiUrl 用户填写的接口地址
 * @returns 完整的 /messages 端点
 */
function buildAnthropicEndpoint(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, '')
  // 已包含 /v1 的中转地址直接拼接 /messages，否则补 /v1/messages。
  return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
}

/** Anthropic 流式中按索引累积的工具调用片段。 */
interface AnthropicToolCallAccumulator {
  id: string
  name: string
  args: string
}

/**
 * 解析 Anthropic 流式响应的 SSE，实时回传增量并累积工具调用。
 * @param body fetch 响应的可读流
 * @param onDelta 接收文本与推理增量的回调
 * @param context 当前协议、供应商与模型身份
 * @returns 归一化的助手回复
 * @throws 流中断或收到 error 事件时抛出错误
 */
async function parseAnthropicSse(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (delta: AdapterDelta) => void,
  context: AiReplayContext
): Promise<AssistantTurn> {
  if (!body) throw new Error('Anthropic 流式响应缺少 body')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let fullReasoning = ''
  let finishReason: string | undefined
  let usage: ReturnType<typeof normalizeAiTokenUsage>
  const usageSource: Record<string, unknown> = {}
  // 每个 content_block 的状态按 index 跟踪，content_block_stop 时完成工具调用解析。
  const toolBlocks = new Map<number, AnthropicToolCallAccumulator>()
  const nativeBlocks = new Map<number, Record<string, unknown>>()

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 事件以空行分隔，逐块解析后保留未完成的尾部。
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ''
    for (const rawEvent of events) {
      const data = extractSseData(rawEvent)
      if (!data) continue
      // 部分 Anthropic 中转复用 OpenAI SSE 终止哨兵，收到后直接结束当前事件批次。
      if (data === '[DONE]') continue
      const event = JSON.parse(data) as Record<string, unknown>
      const type = typeof event.type === 'string' ? event.type : ''

      if (type === 'content_block_start') {
        const index = event.index as number
        const block = event.content_block as Record<string, unknown> | undefined
        const serializableBlock = toJsonValue(block)
        if (serializableBlock && typeof serializableBlock === 'object') {
          nativeBlocks.set(index, serializableBlock as Record<string, unknown>)
        }
        if (block && block.type === 'tool_use') {
          toolBlocks.set(index, {
            id: typeof block.id === 'string' ? block.id : '',
            name: typeof block.name === 'string' ? block.name : '',
            args: ''
          })
        }
      } else if (type === 'content_block_delta') {
        const index = event.index as number
        const delta = event.delta as Record<string, unknown> | undefined
        if (!delta) continue
        // 文本增量：回传并累积为最终内容。
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          fullContent += delta.text
          const block = nativeBlocks.get(index) ?? { type: 'text', text: '' }
          block.text = `${typeof block.text === 'string' ? block.text : ''}${delta.text}`
          nativeBlocks.set(index, block)
          onDelta({ content: delta.text })
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          fullReasoning += delta.thinking
          const block = nativeBlocks.get(index) ?? { type: 'thinking', thinking: '' }
          block.thinking = `${typeof block.thinking === 'string' ? block.thinking : ''}${delta.thinking}`
          nativeBlocks.set(index, block)
          onDelta({ reasoningContent: delta.thinking })
        } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
          // signature 必须与 thinking 块一起回放，否则 Anthropic 会拒绝后续工具轮次。
          const block = nativeBlocks.get(index) ?? { type: 'thinking', thinking: '' }
          block.signature = `${typeof block.signature === 'string' ? block.signature : ''}${delta.signature}`
          nativeBlocks.set(index, block)
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const accumulator = toolBlocks.get(index)
          if (accumulator) accumulator.args += delta.partial_json
          if (accumulator) {
            onDelta({
              toolCall: {
                index,
                id: accumulator.id,
                name: accumulator.name,
                argumentsDelta: delta.partial_json
              }
            })
          }
        }
      } else if (type === 'message_start') {
        const message = event.message as Record<string, unknown> | undefined
        const initialUsage = message?.usage
        if (initialUsage && typeof initialUsage === 'object') {
          Object.assign(usageSource, initialUsage)
          usage = normalizeAiTokenUsage(usageSource)
          if (usage) onDelta({ usage })
        }
      } else if (type === 'message_delta') {
        const messageDelta = event.delta as Record<string, unknown> | undefined
        if (typeof messageDelta?.stop_reason === 'string') finishReason = messageDelta.stop_reason
        if (event.usage && typeof event.usage === 'object') Object.assign(usageSource, event.usage)
        usage = normalizeAiTokenUsage(usageSource)
        if (usage) onDelta({ usage })
      } else if (type === 'content_block_stop') {
        const index = event.index as number
        const accumulator = toolBlocks.get(index)
        if (accumulator) {
          // 工具调用参数为累积的 JSON 片段，解析失败时回退为空对象。
          let input: unknown
          try {
            input = accumulator.args ? JSON.parse(accumulator.args) : {}
          } catch {
            input = {}
          }
          const block = nativeBlocks.get(index) ?? {
            type: 'tool_use',
            id: accumulator.id,
            name: accumulator.name
          }
          block.input = input
          nativeBlocks.set(index, block)
          toolBlocks.delete(index)
        }
      } else if (type === 'error') {
        const error = event.error as Record<string, unknown> | undefined
        throw new Error(
          `Anthropic 流式响应错误: ${typeof error?.message === 'string' ? error.message : data}`
        )
      }
    }
  }

  const nativeContent = Array.from(nativeBlocks.entries())
    .sort(([left], [right]) => left - right)
    .map(([, block]) => block)
  const turn = fromAnthropicContent(nativeContent, context)
  return {
    ...turn,
    // 兼容缺少 content_block_start 的中转站，以已流式投递的文本作为最终兜底。
    content: turn.content || fullContent,
    reasoningContent: turn.reasoningContent || fullReasoning || undefined,
    finishReason: finishReason || (turn.toolCalls.length ? 'tool_use' : 'end_turn'),
    usage
  }
}

/**
 * 从单个 SSE 事件文本中提取 data 字段的 JSON 负载。
 * @param rawEvent 单个 SSE 事件的原始文本
 * @returns data 字段拼接后的字符串；无 data 行时返回 null
 */
function extractSseData(rawEvent: string): string | null {
  const dataLines: string[] = []
  for (const line of rawEvent.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  return dataLines.length ? dataLines.join('\n') : null
}
