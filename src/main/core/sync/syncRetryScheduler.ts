import { EventEmitter } from 'events'
import {
  classifySyncError,
  SyncRetryStatus,
  SyncTask,
  SyncTaskStatus,
  SyncTaskStore
} from './syncTaskStore'

export type SyncTaskRunner = (task: SyncTask) => Promise<void>

export class SyncRetryScheduler extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private lastStatusKey = ''

  constructor(
    private store: SyncTaskStore,
    private runner: SyncTaskRunner,
    private options: { intervalMs?: number } = {}
  ) {
    super()
  }

  start(): void {
    this.stop()
    this.store.recoverRunningTasks()
    this.timer = setInterval(() => this.runDue(), this.options.intervalMs || 1000)
    this.runDue()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  retryNow(): void {
    for (const task of this.store.list()) {
      if (task.status === 'pending') {
        this.store.upsert({
          id: task.id,
          type: task.type,
          payload: task.payload,
          nextRetryAt: Date.now()
        })
      }
    }
    this.runDue()
    this.emitStatus()
  }

  getStatus(): SyncRetryStatus {
    return this.store.status()
  }

  emitStatus(): void {
    const status = this.getStatus()
    const statusKey = JSON.stringify(status)
    if (statusKey === this.lastStatusKey) return
    this.lastStatusKey = statusKey
    this.emit('status', status)
  }

  private async runDue(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const tasks = this.store.due()
      for (const task of tasks) {
        await this.runTask(task)
      }
    } finally {
      this.running = false
      this.emitStatus()
    }
  }

  private async runTask(task: SyncTask): Promise<void> {
    this.store.markRunning(task.id)
    this.emitStatus()
    try {
      await this.runner(task)
    } catch (err) {
      const status: SyncTaskStatus = classifySyncError(err)
      this.store.markFailed(task.id, err, status)
      this.emit('task-error', err)
    }
  }
}
