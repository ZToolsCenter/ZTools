import LmdbDatabase from '../lmdb'
import type { DbDoc } from '../lmdb/types'
import { hashAccountId, storageManager, type StorageManager } from './storageManager'

export interface DefaultAccountImportStatus {
  pending: boolean
  uid: string | null
  defaultDocCount: number
  targetDocCount: number
  skipped: boolean
  imported: boolean
}

export interface DefaultAccountImportResult {
  importedDocs: number
  importedAttachments: number
}

const IMPORT_STATUS_PREFIX = 'SYNC/default-account-import:'

export class DefaultAccountImportService {
  constructor(private manager: StorageManager = storageManager) {}

  getStatus(uid?: string | null): DefaultAccountImportStatus {
    const normalizedUid = uid?.trim() || this.manager.getCurrentAccountUid()
    if (!normalizedUid) {
      return this.emptyStatus(null)
    }

    const marker = this.getMarker(normalizedUid)
    const imported = marker?.status === 'imported'
    const skipped = marker?.status === 'skipped'
    const defaultDocCount = this.countDocs(this.openDefaultDb())
    const targetDocCount = this.countDocs(this.manager.getAccountDb())

    return {
      pending: defaultDocCount > 0 && targetDocCount === 0 && !imported && !skipped,
      uid: normalizedUid,
      defaultDocCount,
      targetDocCount,
      skipped,
      imported
    }
  }

  importToCurrentAccount(uid?: string | null): DefaultAccountImportResult {
    const normalizedUid = uid?.trim() || this.manager.getCurrentAccountUid()
    if (!normalizedUid) {
      throw new Error('未登录账号')
    }
    const status = this.getStatus(normalizedUid)
    if (!status.pending) {
      return { importedDocs: 0, importedAttachments: 0 }
    }

    const defaultDb = this.openDefaultDb()
    const targetDb = this.manager.getAccountDb()
    let importedDocs = 0
    let importedAttachments = 0

    try {
      const attachments = new Map(defaultDb.listAttachments().map((item) => [item.docId, item]))
      for (const doc of defaultDb.allDocs()) {
        const cleanDoc = sanitizeDefaultAccountDoc(doc, attachments.has(doc._id))
        const existing = targetDb.get(cleanDoc._id)
        const result = targetDb.put({ ...cleanDoc, _rev: existing?._rev })
        if (result.ok) importedDocs++
      }

      for (const item of attachments.values()) {
        const body = defaultDb.getAttachment(item.docId)
        if (!body) continue
        const meta = defaultDb.getAttachmentType(item.docId)
        const result = targetDb.postAttachment(
          item.docId,
          body,
          meta?.type || item.contentType || 'application/octet-stream'
        )
        if (result.ok) importedAttachments++
      }
    } finally {
      defaultDb.close()
    }

    this.saveMarker(normalizedUid, {
      status: 'imported',
      importedDocs,
      importedAttachments
    })
    return { importedDocs, importedAttachments }
  }

  skip(uid?: string | null): void {
    const normalizedUid = uid?.trim() || this.manager.getCurrentAccountUid()
    if (!normalizedUid) return
    this.saveMarker(normalizedUid, { status: 'skipped' })
  }

  private emptyStatus(uid: string | null): DefaultAccountImportStatus {
    return {
      pending: false,
      uid,
      defaultDocCount: 0,
      targetDocCount: 0,
      skipped: false,
      imported: false
    }
  }

  private openDefaultDb(): LmdbDatabase {
    return new LmdbDatabase({
      path: this.manager.getLayout().defaultAccountLmdbPath,
      mapSize: 2 * 1024 * 1024 * 1024,
      maxDbs: 6
    })
  }

  private countDocs(db: LmdbDatabase): number {
    try {
      return db.allDocs().length
    } finally {
      if (db !== this.manager.getAccountDb()) {
        db.close()
      }
    }
  }

  private markerKey(uid: string): string {
    return `${IMPORT_STATUS_PREFIX}${hashAccountId(uid)}`
  }

  private getMarker(uid: string): any {
    return this.manager.getDeviceDb().get(this.markerKey(uid))?.data || null
  }

  private saveMarker(uid: string, data: Record<string, unknown>): void {
    const key = this.markerKey(uid)
    const existing = this.manager.getDeviceDb().get(key)
    this.manager.getDeviceDb().put({
      _id: key,
      _rev: existing?._rev,
      data: {
        ...data,
        uid,
        updatedAt: Date.now()
      }
    })
  }
}

function sanitizeDefaultAccountDoc(doc: DbDoc, hasAttachment: boolean): DbDoc {
  const {
    _rev,
    _cloudSynced,
    _lastModified,
    _deleted,
    _conflicts,
    _revisions,
    _sync,
    _attachments,
    ...cleanDoc
  } = doc as any

  if (!hasAttachment) return cleanDoc
  return cleanDoc
}

export const defaultAccountImportService = new DefaultAccountImportService()
