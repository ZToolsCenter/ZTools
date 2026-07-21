/**
 * 数据库文档接口（完全兼容 UTools）
 */
export interface DbDoc {
  _id: string
  _rev?: string

  // 同步字段（优化方案）
  _lastModified?: number // 最后修改时间戳（毫秒），用于冲突解决
  _cloudSynced?: boolean // 是否已同步到云端，用于启动扫描优化

  [key: string]: any
}

export interface SyncMeta {
  _rev: string
  _winningRev?: string
  _lastModified?: number
  _cloudSynced?: boolean
  _deleted?: boolean
  _hasConflicts?: boolean
  _conflictCount?: number
}

export interface RevisionRecord {
  docId: string
  rev: string
  parentRev?: string | null
  deleted: boolean
  timestamp: number
  doc: DbDoc | null
  isLeaf?: boolean
}

/**
 * 数据库操作结果接口（完全兼容 UTools）
 */
export interface DbResult {
  id: string
  rev?: string
  ok?: boolean
  error?: boolean
  name?: string
  message?: string
}

/**
 * LMDB 配置接口
 */
export interface LmdbConfig {
  path: string
  mapSize?: number // 数据库最大大小（字节），默认 2GB
  maxDbs?: number // 最大数据库数量，默认 3
}

/**
 * LMDB 环境接口
 */
export interface LmdbEnv {
  openDB(options: { name: string }): LmdbDatabase
  transactionSync<T>(callback: () => T): T
  close(): void
}

/**
 * LMDB 数据库接口
 */
export interface LmdbDatabase {
  get(key: string): any
  putSync(key: string, value: any): void
  removeSync(key: string): boolean
  getRange(options: { start?: string; end?: string }): Iterable<{ key: string; value: any }>
}

/**
 * 变更日志条目
 */
export interface ChangeEntry {
  seq: number
  docId: string
  rev: string
  parentRev?: string | null
  deleted: boolean
  timestamp: number
  winnerRev?: string
  isWinner?: boolean
  resolution?: { retireOtherLeaves?: boolean }
}
