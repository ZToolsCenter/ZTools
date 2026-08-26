import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  loadStoredSyncConfig: vi.fn(),
  refreshStoredSyncTokens: vi.fn(),
  webSocketInstances: [] as any[]
}))

vi.mock('../../src/main/core/sync/syncAuthTokenService', () => ({
  loadStoredSyncConfig: authMocks.loadStoredSyncConfig,
  refreshStoredSyncTokens: authMocks.refreshStoredSyncTokens
}))

vi.mock('ws', () => {
  class MockWebSocket {
    static OPEN = 1
    readyState = MockWebSocket.OPEN
    send = vi.fn()
    private handlers = new Map<string, Array<(...args: any[]) => void>>()
    close = vi.fn(() => {
      this.readyState = 3
      this.emit('close')
    })

    /**
     * 创建可由测试主动触发 open/close 事件的 WebSocket 替身。
     * @param url 客户端准备连接的服务地址。
     * @returns 初始化后的 WebSocket 替身实例。
     */
    constructor(public url: string) {
      authMocks.webSocketInstances.push(this)
    }

    /**
     * 注册 WebSocket 事件监听器。
     * @param event 事件名称。
     * @param handler 事件回调函数。
     * @returns 当前 WebSocket 替身，支持链式调用。
     */
    on(event: string, handler: (...args: any[]) => void): this {
      const handlers = this.handlers.get(event) || []
      handlers.push(handler)
      this.handlers.set(event, handlers)
      return this
    }

    /**
     * 主动触发已注册的 WebSocket 事件。
     * @param event 事件名称。
     * @param args 传递给监听器的参数。
     * @returns 存在监听器时返回 true。
     */
    emit(event: string, ...args: any[]): boolean {
      const handlers = this.handlers.get(event) || []
      for (const handler of handlers) handler(...args)
      return handlers.length > 0
    }
  }

  return { default: MockWebSocket }
})

import { SyncClient } from '../../src/main/core/sync/syncClient'

describe('SyncClient authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.webSocketInstances.length = 0
  })

  it('catches refresh failure, leaves authenticating, and does not send stale auth data', async () => {
    const config = {
      enabled: true,
      serverUrl: 'wss://z.zosen.link',
      token: 'expired-token',
      refreshToken: 'invalid-refresh-token',
      syncInterval: 30,
      lastSyncTime: 0,
      deviceId: 'device-1',
      username: 'zing'
    }
    authMocks.loadStoredSyncConfig.mockResolvedValue(config)
    authMocks.refreshStoredSyncTokens.mockResolvedValue({
      status: 'invalid',
      config: { ...config, token: '', refreshToken: '' }
    })
    const client = new SyncClient(createFakeSyncDatabase() as any)
    const errors: string[] = []
    client.on('sync-error', (message) => errors.push(message))

    client.start(config)
    const ws = authMocks.webSocketInstances[0]
    ws.emit('open')

    await vi.waitFor(() => expect(client.getState()).toBe('error'))
    expect(ws.send).not.toHaveBeenCalled()
    expect(ws.close).toHaveBeenCalledTimes(1)
    expect(errors).toContain('登录状态已失效，请重新登录')
    client.stop()
  })
})

/**
 * 创建满足 SyncClient 构造和启动阶段所需的最小数据库替身。
 * @returns 同步客户端测试使用的数据库对象。
 */
function createFakeSyncDatabase(): Record<string, unknown> {
  const meta = new Map<string, unknown>()
  const metaDb = {
    get: (key: string) => meta.get(key) || null,
    putSync: (key: string, value: unknown) => meta.set(key, value)
  }
  const taskDb = {
    get: () => null,
    putSync: vi.fn(),
    removeSync: vi.fn(),
    getRange: () => []
  }
  return {
    getMetaDb: () => metaDb,
    getSyncTaskDb: () => taskDb
  }
}
