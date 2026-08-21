import { describe, expect, it } from 'vitest'
import type { ContentPart, Tool } from '../../../src/main/api/plugin/ai'
import {
  fromAnthropicContent,
  fromResponsesOutput,
  toAnthropicMessages,
  toAnthropicTools,
  toResponsesInput,
  toResponsesTools
} from '../../../src/main/api/plugin/aiProtocol/converters'

describe('aiProtocol converters', () => {
  describe('toAnthropicMessages', () => {
    it('extracts system instructions and keeps alternating roles', () => {
      const { system, messages } = toAnthropicMessages([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' }
      ])

      expect(system).toBe('You are helpful')
      expect(messages).toEqual([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
      ])
    })

    it('maps assistant tool calls to tool_use blocks and tool results to tool_result blocks', () => {
      const { system, messages } = toAnthropicMessages([
        { role: 'user', content: 'use the tool' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'getWeather', arguments: '{"city":"NY"}' }
            }
          ]
        },
        { role: 'tool', content: '{"temp":72}', tool_call_id: 'call_1' },
        { role: 'assistant', content: 'The temp is 72' }
      ])

      expect(system).toBe('')
      expect(messages[0]).toEqual({ role: 'user', content: 'use the tool' })
      // 助手无文本时仅发出 tool_use 块。
      expect(messages[1]).toEqual({
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_1', name: 'getWeather', input: { city: 'NY' } }]
      })
      // 工具结果归入 user 轮。
      expect(messages[2]).toEqual({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"temp":72}' }]
      })
      expect(messages[3]).toEqual({
        role: 'assistant',
        content: [{ type: 'text', text: 'The temp is 72' }]
      })
    })

    it('merges consecutive same-role messages to satisfy strict alternation', () => {
      const { messages } = toAnthropicMessages([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' }
      ])

      expect(messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' }
          ]
        }
      ])
    })

    it('maps multimodal user content with a base64 data URI image', () => {
      const content: ContentPart[] = [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,ABC=' } }
      ]
      const { messages } = toAnthropicMessages([{ role: 'user', content }])

      expect(messages[0]).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'ABC=' }
          }
        ]
      })
    })

    it('prepends a placeholder user message when the conversation does not start with user', () => {
      const { messages } = toAnthropicMessages([{ role: 'assistant', content: 'hi' }])

      expect(messages[0].role).toBe('user')
      expect(messages[1]).toEqual({
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }]
      })
    })
  })

  describe('fromAnthropicContent', () => {
    it('normalizes text, thinking and tool_use blocks', () => {
      const turn = fromAnthropicContent([
        { type: 'text', text: 'Hi' },
        { type: 'thinking', thinking: 'reasoning' },
        { type: 'tool_use', id: 't1', name: 'do', input: { x: 1 } }
      ])

      expect(turn.content).toBe('Hi')
      expect(turn.reasoningContent).toBe('reasoning')
      expect(turn.toolCalls).toEqual([
        {
          id: 't1',
          type: 'function',
          function: { name: 'do', arguments: '{"x":1}' }
        }
      ])
    })
  })

  describe('toAnthropicTools', () => {
    it('converts plugin tool definitions to Anthropic tools', () => {
      const tools: Tool[] = [
        {
          type: 'function',
          function: {
            name: 'do',
            description: 'does it',
            parameters: { type: 'object', properties: {} }
          }
        }
      ]

      expect(toAnthropicTools(tools)).toEqual([
        {
          name: 'do',
          description: 'does it',
          input_schema: { type: 'object', properties: {} }
        }
      ])
    })

    it('returns undefined when there are no tools', () => {
      expect(toAnthropicTools()).toBeUndefined()
    })
  })

  describe('toResponsesInput', () => {
    it('maps a tool-call round trip to function_call and function_call_output items', () => {
      const items = toResponsesInput([
        { role: 'user', content: 'use the tool' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'getWeather', arguments: '{"city":"NY"}' }
            }
          ]
        },
        { role: 'tool', content: '{"temp":72}', tool_call_id: 'call_1' }
      ])

      // 助手无文本时不发出消息项，仅补充函数调用项。
      expect(items).toEqual([
        { type: 'message', role: 'user', content: 'use the tool' },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'getWeather',
          arguments: '{"city":"NY"}'
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '{"temp":72}'
        }
      ])
    })

    it('emits an assistant message item followed by function_call items when text is present', () => {
      const items = toResponsesInput([
        {
          role: 'assistant',
          content: 'thinking',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'f', arguments: '{}' }
            }
          ]
        }
      ])

      expect(items).toEqual([
        { type: 'message', role: 'assistant', content: 'thinking' },
        { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' }
      ])
    })

    it('maps multimodal user content to Responses input parts', () => {
      const content: ContentPart[] = [
        { type: 'text', text: 'hi' },
        { type: 'image_url', image_url: { url: 'https://x/y.png' } }
      ]
      const items = toResponsesInput([{ role: 'user', content }])

      expect(items).toEqual([
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'hi' },
            { type: 'input_image', image_url: 'https://x/y.png', detail: 'auto' }
          ]
        }
      ])
    })
  })

  describe('fromResponsesOutput', () => {
    it('normalizes message, function_call and reasoning output items', () => {
      const turn = fromResponsesOutput([
        { type: 'message', content: [{ type: 'output_text', text: 'Hello' }] },
        { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{"a":1}' },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'sum' }],
          content: [{ type: 'reasoning_text', text: 'r' }]
        }
      ])

      expect(turn.content).toBe('Hello')
      expect(turn.reasoningContent).toBe('sumr')
      expect(turn.toolCalls).toEqual([
        {
          id: 'c1',
          type: 'function',
          function: { name: 'f', arguments: '{"a":1}' }
        }
      ])
    })

    it('returns an empty turn when the output is missing', () => {
      const turn = fromResponsesOutput(undefined)
      expect(turn.content).toBe('')
      expect(turn.toolCalls).toEqual([])
    })
  })

  describe('toResponsesTools', () => {
    it('converts plugin tools to Responses function tools with strict disabled', () => {
      const tools: Tool[] = [
        {
          type: 'function',
          function: {
            name: 'do',
            description: 'does it',
            parameters: { type: 'object', properties: {} }
          }
        }
      ]

      expect(toResponsesTools(tools)).toEqual([
        {
          type: 'function',
          name: 'do',
          description: 'does it',
          parameters: { type: 'object', properties: {} },
          strict: false
        }
      ])
    })

    it('returns undefined when there are no tools', () => {
      expect(toResponsesTools()).toBeUndefined()
    })
  })
})
