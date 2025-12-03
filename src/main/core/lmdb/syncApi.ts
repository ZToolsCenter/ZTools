import { DbDoc, DbResult, LmdbEnv, LmdbDatabase as LmdbDb } from './types'
import {
  generateNewRev,
  createErrorResult,
  createSuccessResult,
  isValidDocId,
  isDocSizeExceeded,
  safeJsonParse,
  safeJsonStringify
} from './utils'
import crypto from 'crypto'

/**
 * 附件元数据接口
 */
interface AttachmentMetadata {
  type: string // MIME 类型
  length: number // 文件大小（字节）
  md5: string // MD5 哈希值
}

/**
 * 同步 API 实现类（完全兼容 UTools）
 */
export class SyncApi {
  constructor(
    private env: LmdbEnv,
    private mainDb: LmdbDb,
    private metaDb: LmdbDb,
    private attachmentDb: LmdbDb
  ) {}

  /**
   * 创建或更新文档（同步）
   * @param doc 文档对象，必须包含 _id
   * @returns 操作结果
   */
  put(doc: DbDoc): DbResult {
    try {
      // 1. 验证 _id
      if (!isValidDocId(doc._id)) {
        return createErrorResult('exception', '_id is required and must be a string', doc._id)
      }

      // 2. 检查文档大小（1M 限制）
      if (isDocSizeExceeded(doc, 1024 * 1024)) {
        return createErrorResult('exception', 'Document size exceeds 1M', doc._id)
      }

      // 3. 使用事务保证原子性
      return this.env.transactionSync(() => {
        const id = doc._id
        const existingRev = this.metaDb.get(id)

        // 4. 版本验证
        if (existingRev) {
          // 文档已存在，必须提供正确的 _rev
          if (!doc._rev || doc._rev !== existingRev) {
            return createErrorResult('conflict', 'Document update conflict', id)
          }
        }

        // 5. 生成新版本
        const newRev = generateNewRev(existingRev)
        const docToSave = { ...doc, _rev: newRev }

        // 6. 保存文档和元数据
        this.mainDb.putSync(id, safeJsonStringify(docToSave))
        this.metaDb.putSync(id, newRev)

        // 7. 更新原始文档的 _rev（保持 UTools 行为）
        doc._rev = newRev

        return createSuccessResult(id, newRev)
      })
    } catch (e: any) {
      console.error('put error:', e)
      return createErrorResult(e.name || 'exception', e.message, doc._id)
    }
  }

  /**
   * 根据 ID 获取文档（同步）
   * @param id 文档 ID
   * @returns 文档对象，不存在返回 null
   */
  get(id: string): DbDoc | null {
    try {
      const docStr = this.mainDb.get(id)
      if (!docStr) {
        return null
      }

      const doc = safeJsonParse(docStr)
      return doc
    } catch (e: any) {
      console.error('get error:', e)
      return null
    }
  }

  /**
   * 删除文档（同步）
   * @param docOrId 文档对象或文档 ID
   * @returns 操作结果
   */
  remove(docOrId: DbDoc | string): DbResult {
    try {
      let id: string
      let rev: string | undefined

      // 1. 参数处理
      if (typeof docOrId === 'string') {
        id = docOrId
        // 根据 ID 删除，先获取现有文档
        const existingDoc = this.get(id)
        if (!existingDoc) {
          return createErrorResult('not_found', 'Document not found', id)
        }
        rev = existingDoc._rev
      } else {
        id = docOrId._id
        rev = docOrId._rev

        if (!isValidDocId(id)) {
          return createErrorResult('exception', '_id is required', id)
        }

        // 验证版本
        const currentRev = this.metaDb.get(id)
        if (currentRev && rev && rev !== currentRev) {
          return createErrorResult('conflict', 'Document update conflict', id)
        }
      }

      // 2. 使用事务删除
      return this.env.transactionSync(() => {
        console.log('remove doc:', id)
        this.mainDb.removeSync(id)
        this.metaDb.removeSync(id)
        return createSuccessResult(id)
      })
    } catch (e: any) {
      console.error('remove error:', e)
      const id = typeof docOrId === 'string' ? docOrId : docOrId._id
      return createErrorResult(e.name || 'exception', e.message, id)
    }
  }

  /**
   * 批量创建或更新文档（同步）
   * @param docs 文档对象数组
   * @returns 操作结果数组
   */
  bulkDocs(docs: DbDoc[]): DbResult[] {
    try {
      // 1. 参数验证
      if (!Array.isArray(docs)) {
        throw new Error('docs must be an array')
      }

      // 2. 检查 _id 是否存在
      for (const doc of docs) {
        if (!isValidDocId(doc._id)) {
          throw new Error('All documents must have a valid _id')
        }
      }

      // 3. 检查 _id 唯一性
      const ids = docs.map((d) => d._id)
      if (new Set(ids).size !== ids.length) {
        throw new Error('Duplicate _id found in docs array')
      }

      // 4. 批量操作（使用事务保证原子性）
      const results: DbResult[] = []

      this.env.transactionSync(() => {
        for (const doc of docs) {
          try {
            // 在事务内执行 put 操作
            const result = this.putInTransaction(doc)
            results.push(result)
          } catch (e: any) {
            results.push(createErrorResult(e.name || 'exception', e.message, doc._id))
          }
        }
      })

      return results
    } catch (e: any) {
      console.error('bulkDocs error:', e)
      // 如果整体验证失败，返回空数组或抛出错误
      throw e
    }
  }

  /**
   * 获取文档数组（同步）
   * @param key 可选的文档 ID 前缀（字符串）或文档 ID 数组
   * @returns 文档对象数组
   */
  allDocs(key?: string | string[]): DbDoc[] {
    try {
      const results: DbDoc[] = []

      if (Array.isArray(key)) {
        // 数组模式：根据 ID 列表获取
        for (const id of key) {
          const doc = this.get(id)
          if (doc) {
            results.push(doc)
          }
        }
      } else {
        // 前缀模式：使用 getRange 进行范围查询
        const prefix = key || ''

        // 使用 lmdb-js 的 getRange 方法
        for (const { key: currentKey, value: docStr } of this.mainDb.getRange({
          start: prefix
        })) {
          // 检查是否仍在前缀范围内
          if (!currentKey.startsWith(prefix)) {
            break
          }

          const doc = safeJsonParse(docStr)
          if (doc) {
            results.push(doc)
          }
        }
      }

      return results
    } catch (e: any) {
      console.error('allDocs error:', e)
      return []
    }
  }

  /**
   * 存储附件（同步）
   * @param id 文档 ID
   * @param attachment 附件数据（Buffer 或 Uint8Array）
   * @param type MIME 类型
   * @returns 操作结果
   */
  postAttachment(id: string, attachment: Buffer | Uint8Array, type: string): DbResult {
    try {
      // 1. 转换为 Buffer
      const buffer = Buffer.from(attachment)

      // 2. 检查附件大小（UTools 限制 10M）
      if (buffer.byteLength > 10 * 1024 * 1024) {
        return createErrorResult('exception', 'Attachment exceeds 10M', id)
      }

      // 3. 检查是否已存在（附件不能更新）
      const existing = this.attachmentDb.get(`attachment:${id}`)
      if (existing) {
        return createErrorResult('conflict', 'Attachment already exists', id)
      }

      // 4. 计算 MD5
      const md5 = crypto.createHash('md5').update(buffer).digest('hex')

      // 5. 准备附件元数据
      const metadata: AttachmentMetadata = {
        type,
        length: buffer.byteLength,
        md5
      }

      // 6. 使用事务存储附件和元数据
      return this.env.transactionSync(() => {
        this.attachmentDb.putSync(`attachment:${id}`, buffer)
        this.attachmentDb.putSync(`attachment-ext:${id}`, safeJsonStringify(metadata))
        return createSuccessResult(id)
      })
    } catch (e: any) {
      console.error('postAttachment error:', e)
      return createErrorResult(e.name || 'exception', e.message, id)
    }
  }

  /**
   * 获取附件（同步）
   * @param id 附件文档 ID
   * @returns 附件数据（Uint8Array），不存在返回 null
   */
  getAttachment(id: string): Uint8Array | null {
    try {
      const buffer = this.attachmentDb.get(`attachment:${id}`)
      if (!buffer) {
        return null
      }

      return new Uint8Array(buffer)
    } catch (e: any) {
      console.error('getAttachment error:', e)
      return null
    }
  }

  /**
   * 获取附件元数据（同步）
   * @param id 附件文档 ID
   * @returns 附件元数据对象，不存在返回 null
   */
  getAttachmentType(id: string): AttachmentMetadata | null {
    try {
      const metadataStr = this.attachmentDb.get(`attachment-ext:${id}`)
      if (!metadataStr) {
        return null
      }

      const metadata = safeJsonParse(metadataStr)
      return metadata
    } catch (e: any) {
      console.error('getAttachmentType error:', e)
      return null
    }
  }

  /**
   * 在事务中执行 put 操作（用于 bulkDocs）
   * @param doc 文档对象
   * @returns 操作结果
   */
  private putInTransaction(doc: DbDoc): DbResult {
    // 验证
    if (!isValidDocId(doc._id)) {
      return createErrorResult('exception', '_id is required', doc._id)
    }

    if (isDocSizeExceeded(doc, 1024 * 1024)) {
      return createErrorResult('exception', 'Document size exceeds 1M', doc._id)
    }

    const id = doc._id
    const existingRev = this.metaDb.get(id)

    // 版本验证
    if (existingRev) {
      if (!doc._rev || doc._rev !== existingRev) {
        return createErrorResult('conflict', 'Document update conflict', id)
      }
    }

    // 生成新版本
    const newRev = generateNewRev(existingRev)
    const docToSave = { ...doc, _rev: newRev }

    // 保存
    this.mainDb.putSync(id, safeJsonStringify(docToSave))
    this.metaDb.putSync(id, newRev)

    // 更新原始文档的 _rev
    doc._rev = newRev

    return createSuccessResult(id, newRev)
  }
}
