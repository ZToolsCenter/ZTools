import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const moduleLoader = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const preloadPath = require.resolve('../../resources/preload.js')
const originalLoad = moduleLoader._load

describe('plugin preload internal api bridge', () => {
  const ipcInvoke = vi.fn()
  const ipcOn = vi.fn()
  const ipcSend = vi.fn()
  const ipcSendSync = vi.fn()
  const ipcRemoveListener = vi.fn()
  const ipcEmit = vi.fn()

  beforeEach(() => {
    delete require.cache[preloadPath]
    ipcInvoke.mockReset().mockResolvedValue({ success: true })
    ipcOn.mockReset()
    ipcSend.mockReset()
    ipcSendSync.mockReset()
    ipcRemoveListener.mockReset()
    ipcEmit.mockReset()
    ;(globalThis as any).window = {
      addEventListener: vi.fn()
    }

    moduleLoader._load = ((request: string, parent: unknown, isMain: boolean) => {
      if (request === 'electron') {
        return {
          ipcRenderer: {
            invoke: ipcInvoke,
            on: ipcOn,
            send: ipcSend,
            sendSync: ipcSendSync,
            removeListener: ipcRemoveListener,
            emit: ipcEmit
          }
        }
      }

      return originalLoad.call(moduleLoader, request, parent, isMain)
    }) as typeof originalLoad
  })

  afterEach(() => {
    delete require.cache[preloadPath]
    moduleLoader._load = originalLoad
    delete (globalThis as any).window
  })

  it('exposes updateDevProjectsOrder for internal plugin runtimes', async () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal

    expect(internalApi?.updateDevProjectsOrder).toBeTypeOf('function')

    await internalApi.updateDevProjectsOrder(['beta', 'alpha'])

    expect(ipcInvoke).toHaveBeenCalledWith('internal:update-dev-projects-order', ['beta', 'alpha'])
  })

  it('exposes upsertDevProjectByConfigPath for internal plugin runtimes', async () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal

    expect(internalApi?.upsertDevProjectByConfigPath).toBeTypeOf('function')

    await internalApi.upsertDevProjectByConfigPath('/workspace/demo/plugin.json')

    expect(ipcInvoke).toHaveBeenCalledWith(
      'internal:upsert-dev-project-by-config-path',
      '/workspace/demo/plugin.json'
    )
  })

  it('exposes accountDelete through the account IPC channel', async () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal

    expect(internalApi?.accountDelete).toBeTypeOf('function')

    await internalApi.accountDelete()

    expect(ipcInvoke).toHaveBeenCalledWith('account:delete')
  })

  it('exposes getLinuxSession through the internal IPC channel', () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal

    expect(internalApi?.getLinuxSession).toBeTypeOf('function')

    ipcSendSync.mockReturnValue({ isWayland: true })
    const result = internalApi.getLinuxSession()

    expect(ipcSendSync).toHaveBeenCalledWith('internal:get-linux-session')
    expect(result).toEqual({ isWayland: true })
  })

  it('exposes accountChangePassword through the account IPC channel', async () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal
    const params = { currentPassword: 'old-password', newPassword: 'new-password' }

    expect(internalApi?.accountChangePassword).toBeTypeOf('function')

    await internalApi.accountChangePassword(params)

    expect(ipcInvoke).toHaveBeenCalledWith('account:change-password', params)
  })

  it('converts reactive AI provider data before add and update IPC calls', async () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal
    const reasoning = new Proxy(
      {
        protocol: 'openai-compatible',
        efforts: new Proxy({ low: 'low', high: 'high' }, {}),
        defaultEffort: 'high',
        responseField: 'reasoning'
      },
      {}
    )
    const model = new Proxy({ modelId: 'model-a', contextWindow: 262144, reasoning }, {})
    const provider = new Proxy(
      {
        id: 'provider-a',
        name: '测试供应商',
        apiUrl: 'https://example.com/v1',
        apiKey: 'test-key',
        selectedModels: [model]
      },
      {}
    )

    await internalApi.aiProviders.add(provider)
    await internalApi.aiProviders.update(provider)

    const expectedProvider = {
      id: 'provider-a',
      name: '测试供应商',
      apiUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      selectedModels: [
        {
          modelId: 'model-a',
          contextWindow: 262144,
          reasoning: {
            protocol: 'openai-compatible',
            efforts: { low: 'low', high: 'high' },
            defaultEffort: 'high',
            responseField: 'reasoning'
          }
        }
      ]
    }
    const addCall = ipcInvoke.mock.calls.find(
      ([channel]) => channel === 'internal:ai-providers-add'
    )
    const updateCall = ipcInvoke.mock.calls.find(
      ([channel]) => channel === 'internal:ai-providers-update'
    )
    expect(addCall).toEqual(['internal:ai-providers-add', expectedProvider])
    expect(updateCall).toEqual(['internal:ai-providers-update', expectedProvider])
    expect(addCall?.[1]).not.toBe(provider)
    expect(addCall?.[1].selectedModels[0]).not.toBe(model)
    expect(addCall?.[1].selectedModels[0].reasoning).not.toBe(reasoning)
    expect(() => structuredClone(addCall?.[1])).not.toThrow()
  })

  it('exposes an abortable aiChat request and releases its event listener', async () => {
    const response = {
      success: true,
      data: {
        role: 'assistant',
        content: '完成',
        reasoning_content: null,
        tool_calls: [],
        finish_reason: 'stop'
      }
    }
    ipcInvoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'plugin:ai-chat' ? response : { success: true })
    )
    require(preloadPath)

    const aiChat = (globalThis as any).window.ztools?.aiChat
    expect(aiChat).toBeTypeOf('function')

    const eventCallback = vi.fn()
    const request = aiChat({ messages: [{ role: 'user', content: '测试' }] }, eventCallback)
    expect(request.abort).toBeTypeOf('function')
    request.abort()
    const eventListener = ipcOn.mock.calls.find(([eventName]) =>
      String(eventName).startsWith('plugin:ai-chat-event-')
    )?.[1]
    eventListener({}, { type: 'content', delta: '完成' })
    eventListener({}, { type: '__ztools_ai_chat_delivery_end__' })
    await expect(request).resolves.toEqual(response.data)

    const chatCall = ipcInvoke.mock.calls.find(([channel]) => channel === 'plugin:ai-chat')
    const abortCall = ipcInvoke.mock.calls.find(([channel]) => channel === 'plugin:ai-abort')
    expect(chatCall?.[1]).toBeTypeOf('string')
    expect(abortCall).toEqual(['plugin:ai-abort', chatCall?.[1]])
    expect(ipcRemoveListener).toHaveBeenCalledWith(
      `plugin:ai-chat-event-${chatCall?.[1]}`,
      expect.any(Function)
    )
    expect(eventCallback).toHaveBeenCalledOnce()
    expect(eventCallback).toHaveBeenCalledWith({ type: 'content', delta: '完成' })
  })

  it('restores structured aiChat failures as Error fields', async () => {
    ipcInvoke.mockResolvedValue({
      success: false,
      error: { code: 'RATE_LIMIT', status: 429, message: '请求过于频繁' }
    })
    require(preloadPath)

    const request = (globalThis as any).window.ztools.aiChat(
      { messages: [{ role: 'user', content: '测试' }] },
      vi.fn()
    )
    const eventListener = ipcOn.mock.calls.find(([eventName]) =>
      String(eventName).startsWith('plugin:ai-chat-event-')
    )?.[1]
    eventListener({}, { type: '__ztools_ai_chat_delivery_end__' })

    await expect(request).rejects.toMatchObject({
      name: 'Error',
      code: 'RATE_LIMIT',
      status: 429,
      message: '请求过于频繁'
    })
  })
})
