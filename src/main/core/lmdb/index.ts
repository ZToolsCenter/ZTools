import { open } from 'lmdb'
import fs from 'fs'
import { DbDoc, DbResult, LmdbConfig } from './types'
import { SyncApi } from './syncApi'
import { PromiseApi } from './promiseApi'

/**
 * LMDB 数据库主类
 * 提供完全兼容 UTools 的数据库 API
 */
export default class LmdbDatabase {
  private env: any
  private mainDb: any
  private metaDb: any
  private attachmentDb: any

  private syncApi: SyncApi
  private promiseApi: PromiseApi

  /**
   * promises 对象，提供所有 Promise 形式的 API
   */
  public promises: {
    put: (doc: DbDoc) => Promise<DbResult>
    get: (id: string) => Promise<DbDoc | null>
    remove: (docOrId: DbDoc | string) => Promise<DbResult>
    bulkDocs: (docs: DbDoc[]) => Promise<DbResult[]>
    allDocs: (key?: string | string[]) => Promise<DbDoc[]>
    postAttachment: (id: string, attachment: Buffer | Uint8Array, type: string) => Promise<DbResult>
    getAttachment: (id: string) => Promise<Uint8Array | null>
    getAttachmentType: (id: string) => Promise<string | null>
  }

  /**
   * 构造函数
   * @param config LMDB 配置对象
   */
  constructor(config: LmdbConfig) {
    // 确保目录存在
    if (!fs.existsSync(config.path)) {
      fs.mkdirSync(config.path, { recursive: true })
    }

    // 打开 LMDB 环境
    this.env = open({
      path: config.path,
      mapSize: config.mapSize || 2 * 1024 * 1024 * 1024, // 默认 2GB
      maxDbs: config.maxDbs || 3,
      compression: false, // 禁用压缩以提高性能
      encoding: 'binary' // 使用二进制编码
    })

    // 打开三个数据库
    this.mainDb = this.env.openDB({
      name: 'main',
      encoding: 'string' // 主数据库使用字符串编码
    })

    this.metaDb = this.env.openDB({
      name: 'meta',
      encoding: 'string' // 元数据使用字符串编码
    })

    this.attachmentDb = this.env.openDB({
      name: 'attachment',
      encoding: 'binary' // 附件使用二进制编码
    })

    // 初始化 API
    this.syncApi = new SyncApi(this.env, this.mainDb, this.metaDb, this.attachmentDb)
    this.promiseApi = new PromiseApi(this.syncApi)

    // 设置 promises 对象
    this.promises = {
      put: (doc: DbDoc) => this.promiseApi.put(doc),
      get: (id: string) => this.promiseApi.get(id),
      remove: (docOrId: DbDoc | string) => this.promiseApi.remove(docOrId),
      bulkDocs: (docs: DbDoc[]) => this.promiseApi.bulkDocs(docs),
      allDocs: (key?: string | string[]) => this.promiseApi.allDocs(key),
      postAttachment: (id: string, attachment: Buffer | Uint8Array, type: string) =>
        this.promiseApi.postAttachment(id, attachment, type),
      getAttachment: (id: string) => this.promiseApi.getAttachment(id),
      getAttachmentType: (id: string) => this.promiseApi.getAttachmentType(id)
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
   * 关闭数据库
   */
  close(): void {
    try {
      this.env.close()
    } catch (e) {
      console.error('Error closing LMDB:', e)
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
        attachment: this.attachmentDb.getStats?.() || {}
      }
    } catch (e) {
      console.error('Error getting stats:', e)
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
      console.error('Error syncing LMDB:', e)
    }
  }
}
