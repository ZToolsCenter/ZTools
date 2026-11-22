import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ dbGet: vi.fn(), dbPut: vi.fn() }))
vi.mock('../../src/main/api/shared/database', () => ({ default: database }))
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('fs', () => ({
  default: {
    existsSync: () => true,
    readFileSync: (path: string, encoding?: string) => {
      if (encoding) return 'worker'
      // 同时覆盖独占缓冲和只占用部分底层内存的视图。
      if (path.endsWith('.spm')) return Buffer.allocUnsafeSlow(32770).subarray(1, 32769).fill(17)
      return Buffer.allocUnsafeSlow(32768).fill(17)
    }
  }
}))

const workers: FakeWorker[] = []
class FakeWorker extends EventEmitter {
  messages: string[] = []
  terminated = false

  /**
   * 记录实例，以便核对并发请求和冷启动次数。
   * @returns 测试用翻译线程。
   */
  constructor() {
    super()
    workers.push(this)
  }

  /**
   * 模拟 Worker 的转移语义并检查模型字节与回复身份。
   * @param message 消息及参数。
   * @param transferList 主线程移交所有权的缓冲区。
   * @returns 无返回值。
   */
  postMessage(
    message: { id: number; name: string; args: any[] },
    transferList: ArrayBuffer[]
  ): void {
    this.messages.push(message.name)
    const cloned = structuredClone(message, { transfer: transferList })
    if (message.name === 'loadTranslationModel') {
      const { model, shortlist, vocabs } = cloned.args[1]
      expect(transferList).toHaveLength(4)
      for (const buffer of transferList) expect(buffer.byteLength).toBe(0)
      for (const buffer of [model, shortlist, ...vocabs]) {
        expect(buffer.byteLength).toBe(32768)
        expect(new Uint8Array(buffer)[0]).toBe(17)
      }
    }
    // 用微任务让多个调用在同一次冷启动期间到达。
    void Promise.resolve().then(() =>
      this.emit('message', { id: message.id, result: [{ target: { text: '译文' } }] })
    )
  }

  /**
   * 模拟终止；退出事件可在下一代 Worker 已就绪后抵达。
   * @returns 已结束的 Promise。
   */
  async terminate(): Promise<number> {
    this.terminated = true
    return 0
  }
}

vi.mock('node:worker_threads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:worker_threads')>()),
  Worker: FakeWorker
}))

describe('Bergamot 资源生命周期', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    workers.length = 0
    database.dbGet.mockReturnValue({ superPanelTranslateEnabled: true })
  })
  afterEach(() => vi.useRealTimers())

  it('启用后待命，首次有效请求合并加载，末次使用满 60 秒回收', async () => {
    const { default: engine } = await import('../../src/main/core/translationManager')
    engine.init()
    engine.updateEnabled(true)
    expect(await engine.translate('  ')).toBeNull()
    expect(await engine.translate('中文')).toBeNull()
    expect(engine.getStatus()).toMatchObject({ enabled: true, status: 'idle' })
    expect(workers).toHaveLength(0)

    expect(await Promise.all([engine.translate('one'), engine.translate('two')])).toEqual([
      '译文',
      '译文'
    ])
    const first = workers[0]
    expect(first.messages).toEqual(['initialize', 'loadTranslationModel', 'translate', 'translate'])
    await vi.advanceTimersByTimeAsync(59000)
    expect(await engine.translate('three')).toBe('译文')
    await vi.advanceTimersByTimeAsync(59999)
    expect(first.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(first.terminated).toBe(true)
    expect(engine.getStatus()).toMatchObject({ enabled: true, status: 'idle' })
    expect(await engine.translate('four')).toBe('译文')
    first.emit('exit', 1)
    expect(workers).toHaveLength(2)
    expect(engine.getStatus().status).toBe('ready')
  })

  it('禁用取消旧冷启动，异常退出后下一次翻译可重试', async () => {
    const { default: engine } = await import('../../src/main/core/translationManager')
    engine.init()
    const obsolete = engine.translate('obsolete')
    engine.updateEnabled(false)
    engine.updateEnabled(true)
    expect(await obsolete).toBeNull()
    expect(workers).toHaveLength(0)
    expect(await engine.translate('new')).toBe('译文')
    workers[0].emit('exit', 1)
    expect(engine.getStatus().status).toBe('error')
    expect(await engine.translate('retry')).toBe('译文')
    engine.updateEnabled(false)
    expect(await engine.translate('disabled')).toBeNull()
    expect(workers[1].terminated).toBe(true)
  })

  it('下载期间关闭再启用只下载一次，旧请求不能启动或销毁新线程', async () => {
    const { default: engine } = await import('../../src/main/core/translationManager')
    const resources = engine as unknown as {
      areResourcesReady(): boolean
      downloadResources(): Promise<void>
    }
    let finishDownload!: () => void
    let cached = false
    vi.spyOn(resources, 'areResourcesReady').mockImplementation(() => cached)
    const download = vi.spyOn(resources, 'downloadResources').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = () => {
            cached = true
            resolve()
          }
        })
    )
    engine.init()
    engine.updateEnabled(true)
    const stale = engine.translate('old')
    expect(engine.getStatus().status).toBe('downloading')
    engine.updateEnabled(false)
    engine.updateEnabled(true)
    const current = engine.translate('new')
    expect(workers).toHaveLength(0)
    finishDownload()
    expect(await stale).toBeNull()
    expect(await current).toBe('译文')
    expect(download).toHaveBeenCalledTimes(1)
    expect(workers).toHaveLength(1)
    expect(workers[0].terminated).toBe(false)
  })
})
