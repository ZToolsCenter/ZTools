import type LmdbDatabase from '../lmdb/index'
import type { FullChangeEntry } from './types'

const CHECKPOINT_KEY = '_sync_checkpoint'

export interface SyncCheckpoint {
  uid?: string
  deviceId?: string
  remotePullSeq: number
  localPushSeq: number
  syncEpoch: number
  protocolVersion: number
  pull?: {
    inProgress: boolean
    batchSince: number
    targetSeq?: number
    startedAt?: number
    updatedAt?: number
    lastError?: string
  }
  push?: {
    inProgress: boolean
    batchFromSeq: number
    batchToSeq: number
    changeIds: Array<{ seq: number; docId: string; rev: string }>
    startedAt?: number
    updatedAt?: number
    attempts: number
    nextRetryAt?: number
    lastError?: string
  }
}

export class SyncCheckpointStore {
  constructor(private db: LmdbDatabase) {}

  load(uid?: string, deviceId?: string): SyncCheckpoint {
    const metaDb = this.db.getMetaDb()
    const existing = this.parse(metaDb.get(this.key(uid, deviceId)))
    if (existing) {
      return this.normalize({ ...existing, uid, deviceId })
    }

    return this.reset(uid, deviceId)
  }

  save(checkpoint: SyncCheckpoint): void {
    this.db
      .getMetaDb()
      .putSync(
        this.key(checkpoint.uid, checkpoint.deviceId),
        JSON.stringify(this.normalize(checkpoint))
      )
  }

  reset(uid?: string, deviceId?: string): SyncCheckpoint {
    const checkpoint = this.normalize({
      uid,
      deviceId,
      remotePullSeq: 0,
      localPushSeq: 0,
      syncEpoch: 0,
      protocolVersion: 0
    })
    this.save(checkpoint)
    return checkpoint
  }

  beginPull(checkpoint: SyncCheckpoint, targetSeq: number): SyncCheckpoint {
    const now = Date.now()
    const next = this.normalize({
      ...checkpoint,
      pull: {
        inProgress: true,
        batchSince: checkpoint.remotePullSeq,
        targetSeq,
        startedAt: now,
        updatedAt: now
      }
    })
    this.save(next)
    return next
  }

  commitPull(
    checkpoint: SyncCheckpoint,
    remotePullSeq: number,
    options: { syncEpoch?: number; protocolVersion?: number } = {}
  ): SyncCheckpoint {
    const next = this.normalize({
      ...checkpoint,
      remotePullSeq,
      syncEpoch: options.syncEpoch ?? checkpoint.syncEpoch,
      protocolVersion: options.protocolVersion ?? checkpoint.protocolVersion,
      pull: {
        inProgress: false,
        batchSince: remotePullSeq,
        targetSeq: remotePullSeq,
        updatedAt: Date.now()
      }
    })
    this.save(next)
    return next
  }

  failPull(checkpoint: SyncCheckpoint, error: unknown): SyncCheckpoint {
    const next = this.normalize({
      ...checkpoint,
      pull: {
        ...(checkpoint.pull || { batchSince: checkpoint.remotePullSeq }),
        inProgress: false,
        updatedAt: Date.now(),
        lastError: this.errorMessage(error)
      }
    })
    this.save(next)
    return next
  }

  beginPush(checkpoint: SyncCheckpoint, batch: FullChangeEntry[]): SyncCheckpoint {
    const sequenced = batch.filter((change) => change.seq > 0)
    const batchFromSeq = sequenced.length > 0 ? sequenced[0].seq : 0
    const batchToSeq =
      sequenced.length > 0 ? sequenced[sequenced.length - 1].seq : checkpoint.localPushSeq
    const previousAttempts =
      checkpoint.push?.inProgress &&
      checkpoint.push.batchFromSeq === batchFromSeq &&
      checkpoint.push.batchToSeq === batchToSeq
        ? checkpoint.push.attempts
        : 0
    const now = Date.now()
    const next = this.normalize({
      ...checkpoint,
      push: {
        inProgress: true,
        batchFromSeq,
        batchToSeq,
        changeIds: batch.map((change) => ({
          seq: change.seq,
          docId: change.docId,
          rev: change.rev
        })),
        startedAt: checkpoint.push?.startedAt || now,
        updatedAt: now,
        attempts: previousAttempts + 1
      }
    })
    this.save(next)
    return next
  }

  commitPush(checkpoint: SyncCheckpoint): SyncCheckpoint {
    const committedSeq = checkpoint.push?.batchToSeq || checkpoint.localPushSeq
    return this.commitLocalPushSeq(
      {
        ...checkpoint,
        push: checkpoint.push
          ? {
              ...checkpoint.push,
              inProgress: false,
              updatedAt: Date.now(),
              lastError: undefined
            }
          : undefined
      },
      committedSeq
    )
  }

  commitLocalPushSeq(checkpoint: SyncCheckpoint, localPushSeq: number): SyncCheckpoint {
    const next = this.normalize({
      ...checkpoint,
      localPushSeq: Math.max(checkpoint.localPushSeq, localPushSeq)
    })
    this.save(next)
    return next
  }

  failPush(checkpoint: SyncCheckpoint, error: unknown): SyncCheckpoint {
    const next = this.normalize({
      ...checkpoint,
      push: checkpoint.push
        ? {
            ...checkpoint.push,
            inProgress: false,
            updatedAt: Date.now(),
            lastError: this.errorMessage(error)
          }
        : undefined
    })
    this.save(next)
    return next
  }

  private key(uid?: string, deviceId?: string): string {
    if (!uid || !deviceId) return CHECKPOINT_KEY
    return `${CHECKPOINT_KEY}:${uid}:${deviceId}`
  }

  private normalize(value: Partial<SyncCheckpoint>): SyncCheckpoint {
    return {
      uid: value.uid,
      deviceId: value.deviceId,
      remotePullSeq: this.safeNumber(value.remotePullSeq),
      localPushSeq: this.safeNumber(value.localPushSeq),
      syncEpoch: this.safeNumber(value.syncEpoch),
      protocolVersion: this.safeNumber(value.protocolVersion),
      pull: value.pull,
      push: value.push
    }
  }

  private parse(raw: unknown): SyncCheckpoint | null {
    if (!raw) return null
    try {
      if (typeof raw === 'string') return JSON.parse(raw)
      if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString())
      return raw as SyncCheckpoint
    } catch {
      return null
    }
  }

  private safeNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10)
      return Number.isFinite(parsed) ? parsed : 0
    }
    if (Buffer.isBuffer(value)) {
      const parsed = parseInt(value.toString(), 10)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
