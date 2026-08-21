import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAiChatEventBatcher,
  normalizeAiChatEventBatchInterval
} from '../../src/main/core/aiChatEventBatcher'
import type { AiChatEvent } from '../../src/main/core/aiChatTransport'

afterEach(() => {
  vi.useRealTimers()
})

describe('aiChatEventBatcher', () => {
  it('合并窗口内的连续正文，并在固定截止时间发布', () => {
    vi.useFakeTimers()
    const events: AiChatEvent[] = []
    const batcher = createAiChatEventBatcher(50, (event) => events.push(event))

    batcher.push({ type: 'content', delta: 'A' })
    vi.advanceTimersByTime(30)
    batcher.push({ type: 'content', delta: 'B' })
    vi.advanceTimersByTime(19)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toEqual([{ type: 'content', delta: 'AB' }])
  })

  it('在思考结束和 usage 边界前按顺序强制刷新', () => {
    vi.useFakeTimers()
    const events: AiChatEvent[] = []
    const batcher = createAiChatEventBatcher(50, (event) => events.push(event))

    batcher.push({ type: 'reasoning', delta: '先' })
    batcher.push({ type: 'reasoning', delta: '分析' })
    batcher.push({ type: 'reasoning_end' })
    batcher.push({ type: 'content', delta: '答案' })
    batcher.push({
      type: 'usage',
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
    })

    expect(events.map((event) => event.type)).toEqual([
      'reasoning',
      'reasoning_end',
      'content',
      'usage'
    ])
    expect(events[0]).toEqual({ type: 'reasoning', delta: '先分析' })
  })

  it('只合并身份兼容的同一工具参数分片', () => {
    const events: AiChatEvent[] = []
    const batcher = createAiChatEventBatcher(50, (event) => events.push(event))

    batcher.push({
      type: 'tool_call',
      index: 0,
      id: 'call-a',
      name: 'read_file',
      argumentsDelta: '{"path"'
    })
    batcher.push({
      type: 'tool_call',
      index: 0,
      id: '',
      name: '',
      argumentsDelta: ':"a.txt"}'
    })
    batcher.push({
      type: 'tool_call',
      index: 1,
      id: 'call-b',
      name: 'read_file',
      argumentsDelta: '{}'
    })
    batcher.flush()

    expect(events).toEqual([
      {
        type: 'tool_call',
        index: 0,
        id: 'call-a',
        name: 'read_file',
        argumentsDelta: '{"path":"a.txt"}'
      },
      {
        type: 'tool_call',
        index: 1,
        id: 'call-b',
        name: 'read_file',
        argumentsDelta: '{}'
      }
    ])
  })

  it('省略或传入零时保持即时事件，异常间隔被限制到安全范围', () => {
    const events: AiChatEvent[] = []
    const batcher = createAiChatEventBatcher(undefined, (event) => events.push(event))
    batcher.push({ type: 'content', delta: 'A' })
    batcher.push({ type: 'content', delta: 'B' })

    expect(events).toEqual([
      { type: 'content', delta: 'A' },
      { type: 'content', delta: 'B' }
    ])
    expect(normalizeAiChatEventBatchInterval(-1)).toBe(0)
    expect(normalizeAiChatEventBatchInterval('50.4')).toBe(50)
    expect(normalizeAiChatEventBatchInterval(10_000)).toBe(1_000)
  })
})
