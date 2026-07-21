import { open } from 'lmdb'
import { EventEmitter } from 'events'
import fs from 'fs'
import { DbDoc, DbResult, LmdbConfig, ChangeEntry, SyncMeta } from './types'
import { SyncApi } from './syncApi'
import { PromiseApi } from './promiseApi'

/**
 * LMDB 数据库主类
 * 提供完全兼容 UTools 的数据库 API
 * 继承 EventEmitter，在数据变更时 emit 'change' 事件
 */
export default class LmdbDatabase extends EventEmitter {
  private env: any
  private mainDb: any
  private metaDb: any
  private attachmentDb: any
  private changelogDb: any
  private revisionDb: any
  private syncTaskDb: any

  private syncApi: SyncApi
  private promiseApi: PromiseApi

  /**
   * promises 对象，提供所有 Promise 形式的 API
   */
  public promises: {
    put: (doc: DbDoc) => Promise<DbResult>
    get: (id: string) => Promise<DbDoc | null>
    remove: (docOrId: DbDoc | string) => Promise<DbResult>
    removeAndResolve: (docOrId: DbDoc | string) => Promise<DbResult>
    bulkDocs: (docs: DbDoc[]) => Promise<DbResult[]>
    allDocs: (key?: string | string[]) => Promise<DbDoc[]>
    postAttachment: (id: string, attachment: Buffer | Uint8Array, type: string) => Promise<DbResult>
    getAttachment: (id: string) => Promise<Uint8Array | null>
    getAttachmentType: (id: string) => Promise<string | null>
    getSyncMeta: (id: string) => Promise<SyncMeta | null>
    updateSyncStatus: (id: string, cloudSynced: boolean) => Promise<void>
  }

  /**
   * 构造函数
   * @param config LMDB 配置对象
   */
  constructor(config: LmdbConfig) {
    super()

    // 确保目录存在
    if (!fs.existsSync(config.path)) {
      fs.mkdirSync(config.path, { recursive: true })
    }

    // 打开 LMDB 环境
    this.env = open({
      path: config.path,
      mapSize: config.mapSize || 2 * 1024 * 1024 * 1024, // 默认 2GB
      maxDbs: config.maxDbs || 6,
      compression: false,
      encoding: 'binary'
    })

    // 打开五个数据库
    this.mainDb = this.env.openDB({
      name: 'main',
      encoding: 'string'
    })

    this.metaDb = this.env.openDB({
      name: 'meta',
      encoding: 'string'
    })

    this.attachmentDb = this.env.openDB({
      name: 'attachment',
      encoding: 'binary'
    })

    this.changelogDb = this.env.openDB({
      name: 'changelog',
      encoding: 'string'
    })

    this.revisionDb = this.env.openDB({
      name: 'revision',
      encoding: 'string'
    })

    this.syncTaskDb = this.env.openDB({
      name: 'syncTask',
      encoding: 'string'
    })

    // 初始化 API（传入 changelogDb、revisionDb 和 emitter）
    this.syncApi = new SyncApi(
      this.env,
      this.mainDb,
      this.metaDb,
      this.attachmentDb,
      this.changelogDb,
      this.revisionDb,
      this
    )
    this.promiseApi = new PromiseApi(this.syncApi)

    // 设置 promises 对象
    this.promises = {
      put: (doc: DbDoc) => this.promiseApi.put(doc),
      get: (id: string) => this.promiseApi.get(id),
      remove: (docOrId: DbDoc | string) => this.promiseApi.remove(docOrId),
      removeAndResolve: (docOrId: DbDoc | string) => this.promiseApi.removeAndResolve(docOrId),
      bulkDocs: (docs: DbDoc[]) => this.promiseApi.bulkDocs(docs),
      allDocs: (key?: string | string[]) => this.promiseApi.allDocs(key),
      postAttachment: (id: string, attachment: Buffer | Uint8Array, type: string) =>
        this.promiseApi.postAttachment(id, attachment, type),
      getAttachment: (id: string) => this.promiseApi.getAttachment(id),
      getAttachmentType: (id: string) => this.promiseApi.getAttachmentType(id),
      getSyncMeta: (id: string) => this.promiseApi.getSyncMeta(id),
      updateSyncStatus: (id: string, cloudSynced: boolean) =>
        this.promiseApi.updateSyncStatus(id, cloudSynced)
    }
  }

  // ==================== 同步 API ====================

  /**
   * 创建或更新文档（同步）
   * @param doc 文档对象，必须包含 _id
   * @returns 操作结果
   */
  put(doc: DbDoc): DbResult {
    return this.syncApi.put(doc)
  }

  /**
   * 根据 ID 获取文档（同步）
   * @param id 文档 ID
   * @returns 文档对象，不存在返回 null
   */
  get(id: string): DbDoc | null {
    return this.syncApi.get(id)
  }

  /**
   * 删除文档（同步）
   * @param docOrId 文档对象或文档 ID
   * @returns 操作结果
   */
  remove(docOrId: DbDoc | string): DbResult {
    return this.syncApi.remove(docOrId)
  }

  removeAndResolve(docOrId: DbDoc | string): DbResult {
    return this.syncApi.removeAndResolve(docOrId)
  }

  /**
   * 批量创建或更新文档（同步）
   * @param docs 文档对象数组
   * @returns 操作结果数组
   */
  bulkDocs(docs: DbDoc[]): DbResult[] {
    return this.syncApi.bulkDocs(docs)
  }

  /**
   * 获取文档数组（同步）
   * @param key 可选的文档 ID 前缀（字符串）或文档 ID 数组
   * @returns 文档对象数组
   */
  allDocs(key?: string | string[]): DbDoc[] {
    return this.syncApi.allDocs(key)
  }

  /**
   * 存储附件（同步）
   * @param id 文档 ID
   * @param attachment 附件数据（Buffer 或 Uint8Array）
   * @param type MIME 类型
   * @returns 操作结果
   */
  postAttachment(id: string, attachment: Buffer | Uint8Array, type: string): DbResult {
    return this.syncApi.postAttachment(id, attachment, type)
  }

  putAttachmentFromRemote(id: string, attachment: Buffer | Uint8Array, type: string): DbResult {
    return this.syncApi.putAttachmentFromRemote(id, attachment, type)
  }

  getSyncMeta(id: string): SyncMeta | null {
    return this.syncApi.getSyncMeta(id)
  }

  removeAttachment(id: string): void {
    return this.syncApi.removeAttachment(id)
  }

  removeAttachmentSilent(id: string): void {
    return this.syncApi.removeAttachmentSilent(id)
  }

  /**
   * 获取附件（同步）
   * @param id 附件文档 ID
   * @returns 附件数据（Uint8Array），不存在返回 null
   */
  getAttachment(id: string): Uint8Array | null {
    return this.syncApi.getAttachment(id)
  }

  /**
   * 获取附件元数据（同步）
   * @param id 附件文档 ID
   * @returns 附件元数据对象，不存在返回 null
   */
  getAttachmentType(id: string): any | null {
    return this.syncApi.getAttachmentType(id)
  }

  // ==================== 实用方法 ====================

  /**
   * 获取附件数据库实例（用于高级查询）
   * @returns 附件数据库实例
   */
  getAttachmentDb(): any {
    return this.attachmentDb
  }

  /**
   * 获取元数据数据库实例（用于高级查询）
   * @returns 元数据数据库实例
   */
  getMetaDb(): any {
    return this.metaDb
  }

  /**
   * 获取 changelog 数据库实例
   */
  getChangelogDb(): any {
    return this.changelogDb
  }

  getRevisionDb(): any {
    return this.revisionDb
  }

  getSyncTaskDb(): any {
    return this.syncTaskDb
  }

  // ==================== Changelog API ====================

  /**
   * 获取从指定序列号之后的所有变更
   */
  getChangesSince(sinceSeq: number): ChangeEntry[] {
    return this.syncApi.getChangesSince(sinceSeq)
  }

  /**
   * 获取当前最大序列号
   */
  getLastSeq(): number {
    return this.syncApi.getLastSeq()
  }

  getRevisionHistory(docId: string, rev?: string | null, maxDepth?: number): string[] {
    return this.syncApi.getRevisionHistory(docId, rev, maxDepth)
  }

  /**
   * 应用远端文档（跳过 _rev 冲突检测）
   */
  applyRemoteDoc(doc: DbDoc): DbResult {
    return this.syncApi.applyRemoteDoc(doc)
  }

  applyRemoteChange(change: {
    docId: string
    rev?: string
    parentRev?: string | null
    revisionHistory?: string[]
    deleted: boolean
    timestamp?: number
    doc?: DbDoc | null
    resolution?: { retireOtherLeaves?: boolean }
  }): DbResult {
    return this.syncApi.applyRemoteChange(change)
  }

  /**
   * 批量应用远端变更（单事务，性能优化）
   */
  applyRemoteBatch(
    changes: {
      doc?: DbDoc | null
      docId: string
      rev?: string
      parentRev?: string | null
      revisionHistory?: string[]
      deleted: boolean
      timestamp?: number
    }[]
  ): number {
    return this.syncApi.applyRemoteBatch(changes)
  }

  /**
   * 获取文档的冲突版本列表（远端/本地各执一词时保留的失败版本）
   */
  getConflicts(docId: string): DbDoc[] {
    return this.syncApi.getConflicts(docId)
  }

  resolveConflict(docId: string, sourceRev: string): DbResult {
    return this.syncApi.resolveConflict(docId, sourceRev)
  }

  /**
   * 清除文档的冲突记录
   */
  clearConflicts(docId: string): void {
    this.syncApi.clearConflicts(docId)
  }

  listAttachments(): Array<{ docId: string; md5: string; contentType: string }> {
    return this.syncApi.listAttachments()
  }

  /**
   * 应用远端删除（跳过 _rev 检测）
   */
  applyRemoteRemove(docId: string): DbResult {
    return this.syncApi.applyRemoteRemove(docId)
  }

  /**
   * 清理已确认的 changelog
   */
  compactChangelog(upToSeq: number): void {
    this.syncApi.compactChangelog(upToSeq)
  }

  /**
   * 关闭数据库
   */
  close(): void {
    try {
      this.env.close()
    } catch (e) {
      console.error('[LMDB] Error closing LMDB:', e)
    }
  }

  /**
   * 获取数据库统计信息
   */
  getStats(): any {
    try {
      return {
        main: this.mainDb.getStats?.() || {},
        meta: this.metaDb.getStats?.() || {},
        attachment: this.attachmentDb.getStats?.() || {},
        changelog: this.changelogDb.getStats?.() || {}
      }
    } catch (e) {
      console.error('[LMDB] Error getting stats:', e)
      return {}
    }
  }

  /**
   * 同步数据到磁盘
   */
  sync(): void {
    try {
      this.env.sync()
    } catch (e) {
      console.error('[LMDB] Error syncing LMDB:', e)
    }
  }
}
