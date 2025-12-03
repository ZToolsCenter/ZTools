/**
 * 数据库文档接口（完全兼容 UTools）
 */
export interface DbDoc {
  _id: string
  _rev?: string
  [key: string]: any
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
