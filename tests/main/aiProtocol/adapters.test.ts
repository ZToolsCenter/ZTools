import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdapter } from '../../../src/main/api/plugin/aiProtocol/adapters'
import {
  streamSingleAiProtocolChat,
  type AiChatEvent
} from '../../../src/main/core/aiChatTransport'
import type { AiApiFormat, AiProvider } from '../../../src/shared/aiProviderShared'

/**
 * 创建只包含一个模型的协议供应商。
 * @param apiFormat 待验证的供应商接口格式
 * @returns 可传给协议适配器的供应商配置
 */
function createProvider(apiFormat: AiApiFormat): AiProvider {
  return {
    id: `provider-${apiFormat}`,
    name: apiFormat,
    apiUrl: 'https://ai.example/v1',
    apiKey: 'secret-key',
    apiFormat,
    enabled: true,
    selectedModels: [{ ref: 'model-ref', modelId: 'model-a' }]
  }
}

/**
 * 将协议事件编码为 fetch 可消费的 SSE 响应。
 * @param events 按发送顺序排列的协议事件
 * @returns 带 event-stream 响应头的 HTTP 响应
 */
function createSseResponse(events: Array<Record<string, unknown>>): Response {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(`${payload}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('aiProtocol adapters', () => {
  it('streams Anthropic messages with native auth and normalized generation options', async () => {
    const fetchMock = vi.fn(async () =>
      createSseResponse([
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '分析' }
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: '答案' }
        },
        {
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'tool_use', id: 'call-a', name: 'lookup' }
        },
        {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'input_json_delta', partial_json: '{"id":1}' }
        },
        { type: 'content_block_stop', index: 2 },
        { type: 'message_stop' }
      ])
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: AiChatEvent[] = []

    const result = await streamSingleAiProtocolChat(
      createAdapter(createProvider('anthropic-messages')),
      'claude-test',
      {
        messages: [{ role: 'user', content: '测试' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup',
              description: '查询',
              parameters: { type: 'object', properties: {} }
            }
          }
        ],
        toolChoice: 'required',
        temperature: 1.8,
        maxTokens: 4096
      },
      new AbortController().signal,
      (event) => events.push(event)
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://ai.example/v1/messages')
    expect(init?.headers).toMatchObject({
      'x-api-key': 'secret-key',
      'anthropic-version': '2023-06-01'
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'claude-test',
      temperature: 1,
      max_tokens: 4096,
      stream: true,
      tool_choice: { type: 'any' }
    })
    expect(events.map((event) => event.type)).toEqual([
      'reasoning',
      'reasoning_end',
      'content',
      'tool_call'
    ])
    expect(result).toMatchObject({
      content: '答案',
      reasoning_content: '分析',
      finish_reason: 'tool_calls',
      tool_calls: [{ id: 'call-a', function: { name: 'lookup', arguments: '{"id":1}' } }]
    })
  })

  it('streams OpenAI Responses output and sends Responses generation fields', async () => {
    const fetchMock = vi.fn(async () =>
      createSseResponse([
        { type: 'response.reasoning_text.delta', delta: '分析' },
        { type: 'response.output_text.delta', delta: '答案' },
        {
          type: 'response.completed',
          response: {
            output: [
              { type: 'reasoning', content: [{ type: 'reasoning_text', text: '分析' }] },
              { type: 'message', content: [{ type: 'output_text', text: '答案' }] },
              {
                type: 'function_call',
                call_id: 'call-r',
                name: 'lookup',
                arguments: '{"id":2}'
              }
            ]
          }
        }
      ])
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: AiChatEvent[] = []

    const result = await streamSingleAiProtocolChat(
      createAdapter(createProvider('openai-responses')),
      'gpt-response-test',
      {
        messages: [{ role: 'user', content: '测试' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup',
              description: '查询',
              parameters: { type: 'object', properties: {} }
            }
          }
        ],
        toolChoice: 'required',
        temperature: 0.8,
        maxTokens: 3072
      },
      new AbortController().signal,
      (event) => events.push(event)
    )

    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    const headers = new Headers(init?.headers)
    expect(String(url)).toBe('https://ai.example/v1/responses')
    expect(headers.get('authorization')).toBe('Bearer secret-key')
    expect(body).toMatchObject({
      model: 'gpt-response-test',
      temperature: 0.8,
      max_output_tokens: 3072,
      stream: true,
      tool_choice: 'required'
    })
    expect(events.map((event) => event.type)).toEqual([
      'reasoning',
      'reasoning_end',
      'content',
      'tool_call'
    ])
    expect(result).toMatchObject({
      content: '答案',
      reasoning_content: '分析',
      finish_reason: 'tool_calls',
      tool_calls: [{ id: 'call-r', function: { name: 'lookup', arguments: '{"id":2}' } }]
    })
  })

  it('streams OpenAI Chat through the shared adapter with reasoning, tools and usage', async () => {
    const fetchMock = vi.fn(async () =>
      createSseResponse([
        {
          id: 'chat-1',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', reasoning_content: '分析' },
              finish_reason: null
            }
          ]
        },
        {
          id: 'chat-1',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: '答案' }, finish_reason: null }]
        },
        {
          id: 'chat-1',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-chat',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"id":' }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        },
        {
          id: 'chat-1',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] },
              finish_reason: 'tool_calls'
            }
          ]
        },
        {
          id: 'chat-1',
          object: 'chat.completion.chunk',
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 }
        }
      ])
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: AiChatEvent[] = []

    const result = await streamSingleAiProtocolChat(
      createAdapter(createProvider('openai-chat'), 15_000),
      'gpt-5-mini',
      {
        messages: [{ role: 'user', content: '测试' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup',
              description: '查询',
              parameters: { type: 'object', properties: {} }
            }
          }
        ],
        toolChoice: 'required',
        modelReasoning: {
          protocol: 'openai-compatible',
          efforts: { high: 'high' },
          responseField: 'reasoning_content'
        },
        reasoningEffort: 'high'
      },
      new AbortController().signal,
      (event) => events.push(event)
    )

    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(String(url)).toBe('https://ai.example/v1/chat/completions')
    expect(body).toMatchObject({
      model: 'gpt-5-mini',
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: 'high',
      tool_choice: 'required'
    })
    expect(events.map((event) => event.type)).toEqual([
      'reasoning',
      'reasoning_end',
      'content',
      'tool_call',
      'tool_call',
      'usage'
    ])
    expect(result).toMatchObject({
      content: '答案',
      reasoning_content: '分析',
      finish_reason: 'tool_calls',
      usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
      tool_calls: [{ id: 'call-chat', function: { name: 'lookup', arguments: '{"id":1}' } }]
    })
  })
})
