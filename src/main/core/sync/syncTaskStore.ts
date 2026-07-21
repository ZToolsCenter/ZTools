import type { FullChangeEntry } from './types'

export type SyncTaskType = 'push_batch' | 'upload_blob' | 'download_blob'
export type SyncTaskStatus = 'pending' | 'running' | 'auth_required' | 'failed_permanent'

export interface PushBatchTaskPayload {
  fromSeq: number
  toSeq: number
  changes: FullChangeEntry[]
  checkpointId: string
}

export interface UploadBlobTaskPayload {
  docId: string
  digest: string
  contentType: string
}

export interface DownloadBlobTaskPayload {
  docId: string
  digest: string
  contentType?: string
  length?: number
}

export type SyncTaskPayload = PushBatchTaskPayload | UploadBlobTaskPayload | DownloadBlobTaskPayload

export interface SyncTask {
  id: string
  type: SyncTaskType
  status: SyncTaskStatus
  payload: SyncTaskPayload
  attempts: number
  nextRetryAt: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface SyncRetryStatus {
  pendingPushBatches: number
  pendingUploads: number
  pendingDownloads: number
  failedPermanent: number
  authRequired: number
  lastError?: string
  nextRetryAt?: number
}

const TASK_PREFIX = 'task:'
const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000, 300000]

export class SyncTaskStore {
  constructor(private taskDb: any) {}

  upsert(task: {
    id: string
    type: SyncTaskType
    payload: SyncTaskPayload
    status?: SyncTaskStatus
    nextRetryAt?: number
  }): SyncTask {
    const existing = this.get(task.id)
    const now = Date.now()
    const next: SyncTask = {
      id: task.id,
      type: task.type,
      payload: task.payload,
      status: task.status || existing?.status || 'pending',
      attempts: existing?.attempts || 0,
      nextRetryAt: task.nextRetryAt ?? existing?.nextRetryAt ?? now,
      lastError: existing?.lastError,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    this.taskDb.putSync(this.key(task.id), JSON.stringify(next))
    return next
  }

  get(id: string): SyncTask | null {
    return this.parse(this.taskDb.get(this.key(id)))
  }

  list(): SyncTask[] {
    const result: SyncTask[] = []
    for (const { value } of this.taskDb.getRange({
      start: TASK_PREFIX,
      end: `${TASK_PREFIX}\xFF`
    })) {
      const task = this.parse(value)
      if (task) result.push(task)
    }
    return result.sort((a, b) => a.nextRetryAt - b.nextRetryAt || a.createdAt - b.createdAt)
  }

  due(now = Date.now()): SyncTask[] {
    return this.list().filter((task) => task.status === 'pending' && task.nextRetryAt <= now)
  }

  markRunning(id: string): SyncTask | null {
    return this.update(id, { status: 'running', updatedAt: Date.now() })
  }

  markPending(id: string): SyncTask | null {
    return this.update(id, { status: 'pending', updatedAt: Date.now() })
  }

  recoverRunningTasks(): number {
    let recovered = 0
    for (const task of this.list()) {
      if (task.status !== 'running') continue
      this.update(task.id, {
        status: 'pending',
        nextRetryAt: Date.now(),
        updatedAt: Date.now()
      })
      recovered += 1
    }
    return recovered
  }

  markFailed(id: string, error: unknown, status: SyncTaskStatus = 'pending'): SyncTask | null {
    const task = this.get(id)
    if (!task) return null
    const attempts = task.attempts + 1
    const nextRetryAt = status === 'pending' ? Date.now() + retryDelayMs(attempts) : 0
    return this.update(id, {
      status,
      attempts,
      nextRetryAt,
      lastError: errorMessage(error),
      updatedAt: Date.now()
    })
  }

  remove(id: string): void {
    this.taskDb.removeSync(this.key(id))
  }

  clear(): number {
    const tasks = this.list()
    for (const task of tasks) {
      this.remove(task.id)
    }
    return tasks.length
  }

  status(): SyncRetryStatus {
    const tasks = this.list()
    const pending = tasks.filter((task) => task.status === 'pending' || task.status === 'running')
    const lastErrorTask = [...tasks]
      .filter((task) => task.lastError)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const nextRetryAt = pending
      .filter((task) => task.status === 'pending' && task.nextRetryAt > Date.now())
      .map((task) => task.nextRetryAt)
      .sort((a, b) => a - b)[0]
    return {
      pendingPushBatches: pending.filter((task) => task.type === 'push_batch').length,
      pendingUploads: pending.filter((task) => task.type === 'upload_blob').length,
      pendingDownloads: pending.filter((task) => task.type === 'download_blob').length,
      failedPermanent: tasks.filter((task) => task.status === 'failed_permanent').length,
      authRequired: tasks.filter((task) => task.status === 'auth_required').length,
      lastError: lastErrorTask?.lastError,
      nextRetryAt
    }
  }

  private update(id: string, patch: Partial<SyncTask>): SyncTask | null {
    const existing = this.get(id)
    if (!existing) return null
    const next = { ...existing, ...patch }
    this.taskDb.putSync(this.key(id), JSON.stringify(next))
    return next
  }

  private key(id: string): string {
    return `${TASK_PREFIX}${id}`
  }

  private parse(raw: unknown): SyncTask | null {
    if (!raw) return null
    try {
      if (typeof raw === 'string') return JSON.parse(raw)
      if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString())
      return raw as SyncTask
    } catch {
      return null
    }
  }
}

export function retryDelayMs(attempts: number): number {
  const base = RETRY_DELAYS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS.length - 1)]
  return Math.floor(base + Math.random() * base * 0.2)
}

export function classifySyncError(error: unknown): SyncTaskStatus {
  const message = errorMessage(error)
  const status = Number(
    (error as any)?.status || message.match(/\b(400|401|403|404|413|5\d\d)\b/)?.[1] || 0
  )
  if (status === 401 || status === 403) return 'auth_required'
  if (status === 400 || status === 404 || status === 413) return 'failed_permanent'
  return 'pending'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
