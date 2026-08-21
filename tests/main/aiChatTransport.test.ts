import { describe, expect, it, vi } from 'vitest'
import {
  normalizeAiChatFailure,
  resolveAiReasoningPolicy,
  streamSingleAiProtocolChat,
  type AiChatEvent
} from '../../src/main/core/aiChatTransport'

describe('aiChatTransport', () => {
  it('maps provider reasoning protocols and structured server errors', () => {
    expect(
      resolveAiReasoningPolicy(
        'deepseek-v4-flash',
        { protocol: 'auto', efforts: { off: null, high: 'high' }, responseField: 'auto' },
        'high'
      ).request
    ).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'high' })
    expect(
      resolveAiReasoningPolicy(
        'gpt-5.6-sol',
        { protocol: 'auto', efforts: { xhigh: 'ultra' }, responseField: 'auto' },
        'xhigh'
      ).request
    ).toEqual({ reasoning_effort: 'ultra' })
    expect(
      resolveAiReasoningPolicy('gpt-5.6-sol', {
        protocol: 'openai-compatible',
        efforts: { off: 'none' },
        defaultEffort: 'off',
        responseField: 'auto'
      }).request
    ).toEqual({ reasoning_effort: 'none' })
    expect(
      resolveAiReasoningPolicy('gpt-5.6-sol', {
        protocol: 'openai-compatible',
        efforts: { off: null },
        defaultEffort: 'off',
        responseField: 'auto'
      }).request
    ).toEqual({})
    expect(
      resolveAiReasoningPolicy(
        'deepseek-v4-flash',
        { protocol: 'deepseek', efforts: { off: null }, responseField: 'auto' },
        'off'
      ).request
    ).toEqual({ thinking: { type: 'disabled' } })
    expect(resolveAiReasoningPolicy('gpt-5.6-sol', undefined).request).toEqual({})
    let unsupportedError: unknown
    try {
      resolveAiReasoningPolicy(
        'gpt-5.6-sol',
        { protocol: 'auto', efforts: { high: 'high' }, responseField: 'auto' },
        'max'
      )
    } catch (error) {
      unsupportedError = error
    }
    expect(unsupportedError).toMatchObject({
      normalizedCode: 'UNSUPPORTED_REASONING_EFFORT',
      message: expect.stringContaining('不支持推理强度')
    })
    expect(normalizeAiChatFailure(new Error('Upstream request failed'))).toMatchObject({
      code: 'SERVER',
      message: 'Upstream request failed'
    })
  })

  it('bridges protocol adapters to ordered aiChat events without executing tools', async () => {
    const events: AiChatEvent[] = []
    const adapter = {
      stream: vi.fn(async (_input, _signal, onDelta) => {
        onDelta({ reasoningContent: '先分析' })
        onDelta({ content: '答案' })
        return {
          content: '答案',
          reasoningContent: '先分析',
          toolCalls: [
            {
              id: 'call-protocol',
              type: 'function' as const,
              function: { name: 'lookup', arguments: '{"id":1}' }
            }
          ]
        }
      })
    }

    const result = await streamSingleAiProtocolChat(
      adapter,
      'protocol-model',
      {
        messages: [{ role: 'user', content: '测试' }],
        temperature: 0.7,
        maxTokens: 2048,
        toolChoice: 'required'
      },
      new AbortController().signal,
      (event) => events.push(event)
    )

    expect(events).toEqual([
      { type: 'reasoning', delta: '先分析' },
      { type: 'reasoning_end' },
      { type: 'content', delta: '答案' },
      {
        type: 'tool_call',
        index: 0,
        id: 'call-protocol',
        name: 'lookup',
        argumentsDelta: '{"id":1}'
      }
    ])
    expect(adapter.stream.mock.calls[0][0]).toMatchObject({
      model: 'protocol-model',
      temperature: 0.7,
      maxTokens: 2048,
      toolChoice: 'required'
    })
    expect(result).toMatchObject({
      content: '答案',
      reasoning_content: '先分析',
      finish_reason: 'tool_calls',
      tool_calls: [{ id: 'call-protocol' }]
    })
  })
})
