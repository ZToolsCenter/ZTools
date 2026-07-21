import crypto from 'crypto'
import path from 'path'
import { EventEmitter } from 'events'
import LmdbDatabase from '../lmdb'
import {
  ensure3Layout,
  hasLegacyLmdb,
  type AppDataPathOptions,
  type ZToolsDataLayout
} from '../appData/appDataPaths'
import { readDataVersion, writeDataVersion } from '../appData/appDataVersion'
import { StorageRouter } from './storageRouter'

const DEFAULT_MAP_SIZE = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_DBS = 6

export interface StorageInitState {
  firstRun: boolean
  legacyLmdbFound: boolean
  importedFromLegacy: boolean
  layout: ZToolsDataLayout
}

export interface StorageManagerOptions extends AppDataPathOptions {
  mapSize?: number
}

export class StorageManager extends EventEmitter {
  private deviceDb: LmdbDatabase | null = null
  private accountDb: LmdbDatabase | null = null
  private router: StorageRouter | null = null
  private currentAccountUid: string | null = null
  private initState: StorageInitState | null = null

  constructor(private options: StorageManagerOptions = {}) {
    super()
  }

  init(): StorageInitState {
    if (this.initState && this.deviceDb && this.accountDb && this.router) {
      return this.initState
    }

    const existingVersion = readDataVersion(this.options)
    const firstRun = !existingVersion
    const legacyLmdbFound = firstRun && hasLegacyLmdb(this.options)
    const layout = ensure3Layout(this.options)
    const version =
      existingVersion ||
      (legacyLmdbFound ? null : writeDataVersion({ importedFromLegacy: false }, this.options))

    this.deviceDb = this.openDb(layout.deviceLmdbPath)
    this.currentAccountUid = this.loadPersistedAccountUid(this.deviceDb)
    this.accountDb = this.openDb(this.accountPathForUid(this.currentAccountUid, layout))
    this.router = new StorageRouter(this)
    this.router.bindAccountDb(this.accountDb)

    this.initState = {
      firstRun,
      legacyLmdbFound,
      importedFromLegacy: Boolean(version?.importedFromLegacy),
      layout
    }
    return this.initState
  }

  getInitState(): StorageInitState {
    return this.init()
  }

  getLayout(): ZToolsDataLayout {
    return this.init().layout
  }

  getDeviceDb(): LmdbDatabase {
    this.init()
    return this.deviceDb!
  }

  getAccountDb(): LmdbDatabase {
    this.init()
    return this.accountDb!
  }

  getRouter(): StorageRouter {
    this.init()
    return this.router!
  }

  getCurrentAccountUid(): string | null {
    this.init()
    return this.currentAccountUid
  }

  switchAccount(uid?: string | null): void {
    this.init()
    const normalizedUid = uid?.trim() || null
    if (normalizedUid === this.currentAccountUid) return

    const nextPath = this.accountPathForUid(normalizedUid, this.getLayout())
    const nextDb = this.openDb(nextPath)
    const previousDb = this.accountDb

    this.currentAccountUid = normalizedUid
    this.accountDb = nextDb
    this.router?.bindAccountDb(nextDb)

    if (previousDb) {
      try {
        previousDb.close()
      } catch (error) {
        console.error('[Storage] close previous account db failed:', error)
      }
    }

    this.persistCurrentAccountUid(normalizedUid)

    this.emit('account-switched', { uid: normalizedUid })
  }

  close(): void {
    this.router?.unbind()
    this.router = null
    for (const db of [this.accountDb, this.deviceDb]) {
      try {
        db?.close()
      } catch (error) {
        console.error('[Storage] close db failed:', error)
      }
    }
    this.accountDb = null
    this.deviceDb = null
    this.currentAccountUid = null
    this.initState = null
  }

  private openDb(dbPath: string): LmdbDatabase {
    return new LmdbDatabase({
      path: dbPath,
      mapSize: this.options.mapSize || DEFAULT_MAP_SIZE,
      maxDbs: DEFAULT_MAX_DBS
    })
  }

  private accountPathForUid(uid: string | null, layout: ZToolsDataLayout): string {
    return uid ? path.join(layout.accountsRoot, hashAccountId(uid)) : layout.defaultAccountLmdbPath
  }

  private loadPersistedAccountUid(deviceDb: LmdbDatabase): string | null {
    const doc = deviceDb.get('SYNC/current-account')
    const uid = doc?.data?.uid
    return typeof uid === 'string' && uid.trim() ? uid.trim() : null
  }

  private persistCurrentAccountUid(uid: string | null): void {
    const deviceDb = this.getDeviceDb()
    const existing = deviceDb.get('SYNC/current-account')
    deviceDb.put({
      _id: 'SYNC/current-account',
      _rev: existing?._rev,
      data: { uid }
    })
  }
}

export function hashAccountId(uid: string): string {
  return crypto.createHash('sha256').update(uid).digest('hex').slice(0, 16)
}

export const storageManager = new StorageManager()
