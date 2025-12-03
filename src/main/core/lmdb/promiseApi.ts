import { DbDoc, DbResult } from './types'
import { SyncApi } from './syncApi'

/**
 * Promise API 实现类（完全兼容 UTools）
 * 将同步 API 包装为 Promise 形式
 */
export class PromiseApi {
  constructor(private syncApi: SyncApi) {}

  /**
   * 创建或更新文档（异步）
   * @param doc 文档对象，必须包含 _id
   * @returns Promise<操作结果>
   */
  async put(doc: DbDoc): Promise<DbResult> {
    // 使用 setImmediate 将操作放到下一个事件循环，避免阻塞
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          console.log('lmdb put', doc)
          const result = this.syncApi.put(doc)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  /**
   * 根据 ID 获取文档（异步）
   * @param id 文档 ID
   * @returns Promise<文档对象>，不存在返回 null
   */
  async get(id: string): Promise<DbDoc | null> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          console.log('lmdb get', id)
          const result = this.syncApi.get(id)
          console.log('lmdb get result', result)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  /**
   * 删除文档（异步）
   * @param docOrId 文档对象或文档 ID
   * @returns Promise<操作结果>
   */
  async remove(docOrId: DbDoc | string): Promise<DbResult> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.remove(docOrId)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  /**
   * 批量创建或更新文档（异步）
   * @param docs 文档对象数组
   * @returns Promise<操作结果数组>
   */
  async bulkDocs(docs: DbDoc[]): Promise<DbResult[]> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const results = this.syncApi.bulkDocs(docs)
          resolve(results)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  /**
   * 获取文档数组（异步）
   * @param key 可选的文档 ID 前缀（字符串）或文档 ID 数组
   * @returns Promise<文档对象数组>
   */
  async allDocs(key?: string | string[]): Promise<DbDoc[]> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const results = this.syncApi.allDocs(key)
          resolve(results)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  /**
   * 存储附件（异步）
   * @param id 文档 ID
   * @param attachment 附件数据（Buffer 或 Uint8Array）
   * @param type MIME 类型
   * @returns Promise<操作结果>
   */
  async postAttachment(
    id: string,
    attachment: Buffer | Uint8Array,
    type: string
  ): Promise<DbResult> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.postAttachment(id, attachment, type)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  /**
   * 获取附件（异步）
   * @param id 附件文档 ID
   * @returns Promise<附件数据（Uint8Array）>，不存在返回 null
   */
  async getAttachment(id: string): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.getAttachment(id)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  /**
   * 获取附件元数据（异步）
   * @param id 附件文档 ID
   * @returns Promise<附件元数据对象>，不存在返回 null
   */
  async getAttachmentType(id: string): Promise<any | null> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const result = this.syncApi.getAttachmentType(id)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      })
    })
  }
}
