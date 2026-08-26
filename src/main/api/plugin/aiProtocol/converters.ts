import type {
  AiChatMessage,
  AiChatProtocolTurn,
  AiChatReplayState,
  AiChatTool,
  AiImageContentPart,
  AiTextContentPart,
  AiToolCall
} from '../../../core/aiChatTransport.js'
import { isCompatibleAiChatReplayState } from '../../../core/aiChatTransport.js'
import type { AiApiFormat } from '../../../../shared/aiProviderShared.js'

/** 单轮模型回复的归一化结果，跨三种接口格式统一。 */
export type AssistantTurn = AiChatProtocolTurn

/** Anthropic 接口要求的默认最大输出 token 数。 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192

/** 适配器创建和校验协议私有回放状态所需的身份。 */
export interface AiReplayContext {
  apiFormat: AiApiFormat
  providerId: string
  model: string
}

/* ===================== OpenAI Responses API 转换 ===================== */

/**
 * 将插件消息列表转为 OpenAI Responses API 的输入项。
 * @param messages 插件维护的标准消息历史
 * @param context 当前协议、供应商与模型身份；缺省时仅执行兼容转换
 * @returns Responses API 的 input 数组（以普通对象表达，交由适配器按需断言）
 */
export function toResponsesInput(
  messages: AiChatMessage[],
  context?: AiReplayContext
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = []
  for (const message of messages) {
    // 工具结果回传为独立的 function_call_output 输入项，沿用模型生成的 call_id。
    if (message.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: message.tool_call_id || '',
        output: typeof message.content === 'string' ? message.content : ''
      })
      continue
    }
    // 同一供应商和模型的助手历史优先恢复原生 output item，保留 reasoning 与 item ID。
    if (message.role === 'assistant') {
      const replayItems = readNativeReplayItems(message.replay_state, context, 'openai-responses')
      if (replayItems.length) {
        items.push(...replayItems)
        continue
      }
      // 缺少有效回放状态时退回标准消息和函数调用转换，兼容旧插件历史。
      const text = typeof message.content === 'string' ? message.content : ''
      if (text) {
        items.push({ type: 'message', role: 'assistant', content: text })
      }
      for (const toolCall of message.tool_calls ?? []) {
        items.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        })
      }
      continue
    }
    // user / system / developer 消息统一以消息项回传，支持多模态内容。
    items.push({
      type: 'message',
      role: message.role,
      content: toResponsesMessageContent(message.content)
    })
  }
  return items
}

/**
 * 将插件工具定义转为 OpenAI Responses API 的函数工具。
 * @param tools 可选的工具列表
 * @returns 函数工具数组；无工具时返回 undefined
 */
export function toResponsesTools(tools?: AiChatTool[]): Record<string, unknown>[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function?.name,
    description: tool.function?.description,
    parameters: tool.function?.parameters ?? { type: 'object', properties: {} },
    // Responses API 要求 strict 字段，这里关闭严格校验以兼容中转站的自定义 schema。
    strict: false
  }))
}

/**
 * 将 OpenAI Responses API 的输出项归一化为单轮回复结果。
 * @param output Responses 返回的 output 项数组
 * @param context 当前协议、供应商与模型身份；提供后生成可供下一轮使用的回放状态
 * @param responseMeta Responses 顶层响应的可选元数据
 * @returns 归一化的助手回复
 */
export function fromResponsesOutput(
  output: unknown,
  context?: AiReplayContext,
  responseMeta?: Record<string, unknown>
): AssistantTurn {
  let content = ''
  let reasoningContent = ''
  const toolCalls: AiToolCall[] = []
  const replayBlocks: Array<Record<string, unknown>> = []
  // 输出项可能是文本消息、函数调用或推理项，按 type 分流后分别归一化。
  for (const item of Array.isArray(output) ? output : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const itemRecord = item as Record<string, unknown>
    const type = readString(itemRecord.type)
    if (type === 'message' || type === 'function_call' || type === 'reasoning') {
      // 保存完整原生项，避免丢失 encrypted_content、message ID 和 function item ID。
      replayBlocks.push({ type, item: itemRecord })
    }
    if (type === 'message') {
      for (const part of toArray(itemRecord.content)) {
        if (readString(part.type) === 'output_text') content += readString(part.text)
      }
    } else if (type === 'function_call') {
      toolCalls.push({
        id: readString(itemRecord.call_id),
        type: 'function',
        function: {
          name: readString(itemRecord.name),
          arguments: readString(itemRecord.arguments)
        }
      })
    } else if (type === 'reasoning') {
      // 推理项可能同时包含 summary 与 content 文本，全部汇总为 reasoning_content。
      for (const part of toArray(itemRecord.summary)) {
        if (readString(part.type) === 'summary_text') reasoningContent += readString(part.text)
      }
      for (const part of toArray(itemRecord.content)) {
        if (readString(part.type) === 'reasoning_text') reasoningContent += readString(part.text)
      }
    }
  }
  return {
    content,
    reasoningContent: reasoningContent || undefined,
    toolCalls,
    replayState: context ? createReplayState(context, replayBlocks, responseMeta) : undefined
  }
}

/**
 * 将插件消息内容转为 Responses API 消息项的 content 字段。
 * @param content 纯文本或多模态内容块
 * @returns 字符串或 Responses 输入内容块数组
 */
function toResponsesMessageContent(
  content: AiChatMessage['content']
): string | Record<string, unknown>[] {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  const parts: Record<string, unknown>[] = []
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'input_text', text: part.text })
    } else if (part.type === 'image_url') {
      parts.push({ type: 'input_image', image_url: part.image_url.url, detail: 'auto' })
    }
  }
  return parts
}

/* ===================== Anthropic Messages API 转换 ===================== */

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64' | 'url'; media_type?: string; data?: string; url?: string }
    }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }

interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** Anthropic 消息序列与提取出的 system 指令。 */
export interface AnthropicConversation {
  system: string
  messages: AnthropicMessage[]
}

/**
 * 将插件消息列表转为 Anthropic 消息序列，并提取 system 指令。
 * Anthropic 要求 user/assistant 严格交替，因此会合并连续同角色的消息。
 * @param messages 插件维护的标准消息历史
 * @param context 当前协议、供应商与模型身份；缺省时仅执行兼容转换
 * @returns 提取出的 system 文本与转换后的消息序列
 */
export function toAnthropicMessages(
  messages: AiChatMessage[],
  context?: AiReplayContext
): AnthropicConversation {
  const systemParts: string[] = []
  const turns: AnthropicMessage[] = []

  for (const message of messages) {
    // system 指令合并为顶层 system，不进入消息序列。
    if (message.role === 'system') {
      if (typeof message.content === 'string') systemParts.push(message.content)
      continue
    }
    if (message.role === 'assistant') {
      const replayBlocks = readNativeReplayItems(
        message.replay_state,
        context,
        'anthropic-messages'
      ) as AnthropicContentBlock[]
      if (replayBlocks.length) {
        turns.push({ role: 'assistant', content: replayBlocks })
        continue
      }
      const blocks: AnthropicContentBlock[] = []
      const text = typeof message.content === 'string' ? message.content : ''
      if (text) blocks.push({ type: 'text', text })
      // 助手发起的工具调用转为 tool_use 块，input 由 JSON 字符串解析为对象。
      for (const toolCall of message.tool_calls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: safeParseJson(toolCall.function.arguments, {})
        })
      }
      turns.push({ role: 'assistant', content: blocks })
      continue
    }
    if (message.role === 'tool') {
      // 工具结果归入 user 轮的 tool_result 块，匹配 Anthropic 的工具调用约定。
      turns.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.tool_call_id || '',
            content: typeof message.content === 'string' ? message.content : ''
          }
        ]
      })
      continue
    }
    // user 消息：支持纯文本或多模态内容块。
    turns.push({ role: 'user', content: toAnthropicUserContent(message.content) })
  }

  // 合并连续同角色消息，满足 Anthropic 严格交替要求。
  const merged = mergeConsecutiveTurns(turns)
  // Anthropic 要求首条消息为 user，缺失时补一条占位消息避免请求被拒。
  if (merged.length === 0 || merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: ' ' })
  }
  return { system: systemParts.join('\n\n').trim(), messages: merged }
}

/**
 * 将插件工具定义转为 Anthropic 的工具定义。
 * @param tools 可选的工具列表
 * @returns Anthropic 工具数组；无工具时返回 undefined
 */
export function toAnthropicTools(tools?: AiChatTool[]): AnthropicTool[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((tool) => ({
    name: tool.function?.name ?? '',
    description: tool.function?.description ?? '',
    input_schema: (tool.function?.parameters as Record<string, unknown>) ?? {
      type: 'object',
      properties: {}
    }
  }))
}

/**
 * 将 Anthropic 返回的 content 块归一化为单轮回复结果。
 * @param content Anthropic 响应的 content 数组
 * @param context 当前协议、供应商与模型身份；提供后生成可供下一轮使用的回放状态
 * @returns 归一化的助手回复
 */
export function fromAnthropicContent(content: unknown, context?: AiReplayContext): AssistantTurn {
  let textContent = ''
  let reasoning = ''
  const toolCalls: AiToolCall[] = []
  const replayBlocks: Array<Record<string, unknown>> = []
  for (const block of Array.isArray(content) ? content : []) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    const blockRecord = block as Record<string, unknown>
    const type = readString(blockRecord.type)
    if (['text', 'thinking', 'redacted_thinking', 'tool_use'].includes(type)) {
      // 原样保存 thinking signature、redacted data 与 tool_use 输入。
      replayBlocks.push({ type, item: blockRecord })
    }
    if (type === 'text') {
      textContent += readString(blockRecord.text)
    } else if (type === 'thinking') {
      // 扩展思考默认未启用，仅当模型或中转站返回 thinking 块时透传。
      reasoning += readString(blockRecord.thinking)
    } else if (type === 'tool_use') {
      const input = blockRecord.input
      toolCalls.push({
        id: readString(blockRecord.id),
        type: 'function',
        function: {
          name: readString(blockRecord.name),
          // Anthropic 的 input 是对象，统一序列化为 JSON 字符串以匹配标准 ToolCall。
          arguments: typeof input === 'string' ? input : JSON.stringify(input ?? {})
        }
      })
    }
  }
  return {
    content: textContent,
    reasoningContent: reasoning || undefined,
    toolCalls,
    replayState: context ? createReplayState(context, replayBlocks) : undefined
  }
}

/**
 * 将插件 user 消息内容转为 Anthropic 的 content 字段。
 * @param content 纯文本或多模态内容块
 * @returns 字符串或 Anthropic 内容块数组
 */
function toAnthropicUserContent(
  content: AiChatMessage['content']
): string | AnthropicContentBlock[] {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  const blocks: AnthropicContentBlock[] = []
  for (const part of content) {
    const block = toAnthropicContentPart(part)
    if (block) blocks.push(block)
  }
  return blocks
}

/**
 * 将单个插件内容块转为 Anthropic 内容块。
 * @param part 文本或图片内容块
 * @returns Anthropic 内容块；无法识别时返回 null
 */
function toAnthropicContentPart(
  part: AiTextContentPart | AiImageContentPart
): AnthropicContentBlock | null {
  if (part.type === 'text') {
    return { type: 'text', text: part.text }
  }
  if (part.type === 'image_url') {
    return toAnthropicImage(part.image_url.url)
  }
  return null
}

/**
 * 将图片 URL 转为 Anthropic 图片来源，支持 data URI 与 http(s) URL。
 * @param url 图片地址
 * @returns Anthropic 图片内容块；不支持的地址返回 null
 */
function toAnthropicImage(url: string): AnthropicContentBlock | null {
  // data URI 形如 data:image/png;base64,XXXX，拆分为 base64 来源。
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url)
  if (match) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: match[1], data: match[2] }
    }
  }
  if (/^https?:\/\//.test(url)) {
    return { type: 'image', source: { type: 'url', url } }
  }
  return null
}

/**
 * 合并连续同角色的消息，确保满足 Anthropic 的角色交替要求。
 * @param turns 原始消息序列
 * @returns 合并后的消息序列
 */
function mergeConsecutiveTurns(turns: AnthropicMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = []
  for (const turn of turns) {
    const last = result[result.length - 1]
    if (last && last.role === turn.role) {
      // 同角色：把两侧内容统一为数组后拼接，避免被接口拒绝。
      last.content = concatContent(last.content, turn.content)
    } else {
      result.push({ role: turn.role, content: turn.content })
    }
  }
  return result
}

/**
 * 拼接两条 Anthropic 内容（字符串或块数组），结果统一为块数组。
 * @param a 前一条内容
 * @param b 后一条内容
 * @returns 合并后的内容块数组
 */
function concatContent(
  a: string | AnthropicContentBlock[],
  b: string | AnthropicContentBlock[]
): AnthropicContentBlock[] {
  const toBlocks = (value: string | AnthropicContentBlock[]): AnthropicContentBlock[] =>
    typeof value === 'string' ? (value ? [{ type: 'text', text: value }] : []) : value
  return [...toBlocks(a), ...toBlocks(b)]
}

/**
 * 安全解析 JSON 字符串，失败时返回兜底值。
 * @param value 待解析的 JSON 字符串
 * @param fallback 解析失败时的兜底值
 * @returns 解析结果或兜底值
 */
function safeParseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

/**
 * 构造版本化、可序列化的协议私有回放状态。
 * @param context 当前协议、供应商与模型身份
 * @param blocks 需要在下一轮原生恢复的输出块
 * @param response 可选的顶层响应元数据
 * @returns 可附加到统一助手结果的回放状态
 */
function createReplayState(
  context: AiReplayContext,
  blocks: Array<Record<string, unknown>>,
  response?: Record<string, unknown>
): AiChatReplayState {
  // 删除 SDK 对象中的 undefined 元数据，确保状态经过 JSON 序列化后结构稳定。
  const serializableResponse = response
    ? Object.fromEntries(Object.entries(response).filter(([, value]) => value !== undefined))
    : undefined
  return {
    version: 1,
    apiFormat: context.apiFormat,
    providerId: context.providerId,
    model: context.model,
    ...(serializableResponse && Object.keys(serializableResponse).length
      ? { response: serializableResponse }
      : {}),
    blocks
  }
}

/**
 * 从匹配当前适配器身份的回放状态中提取原生协议项。
 * @param state 助手历史携带的回放状态
 * @param context 当前协议、供应商与模型身份
 * @param apiFormat 当前转换器要求的协议格式
 * @returns 已通过基础结构和协议类型校验的原生项
 */
function readNativeReplayItems(
  state: unknown,
  context: AiReplayContext | undefined,
  apiFormat: AiApiFormat
): Array<Record<string, unknown>> {
  if (
    !context ||
    context.apiFormat !== apiFormat ||
    !isCompatibleAiChatReplayState(state, apiFormat, context.providerId, context.model)
  ) {
    return []
  }
  const allowedTypes =
    apiFormat === 'openai-responses'
      ? new Set(['reasoning', 'message', 'function_call'])
      : new Set(['thinking', 'redacted_thinking', 'text', 'tool_use'])
  const items: Array<Record<string, unknown>> = []
  for (const block of state.blocks ?? []) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    const item = block.item
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const itemRecord = item as Record<string, unknown>
    const type = readString(itemRecord.type)
    if (allowedTypes.has(type) && (!block.type || block.type === type)) items.push(itemRecord)
  }
  return items
}

/**
 * 从未知值中读取字符串，非字符串返回空串。
 * @param value 待读取的值
 * @returns 字符串值
 */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 将未知值转为可遍历的对象数组，非数组返回空数组。
 * @param value 待转换的值
 * @returns 对象数组
 */
function toArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}
