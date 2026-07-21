import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import LmdbDatabase from '../../src/main/core/lmdb'
import { getZToolsDataLayout } from '../../src/main/core/appData/appDataPaths'
import { LegacyImportService } from '../../src/main/core/storage/legacyImportService'
import { hashAccountId, StorageManager } from '../../src/main/core/storage/storageManager'
import { DefaultAccountImportService } from '../../src/main/core/storage/defaultAccountImportService'

const tempRoots: string[] = []

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-storage3-'))
  tempRoots.push(root)
  return root
}

function cleanup(root: string): void {
  fs.rmSync(root, { recursive: true, force: true })
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) cleanup(root)
})

describe('ZTools 3.0 storage routing', () => {
  it('routes device data to device db and account data to current account db', () => {
    const homeDir = makeTempRoot()
    const manager = new StorageManager({ homeDir, mapSize: 128 * 1024 * 1024 })
    const db = manager.getRouter()

    db.put({ _id: 'ZTOOLS/settings-general', data: { theme: 'dark' } })
    db.put({ _id: 'ZTOOLS/plugins', data: [{ name: 'demo' }] })
    db.put({ _id: 'ZTOOLS/ai-models', data: [{ id: 'model-a' }] })
    db.put({ _id: 'PLUGIN/demo/settings', data: { value: 'default' } })

    expect(manager.getDeviceDb().get('ZTOOLS/settings-general')).not.toBeNull()
    expect(manager.getDeviceDb().get('ZTOOLS/plugins')).not.toBeNull()
    expect(manager.getAccountDb().get('ZTOOLS/ai-models')).not.toBeNull()
    expect(manager.getAccountDb().get('PLUGIN/demo/settings')).not.toBeNull()
    expect(manager.getDeviceDb().get('PLUGIN/demo/settings')).toBeNull()

    manager.switchAccount('alice')
    const aliceDb = manager.getRouter()
    expect(aliceDb.get('ZTOOLS/settings-general')?.data.theme).toBe('dark')
    expect(aliceDb.get('ZTOOLS/plugins')?.data[0].name).toBe('demo')
    expect(aliceDb.get('PLUGIN/demo/settings')).toBeNull()

    aliceDb.put({ _id: 'PLUGIN/demo/settings', data: { value: 'alice' } })
    expect(aliceDb.get('PLUGIN/demo/settings')?.data.value).toBe('alice')

    manager.switchAccount(null)
    expect(manager.getRouter().get('PLUGIN/demo/settings')?.data.value).toBe('default')
    manager.close()
  })

  it('keeps sync changelog scoped to account data only', () => {
    const homeDir = makeTempRoot()
    const manager = new StorageManager({ homeDir, mapSize: 128 * 1024 * 1024 })
    const db = manager.getRouter()

    db.put({ _id: 'ZTOOLS/settings-general', data: { theme: 'dark' } })
    db.put({ _id: 'ZTOOLS/ai-models', data: [{ id: 'model-a' }] })
    db.put({ _id: 'PLUGIN/demo/settings', data: { value: 'default' } })

    const changes = db.getChangesSince(0)
    expect(changes.map((change) => change.docId)).toEqual([
      'ZTOOLS/ai-models',
      'PLUGIN/demo/settings'
    ])
    manager.close()
  })

  it('uses stable hashed account directory names', () => {
    const homeDir = makeTempRoot()
    const manager = new StorageManager({ homeDir, mapSize: 128 * 1024 * 1024 })
    manager.switchAccount('user@example.com')

    const layout = getZToolsDataLayout({ homeDir })
    expect(fs.existsSync(path.join(layout.accountsRoot, hashAccountId('user@example.com')))).toBe(
      true
    )
    expect(path.basename(path.dirname(layout.accountsRoot))).toBe('lmdb')
    manager.close()
  })

  it('persists current account in device db and restores it on next startup', () => {
    const homeDir = makeTempRoot()
    const managerA = new StorageManager({ homeDir, mapSize: 128 * 1024 * 1024 })
    managerA.switchAccount('alice')
    managerA.getRouter().put({ _id: 'PLUGIN/demo/settings', data: { value: 'alice' } })
    expect(managerA.getDeviceDb().get('SYNC/current-account')?.data.uid).toBe('alice')
    managerA.close()

    const managerB = new StorageManager({ homeDir, mapSize: 128 * 1024 * 1024 })
    expect(managerB.getCurrentAccountUid()).toBe('alice')
    expect(managerB.getRouter().get('PLUGIN/demo/settings')?.data.value).toBe('alice')
    managerB.close()
  })
})

describe('ZTools 3.0 legacy import', () => {
  it('detects legacy lmdb only on first run before .ztools exists', () => {
    const homeDir = makeTempRoot()
    const legacyUserDataPath = path.join(homeDir, 'Library', 'Application Support', 'ZTools')
    fs.mkdirSync(path.join(legacyUserDataPath, 'lmdb'), { recursive: true })

    const service = new LegacyImportService(new StorageManager({ homeDir, legacyUserDataPath }), {
      homeDir,
      legacyUserDataPath
    })

    expect(service.detect()).toMatchObject({
      initialized: false,
      legacyLmdbFound: true,
      shouldPrompt: true
    })

    fs.mkdirSync(path.join(homeDir, '.ztools'), { recursive: true })
    expect(service.detect()).toMatchObject({
      initialized: false,
      legacyLmdbFound: true,
      shouldPrompt: true
    })

    service.startFresh()
    expect(service.detect()).toMatchObject({
      initialized: true,
      legacyLmdbFound: false,
      shouldPrompt: false
    })
  })

  it('imports selected legacy docs without deleting or modifying the legacy lmdb', () => {
    const homeDir = makeTempRoot()
    const legacyUserDataPath = path.join(homeDir, 'legacy-user-data')
    const legacyLmdbPath = path.join(legacyUserDataPath, 'lmdb')
    fs.mkdirSync(legacyLmdbPath, { recursive: true })
    fs.mkdirSync(path.join(legacyUserDataPath, 'plugins', 'demo'), { recursive: true })
    fs.writeFileSync(
      path.join(legacyUserDataPath, 'plugins', 'demo', 'plugin.json'),
      JSON.stringify({ name: 'demo' })
    )
    fs.mkdirSync(path.join(legacyUserDataPath, 'avatar'), { recursive: true })
    fs.writeFileSync(path.join(legacyUserDataPath, 'avatar', 'user.png'), 'avatar')

    const legacyDb = new LmdbDatabase({
      path: legacyLmdbPath,
      mapSize: 128 * 1024 * 1024,
      maxDbs: 6
    })
    legacyDb.put({ _id: 'ZTOOLS/settings-general', data: { theme: 'light' } })
    legacyDb.put({
      _id: 'ZTOOLS/plugins',
      data: [{ name: 'keep-installed', path: path.join(legacyUserDataPath, 'plugins', 'demo') }]
    })
    legacyDb.put({ _id: 'PLUGIN/demo/settings', data: { value: 'legacy' } })
    legacyDb.postAttachment('PLUGIN/demo/settings', Buffer.from('legacy-attachment'), 'text/plain')
    ;(legacyDb as any).mainDb.putSync(
      'PLUGIN/demo/cloud-state',
      JSON.stringify({
        _id: 'PLUGIN/demo/cloud-state',
        _rev: '99-oldcloud',
        _cloudSynced: true,
        _lastModified: 123456,
        _deleted: false,
        _conflicts: ['98-loser'],
        _revisions: { start: 99, ids: ['oldcloud'] },
        data: { value: 'legacy-cloud' }
      })
    )
    legacyDb.put({ _id: 'ZTOOLS/ai-models', data: [{ id: 'legacy-model' }] })
    legacyDb.put({
      _id: 'SYNC/config',
      data: {
        enabled: true,
        serverUrl: 'wss://legacy.example',
        token: 'old-token',
        refreshToken: 'old-refresh',
        username: 'old-user'
      }
    })
    legacyDb.close()

    const manager = new StorageManager({ homeDir, legacyUserDataPath, mapSize: 128 * 1024 * 1024 })
    const service = new LegacyImportService(manager, { homeDir, legacyUserDataPath })
    const result = service.importSelected({
      baseSettings: true,
      pluginInstallState: true,
      pluginData: true,
      aiModels: false,
      legacySyncConfig: true
    })

    expect(result.importedDocs).toBe(5)
    expect(result.skippedDocs).toBe(1)
    expect(result.importedAttachments).toBe(1)
    expect(result.skippedAttachments).toBe(0)
    expect(result.copiedDirs).toEqual(['plugins', 'avatar'])
    expect(manager.getDeviceDb().get('ZTOOLS/settings-general')?.data.theme).toBe('light')
    expect(manager.getDeviceDb().get('ZTOOLS/plugins')?.data[0]).toMatchObject({
      name: 'keep-installed',
      path: path.join(homeDir, '.ztools', 'plugins', 'demo')
    })
    expect(fs.existsSync(path.join(homeDir, '.ztools', 'plugins', 'demo', 'plugin.json'))).toBe(
      true
    )
    expect(fs.existsSync(path.join(homeDir, '.ztools', 'avatar', 'user.png'))).toBe(true)
    expect(manager.getAccountDb().get('PLUGIN/demo/settings')?.data.value).toBe('legacy')
    expect(
      Buffer.from(manager.getAccountDb().getAttachment('PLUGIN/demo/settings') || []).toString()
    ).toBe('legacy-attachment')
    expect(manager.getAccountDb().getAttachmentType('PLUGIN/demo/settings')?.type).toBe(
      'text/plain'
    )
    expect(
      (manager.getAccountDb().get('PLUGIN/demo/settings') as any)?._attachments?.default?.stub
    ).toBe(true)
    const importedCloudState = manager.getAccountDb().get('PLUGIN/demo/cloud-state') as any
    expect(importedCloudState.data.value).toBe('legacy-cloud')
    expect(importedCloudState._rev).not.toBe('99-oldcloud')
    expect(importedCloudState._cloudSynced).toBeUndefined()
    expect(importedCloudState._lastModified).toBeUndefined()
    expect(importedCloudState._deleted).toBeUndefined()
    expect(importedCloudState._conflicts).toBeUndefined()
    expect(importedCloudState._revisions).toBeUndefined()
    expect(manager.getAccountDb().getSyncMeta('PLUGIN/demo/cloud-state')?._cloudSynced).toBe(false)
    expect(
      manager
        .getAccountDb()
        .getChangesSince(0)
        .map((change) => change.docId)
    ).toContain('PLUGIN/demo/cloud-state')
    expect(manager.getAccountDb().get('ZTOOLS/ai-models')).toBeNull()
    expect(manager.getDeviceDb().get('SYNC/config')?.data).toMatchObject({
      enabled: false,
      serverUrl: 'wss://legacy.example',
      token: '',
      refreshToken: '',
      username: ''
    })

    const legacyCheckDb = new LmdbDatabase({
      path: legacyLmdbPath,
      mapSize: 128 * 1024 * 1024,
      maxDbs: 6
    })
    expect(legacyCheckDb.get('PLUGIN/demo/settings')?.data.value).toBe('legacy')
    expect(Buffer.from(legacyCheckDb.getAttachment('PLUGIN/demo/settings') || []).toString()).toBe(
      'legacy-attachment'
    )
    legacyCheckDb.close()
    manager.close()
  })

  it('imports the full user-data set and renames legacy camel-case keys', () => {
    const homeDir = makeTempRoot()
    const legacyUserDataPath = path.join(homeDir, 'legacy-user-data')
    const legacyLmdbPath = path.join(legacyUserDataPath, 'lmdb')
    fs.mkdirSync(legacyLmdbPath, { recursive: true })

    const legacyDb = new LmdbDatabase({
      path: legacyLmdbPath,
      mapSize: 128 * 1024 * 1024,
      maxDbs: 6
    })
    legacyDb.put({
      _id: 'ZTOOLS/plugins',
      data: [{ name: 'enabled-plugin' }, { name: 'blocked-plugin' }]
    })
    legacyDb.put({ _id: 'ZTOOLS/pinned-commands', data: [{ name: 'Pinned' }] })
    legacyDb.put({ _id: 'ZTOOLS/command-history', data: [{ name: 'Recent' }] })
    legacyDb.put({ _id: 'ZTOOLS/autoStartPlugin', data: ['enabled-plugin'] })
    legacyDb.put({ _id: 'ZTOOLS/autoDetachPlugin', data: ['enabled-plugin'] })
    legacyDb.put({ _id: 'ZTOOLS/outKillPlugin', data: ['enabled-plugin'] })
    legacyDb.put({ _id: 'ZTOOLS/disabledMainPushPlugin', data: ['blocked-plugin'] })
    legacyDb.put({
      _id: 'ZTOOLS/detachedWindowSizes',
      data: { 'enabled-plugin': { width: 600, height: 400 } }
    })
    legacyDb.put({ _id: 'ZTOOLS/settings-mcp-disabled-plugins', data: ['/plugin/path'] })
    legacyDb.put({ _id: 'ZTOOLS/plugin-market-data', data: ['cache'] })
    legacyDb.close()

    const manager = new StorageManager({ homeDir, legacyUserDataPath, mapSize: 128 * 1024 * 1024 })
    const service = new LegacyImportService(manager, { homeDir, legacyUserDataPath })
    const result = service.importSelected({ mode: 'full' })

    expect(result.mode).toBe('full')
    expect(manager.getDeviceDb().get('ZTOOLS/pinned-commands')?.data).toEqual([{ name: 'Pinned' }])
    expect(manager.getDeviceDb().get('ZTOOLS/command-history')?.data).toEqual([{ name: 'Recent' }])
    expect(manager.getDeviceDb().get('ZTOOLS/auto-start-plugin')?.data).toEqual(['enabled-plugin'])
    expect(manager.getDeviceDb().get('ZTOOLS/auto-detach-plugin')?.data).toEqual(['enabled-plugin'])
    expect(manager.getDeviceDb().get('ZTOOLS/out-kill-plugin')?.data).toEqual(['enabled-plugin'])
    expect(manager.getDeviceDb().get('ZTOOLS/enabled-main-push-plugin')?.data).toEqual([
      'enabled-plugin'
    ])
    expect(manager.getDeviceDb().get('ZTOOLS/detached-window-sizes')?.data).toEqual({
      'enabled-plugin': { width: 600, height: 400 }
    })
    expect(manager.getDeviceDb().get('ZTOOLS/settings-mcp-disabled-plugins')?.data).toEqual([
      '/plugin/path'
    ])
    expect(manager.getDeviceDb().get('ZTOOLS/autoStartPlugin')).toBeNull()
    expect(manager.getDeviceDb().get('ZTOOLS/plugin-market-data')).toBeNull()
    manager.close()
  })

  it('keeps the compact import limited to the original data set', () => {
    const homeDir = makeTempRoot()
    const legacyUserDataPath = path.join(homeDir, 'legacy-user-data')
    const legacyLmdbPath = path.join(legacyUserDataPath, 'lmdb')
    fs.mkdirSync(legacyLmdbPath, { recursive: true })

    const legacyDb = new LmdbDatabase({
      path: legacyLmdbPath,
      mapSize: 128 * 1024 * 1024,
      maxDbs: 6
    })
    legacyDb.put({ _id: 'ZTOOLS/settings-general', data: { theme: 'dark' } })
    legacyDb.put({ _id: 'ZTOOLS/pinned-commands', data: [{ name: 'Skipped' }] })
    legacyDb.put({ _id: 'ZTOOLS/autoStartPlugin', data: ['skipped-plugin'] })
    legacyDb.close()

    const manager = new StorageManager({ homeDir, legacyUserDataPath, mapSize: 128 * 1024 * 1024 })
    const service = new LegacyImportService(manager, { homeDir, legacyUserDataPath })
    const result = service.importSelected({ mode: 'compact' })

    expect(result.mode).toBe('compact')
    expect(manager.getDeviceDb().get('ZTOOLS/settings-general')?.data.theme).toBe('dark')
    expect(manager.getDeviceDb().get('ZTOOLS/pinned-commands')).toBeNull()
    expect(manager.getDeviceDb().get('ZTOOLS/auto-start-plugin')).toBeNull()
    manager.close()
  })
})

describe('ZTools 3.0 default account import after login', () => {
  it('prompts when default has data and imports it into first-time account db', () => {
    const homeDir = makeTempRoot()
    const manager = new StorageManager({ homeDir, mapSize: 128 * 1024 * 1024 })
    manager.getRouter().put({ _id: 'PLUGIN/demo/settings', data: { value: 'default-data' } })
    manager.getRouter().postAttachment('PLUGIN/demo/settings', Buffer.from('hello'), 'text/plain')

    manager.switchAccount('alice')
    const service = new DefaultAccountImportService(manager)
    const status = service.getStatus('alice')

    expect(status).toMatchObject({
      pending: true,
      defaultDocCount: 1,
      targetDocCount: 0,
      skipped: false,
      imported: false
    })

    const result = service.importToCurrentAccount('alice')
    expect(result.importedDocs).toBe(1)
    expect(result.importedAttachments).toBe(1)
    expect(manager.getRouter().get('PLUGIN/demo/settings')?.data.value).toBe('default-data')
    expect(manager.getRouter().getSyncMeta('PLUGIN/demo/settings')?._cloudSynced).toBe(false)
    expect(
      Buffer.from(manager.getRouter().getAttachment('PLUGIN/demo/settings') || []).toString()
    ).toBe('hello')
    expect(service.getStatus('alice')).toMatchObject({
      pending: false,
      imported: true
    })
    manager.close()
  })

  it('does not prompt again after user skips default data import', () => {
    const homeDir = makeTempRoot()
    const manager = new StorageManager({ homeDir, mapSize: 128 * 1024 * 1024 })
    manager.getRouter().put({ _id: 'PLUGIN/demo/settings', data: { value: 'default-data' } })
    manager.switchAccount('alice')

    const service = new DefaultAccountImportService(manager)
    expect(service.getStatus('alice').pending).toBe(true)
    service.skip('alice')
    expect(service.getStatus('alice')).toMatchObject({
      pending: false,
      skipped: true
    })
    manager.close()
  })

  it('does not prompt when account already has local data', () => {
    const homeDir = makeTempRoot()
    const manager = new StorageManager({ homeDir, mapSize: 128 * 1024 * 1024 })
    manager.getRouter().put({ _id: 'PLUGIN/default/settings', data: { value: 'default-data' } })
    manager.switchAccount('alice')
    manager.getRouter().put({ _id: 'PLUGIN/alice/settings', data: { value: 'alice-data' } })

    const service = new DefaultAccountImportService(manager)
    expect(service.getStatus('alice')).toMatchObject({
      pending: false,
      defaultDocCount: 1,
      targetDocCount: 1
    })
    manager.close()
  })
})
