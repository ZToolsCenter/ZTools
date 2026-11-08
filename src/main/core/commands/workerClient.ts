import type { Worker } from 'node:worker_threads'
import type {
  CommandCatalog,
  CommandCatalogInput,
  CommandMatchContext,
  CommandMatchRequest,
  CommandMatchResult,
  CommandRankState
} from '../../../shared/commandService'

interface WorkerTask {
  message: object
  timeout: number
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

/**
 * 管理隔离搜索线程；超时销毁线程并在下次任务恢复目录。
 */
export class SearchWorkerClient {
  private worker: Worker | undefined
  private sequence = 0
  private ready: Promise<CommandCatalog> | undefined
  private input: CommandCatalogInput | undefined
  private active: number | undefined
  private pending = new Map<number, WorkerTask>()

  /**
   * 注入线程工厂和计算预算，便于真实线程测试。
   * @param factory 创建 Worker 的函数
   * @param queryTimeout 查询超时毫秒数
   * @returns 客户端实例
   */
  constructor(
    private factory: () => Worker,
    private queryTimeout = 1000
  ) {}

  /**
   * 发布完整目录，调用方只在成功后替换可见快照。
   * @param input 原始目录来源
   * @returns 已完成索引的目录
   */
  publish(input: CommandCatalogInput): Promise<CommandCatalog> {
    this.input = input
    this.ready = this.call({ type: 'catalog', input }, 15000)
    return this.ready
  }

  /**
   * 等待首次建索引或超时后的目录恢复，查询和单条验证共用此边界。
   * @returns 索引可用后结束的 Promise
   * @throws 未发布目录或目录恢复失败时抛错
   */
  private async ensureReady(): Promise<void> {
    if (!this.ready && this.input) {
      this.ready = this.call({ type: 'catalog', input: this.input }, 15000)
    }
    if (!this.ready) throw new Error('搜索目录尚未初始化')
    await this.ready
  }

  /**
   * 等待索引恢复后计算查询，不向匹配引擎传递页面会话或目录版本。
   * @param request 最小匹配输入
   * @param state 排序所需的用户状态
   * @returns 查询结果
   * @throws 线程超时、崩溃或未初始化时抛错
   */
  async query(request: CommandMatchRequest, state: CommandRankState): Promise<CommandMatchResult> {
    await this.ensureReady()
    return this.call({ type: 'query', request, state }, this.queryTimeout)
  }

  /**
   * 在线程内只验证所选命令的内容规则，保持第三方正则隔离。
   * @param ruleId 稳定规则身份
   * @param context 所选结果对应的最小输入快照
   * @returns 规则当前是否可执行
   * @throws 线程超时、崩溃或未初始化时抛错
   */
  async validateCommand(ruleId: string, context: CommandMatchContext): Promise<boolean> {
    await this.ensureReady()
    return this.call({ type: 'validate', ruleId, context }, this.queryTimeout)
  }

  /**
   * 将任务排队并按顺序交给唯一计算线程，排队时间不占用计算预算。
   * @param message 可序列化任务
   * @param timeout 派发后的执行预算
   * @returns 线程任务返回值
   */
  private call(message: object, timeout: number): Promise<any> {
    if (!this.worker) {
      const worker = this.factory()
      this.worker = worker
      worker.unref()
      worker.on('message', (response) => {
        if (this.worker !== worker || this.active !== response.id) return
        const task = this.pending.get(response.id)!
        clearTimeout(task.timer)
        this.pending.delete(response.id)
        this.active = undefined
        if (response.error) task.reject(new Error(response.error))
        else task.resolve(response.value)
        this.dispatchNext()
      })
      worker.on('error', (error) => {
        if (this.worker === worker) this.reset(error)
      })
      worker.on('exit', (code) => {
        if (this.worker === worker) this.reset(new Error(`搜索线程退出: ${code}`))
      })
    }
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { message, timeout, resolve, reject })
      this.dispatchNext()
    })
  }

  /**
   * 为即将实际执行的任务启动超时，避免旧任务的等待挤占新查询预算。
   * @returns 无返回值
   */
  private dispatchNext(): void {
    if (this.active !== undefined || !this.worker) return
    const next = this.pending.entries().next().value
    if (!next) return
    const [id, task] = next
    this.active = id
    task.timer = setTimeout(
      () => this.reset(new Error('搜索计算超时，已终止搜索线程')),
      task.timeout
    )
    // 序列化失败也要释放队列，不能留下永远等待的 Promise。
    try {
      this.worker.postMessage({ ...task.message, id })
    } catch (error) {
      this.reset(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * 释放线程并拒绝所有排队任务，不将阻塞正则带入恢复线程。
   * @param error 本批次失败原因
   * @returns 无返回值
   */
  private reset(error: Error): void {
    const worker = this.worker
    this.worker = undefined
    this.ready = undefined
    this.active = undefined
    void worker?.terminate()
    for (const task of this.pending.values()) {
      clearTimeout(task.timer)
      task.reject(error)
    }
    this.pending.clear()
  }

  /**
   * 应用退出时结束线程和待处理任务。
   * @returns 无返回值
   */
  dispose(): void {
    this.reset(new Error('搜索服务已关闭'))
  }
}
