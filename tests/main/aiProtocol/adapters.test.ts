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
  it('rejects forced Anthropic tool choice while extended thinking is enabled', async () => {
    const adapter = createAdapter(createProvider('anthropic-messages'))

    await expect(
      adapter.stream(
        {
          model: 'claude-test',
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
            protocol: 'passthrough',
            efforts: { high: 'high' },
            responseField: 'auto'
          },
          reasoningEffort: 'high'
        },
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toMatchObject({
      normalizedCode: 'INVALID_REQUEST',
      message: expect.stringContaining('不支持 required toolChoice')
    })
  })

  it('streams Anthropic messages with native auth and normalized generation options', async () => {
    const fetchMock = vi.fn(async () =>
      createSseResponse([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '分析' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'signed-thinking' }
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
        toolChoice: 'auto',
        temperature: 1.8,
        maxTokens: 4096,
        modelReasoning: {
          protocol: 'passthrough',
          efforts: { high: 'high' },
          responseField: 'auto'
        },
        reasoningEffort: 'high'
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
      max_tokens: 4096,
      stream: true,
      tool_choice: { type: 'auto' },
      thinking: { type: 'enabled', budget_tokens: 3072 }
    })
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('temperature')
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
      tool_calls: [{ id: 'call-a', function: { name: 'lookup', arguments: '{"id":1}' } }],
      replay_state: {
        apiFormat: 'anthropic-messages',
        blocks: expect.arrayContaining([
          {
            type: 'thinking',
            item: {
              type: 'thinking',
              thinking: '分析',
              signature: 'signed-thinking'
            }
          }
        ])
      }
    })
  })

  it('streams OpenAI Responses output and sends Responses generation fields', async () => {
    const fetchMock = vi.fn(async () =>
      createSseResponse([
        { type: 'response.reasoning_text.delta', output_index: 0, delta: '分析' },
        { type: 'response.output_text.delta', output_index: 1, delta: '答案' },
        {
          type: 'response.output_item.added',
          output_index: 2,
          item: {
            id: 'function-item-r',
            type: 'function_call',
            call_id: 'call-r',
            name: 'lookup',
            arguments: ''
          }
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 2,
          item_id: 'function-item-r',
          delta: '{"id":2}'
        },
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
        maxTokens: 3072,
        modelReasoning: {
          protocol: 'openai-compatible',
          efforts: { high: 'high' },
          responseField: 'auto'
        },
        reasoningEffort: 'high'
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
      tool_choice: 'required',
      reasoning: { effort: 'high', summary: 'auto' },
      include: ['reasoning.encrypted_content']
    })
    expect(events.map((event) => event.type)).toEqual([
      'reasoning',
      'reasoning_end',
      'content',
      'tool_call'
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'tool_call',
      index: 0,
      id: 'call-r',
      name: 'lookup',
      argumentsDelta: '{"id":2}'
    })
    expect(result).toMatchObject({
      content: '答案',
      reasoning_content: '分析',
      finish_reason: 'tool_calls',
      tool_calls: [{ id: 'call-r', function: { name: 'lookup', arguments: '{"id":2}' } }],
      replay_state: { apiFormat: 'openai-responses' }
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
      tool_calls: [{ id: 'call-chat', function: { name: 'lookup', arguments: '{"id":1}' } }],
      replay_state: {
        apiFormat: 'openai-chat',
        blocks: [
          {
            type: 'reasoning',
            field: 'reasoning_content',
            value: '分析'
          }
        ]
      }
    })
  })

  it('replays the original Chat reasoning field during a tool-call second round', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createSseResponse([
          {
            id: 'chat-replay-1',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: {
                  reasoning_details: [{ type: 'reasoning.text', text: 'private reasoning' }],
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-replay',
                      type: 'function',
                      function: { name: 'lookup', arguments: '{}' }
                    }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ]
          }
        ])
      )
      .mockResolvedValueOnce(
        createSseResponse([
          {
            id: 'chat-replay-2',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }]
          }
        ])
      )
    vi.stubGlobal('fetch', fetchMock)
    const provider = createProvider('openai-chat')
    const adapter = createAdapter(provider)
    const modelReasoning = {
      protocol: 'passthrough' as const,
      efforts: { high: 'high' },
      responseField: 'reasoning_details' as const
    }
    const first = await streamSingleAiProtocolChat(
      adapter,
      'chat-replay-model',
      {
        messages: [{ role: 'user', content: 'run' }],
        modelReasoning,
        reasoningEffort: 'high'
      },
      new AbortController().signal,
      () => undefined
    )

    await streamSingleAiProtocolChat(
      adapter,
      'chat-replay-model',
      {
        messages: [
          { role: 'user', content: 'run' },
          {
            role: 'assistant',
            content: first.content ?? '',
            reasoning_content: first.reasoning_content ?? undefined,
            tool_calls: first.tool_calls,
            replay_state: first.replay_state
          },
          { role: 'tool', content: 'tool result', tool_call_id: 'call-replay' }
        ],
        modelReasoning,
        reasoningEffort: 'high'
      },
      new AbortController().signal,
      () => undefined
    )

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(secondBody.messages[1]).toMatchObject({
      role: 'assistant',
      reasoning_details: [{ type: 'reasoning.text', text: 'private reasoning' }],
      tool_calls: [{ id: 'call-replay' }]
    })
    expect(secondBody.messages[1]).not.toHaveProperty('reasoning_content')
  })
})
