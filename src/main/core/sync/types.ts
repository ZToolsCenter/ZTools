/**
 * WebSocket 同步系统类型定义
 */

/**
 * 同步配置
 */
export interface SyncConfig {
  enabled: boolean
  serverUrl: string // WebSocket 服务器地址 ws://host:port
  token: string // JWT token（加密存储）
  refreshToken?: string // 刷新 token（单次使用，服务端换发后更新）
  syncInterval: number // 心跳间隔（秒）
  lastSyncTime: number
  deviceId: string
  username?: string // 显示用
}

/**
 * 变更日志条目（本地 changelogDb 存储 + 网络传输）
 */
export interface ChangeEntry {
  seq: number
  docId: string
  rev: string
  parentRev?: string | null
  /**
   * CouchDB 风格 revision lineage，按当前 rev -> 祖先 rev 排序。
   * 首次全量推送只上传当前正文，但会携带祖先链，避免服务端把高版本当成孤立根。
   */
  revisionHistory?: string[]
  deleted: boolean
  timestamp: number
  winnerRev?: string
  isWinner?: boolean
  resolution?: { retireOtherLeaves?: boolean }
}

/**
 * 带完整文档的变更条目（网络传输用）
 */
export interface FullChangeEntry extends ChangeEntry {
  doc: any | null // deleted 时为 null
  /** 文档变更时为 'doc' 或省略；附件通过文档 _attachments stub 同步 */
  docType?: 'doc'
}

export interface SyncFeatures {
  revisionRetention?: boolean
  snapshotPull?: boolean
}

export interface RemoteCheckpointPayload {
  id: string
  sourceId?: string
  targetId?: string
  lastSeq?: number
  remotePullSeq?: number
  localPushSeq?: number
  syncEpoch?: number
  protocolVersion?: number
  updatedAt?: number
  data?: any
}

/**
 * 客户端 → 服务端消息
 */
export type ClientMessage =
  | {
      type: 'auth'
      token: string
      deviceId: string
      deviceName?: string
      protocolVersion?: number
    }
  | { type: 'pull'; since: number; snapshot?: boolean; protocolVersion?: number }
  | { type: 'get_checkpoint'; checkpointId: string }
  | { type: 'put_checkpoint'; checkpoint: RemoteCheckpointPayload }
  | { type: 'push'; changes: FullChangeEntry[]; protocolVersion?: number }
  | { type: 'ping' }

/**
 * 服务端 → 客户端消息
 */
export type ServerMessage =
  | {
      type: 'auth_ok'
      serverSeq: number
      protocolVersion?: number
      syncEpoch?: number
      features?: SyncFeatures
    }
  | {
      type: 'changes'
      changes: FullChangeEntry[]
      seq: number
      snapshot?: boolean
      reset?: boolean
      syncEpoch?: number
    }
  | { type: 'change'; change: FullChangeEntry }
  | { type: 'push_ok'; seq: number }
  | { type: 'push_missing'; message?: string; missingDigests: string[] }
  | { type: 'checkpoint'; checkpoint: RemoteCheckpointPayload }
  | { type: 'checkpoint_ok'; checkpoint: RemoteCheckpointPayload }
  | { type: 'error'; message: string }
  | { type: 'pong' }

/**
 * 同步客户端状态
 */
export type SyncState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'pulling'
  | 'pushing'
  | 'live'
  | 'error'

/**
 * 同步结果
 */
export interface SyncResult {
  uploaded: number
  downloaded: number
  errors: number
}
