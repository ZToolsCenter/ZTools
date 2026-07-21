import { EventEmitter } from 'events'
import type LmdbDatabase from '../lmdb'
import type { ChangeEntry, DbDoc, DbResult, SyncMeta } from '../lmdb/types'
import { getStorageScopeForKey } from './storageRouting'
import type { StorageManager } from './storageManager'

type DbSelector = 'device' | 'account'

export class StorageRouter extends EventEmitter {
  public promises: {
    put: (doc: DbDoc) => Promise<DbResult>
    get: (id: string) => Promise<DbDoc | null>
    remove: (docOrId: DbDoc | string) => Promise<DbResult>
    removeAndResolve: (docOrId: DbDoc | string) => Promise<DbResult>
    bulkDocs: (docs: DbDoc[]) => Promise<DbResult[]>
    allDocs: (key?: string | string[]) => Promise<DbDoc[]>
    postAttachment: (id: string, attachment: Buffer | Uint8Array, type: string) => Promise<DbResult>
    getAttachment: (id: string) => Promise<Uint8Array | null>
    getAttachmentType: (id: string) => Promise<any | null>
    getSyncMeta: (id: string) => Promise<SyncMeta | null>
    updateSyncStatus: (id: string, cloudSynced: boolean) => Promise<void>
  }

  private accountDb: LmdbDatabase | null = null
  private readonly forwardChange = (payload: unknown): boolean => this.emit('change', payload)
  private readonly forwardAttachmentAdded = (payload: unknown): boolean =>
    this.emit('attachment-added', payload)

  constructor(private manager: StorageManager) {
    super()
    this.promises = {
      put: async (doc) => this.put(doc),
      get: async (id) => this.get(id),
      remove: async (docOrId) => this.remove(docOrId),
      removeAndResolve: async (docOrId) => this.removeAndResolve(docOrId),
      bulkDocs: async (docs) => this.bulkDocs(docs),
      allDocs: async (key) => this.allDocs(key),
      postAttachment: async (id, attachment, type) => this.postAttachment(id, attachment, type),
      getAttachment: async (id) => this.getAttachment(id),
      getAttachmentType: async (id) => this.getAttachmentType(id),
      getSyncMeta: async (id) => this.getSyncMeta(id),
      updateSyncStatus: async (id, cloudSynced) => {
        const meta = this.getSyncMeta(id)
        if (meta) {
          this.getAccountDb()
            .getMetaDb()
            .putSync(id, JSON.stringify({ ...meta, _cloudSynced: cloudSynced }))
        }
      }
    }
  }

  bindAccountDb(db: LmdbDatabase): void {
    this.unbind()
    this.accountDb = db
    db.on('change', this.forwardChange)
    db.on('attachment-added', this.forwardAttachmentAdded)
  }

  unbind(): void {
    if (!this.accountDb) return
    this.accountDb.removeListener('change', this.forwardChange)
    this.accountDb.removeListener('attachment-added', this.forwardAttachmentAdded)
    this.accountDb = null
  }

  put(doc: DbDoc): DbResult {
    return this.selectByDoc(doc).put(doc)
  }

  get(id: string): DbDoc | null {
    return this.selectByKey(id).get(id)
  }

  remove(docOrId: DbDoc | string): DbResult {
    return this.selectByDocOrId(docOrId).remove(docOrId)
  }

  removeAndResolve(docOrId: DbDoc | string): DbResult {
    return this.selectByDocOrId(docOrId).removeAndResolve(docOrId)
  }

  bulkDocs(docs: DbDoc[]): DbResult[] {
    return docs.map((doc) => this.put(doc))
  }

  allDocs(key?: string | string[]): DbDoc[] {
    if (Array.isArray(key)) {
      return key.map((id) => this.get(id)).filter(Boolean) as DbDoc[]
    }
    const scope = getStorageScopeForKey(key)
    if (scope === 'device') return this.getDeviceDb().allDocs(key)
    if (scope === 'account') return this.getAccountDb().allDocs(key)
    return mergeDocs(this.getDeviceDb().allDocs(key), this.getAccountDb().allDocs(key))
  }

  postAttachment(id: string, attachment: Buffer | Uint8Array, type: string): DbResult {
    return this.getAccountDb().postAttachment(id, attachment, type)
  }

  putAttachmentFromRemote(id: string, attachment: Buffer | Uint8Array, type: string): DbResult {
    return this.getAccountDb().putAttachmentFromRemote(id, attachment, type)
  }

  removeAttachment(id: string): void {
    this.getAccountDb().removeAttachment(id)
  }

  removeAttachmentSilent(id: string): void {
    this.getAccountDb().removeAttachmentSilent(id)
  }

  getAttachment(id: string): Uint8Array | null {
    return this.getAccountDb().getAttachment(id)
  }

  getAttachmentType(id: string): any | null {
    return this.getAccountDb().getAttachmentType(id)
  }

  getSyncMeta(id: string): SyncMeta | null {
    return this.getAccountDb().getSyncMeta(id)
  }

  getAttachmentDb(): any {
    return this.getAccountDb().getAttachmentDb()
  }

  getMetaDb(): any {
    return this.getAccountDb().getMetaDb()
  }

  getDeviceMetaDb(): any {
    return this.getDeviceDb().getMetaDb()
  }

  getChangelogDb(): any {
    return this.getAccountDb().getChangelogDb()
  }

  getRevisionDb(): any {
    return this.getAccountDb().getRevisionDb()
  }

  getSyncTaskDb(): any {
    return this.getAccountDb().getSyncTaskDb()
  }

  getChangesSince(sinceSeq: number): ChangeEntry[] {
    return this.getAccountDb().getChangesSince(sinceSeq)
  }

  getLastSeq(): number {
    return this.getAccountDb().getLastSeq()
  }

  getRevisionHistory(docId: string, rev?: string | null, maxDepth?: number): string[] {
    return this.getAccountDb().getRevisionHistory(docId, rev, maxDepth)
  }

  applyRemoteDoc(doc: DbDoc): DbResult {
    return this.getAccountDb().applyRemoteDoc(doc)
  }

  applyRemoteChange(change: any): DbResult {
    return this.getAccountDb().applyRemoteChange(change)
  }

  applyRemoteBatch(changes: any[]): number {
    return this.getAccountDb().applyRemoteBatch(changes)
  }

  getConflicts(docId: string): DbDoc[] {
    return this.getAccountDb().getConflicts(docId)
  }

  resolveConflict(docId: string, sourceRev: string): DbResult {
    return this.getAccountDb().resolveConflict(docId, sourceRev)
  }

  clearConflicts(docId: string): void {
    this.getAccountDb().clearConflicts(docId)
  }

  listAttachments(): Array<{ docId: string; md5: string; contentType: string }> {
    return this.getAccountDb().listAttachments()
  }

  applyRemoteRemove(docId: string): DbResult {
    return this.getAccountDb().applyRemoteRemove(docId)
  }

  compactChangelog(upToSeq: number): void {
    this.getAccountDb().compactChangelog(upToSeq)
  }

  close(): void {
    this.manager.close()
  }

  getStats(): any {
    return {
      device: this.getDeviceDb().getStats(),
      account: this.getAccountDb().getStats()
    }
  }

  sync(): void {
    this.getDeviceDb().sync()
    this.getAccountDb().sync()
  }

  private selectByDoc(doc: DbDoc): LmdbDatabase {
    return this.selectByKey(doc._id)
  }

  private selectByDocOrId(docOrId: DbDoc | string): LmdbDatabase {
    return this.selectByKey(typeof docOrId === 'string' ? docOrId : docOrId._id)
  }

  private selectByKey(key: string): LmdbDatabase {
    return this.dbBySelector(getStorageScopeForKey(key) === 'device' ? 'device' : 'account')
  }

  private dbBySelector(selector: DbSelector): LmdbDatabase {
    return selector === 'device' ? this.getDeviceDb() : this.getAccountDb()
  }

  private getDeviceDb(): LmdbDatabase {
    return this.manager.getDeviceDb()
  }

  private getAccountDb(): LmdbDatabase {
    return this.manager.getAccountDb()
  }
}

function mergeDocs(primary: DbDoc[], secondary: DbDoc[]): DbDoc[] {
  const byId = new Map<string, DbDoc>()
  for (const doc of primary) byId.set(doc._id, doc)
  for (const doc of secondary) byId.set(doc._id, doc)
  return Array.from(byId.values()).sort((a, b) => a._id.localeCompare(b._id))
}
