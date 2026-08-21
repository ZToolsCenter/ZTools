import type { AiChatEvent } from './aiChatTransport.js'

/** AI 流事件允许的最大合并间隔。 */
export const MAX_AI_CHAT_EVENT_BATCH_INTERVAL_MS = 1_000

/**
 * 将插件传入的流事件合并间隔规范化到安全范围。
 * @param value 插件传入的毫秒值
 * @returns 0 到最大合并间隔之间的整数；无效值表示关闭合并
 */
export function normalizeAiChatEventBatchInterval(value: unknown): number {
  const interval = Number(value)
  if (!Number.isFinite(interval) || interval <= 0) return 0
  return Math.min(MAX_AI_CHAT_EVENT_BATCH_INTERVAL_MS, Math.max(1, Math.round(interval)))
}

/**
 * 判断两项连续流事件能否在不改变协议顺序的前提下合并。
 * @param current 当前待发送事件
 * @param incoming 新到达事件
 * @returns 两项事件是否兼容
 */
function canMergeAiChatEvents(current: AiChatEvent, incoming: AiChatEvent): boolean {
  if (current.type !== incoming.type) return false
  if (current.type === 'content' || current.type === 'reasoning') return true
  if (current.type !== 'tool_call' || incoming.type !== 'tool_call') return false
  return (
    current.index === incoming.index &&
    (!current.id || !incoming.id || current.id === incoming.id) &&
    (!current.name || !incoming.name || current.name === incoming.name)
  )
}

/**
 * 合并两项已经确认兼容的连续流事件。
 * @param current 当前待发送事件
 * @param incoming 新到达事件
 * @returns 保留完整增量内容的合并事件
 * @throws 事件类型不支持合并时抛出
 */
function mergeAiChatEvents(current: AiChatEvent, incoming: AiChatEvent): AiChatEvent {
  if (current.type === 'content' && incoming.type === 'content') {
    return { type: 'content', delta: current.delta + incoming.delta }
  }
  if (current.type === 'reasoning' && incoming.type === 'reasoning') {
    return { type: 'reasoning', delta: current.delta + incoming.delta }
  }
  if (current.type === 'tool_call' && incoming.type === 'tool_call') {
    return {
      type: 'tool_call',
      index: current.index,
      id: incoming.id || current.id,
      name: incoming.name || current.name,
      argumentsDelta: current.argumentsDelta + incoming.argumentsDelta
    }
  }
  throw new Error(`不支持合并 AI 流事件：${current.type}`)
}

/** 单轮 AI 流事件合并器。 */
export interface AiChatEventBatcher {
  push: (event: AiChatEvent) => void
  flush: () => void
}

/**
 * 创建保持事件顺序和最大延迟边界的单轮流事件合并器。
 * @param intervalValue 合并窗口毫秒数；0 或无效值表示即时发送
 * @param emit 合并后的事件接收器
 * @returns 支持追加和强制刷新的事件合并器
 */
export function createAiChatEventBatcher(
  intervalValue: unknown,
  emit: (event: AiChatEvent) => void
): AiChatEventBatcher {
  const interval = normalizeAiChatEventBatchInterval(intervalValue)
  let pending: AiChatEvent | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  /**
   * 立即发送待处理事件，并释放当前计时器。
   * @returns 无返回值
   */
  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending) return
    const event = pending
    pending = null
    emit(event)
  }

  /**
   * 为当前批次建立一次固定截止时间，持续到达的分片不会延长最大等待。
   * @returns 无返回值
   */
  const schedule = (): void => {
    if (!timer) timer = setTimeout(flush, interval)
  }

  /**
   * 按协议顺序追加一项事件，并在状态边界前发布旧批次。
   * @param event 新到达的标准流事件
   * @returns 无返回值
   */
  const push = (event: AiChatEvent): void => {
    // 关闭合并时维持旧版 aiChat 的逐事件回调行为。
    if (!interval) {
      emit(event)
      return
    }

    // 控制和统计事件属于协议边界，必须在发布前清空文本或工具增量。
    if (event.type === 'request' || event.type === 'reasoning_end' || event.type === 'usage') {
      flush()
      emit(event)
      return
    }

    if (pending && canMergeAiChatEvents(pending, event)) {
      pending = mergeAiChatEvents(pending, event)
      return
    }
    // 类型、工具索引或身份变化时先发布旧批次，禁止跨边界重新排序。
    flush()
    pending = event
    schedule()
  }

  return { push, flush }
}
