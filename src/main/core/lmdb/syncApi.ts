import {
  DbDoc,
  DbResult,
  LmdbEnv,
  LmdbDatabase as LmdbDb,
  ChangeEntry,
  RevisionRecord,
  SyncMeta
} from './types'
import {
  generateNewRev,
  compareRevs,
  createErrorResult,
  createSuccessResult,
  isValidDocId,
  isDocSizeExceeded,
  safeJsonParse,
  safeJsonStringify
} from './utils'
import * as crypto from 'crypto'
import { EventEmitter } from 'events'
import { isAccountSyncDoc } from '../storage/storageRouting'

interface AttachmentMetadata {
  type: string
  length: number
  md5: string
  digest?: string
  name?: string
  revpos?: number
}

interface CouchAttachmentStub {
  stub?: boolean
  digest?: string
  content_type?: string
  length?: number
  revpos?: number
}

interface RemoteChangeLike {
  docId: string
  rev?: string
  parentRev?: string | null
  revisionHistory?: string[]
  deleted: boolean
  timestamp?: number
  doc?: DbDoc | null
  resolution?: { retireOtherLeaves?: boolean }
}

export class SyncApi {
  private static readonly SEQ_KEY = '_changelog_seq'
  private static readonly REVISION_KEY_PREFIX = 'rev:'
  private static readonly LEGACY_CONFLICT_PREFIX = '\x00'
  private static readonly LEGACY_CLOUD_SYNC_KEY = '_cloudSynced'

  constructor(
    private env: LmdbEnv,
    private mainDb: LmdbDb,
    private metaDb: LmdbDb,
    private attachmentDb: LmdbDb,
    private changelogDb: LmdbDb,
    private revisionDb: LmdbDb,
    private emitter: EventEmitter
  ) {}

  put(doc: DbDoc): DbResult {
    try {
      if (!isValidDocId(doc._id)) {
        return createErrorResult('exception', '_id is required and must be a string', doc._id)
      }

      if (isDocSizeExceeded(doc, 1024 * 1024)) {
        return createErrorResult('exception', 'Document size exceeds 1M', doc._id)
      }

      return this.env.transactionSync(() => this.putInTransaction(doc))
    } catch (e: any) {
      console.error('[LMDB] put error:', e)
      return createErrorResult(e.name || 'exception', e.message, doc._id)
    }
  }

  private shouldSync(docId: string): boolean {
    return isAccountSyncDoc(docId)
  }

  private getRevisionKey(docId: string, rev: string): string {
    return `${SyncApi.REVISION_KEY_PREFIX}${docId}:${rev}`
  }

  /**
   * 解析文档 metadata，并过滤旧版本遗留的单云端同步状态。
   * @param metaStr metadata 库中的原始字符串。
   * @returns 当前版本支持的同步 metadata；无有效数据时返回 null。
   */
  private parseMeta(metaStr: string | null | undefined): SyncMeta | null {
    if (!metaStr) return null
    if (metaStr.startsWith('{')) {
      const parsed = safeJsonParse(metaStr) as Record<string, unknown> | null
      if (!parsed) return null
      delete parsed[SyncApi.LEGACY_CLOUD_SYNC_KEY]
      return parsed as unknown as SyncMeta
    }
    return { _rev: metaStr, _winningRev: metaStr }
  }

  /**
   * 从旧版文档中移除已废弃的单云端同步状态。
   * @param doc 本地或远端文档。
   * @returns 不含旧状态字段的文档；输入为空时原样返回。
   */
  private stripLegacyCloudSyncState(doc: DbDoc | null): DbDoc | null {
    if (!doc || !Object.prototype.hasOwnProperty.call(doc, SyncApi.LEGACY_CLOUD_SYNC_KEY)) {
      return doc
    }
    const cleaned = { ...doc }
    delete cleaned[SyncApi.LEGACY_CLOUD_SYNC_KEY]
    return cleaned
  }

  private saveMeta(id: string, meta: SyncMeta): void {
    this.metaDb.putSync(id, safeJsonStringify(meta))
  }

  private putRevision(record: RevisionRecord): void {
    const normalized: RevisionRecord = {
      ...record,
      isLeaf: record.isLeaf !== false
    }
    this.revisionDb.putSync(
      this.getRevisionKey(normalized.docId, normalized.rev),
      safeJsonStringify(normalized)
    )
  }

  private getRevision(docId: string, rev: string): RevisionRecord | null {
    const raw = this.revisionDb.get(this.getRevisionKey(docId, rev))
    return raw ? (safeJsonParse(raw) as RevisionRecord | null) : null
  }

  private normalizeRevisionHistory(currentRev: string, raw?: string[]): string[] {
    const history: string[] = []
    const seen = new Set<string>()
    const add = (rev?: string | null): void => {
      const normalized = typeof rev === 'string' ? rev.trim() : ''
      if (!normalized || seen.has(normalized)) return
      seen.add(normalized)
      history.push(normalized)
    }
    add(currentRev)
    for (const rev of raw || []) add(rev)
    return history
  }

  private ensureRevisionHistoryStubs(docId: string, history: string[], timestamp: number): void {
    if (history.length <= 1) return
    for (let i = 1; i < history.length; i++) {
      const rev = history[i]
      const parentRev = history[i + 1] || null
      const existing = this.getRevision(docId, rev)
      if (existing) {
        this.putRevision({
          ...existing,
          parentRev: existing.parentRev || parentRev,
          isLeaf: false
        })
        continue
      }
      this.putRevision({
        docId,
        rev,
        parentRev,
        deleted: false,
        timestamp,
        doc: null,
        isLeaf: false
      })
    }
  }

  getRevisionHistory(docId: string, rev?: string | null, maxDepth = 100): string[] {
    if (!docId || !rev) return []
    const history: string[] = []
    const seen = new Set<string>()
    let currentRev: string | null | undefined = rev

    while (currentRev && history.length < maxDepth && !seen.has(currentRev)) {
      history.push(currentRev)
      seen.add(currentRev)
      const current = this.getRevision(docId, currentRev)
      currentRev = current?.parentRev || null
    }

    return history
  }

  private listRevisions(docId: string): RevisionRecord[] {
    const prefix = `${SyncApi.REVISION_KEY_PREFIX}${docId}:`
    const results: RevisionRecord[] = []
    for (const { key, value } of this.revisionDb.getRange({
      start: prefix,
      end: `${prefix}\xFF`
    })) {
      if (!(key as string).startsWith(prefix)) break
      const revision = safeJsonParse(value as string) as RevisionRecord | null
      if (revision) results.push({ ...revision, isLeaf: revision.isLeaf !== false })
    }

    const byRev = new Map(results.map((revision) => [revision.rev, revision]))
    for (const revision of results) {
      if (revision.parentRev) {
        const parent = byRev.get(revision.parentRev)
        if (parent) parent.isLeaf = false
      }
    }

    return results.sort((a, b) => compareRevs(b.rev, a.rev))
  }

  private chooseWinner(revisions: RevisionRecord[]): RevisionRecord | null {
    if (revisions.length === 0) return null
    const leaves = revisions.filter((revision) => revision.isLeaf !== false)
    const nonDeletedLeaves = leaves.filter((revision) => !revision.deleted)
    const pool = nonDeletedLeaves.length > 0 ? nonDeletedLeaves : leaves
    return [...pool].sort((a, b) => compareRevs(b.rev, a.rev))[0] || null
  }

  private retireLeafRevisions(docId: string, keepRev: string): void {
    const revisions = this.listRevisions(docId)
    for (const revision of revisions) {
      if (revision.isLeaf !== false && revision.rev !== keepRev) {
        this.putRevision({
          ...revision,
          isLeaf: false
        })
      }
    }
  }

  private retireEquivalentLeafRevisions(
    docId: string,
    remoteRev: string,
    remoteDoc: DbDoc | null
  ): void {
    if (!remoteDoc) return
    const remoteFingerprint = this.contentFingerprint(remoteDoc)
    for (const revision of this.listRevisions(docId)) {
      if (
        revision.rev === remoteRev ||
        revision.isLeaf === false ||
        revision.deleted ||
        !revision.doc
      ) {
        continue
      }
      if (this.contentFingerprint(revision.doc) === remoteFingerprint) {
        this.putRevision({
          ...revision,
          isLeaf: false
        })
      }
    }
  }

  private contentFingerprint(doc: DbDoc): string {
    return JSON.stringify(this.normalizeContentForCompare(doc))
  }

  private normalizeContentForCompare(value: any): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeContentForCompare(item))
    }
    if (!value || typeof value !== 'object') return value

    const ignoredKeys = new Set([
      '_rev',
      '_cloudSynced',
      '_lastModified',
      '_deleted',
      '_conflicts',
      '_revisions',
      '_sync'
    ])
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      if (ignoredKeys.has(key)) continue
      normalized[key] = this.normalizeContentForCompare(value[key])
    }
    return normalized
  }

  /**
   * 根据叶子 revision 重新选择文档 winner 并刷新主文档和 metadata。
   * @param docId 要刷新的文档 ID。
   * @returns 选中的 winner；没有 revision 时返回 null。
   */
  private refreshWinner(docId: string): RevisionRecord | null {
    const revisions = this.listRevisions(docId)
    const winner = this.chooseWinner(revisions)

    if (!winner) {
      this.mainDb.removeSync(docId)
      this.metaDb.removeSync(docId)
      return null
    }

    const leafRevisions = revisions.filter((revision) => revision.isLeaf !== false)
    const conflictCount = leafRevisions.filter((revision) => revision.rev !== winner.rev).length
    const meta: SyncMeta = {
      _rev: winner.rev,
      _winningRev: winner.rev,
      _lastModified: winner.timestamp,
      _deleted: winner.deleted,
      _hasConflicts: conflictCount > 0,
      _conflictCount: conflictCount
    }

    this.saveMeta(docId, meta)
    this.metaDb.removeSync(SyncApi.LEGACY_CONFLICT_PREFIX + docId)

    if (winner.deleted || !winner.doc) {
      this.mainDb.removeSync(docId)
    } else {
      const winnerDoc = this.stripLegacyCloudSyncState(winner.doc)
      if (winnerDoc !== winner.doc) {
        winner.doc = winnerDoc
        this.putRevision(winner)
      }
      this.mainDb.putSync(docId, safeJsonStringify(winnerDoc))
    }

    return winner
  }

  private appendChange(entry: ChangeEntry): number {
    const seq = this.nextSeq()
    const change = { ...entry, seq }
    this.changelogDb.putSync(seq.toString().padStart(10, '0'), safeJsonStringify(change))
    return seq
  }

  private getCurrentWinningRev(docId: string): string | undefined {
    return this.getSyncMeta(docId)?._winningRev || this.getSyncMeta(docId)?._rev
  }

  private normalizeDigest(value: string): string {
    if (!value) return ''
    return value.startsWith('md5-') ? value : `md5-${value}`
  }

  private trimDigestPrefix(value: string): string {
    return value.replace(/^md5-/, '')
  }

  private attachmentDigest(buffer: Buffer): string {
    return `md5-${crypto.createHash('md5').update(buffer).digest('hex')}`
  }

  private defaultAttachmentName(): string {
    return 'default'
  }

  private getAttachmentStubs(doc: DbDoc | null | undefined): Record<string, CouchAttachmentStub> {
    if (!doc || typeof doc !== 'object') return {}
    const attachments = (doc as any)._attachments
    if (!attachments || typeof attachments !== 'object') return {}
    return attachments
  }

  private withAttachmentStub(
    doc: DbDoc,
    name: string,
    metadata: AttachmentMetadata,
    revpos: number
  ): DbDoc {
    const attachments = { ...this.getAttachmentStubs(doc) }
    attachments[name] = {
      stub: true,
      digest: metadata.digest || this.normalizeDigest(metadata.md5),
      content_type: metadata.type,
      length: metadata.length,
      revpos
    }
    return { ...doc, _attachments: attachments }
  }

  private rememberRemoteAttachmentStubs(doc: DbDoc | null): void {
    if (!doc?._id) return
    const attachments = this.getAttachmentStubs(doc)
    for (const [name, stub] of Object.entries(attachments)) {
      const digest = this.normalizeDigest(stub.digest || '')
      if (!digest) continue
      const metadata: AttachmentMetadata = {
        type: stub.content_type || 'application/octet-stream',
        length: stub.length || 0,
        md5: this.trimDigestPrefix(digest),
        digest,
        name,
        revpos: stub.revpos
      }
      this.attachmentDb.putSync(`attachment-ext:${doc._id}`, safeJsonStringify(metadata))
    }
  }

  /**
   * 读取当前文档 metadata，并惰性清理旧版本遗留字段。
   * @param id 文档 ID。
   * @returns 文档 metadata；不存在或无法解析时返回 null。
   */
  getSyncMeta(id: string): SyncMeta | null {
    try {
      const raw = this.metaDb.get(id)
      const meta = this.parseMeta(raw)
      if (meta && typeof raw === 'string' && raw.includes(`"${SyncApi.LEGACY_CLOUD_SYNC_KEY}"`)) {
        // 旧版本状态在首次读取时惰性清理，避免启动时扫描整个 metadata 库。
        this.saveMeta(id, meta)
      }
      return meta
    } catch (e: any) {
      console.error('[LMDB] getSyncMeta error:', e)
      return null
    }
  }

  get(id: string): DbDoc | null {
    try {
      const docStr = this.mainDb.get(id)
      if (!docStr) return null
      const doc = safeJsonParse(docStr) as DbDoc | null
      const cleaned = this.stripLegacyCloudSyncState(doc)
      if (cleaned && cleaned !== doc) this.mainDb.putSync(id, safeJsonStringify(cleaned))
      return cleaned
    } catch (e: any) {
      console.error('[LMDB] get error:', e)
      return null
    }
  }

  remove(docOrId: DbDoc | string): DbResult {
    return this.removeWithOptions(docOrId, { retireOtherLeaves: false })
  }

  removeAndResolve(docOrId: DbDoc | string): DbResult {
    return this.removeWithOptions(docOrId, { retireOtherLeaves: true })
  }

  /**
   * 删除文档，并按存储范围发布同步或本机变更通知。
   * @param docOrId 文档身份或带版本的文档
   * @param options 是否同时退役冲突分支
   * @returns 删除结果，失败时包含错误信息
   */
  private removeWithOptions(
    docOrId: DbDoc | string,
    options: { retireOtherLeaves: boolean }
  ): DbResult {
    try {
      let id: string
      let rev: string | undefined

      if (typeof docOrId === 'string') {
        id = docOrId
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
        const currentRev = this.getCurrentWinningRev(id)
        if (currentRev && rev && rev !== currentRev) {
          return createErrorResult('conflict', 'Document update conflict', id)
        }
      }

      return this.env.transactionSync(() => {
        if (!this.shouldSync(id)) {
          this.mainDb.removeSync(id)
          this.metaDb.removeSync(id)
          // 本机文档不进入同步日志，但业务缓存仍需获知成功的删除。
          setImmediate(() => this.emitter.emit('local-change', { docId: id }))
          return createSuccessResult(id)
        }

        const timestamp = Date.now()
        const newRev = generateNewRev(rev)
        const tombstone: RevisionRecord = {
          docId: id,
          rev: newRev,
          parentRev: rev || null,
          deleted: true,
          timestamp,
          doc: null,
          isLeaf: true
        }

        this.putRevision(tombstone)
        if (options.retireOtherLeaves) {
          this.retireLeafRevisions(id, newRev)
        }
        const winner = this.refreshWinner(id)
        const seq = this.appendChange({
          seq: 0,
          docId: id,
          rev: newRev,
          parentRev: rev || null,
          deleted: true,
          timestamp,
          winnerRev: winner?.rev || newRev,
          isWinner: true,
          resolution: options.retireOtherLeaves ? { retireOtherLeaves: true } : undefined
        })
        setImmediate(() => this.emitter.emit('change', { seq, docId: id }))
        return createSuccessResult(id, newRev)
      })
    } catch (e: any) {
      console.error('[LMDB] remove error:', e)
      const id = typeof docOrId === 'string' ? docOrId : docOrId._id
      return createErrorResult(e.name || 'exception', e.message, id)
    }
  }

  bulkDocs(docs: DbDoc[]): DbResult[] {
    try {
      if (!Array.isArray(docs)) {
        throw new Error('docs must be an array')
      }
      for (const doc of docs) {
        if (!isValidDocId(doc._id)) {
          throw new Error('All documents must have a valid _id')
        }
      }
      const ids = docs.map((d) => d._id)
      if (new Set(ids).size !== ids.length) {
        throw new Error('Duplicate _id found in docs array')
      }

      const results: DbResult[] = []
      this.env.transactionSync(() => {
        for (const doc of docs) {
          try {
            results.push(this.putInTransaction(doc))
          } catch (e: any) {
            results.push(createErrorResult(e.name || 'exception', e.message, doc._id))
          }
        }
      })
      return results
    } catch (e: any) {
      console.error('[LMDB] bulkDocs error:', e)
      throw e
    }
  }

  allDocs(key?: string | string[]): DbDoc[] {
    try {
      const results: DbDoc[] = []
      if (Array.isArray(key)) {
        for (const id of key) {
          const doc = this.get(id)
          if (doc) results.push(doc)
        }
      } else {
        const prefix = key || ''
        let endPrefix: string | undefined
        if (prefix) {
          const lastChar = prefix[prefix.length - 1]
          const nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1)
          endPrefix = prefix.slice(0, -1) + nextChar
        }
        const rangeOptions: any = { start: prefix }
        if (endPrefix) {
          rangeOptions.end = endPrefix
        }
        for (const { key: currentKey, value: docStr } of Array.from(
          this.mainDb.getRange(rangeOptions)
        )) {
          if (!currentKey.startsWith(prefix)) break
          const doc = safeJsonParse(docStr) as DbDoc | null
          const cleaned = this.stripLegacyCloudSyncState(doc)
          if (cleaned) {
            if (cleaned !== doc) this.mainDb.putSync(currentKey, safeJsonStringify(cleaned))
            results.push(cleaned)
          }
        }
      }
      return results
    } catch (e: any) {
      console.error('[LMDB] allDocs error:', e)
      return []
    }
  }

  postAttachment(id: string, attachment: Buffer | Uint8Array, type: string): DbResult {
    try {
      const buffer = Buffer.from(attachment)
      if (buffer.byteLength > 10 * 1024 * 1024) {
        return createErrorResult('exception', 'Attachment exceeds 10M', id)
      }
      const existing = this.attachmentDb.get(`attachment:${id}`)
      if (existing) {
        return createErrorResult('conflict', 'Attachment already exists', id)
      }
      const digest = this.attachmentDigest(buffer)
      const md5 = this.trimDigestPrefix(digest)
      const result = this.env.transactionSync(() => {
        const existingDoc = this.get(id)
        const existingRev = this.getCurrentWinningRev(id)
        const revpos = existingRev ? parseInt(existingRev.split('-', 1)[0], 10) + 1 : 1
        const metadata: AttachmentMetadata = {
          type,
          length: buffer.byteLength,
          md5,
          digest,
          name: this.defaultAttachmentName(),
          revpos
        }
        this.attachmentDb.putSync(`attachment:${id}`, buffer)
        this.attachmentDb.putSync(`attachment-ext:${id}`, safeJsonStringify(metadata))
        if (this.shouldSync(id)) {
          const timestamp = Date.now()
          const newRev = generateNewRev(existingRev)
          const baseDoc = existingDoc || ({ _id: id } as DbDoc)
          const docToSave = this.withAttachmentStub(
            baseDoc,
            this.defaultAttachmentName(),
            metadata,
            revpos
          )
          docToSave._rev = newRev
          this.mainDb.putSync(id, safeJsonStringify(docToSave))
          const revision: RevisionRecord = {
            docId: id,
            rev: newRev,
            parentRev: existingRev || null,
            deleted: false,
            timestamp,
            doc: docToSave,
            isLeaf: true
          }
          this.putRevision(revision)
          const winner = this.refreshWinner(id)
          const seq = this.appendChange({
            seq: 0,
            docId: id,
            rev: newRev,
            parentRev: existingRev || null,
            deleted: false,
            timestamp,
            winnerRev: winner?.rev || newRev,
            isWinner: true
          })
          setImmediate(() => this.emitter.emit('change', { seq, docId: id }))
          return createSuccessResult(id, newRev)
        }
        return createSuccessResult(id)
      })
      if (!result.error) {
        setImmediate(() =>
          this.emitter.emit('attachment-added', { docId: id, md5, digest, contentType: type })
        )
      }
      return result
    } catch (e: any) {
      console.error('[LMDB] postAttachment error:', e)
      return createErrorResult(e.name || 'exception', e.message, id)
    }
  }

  removeAttachment(id: string): void {
    try {
      this.env.transactionSync(() => {
        const existingDoc = this.get(id)
        const existingRev = this.getCurrentWinningRev(id)
        this.attachmentDb.removeSync(`attachment:${id}`)
        this.attachmentDb.removeSync(`attachment-ext:${id}`)
        if (existingDoc && existingRev && this.shouldSync(id)) {
          const timestamp = Date.now()
          const newRev = generateNewRev(existingRev)
          const { _attachments, ...docWithoutAttachments } = existingDoc as any
          const remainingAttachments = { ...(typeof _attachments === 'object' ? _attachments : {}) }
          delete remainingAttachments[this.defaultAttachmentName()]
          const docToSave: DbDoc = { ...docWithoutAttachments, _rev: newRev }
          if (Object.keys(remainingAttachments).length > 0) {
            ;(docToSave as any)._attachments = remainingAttachments
          }
          this.mainDb.putSync(id, safeJsonStringify(docToSave))
          const revision: RevisionRecord = {
            docId: id,
            rev: newRev,
            parentRev: existingRev,
            deleted: false,
            timestamp,
            doc: docToSave,
            isLeaf: true
          }
          this.putRevision(revision)
          const winner = this.refreshWinner(id)
          const seq = this.appendChange({
            seq: 0,
            docId: id,
            rev: newRev,
            parentRev: existingRev,
            deleted: false,
            timestamp,
            winnerRev: winner?.rev || newRev,
            isWinner: true
          })
          setImmediate(() => this.emitter.emit('change', { seq, docId: id }))
        }
      })
    } catch (e: any) {
      console.error('[LMDB] removeAttachment error:', e)
    }
  }

  removeAttachmentSilent(id: string): void {
    try {
      this.env.transactionSync(() => {
        this.attachmentDb.removeSync(`attachment:${id}`)
        this.attachmentDb.removeSync(`attachment-ext:${id}`)
      })
    } catch (e: any) {
      console.error('[LMDB] removeAttachmentSilent error:', e)
    }
  }

  putAttachmentFromRemote(id: string, attachment: Buffer | Uint8Array, type: string): DbResult {
    try {
      const buffer = Buffer.from(attachment)
      if (buffer.byteLength > 10 * 1024 * 1024) {
        return createErrorResult('exception', 'Attachment exceeds 10M', id)
      }
      const digest = this.attachmentDigest(buffer)
      const metadata: AttachmentMetadata = {
        type,
        length: buffer.byteLength,
        md5: this.trimDigestPrefix(digest),
        digest,
        name: this.defaultAttachmentName()
      }
      return this.env.transactionSync(() => {
        this.attachmentDb.putSync(`attachment:${id}`, buffer)
        this.attachmentDb.putSync(`attachment-ext:${id}`, safeJsonStringify(metadata))
        return createSuccessResult(id)
      })
    } catch (e: any) {
      console.error('[LMDB] putAttachmentFromRemote error:', e)
      return createErrorResult(e.name || 'exception', e.message, id)
    }
  }

  getAttachment(id: string): Uint8Array | null {
    try {
      const buffer = this.attachmentDb.get(`attachment:${id}`)
      if (!buffer) return null
      return new Uint8Array(buffer)
    } catch (e: any) {
      console.error('[LMDB] getAttachment error:', e)
      return null
    }
  }

  getAttachmentType(id: string): AttachmentMetadata | null {
    try {
      const metadataStr = this.attachmentDb.get(`attachment-ext:${id}`)
      if (!metadataStr) return null
      return safeJsonParse(metadataStr)
    } catch (e: any) {
      console.error('[LMDB] getAttachmentType error:', e)
      return null
    }
  }

  listAttachments(): Array<{ docId: string; md5: string; contentType: string }> {
    const results: Array<{ docId: string; md5: string; contentType: string }> = []
    try {
      for (const { key, value } of this.attachmentDb.getRange({
        start: 'attachment-ext:',
        end: 'attachment-ext:\xFF'
      })) {
        const docId = (key as string).slice('attachment-ext:'.length)
        const meta = safeJsonParse(value as string)
        if (meta) {
          results.push({ docId, md5: meta.digest || meta.md5, contentType: meta.type })
        }
      }
    } catch (e: any) {
      console.error('[LMDB] listAttachments error:', e)
    }
    return results
  }

  /**
   * 在调用方事务内保存版本并发布对应存储范围的变更通知。
   * @param doc 待写入文档，成功后更新其版本
   * @returns 写入结果，校验失败时返回错误信息
   */
  private putInTransaction(doc: DbDoc): DbResult {
    if (!isValidDocId(doc._id)) {
      return createErrorResult('exception', '_id is required', doc._id)
    }
    if (isDocSizeExceeded(doc, 1024 * 1024)) {
      return createErrorResult('exception', 'Document size exceeds 1M', doc._id)
    }

    const id = doc._id
    const syncEnabled = this.shouldSync(id)
    const meta = this.getSyncMeta(id)
    const existingRev = meta?._winningRev || meta?._rev
    const revivesDeletedWinner = !!existingRev && meta?._deleted === true && !this.get(id)
    if (existingRev && !revivesDeletedWinner && (!doc._rev || doc._rev !== existingRev)) {
      return createErrorResult('conflict', 'Document update conflict', id)
    }
    if (existingRev && revivesDeletedWinner && doc._rev && doc._rev !== existingRev) {
      return createErrorResult('conflict', 'Document update conflict', id)
    }

    const { _cloudSynced, _lastModified, ...docWithoutSyncFields } = doc
    const timestamp = Date.now()
    const newRev = generateNewRev(existingRev)
    const docToSave = { ...docWithoutSyncFields, _rev: newRev }

    this.mainDb.putSync(id, safeJsonStringify(docToSave))

    if (syncEnabled) {
      const revision: RevisionRecord = {
        docId: id,
        rev: newRev,
        parentRev: existingRev || null,
        deleted: false,
        timestamp,
        doc: docToSave,
        isLeaf: true
      }
      this.putRevision(revision)
      const winner = this.refreshWinner(id)
      const seq = this.appendChange({
        seq: 0,
        docId: id,
        rev: newRev,
        parentRev: existingRev || null,
        deleted: false,
        timestamp,
        winnerRev: winner?.rev || newRev,
        isWinner: true
      })
      setImmediate(() => this.emitter.emit('change', { seq, docId: id }))
    } else {
      this.metaDb.putSync(id, newRev)
      // 使用独立通知，避免设备配置被同步客户端误当作待上传变更。
      setImmediate(() => this.emitter.emit('local-change', { docId: id }))
    }

    doc._rev = newRev
    return createSuccessResult(id, newRev)
  }

  private nextSeq(): number {
    const currentStr = this.metaDb.get(SyncApi.SEQ_KEY)
    const current = currentStr ? parseInt(currentStr, 10) : 0
    const next = current + 1
    this.metaDb.putSync(SyncApi.SEQ_KEY, next.toString())
    return next
  }

  getLastSeq(): number {
    const seqStr = this.metaDb.get(SyncApi.SEQ_KEY)
    return seqStr ? parseInt(seqStr, 10) : 0
  }

  getChangesSince(sinceSeq: number): ChangeEntry[] {
    const startKey = (sinceSeq + 1).toString().padStart(10, '0')
    const changes: ChangeEntry[] = []
    for (const { value } of this.changelogDb.getRange({ start: startKey })) {
      const entry = safeJsonParse(value)
      if (entry) changes.push(entry)
    }
    return changes
  }

  applyRemoteDoc(doc: DbDoc): DbResult {
    return this.env.transactionSync(() =>
      this.applyRemoteChange({
        docId: doc._id,
        rev: doc._rev,
        parentRev: (doc as any)._parentRev || null,
        deleted: false,
        timestamp: doc._lastModified,
        doc,
        resolution: (doc as any)._resolution
      })
    )
  }

  applyRemoteChange(change: RemoteChangeLike): DbResult {
    const id = change.docId
    if (!id) {
      return createErrorResult('not_found', 'Remote change missing docId', '')
    }

    const remoteRev = change.rev || generateNewRev(change.parentRev || undefined)
    if (this.getRevision(id, remoteRev)) {
      const history = this.normalizeRevisionHistory(remoteRev, change.revisionHistory)
      this.ensureRevisionHistoryStubs(id, history, change.timestamp || Date.now())
      const parentRev = change.parentRev || history[1] || null
      const existing = this.getRevision(id, remoteRev)
      if (existing && !existing.parentRev && parentRev) {
        this.putRevision({ ...existing, parentRev })
      }
      const winner = this.refreshWinner(id)
      return createSuccessResult(id, winner?.rev || remoteRev)
    }

    const timestamp = change.timestamp || Date.now()
    const history = this.normalizeRevisionHistory(remoteRev, change.revisionHistory)
    this.ensureRevisionHistoryStubs(id, history, timestamp)
    const parentRev = change.parentRev || history[1] || null
    const remoteDoc = this.stripLegacyCloudSyncState(change.doc || null)
    const docBody = change.deleted
      ? null
      : remoteDoc
        ? ({ ...remoteDoc, _rev: remoteRev } as DbDoc)
        : null
    this.rememberRemoteAttachmentStubs(docBody)

    const revision: RevisionRecord = {
      docId: id,
      rev: remoteRev,
      parentRev,
      deleted: !!change.deleted,
      timestamp,
      doc: docBody,
      isLeaf: true
    }

    this.putRevision(revision)
    this.retireEquivalentLeafRevisions(id, remoteRev, docBody)
    if (change.resolution?.retireOtherLeaves) {
      this.retireLeafRevisions(id, remoteRev)
    }
    const winner = this.refreshWinner(id)
    return createSuccessResult(id, winner?.rev || remoteRev)
  }

  getConflicts(docId: string): DbDoc[] {
    const revisions = this.listRevisions(docId)
    const winner = this.chooseWinner(revisions)
    return revisions
      .filter((revision) => revision.isLeaf !== false && revision.rev !== winner?.rev)
      .map((revision) => {
        if (revision.doc) return revision.doc
        return {
          _id: docId,
          _rev: revision.rev,
          _deleted: true,
          _lastModified: revision.timestamp
        } as DbDoc
      })
  }

  resolveConflict(docId: string, sourceRev: string): DbResult {
    return this.env.transactionSync(() => {
      const currentWinningRev = this.getCurrentWinningRev(docId)
      if (!currentWinningRev) {
        return createErrorResult('not_found', 'Winning revision not found', docId)
      }

      const source = this.getRevision(docId, sourceRev)
      if (!source) {
        return createErrorResult('not_found', 'Source revision not found', docId)
      }

      const timestamp = Date.now()
      const newRev = generateNewRev(currentWinningRev)
      const nextDoc = source.deleted
        ? null
        : source.doc
          ? ({ ...source.doc, _rev: newRev } as DbDoc)
          : null

      const nextRevision: RevisionRecord = {
        docId,
        rev: newRev,
        parentRev: currentWinningRev,
        deleted: source.deleted,
        timestamp,
        doc: nextDoc,
        isLeaf: true
      }

      this.putRevision(nextRevision)
      this.retireLeafRevisions(docId, newRev)
      const winner = this.refreshWinner(docId)
      const seq = this.appendChange({
        seq: 0,
        docId,
        rev: newRev,
        parentRev: currentWinningRev,
        deleted: source.deleted,
        timestamp,
        winnerRev: winner?.rev || newRev,
        isWinner: true,
        resolution: { retireOtherLeaves: true }
      })
      setImmediate(() => this.emitter.emit('change', { seq, docId }))
      return createSuccessResult(docId, newRev)
    })
  }

  clearConflicts(docId: string): void {
    this.env.transactionSync(() => {
      this.metaDb.removeSync(SyncApi.LEGACY_CONFLICT_PREFIX + docId)
      const meta = this.getSyncMeta(docId)
      if (meta) {
        meta._hasConflicts = false
        meta._conflictCount = 0
        this.saveMeta(docId, meta)
      }
    })
  }

  applyRemoteBatch(changes: RemoteChangeLike[]): number {
    return this.env.transactionSync(() => {
      let applied = 0
      for (const change of changes) {
        try {
          if (change.deleted && !change.rev) {
            this.mainDb.removeSync(change.docId)
            this.metaDb.removeSync(change.docId)
          } else {
            this.applyRemoteChange(change)
          }
          applied++
        } catch (err) {
          console.error('[LMDB] applyRemoteBatch item failed:', change.docId, err)
        }
      }
      return applied
    })
  }

  applyRemoteRemove(docId: string): DbResult {
    return this.env.transactionSync(() => {
      this.mainDb.removeSync(docId)
      this.metaDb.removeSync(docId)
      return createSuccessResult(docId)
    })
  }

  compactChangelog(upToSeq: number): void {
    this.env.transactionSync(() => {
      for (const { key, value } of this.changelogDb.getRange({})) {
        const entry = safeJsonParse(value)
        if (entry && entry.seq <= upToSeq) {
          this.changelogDb.removeSync(key)
        } else {
          break
        }
      }
    })
  }
}
