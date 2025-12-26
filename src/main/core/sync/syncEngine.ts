import { WebDAVSyncClient } from './webdavClient'
import { SyncConfig, SyncResult } from './types'
import LmdbDatabase from '../lmdb/index'
import { safeStorage } from 'electron'

/**
 * 同步引擎
 */
export class SyncEngine {
  private webdavClient: WebDAVSyncClient
  private db: LmdbDatabase
  private syncTimer: NodeJS.Timeout | null = null

  constructor(db: LmdbDatabase) {
    this.db = db
    this.webdavClient = new WebDAVSyncClient()
  }

  /**
   * 初始化同步引擎
   */
  async init(): Promise<void> {
    // 加载同步配置
    const config = await this.loadSyncConfig()
    if (!config || !config.enabled) {
      console.log('[Sync] 同步未启用')
      return
    }

    // 解密密码
    if (config.password && safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(config.password, 'base64')
        config.password = safeStorage.decryptString(buffer)
      } catch (error) {
        console.error('[Sync] 解密密码失败:', error)
        throw new Error('解密密码失败')
      }
    }

    // 初始化 WebDAV 客户端
    await this.webdavClient.init(config)

    // 启动定时同步
    this.startAutoSync(config.syncInterval)

    console.log('[Sync] 同步引擎初始化完成')
  }

  /**
   * 加载同步配置
   */
  private async loadSyncConfig(): Promise<SyncConfig | null> {
    try {
      const doc = await this.db.promises.get('SYNC/config')
      return doc?.data || null
    } catch (error) {
      console.error('[Sync] 加载配置失败:', error)
      return null
    }
  }

  /**
   * 保存同步配置
   */
  async saveSyncConfig(config: SyncConfig): Promise<void> {
    // 先获取现有文档以获得 _rev
    const existingDoc = await this.db.promises.get('SYNC/config')

    await this.db.promises.put({
      _id: 'SYNC/config',
      _rev: existingDoc?._rev, // 保留现有的 _rev
      data: config
    })
  }

  /**
   * 启动自动同步
   */
  private startAutoSync(intervalSeconds: number): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
    }

    this.syncTimer = setInterval(() => {
      this.performSync().catch((error) => {
        console.error('[Sync] 自动同步失败:', error)
      })
    }, intervalSeconds * 1000)

    console.log(`[Sync] 自动同步已启动，间隔 ${intervalSeconds} 秒`)
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
      console.log('[Sync] 自动同步已停止')
    }
  }

  /**
   * 执行完整同步流程
   */
  async performSync(): Promise<SyncResult> {
    console.log('[Sync] 开始同步...')

    try {
      // 1. 上传本地变更（返回已处理的文档 ID 列表）
      const uploadResult = await this.uploadLocalChanges()

      // 2. 上传本地附件变更
      const uploadAttachmentResult = await this.uploadLocalAttachments()

      // 3. 下载云端变更（排除已在上传阶段处理的文档）
      const downloadResult = await this.downloadRemoteChanges(uploadResult.processedDocIds)

      // 4. 下载云端附件变更
      const downloadAttachmentResult = await this.downloadRemoteAttachments()

      // 5. 更新同步时间
      await this.updateLastSyncTime()

      const result: SyncResult = {
        uploaded: uploadResult.count + uploadAttachmentResult.count,
        downloaded: downloadResult.count + downloadAttachmentResult.count,
        conflicts: 0,
        errors:
          uploadResult.errors +
          uploadAttachmentResult.errors +
          downloadResult.errors +
          downloadAttachmentResult.errors
      }

      console.log('[Sync] 同步完成:', result)
      return result
    } catch (error) {
      console.error('[Sync] 同步失败:', error)
      throw error
    }
  }

  /**
   * 强制从云端下载所有数据到本地（覆盖本地数据）
   */
  async forceDownloadFromCloud(): Promise<SyncResult> {
    console.log('[Sync] 开始强制从云端同步到本地...')

    try {
      // 获取云端所有文件列表
      const remoteFiles = await this.webdavClient.listRemoteDocsWithMeta()

      if (remoteFiles.length === 0) {
        console.log('[Sync] 云端没有数据')
        return { uploaded: 0, downloaded: 0, conflicts: 0, errors: 0 }
      }

      console.log(`[Sync] 云端共有 ${remoteFiles.length} 个文档需要下载`)

      let downloaded = 0
      let errors = 0

      for (const file of remoteFiles) {
        try {
          const remoteDoc = await this.webdavClient.downloadDoc(file.docId)
          if (!remoteDoc) {
            console.warn(`[Sync] 无法下载文档: ${file.docId}`)
            errors++
            continue
          }

          // 强制覆盖本地数据（不检查冲突）
          remoteDoc._cloudSynced = true
          await this.updateDocSyncStatus(file.docId, remoteDoc, true)

          downloaded++
          console.log(`[Sync] 强制下载成功: ${file.docId}`)
        } catch (error) {
          console.error(`[Sync] 强制下载失败: ${file.docId}`, error)
          errors++
        }
      }

      // 更新同步时间
      await this.updateLastSyncTime()

      const result: SyncResult = {
        uploaded: 0,
        downloaded,
        conflicts: 0,
        errors
      }

      console.log('[Sync] 强制同步完成:', result)
      return result
    } catch (error) {
      console.error('[Sync] 强制同步失败:', error)
      throw error
    }
  }

  /**
   * 上传本地变更到云端
   */
  private async uploadLocalChanges(): Promise<{
    count: number
    errors: number
    processedDocIds: Set<string>
  }> {
    // 获取所有需要同步的文档（_cloudSynced === false）
    const pendingDocs = await this.getUnsyncedDocs()

    if (pendingDocs.length === 0) {
      console.log('[Sync] 没有待上传的文档')
      return { count: 0, errors: 0, processedDocIds: new Set() }
    }

    console.log(`[Sync] 待上传文档数量: ${pendingDocs.length}`)

    let uploaded = 0
    let errors = 0
    const processedDocIds = new Set<string>()

    for (const doc of pendingDocs) {
      try {
        // 跳过已处理的文档
        if (processedDocIds.has(doc._id)) {
          continue
        }

        // 检查云端是否有更新版本
        const remoteDoc = await this.webdavClient.downloadDoc(doc._id)

        if (remoteDoc && this.hasConflict(doc, remoteDoc)) {
          // 冲突：使用 Last Write Wins 策略
          const winner = doc._lastModified! > remoteDoc._lastModified! ? doc : remoteDoc

          if (winner === doc) {
            // 本地版本胜出，上传到云端
            await this.webdavClient.uploadDoc({
              ...doc,
              _lastModified: Date.now()
            })

            // 更新本地同步状态
            const updatedDoc = await this.db.promises.get(doc._id)
            if (updatedDoc) {
              updatedDoc._cloudSynced = true
              await this.updateDocSyncStatus(doc._id, updatedDoc)
            }

            uploaded++
            console.log(`[Sync] 冲突已解决: ${doc._id}, 胜出: 本地，已上传`)
          } else {
            // 云端版本胜出，更新本地
            remoteDoc._cloudSynced = true
            await this.updateDocSyncStatus(doc._id, remoteDoc)

            console.log(`[Sync] 冲突已解决: ${doc._id}, 胜出: 云端，已下载`)
          }

          // 标记为已处理，避免下载阶段重复处理
          processedDocIds.add(doc._id)
        } else {
          // 无冲突，直接上传
          await this.webdavClient.uploadDoc({
            ...doc,
            _lastModified: Date.now()
          })

          // 更新本地同步状态
          const updatedDoc = await this.db.promises.get(doc._id)
          if (updatedDoc) {
            updatedDoc._cloudSynced = true
            await this.updateDocSyncStatus(doc._id, updatedDoc)
          }

          uploaded++
          processedDocIds.add(doc._id)
          console.log(`[Sync] 上传成功: ${doc._id}`)
        }
      } catch (error: any) {
        console.error(`[Sync] 上传失败: ${doc._id}`)
        console.error(`[Sync] 错误详情:`, error.message || error)
        if (error.response) {
          console.error(`[Sync] HTTP 状态:`, error.response.status)
          console.error(`[Sync] HTTP 响应:`, error.response.statusText)
        }
        errors++
      }
    }

    return { count: uploaded, errors, processedDocIds }
  }

  /**
   * 上传本地附件变更
   */
  private async uploadLocalAttachments(): Promise<{ count: number; errors: number }> {
    console.log('[Sync] 开始扫描本地附件...')

    const attachmentDb = this.db.getAttachmentDb()
    const unsyncedAttachments: string[] = []

    // 扫描所有附件
    for (const { key } of attachmentDb.getRange({})) {
      // 只处理附件数据（不包括元数据）
      if (key.startsWith('attachment:') && !key.startsWith('attachment-ext:')) {
        const attachmentId = key.replace('attachment:', '')

        // 检查同步状态（从 attachment-ext 中读取）
        const extKey = `attachment-ext:${attachmentId}`
        const extData = attachmentDb.get(extKey)
        if (extData) {
          try {
            const metadata = JSON.parse(extData)
            // 如果已同步，跳过
            if (metadata._cloudSynced === true) {
              continue
            }
          } catch {
            // 解析失败，视为未同步
          }
        }

        unsyncedAttachments.push(attachmentId)
      }
    }

    if (unsyncedAttachments.length === 0) {
      console.log('[Sync] 没有待上传的附件')
      return { count: 0, errors: 0 }
    }

    console.log(`[Sync] 待上传附件数量: ${unsyncedAttachments.length}`)

    let uploaded = 0
    let errors = 0

    for (const attachmentId of unsyncedAttachments) {
      try {
        const attachment = await this.db.promises.getAttachment(attachmentId)
        if (!attachment) {
          console.warn(`[Sync] 附件不存在: ${attachmentId}`)
          continue
        }

        console.log(`[Sync] 上传附件: ${attachmentId}, 大小: ${attachment.length} 字节`)

        // 获取附件元数据
        const extKey = `attachment-ext:${attachmentId}`
        const extData = attachmentDb.get(extKey)
        let metadata: any = undefined
        if (extData) {
          try {
            metadata = JSON.parse(extData)
            // 移除同步状态字段，只保留原始元数据
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { _cloudSynced, _lastModified, ...originalMetadata } = metadata
            metadata = originalMetadata
          } catch {
            // 解析失败，不上传元数据
          }
        }

        // 上传到云端（包含元数据）
        await this.webdavClient.uploadAttachment(attachmentId, Buffer.from(attachment), metadata)

        // 更新同步状态（存储到 attachment-ext 中）
        const env = (this.db as any).env
        env.transactionSync(() => {
          const extKey = `attachment-ext:${attachmentId}`
          const existingData = attachmentDb.get(extKey)
          let metadata: any = {}

          if (existingData) {
            try {
              metadata = JSON.parse(existingData)
            } catch {
              // 解析失败，使用空对象
            }
          }

          // 添加同步状态
          metadata._cloudSynced = true
          metadata._lastModified = Date.now()

          attachmentDb.putSync(extKey, JSON.stringify(metadata))
        })

        uploaded++
        console.log(`[Sync] 附件上传成功: ${attachmentId}`)
      } catch (error: any) {
        console.error(`[Sync] 附件上传失败: ${attachmentId}`, error)
        errors++
      }
    }

    return { count: uploaded, errors }
  }

  /**
   * 从云端下载变更
   * @param processedDocIds 已在上传阶段处理过的文档 ID 集合
   */
  private async downloadRemoteChanges(
    processedDocIds: Set<string> = new Set()
  ): Promise<{ count: number; errors: number }> {
    // 获取云端文件列表和修改时间
    const remoteFiles = await this.webdavClient.listRemoteDocsWithMeta()

    // 过滤出需要下载的文档（云端修改时间 > 本地记录，且未在上传阶段处理）
    const lastSyncTime = await this.getLastSyncTime()
    console.log('lastSyncTime', lastSyncTime)
    const remoteDocIds = remoteFiles
      .filter((file) => file.lastModified > lastSyncTime && !processedDocIds.has(file.docId))
      .map((file) => file.docId)

    if (remoteDocIds.length === 0) {
      console.log('[Sync] 云端没有新变更')
      return { count: 0, errors: 0 }
    }

    console.log(`[Sync] 云端有 ${remoteDocIds.length} 个文档需要下载`)

    let downloaded = 0
    let errors = 0

    for (const docId of remoteDocIds) {
      try {
        const remoteDoc = await this.webdavClient.downloadDoc(docId)
        if (!remoteDoc) continue

        const localDoc = await this.db.promises.get(docId)

        // 情况 1: 本地不存在，直接下载
        if (!localDoc) {
          remoteDoc._cloudSynced = true
          await this.updateDocSyncStatus(docId, remoteDoc, true)

          downloaded++
          console.log(`[Sync] 下载新文档: ${docId}`)
          continue
        }

        // 情况 2: 云端更新时间更晚
        if (remoteDoc._lastModified! > (localDoc._lastModified || 0)) {
          // 检查本地是否有未同步的修改
          const meta = await this.db.promises.getSyncMeta(docId)
          if (meta && meta._cloudSynced === false) {
            // 冲突：使用 Last Write Wins 策略
            const winner =
              (meta._lastModified || 0) > remoteDoc._lastModified! ? localDoc : remoteDoc

            winner._cloudSynced = true
            await this.updateDocSyncStatus(docId, winner)

            console.log(
              `[Sync] 下载阶段冲突已解决: ${docId}, 胜出: ${winner === localDoc ? '本地' : '云端'}`
            )
          } else {
            // 覆盖本地数据
            remoteDoc._cloudSynced = true
            await this.updateDocSyncStatus(docId, remoteDoc)

            console.log(`[Sync] 下载更新: ${docId}`)
          }

          downloaded++
        }
      } catch (error) {
        console.error(`[Sync] 下载失败: ${docId}`, error)
        errors++
      }
    }

    return { count: downloaded, errors }
  }

  /**
   * 获取所有未同步的文档
   */
  private async getUnsyncedDocs(): Promise<any[]> {
    // 获取所有需要同步的文档前缀
    const syncPrefixes = ['ZTOOLS/pinned-apps', 'ZTOOLS/settings-general', 'PLUGIN/']

    const unsyncedDocs: any[] = []
    const seenIds = new Set<string>()

    for (const prefix of syncPrefixes) {
      const docs = await this.db.promises.allDocs(prefix)

      for (const doc of docs) {
        // 跳过已添加的文档（去重）
        if (seenIds.has(doc._id)) {
          continue
        }

        // 从 metaDb 获取同步状态
        const meta = await this.db.promises.getSyncMeta(doc._id)

        // 如果没有同步元数据，或者 _cloudSynced !== true，则视为未同步
        if (!meta || meta._cloudSynced !== true) {
          // 添加同步元数据到文档对象（方便后续使用）
          doc._lastModified = meta?._lastModified || Date.now()
          doc._cloudSynced = meta?._cloudSynced || false
          unsyncedDocs.push(doc)
          seenIds.add(doc._id)
        }
      }
    }

    return unsyncedDocs
  }

  /**
   * 下载云端附件变更
   */
  private async downloadRemoteAttachments(): Promise<{ count: number; errors: number }> {
    console.log('[Sync] 开始扫描云端附件...')

    try {
      // 获取云端附件列表
      const remoteAttachments = await this.webdavClient.listRemoteAttachments()

      if (remoteAttachments.length === 0) {
        console.log('[Sync] 云端没有附件')
        return { count: 0, errors: 0 }
      }

      console.log(`[Sync] 云端共有 ${remoteAttachments.length} 个附件`)

      let downloaded = 0
      let errors = 0

      for (const attachmentId of remoteAttachments) {
        try {
          // 检查本地是否已有附件
          const localAttachment = await this.db.promises.getAttachment(attachmentId)
          if (localAttachment) {
            console.log(`[Sync] 本地已有附件，跳过: ${attachmentId}`)
            continue
          }

          // 下载云端附件
          const result = await this.webdavClient.downloadAttachment(attachmentId)
          if (!result) {
            console.warn(`[Sync] 无法下载附件: ${attachmentId}`)
            continue
          }

          const { data: attachment, metadata: cloudMetadata } = result
          console.log(`[Sync] 下载附件: ${attachmentId}, 大小: ${attachment.length} 字节`)

          // 使用云端的 MIME 类型，如果没有则使用默认值
          const mimeType = cloudMetadata?.type || 'application/octet-stream'

          // 保存附件到本地
          const saveResult = await this.db.promises.postAttachment(
            attachmentId,
            attachment,
            mimeType
          )
          if (saveResult.ok) {
            // 更新同步状态（存储到 attachment-ext 中）
            const attachmentDb = this.db.getAttachmentDb()
            const env = (this.db as any).env
            env.transactionSync(() => {
              const extKey = `attachment-ext:${attachmentId}`
              const existingData = attachmentDb.get(extKey)
              let metadata: any = {}

              if (existingData) {
                try {
                  metadata = JSON.parse(existingData)
                } catch {
                  // 解析失败，使用空对象
                }
              }

              // 如果云端有元数据，合并到本地
              if (cloudMetadata) {
                metadata = { ...metadata, ...cloudMetadata }
              }

              // 添加同步状态
              metadata._cloudSynced = true
              metadata._lastModified = Date.now()

              attachmentDb.putSync(extKey, JSON.stringify(metadata))
            })

            downloaded++
            console.log(`[Sync] 附件下载成功: ${attachmentId}`)
          } else {
            console.error(`[Sync] 附件保存失败: ${attachmentId}, 错误: ${saveResult.error}`)
            errors++
          }
        } catch (error: any) {
          console.error(`[Sync] 附件下载失败: ${attachmentId}`, error)
          errors++
        }
      }

      return { count: downloaded, errors }
    } catch (error: any) {
      console.error('[Sync] 扫描云端附件失败:', error)
      return { count: 0, errors: 1 }
    }
  }

  /**
   * 检测冲突
   */
  private hasConflict(localDoc: any, remoteDoc: any): boolean {
    return (
      localDoc._cloudSynced === false && remoteDoc._lastModified! > (localDoc._lastModified || 0)
    )
  }

  /**
   * 获取最后同步时间
   */
  private async getLastSyncTime(): Promise<number> {
    const config = await this.loadSyncConfig()
    return config?.lastSyncTime || 0
  }

  /**
   * 更新最后同步时间
   */
  private async updateLastSyncTime(): Promise<void> {
    const config = await this.loadSyncConfig()
    if (config) {
      config.lastSyncTime = Date.now()
      await this.saveSyncConfig(config)
    }
  }

  /**
   * 直接更新文档的同步状态（使用 metaDb）
   * 注意：不修改文档内容，只更新元数据
   * @param docId 文档 ID
   * @param doc 文档对象（如果需要创建文档）
   * @param createIfNotExists 如果文档不存在，是否创建
   */
  private async updateDocSyncStatus(
    docId: string,
    doc: any,
    createIfNotExists = false
  ): Promise<void> {
    const mainDb = (this.db as any).mainDb
    const metaDb = (this.db as any).metaDb
    const env = (this.db as any).env

    env.transactionSync(() => {
      // 检查文档是否存在
      const existingDoc = mainDb.get(docId)

      if (!existingDoc && !createIfNotExists) {
        console.warn(`updateDocSyncStatus: 文档不存在 ${docId}`)
        return
      }

      // 如果文档不存在且需要创建，或者文档内容有变化
      if (doc) {
        // 移除同步字段，这些字段存储在 metaDb 中
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _cloudSynced, _lastModified, ...docWithoutSyncFields } = doc
        mainDb.putSync(docId, JSON.stringify(docWithoutSyncFields))
      }

      // 获取或创建元数据
      const existingMetaStr = metaDb.get(docId)
      let meta: any

      if (existingMetaStr) {
        // 解析现有元数据
        if (existingMetaStr.startsWith('{')) {
          meta = JSON.parse(existingMetaStr)
        } else {
          meta = { _rev: existingMetaStr }
        }
        // 更新版本号和修改时间（使用云端文档的值）
        if (doc._rev) {
          meta._rev = doc._rev
        }
        if (doc._lastModified) {
          meta._lastModified = doc._lastModified
        }
      } else {
        // 创建新元数据
        meta = {
          _rev: doc._rev || '1-' + Math.random().toString(36).substring(2, 15),
          _lastModified: doc._lastModified || Date.now()
        }
      }

      // 更新同步状态
      meta._cloudSynced = true

      // 保存元数据
      metaDb.putSync(docId, JSON.stringify(meta))
    })
  }
}
