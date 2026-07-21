/**
 * ZTools 同步系统集成测试（真实 LMDB）
 *
 * 使用真实 LmdbDatabase 实例，无 Electron 依赖
 * 测试完整链路：LMDB 写入 → Changelog → WebSocket 推送 → 服务端存储 → 拉取 → 应用到另一个 LMDB
 *
 * 运行方式:
 *   cd ZTools && pnpm vitest run tests/main/syncLmdb.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import http, { type Server as HttpServer } from 'http'
import WebSocket, { WebSocketServer } from 'ws'
import LmdbDatabase from '../../src/main/core/lmdb/index'
import { SyncCheckpointStore } from '../../src/main/core/sync/syncCheckpointStore'
import { SyncClient, SYNC_PREFIXES } from '../../src/main/core/sync/syncClient'
import { classifySyncError, SyncTaskStore } from '../../src/main/core/sync/syncTaskStore'

const SERVER_PORT = 23520
const BASE_URL = `http://localhost:${SERVER_PORT}`
const WS_URL = `ws://localhost:${SERVER_PORT}`
let token = ''

// ==================== Helpers ====================

function createTempDb(): { db: LmdbDatabase; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-test-'))
  const db = new LmdbDatabase({
    path: dir,
    mapSize: 256 * 1024 * 1024,
    maxDbs: 6
  })
  return { db, dir }
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function httpRequest(
  method: string,
  urlPath: string,
  body?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL)
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' }
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode!, body: data })
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitUntil(assertion: () => boolean, timeout = 5000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (assertion()) return
    await sleep(50)
  }
  throw new Error('等待条件超时')
}

function waitForSyncClientState(client: SyncClient, state: string, timeout = 5000): Promise<void> {
  if (client.getState() === state) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener('state', onState)
      reject(new Error(`等待 SyncClient 状态 ${state} 超时，当前状态 ${client.getState()}`))
    }, timeout)
    const onState = (nextState: string): void => {
      if (nextState !== state) return
      clearTimeout(timer)
      client.removeListener('state', onState)
      resolve()
    }
    client.on('state', onState)
  })
}

interface WSClient {
  ws: WebSocket
  received: any[]
  send: (msg: any) => void
  waitFor: (type: string, timeout?: number) => Promise<any>
  close: () => void
}

function createWSClientAt(url: string, wsToken: string, deviceId: string): Promise<WSClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const received: any[] = []
    let onMsg: ((msg: any) => void) | null = null
    let resolved = false

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: wsToken, deviceId, protocolVersion: 2 }))
    })

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      received.push(msg)
      if (!resolved && msg.type === 'auth_ok') {
        resolved = true
        resolve(client)
      }
      if (onMsg) onMsg(msg)
    })

    ws.on('error', (err) => {
      if (!resolved) reject(err)
    })

    const client: WSClient = {
      ws,
      received,
      send(msg) {
        ws.send(JSON.stringify(msg))
      },
      waitFor(type: string, timeout = 5000) {
        const idx = received.findIndex((m) => m.type === type)
        if (idx !== -1) return Promise.resolve(received.splice(idx, 1)[0])
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            onMsg = null
            reject(new Error(`等待 ${type} 超时`))
          }, timeout)
          onMsg = (msg) => {
            if (msg.type === type) {
              clearTimeout(timer)
              onMsg = null
              const i = received.indexOf(msg)
              if (i !== -1) received.splice(i, 1)
              resolve(msg)
            }
          }
        })
      },
      close() {
        ws.close()
      }
    }

    setTimeout(() => {
      if (!resolved) reject(new Error('连接超时'))
    }, 5000)
  })
}

function createWSClient(wsToken: string, deviceId: string): Promise<WSClient> {
  return createWSClientAt(WS_URL, wsToken, deviceId)
}

// ==================== Server Lifecycle ====================

class InMemorySyncTestServer {
  private httpServer: HttpServer | null = null
  private wsServer: WebSocketServer | null = null
  private readonly users = new Map<string, string>()
  private readonly issuedTokens = new Map<string, string>()
  private readonly changes: any[] = []
  private readonly checkpoints = new Map<string, any>()
  private seq = 0

  async start(port: number): Promise<void> {
    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res))
    this.wsServer = new WebSocketServer({ server: this.httpServer })
    this.wsServer.on('connection', (ws) => this.handleWs(ws))
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject)
      this.httpServer!.listen(port, () => resolve())
    })
  }

  async stop(): Promise<void> {
    for (const client of this.wsServer?.clients || []) {
      client.close()
    }
    await new Promise<void>((resolve) => this.wsServer?.close(() => resolve()) || resolve())
    await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()) || resolve())
    this.wsServer = null
    this.httpServer = null
  }

  private json(res: http.ServerResponse, status: number, body: any): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {})
        } catch {
          resolve({})
        }
      })
    })
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'GET' && req.url === '/health') {
      this.json(res, 200, { ok: true, connections: this.wsServer?.clients.size || 0 })
      return
    }

    if (req.method === 'POST' && req.url === '/api/auth') {
      const body = await this.readBody(req)
      const uid = String(body.uid || '')
      const password = String(body.password || '')
      if (!uid || !password) {
        this.json(res, 400, { error: 'uid and password are required' })
        return
      }

      const existingPassword = this.users.get(uid)
      if (existingPassword && existingPassword !== password) {
        this.json(res, 401, { error: 'Invalid credentials' })
        return
      }

      const isNew = !existingPassword
      if (isNew) this.users.set(uid, password)
      const userToken = `test-token:${uid}:${Date.now()}:${Math.random()}`
      this.issuedTokens.set(userToken, uid)
      this.json(res, 200, { token: userToken, refreshToken: `refresh:${userToken}`, isNew })
      return
    }

    this.json(res, 404, { error: 'Not found' })
  }

  private handleWs(ws: WebSocket): void {
    let authedUid = ''
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'auth') {
        const uid = this.issuedTokens.get(msg.token)
        if (!uid) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }))
          ws.close()
          return
        }
        authedUid = uid
        ws.send(
          JSON.stringify({
            type: 'auth_ok',
            serverSeq: this.seq,
            protocolVersion: 2,
            syncEpoch: 0,
            features: { checkpoint: true }
          })
        )
        return
      }

      if (!authedUid) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }))
        return
      }

      if (msg.type === 'get_checkpoint') {
        ws.send(
          JSON.stringify({
            type: 'checkpoint',
            checkpoint: this.checkpoints.get(msg.checkpointId) || {
              id: msg.checkpointId,
              remotePullSeq: 0,
              localPushSeq: 0,
              lastSeq: 0,
              protocolVersion: 2,
              syncEpoch: 0
            }
          })
        )
        return
      }

      if (msg.type === 'put_checkpoint') {
        this.checkpoints.set(msg.checkpoint.id, msg.checkpoint)
        ws.send(JSON.stringify({ type: 'checkpoint_ok', checkpoint: msg.checkpoint }))
        return
      }

      if (msg.type === 'pull') {
        ws.send(
          JSON.stringify({
            type: 'changes',
            changes: this.changes.filter((change) => change.seq > msg.since),
            seq: this.seq
          })
        )
        return
      }

      if (msg.type === 'push') {
        for (const change of msg.changes || []) {
          this.seq += 1
          const nextChange = { ...change, seq: this.seq }
          this.changes.push(nextChange)
          for (const client of this.wsServer?.clients || []) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'change', change: nextChange }))
            }
          }
        }
        ws.send(JSON.stringify({ type: 'push_ok', seq: this.seq }))
        return
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
      }
    })
  }
}

const testServer = new InMemorySyncTestServer()

async function startServer(): Promise<void> {
  await testServer.start(SERVER_PORT)
}

// ==================== Tests ====================

describe('同步系统集成测试（真实 LMDB）', () => {
  const tempDirs: string[] = []

  beforeAll(async () => {
    await startServer()

    // 注册测试用户
    const reg = await httpRequest('POST', '/api/auth', {
      uid: 'lmdb-test-user',
      password: 'pass123'
    })
    expect(reg.status).toBe(200)
    expect(reg.body.token).toBeTruthy()
    token = reg.body.token
  }, 15000)

  afterAll(async () => {
    await testServer.stop()
    for (const dir of tempDirs) cleanupDir(dir)
  })

  afterEach(() => {
    // cleanup is done in afterAll
  })

  function makeTempDb(): LmdbDatabase {
    const { db, dir } = createTempDb()
    tempDirs.push(dir)
    return db
  }

  // ==================== LMDB 本地行为测试 ====================

  describe('LMDB 本地读写 + Changelog', () => {
    it('put 写入文档并生成 changelog', () => {
      const db = makeTempDb()
      const result = db.put({
        _id: 'PLUGIN/test-plugin',
        name: 'TestPlugin',
        version: '1.0.0'
      })

      expect(result.ok).toBe(true)
      expect(result.rev).toBeTruthy()

      // 验证文档可读取
      const doc = db.get('PLUGIN/test-plugin')
      expect(doc).not.toBeNull()
      expect(doc!.name).toBe('TestPlugin')
      expect(doc!._rev).toBe(result.rev)

      // 验证 changelog 已写入
      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(1)
      expect(changes[0].docId).toBe('PLUGIN/test-plugin')
      expect(changes[0].deleted).toBe(false)
      expect(changes[0].seq).toBe(1)

      db.close()
    })

    it('多次写入递增 seq', () => {
      const db = makeTempDb()

      db.put({ _id: 'PLUGIN/a', data: '1' })
      db.put({ _id: 'PLUGIN/b', data: '2' })
      db.put({ _id: 'PLUGIN/c', data: '3' })

      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(3)
      expect(changes[0].seq).toBe(1)
      expect(changes[1].seq).toBe(2)
      expect(changes[2].seq).toBe(3)

      expect(db.getLastSeq()).toBe(3)

      db.close()
    })

    it('getChangesSince 增量查询', () => {
      const db = makeTempDb()

      db.put({ _id: 'PLUGIN/x', data: '1' })
      db.put({ _id: 'PLUGIN/y', data: '2' })
      db.put({ _id: 'PLUGIN/z', data: '3' })

      const since1 = db.getChangesSince(1)
      expect(since1.length).toBe(2)
      expect(since1[0].docId).toBe('PLUGIN/y')
      expect(since1[1].docId).toBe('PLUGIN/z')

      const since2 = db.getChangesSince(2)
      expect(since2.length).toBe(1)
      expect(since2[0].docId).toBe('PLUGIN/z')

      const since3 = db.getChangesSince(3)
      expect(since3.length).toBe(0)

      db.close()
    })

    it('删除文档写入 changelog（deleted=true）', () => {
      const db = makeTempDb()

      const putResult = db.put({ _id: 'PLUGIN/del-me', data: 'temp' })
      db.remove({ _id: 'PLUGIN/del-me', _rev: putResult.rev })

      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(2)
      expect(changes[1].deleted).toBe(true)
      expect(changes[1].docId).toBe('PLUGIN/del-me')

      expect(db.get('PLUGIN/del-me')).toBeNull()

      db.close()
    })

    it('已删除的 key 可以不带 _rev 重新创建', () => {
      const db = makeTempDb()

      const created = db.put({ _id: 'PLUGIN/recreate-me', value: 'old' })
      expect(created.ok).toBe(true)
      const removed = db.remove({ _id: 'PLUGIN/recreate-me', _rev: created.rev })
      expect(removed.ok).toBe(true)
      expect(db.get('PLUGIN/recreate-me')).toBeNull()

      const recreated = db.put({ _id: 'PLUGIN/recreate-me', value: 'new' })
      expect(recreated.ok).toBe(true)
      expect(recreated.rev).toMatch(/^3-/)
      expect(db.get('PLUGIN/recreate-me')?.value).toBe('new')

      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(3)
      expect(changes[2].docId).toBe('PLUGIN/recreate-me')
      expect(changes[2].deleted).toBe(false)
      expect(changes[2].parentRev).toBe(removed.rev)

      db.close()
    })

    it('全新设备应用远端 tombstone 后保留最后版本号并可重新创建', () => {
      const db = makeTempDb()
      const docId = 'PLUGIN/remote-tombstone'

      const applied = db.applyRemoteChange({
        docId,
        rev: '7-remote-deleted',
        parentRev: '6-remote-live',
        deleted: true,
        timestamp: Date.now(),
        doc: null
      })

      expect(applied.ok).toBe(true)
      expect(db.get(docId)).toBeNull()

      const meta = db.getSyncMeta(docId)
      expect(meta?._deleted).toBe(true)
      expect(meta?._rev).toBe('7-remote-deleted')
      expect(meta?._winningRev).toBe('7-remote-deleted')

      const recreated = db.put({ _id: docId, value: 'revived locally' })
      expect(recreated.ok).toBe(true)
      expect(recreated.rev).toMatch(/^8-/)
      expect(db.get(docId)?.value).toBe('revived locally')

      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(1)
      expect(changes[0].docId).toBe(docId)
      expect(changes[0].deleted).toBe(false)
      expect(changes[0].parentRev).toBe('7-remote-deleted')

      db.close()
    })

    it('更新文档也写入 changelog', () => {
      const db = makeTempDb()

      const r1 = db.put({ _id: 'PLUGIN/updatable', version: '1.0' })
      const r2 = db.put({ _id: 'PLUGIN/updatable', _rev: r1.rev, version: '2.0' })

      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(2)
      expect(changes[0].rev).toBe(r1.rev)
      expect(changes[1].rev).toBe(r2.rev)

      const doc = db.get('PLUGIN/updatable')
      expect(doc!.version).toBe('2.0')

      db.close()
    })

    it('可以为当前 revision 生成 CouchDB 风格祖先链', () => {
      const db = makeTempDb()

      const r1 = db.put({ _id: 'PLUGIN/revision-history', version: '1.0' })
      const r2 = db.put({ _id: 'PLUGIN/revision-history', _rev: r1.rev, version: '2.0' })
      const r3 = db.put({ _id: 'PLUGIN/revision-history', _rev: r2.rev, version: '3.0' })

      expect(db.getRevisionHistory('PLUGIN/revision-history', r3.rev)).toEqual([
        r3.rev,
        r2.rev,
        r1.rev
      ])

      db.close()
    })

    it('应用远端 revisionHistory 时会用祖先链收敛旧 leaf', () => {
      const db = makeTempDb()
      const docId = 'PLUGIN/lineage-repair'

      db.applyRemoteChange({
        docId,
        rev: '73-local-old',
        parentRev: '72-local-parent',
        deleted: false,
        timestamp: Date.now(),
        doc: { _id: docId, _rev: '73-local-old', value: 'same' }
      })
      expect(db.getConflicts(docId).length).toBe(0)

      db.applyRemoteChange({
        docId,
        rev: '75-cloud-current',
        deleted: false,
        revisionHistory: ['75-cloud-current', '74-cloud-parent', '73-local-old'],
        timestamp: Date.now() + 1000,
        doc: { _id: docId, _rev: '75-cloud-current', value: 'same' }
      })

      expect(db.get(docId)?._rev).toBe('75-cloud-current')
      expect(db.getConflicts(docId).length).toBe(0)
      expect(db.getRevisionHistory(docId, '75-cloud-current')).toEqual([
        '75-cloud-current',
        '74-cloud-parent',
        '73-local-old',
        '72-local-parent'
      ])

      db.close()
    })

    it('重复导入同内容文档后拉取远端版本不会产生假冲突', () => {
      const db = makeTempDb()
      const docId = 'PLUGIN/reimport-same-content'

      const local = db.put({
        _id: docId,
        title: 'Anime.js',
        url: 'https://animejs.com/',
        icon: { type: 'image', text: 'an' }
      })
      expect(local.ok).toBe(true)

      const applied = db.applyRemoteChange({
        docId,
        rev: '1-cloud-existing',
        deleted: false,
        timestamp: Date.now(),
        doc: {
          _id: docId,
          _rev: '1-cloud-existing',
          title: 'Anime.js',
          url: 'https://animejs.com/',
          icon: { type: 'image', text: 'an' }
        }
      })

      expect(applied.ok).toBe(true)
      expect(db.get(docId)?._rev).toBe('1-cloud-existing')
      expect(db.getConflicts(docId)).toHaveLength(0)

      const pushChanges = db.getChangesSince(0)
      expect(pushChanges).toHaveLength(1)
      expect(pushChanges[0].rev).toBe(local.rev)
      expect(db.get(docId)?._rev).not.toBe(pushChanges[0].rev)

      db.close()
    })

    it('非同步前缀的文档不产生 changelog', () => {
      const db = makeTempDb()

      db.put({ _id: 'command-history/cmd1', command: 'ls' })

      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(0)

      db.close()
    })

    it('applyRemoteDoc 不写入 changelog', () => {
      const db = makeTempDb()

      // 先本地写一条
      db.put({ _id: 'PLUGIN/local1', data: 'local' })
      expect(db.getChangesSince(0).length).toBe(1)

      // 应用远端文档
      db.applyRemoteDoc({
        _id: 'PLUGIN/remote1',
        _rev: '5-abc',
        data: 'from-server'
      })

      // changelog 仍然只有 1 条
      expect(db.getChangesSince(0).length).toBe(1)

      // 但文档已写入
      const remote = db.get('PLUGIN/remote1')
      expect(remote).not.toBeNull()
      expect(remote!.data).toBe('from-server')

      db.close()
    })

    it('applyRemoteRemove 不写入 changelog', () => {
      const db = makeTempDb()

      db.put({ _id: 'PLUGIN/will-remove', data: 'temp' })
      expect(db.getChangesSince(0).length).toBe(1)

      // 远端删除
      db.applyRemoteRemove('PLUGIN/will-remove')
      expect(db.getChangesSince(0).length).toBe(1) // 仍为 1
      expect(db.get('PLUGIN/will-remove')).toBeNull()

      db.close()
    })

    it('bulkDocs 批量写入产生对应 changelog', () => {
      const db = makeTempDb()

      db.bulkDocs([
        { _id: 'PLUGIN/bulk-1', data: 'a' },
        { _id: 'PLUGIN/bulk-2', data: 'b' },
        { _id: 'PLUGIN/bulk-3', data: 'c' }
      ])

      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(3)
      expect(changes.map((c) => c.docId).sort()).toEqual([
        'PLUGIN/bulk-1',
        'PLUGIN/bulk-2',
        'PLUGIN/bulk-3'
      ])

      db.close()
    })

    it('postAttachment 生成 CouchDB 风格 _attachments revision', () => {
      const db = makeTempDb()

      const docResult = db.put({ _id: 'PLUGIN/with-attachment', title: 'attachment-owner' })
      expect(docResult.ok).toBe(true)
      const attachmentResult = db.postAttachment(
        'PLUGIN/with-attachment',
        Buffer.from('hello couch attachment'),
        'text/plain'
      )
      expect(attachmentResult.ok).toBe(true)

      const doc = db.get('PLUGIN/with-attachment') as any
      expect(doc?._attachments?.default?.stub).toBe(true)
      expect(doc?._attachments?.default?.digest).toMatch(/^md5-/)
      expect(doc?._attachments?.default?.content_type).toBe('text/plain')
      expect(doc?._attachments?.default?.length).toBe(Buffer.byteLength('hello couch attachment'))

      const meta = db.getAttachmentType('PLUGIN/with-attachment') as any
      expect(meta.digest).toBe(doc._attachments.default.digest)
      expect(meta.name).toBe('default')

      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(2)
      expect(changes[1].docId).toBe('PLUGIN/with-attachment')

      db.close()
    })

    it('postAttachment 在文档不存在时创建附件文档 revision', () => {
      const db = makeTempDb()

      const attachmentResult = db.postAttachment(
        'PLUGIN/attachment-only',
        Buffer.from('attachment without existing doc'),
        'text/plain'
      )
      expect(attachmentResult.ok).toBe(true)

      const doc = db.get('PLUGIN/attachment-only') as any
      expect(doc).not.toBeNull()
      expect(doc?._id).toBe('PLUGIN/attachment-only')
      expect(doc?._rev).toBe(attachmentResult.rev)
      expect(doc?._attachments?.default?.stub).toBe(true)
      expect(doc?._attachments?.default?.digest).toMatch(/^md5-/)
      expect(doc?._attachments?.default?.content_type).toBe('text/plain')

      const changes = db.getChangesSince(0)
      expect(changes.length).toBe(1)
      expect(changes[0].docId).toBe('PLUGIN/attachment-only')
      expect(changes[0].rev).toBe(attachmentResult.rev)
      expect(changes[0].deleted).toBe(false)

      db.close()
    })

    it('applyRemoteChange 记录远端 _attachments stub metadata', () => {
      const db = makeTempDb()

      db.applyRemoteChange({
        docId: 'PLUGIN/remote-attachment',
        rev: '2-remote',
        parentRev: null,
        deleted: false,
        timestamp: Date.now(),
        doc: {
          _id: 'PLUGIN/remote-attachment',
          _rev: '2-remote',
          title: 'remote',
          _attachments: {
            default: {
              stub: true,
              digest: 'md5-abc123',
              content_type: 'text/plain',
              length: 12,
              revpos: 2
            }
          }
        }
      })

      const meta = db.getAttachmentType('PLUGIN/remote-attachment') as any
      expect(meta.digest).toBe('md5-abc123')
      expect(meta.md5).toBe('abc123')
      expect(meta.type).toBe('text/plain')
      expect(meta.revpos).toBe(2)

      db.close()
    })

    it('远端附件只有 stub metadata 且缺少 body 时会触发下载', async () => {
      const db = makeTempDb()
      const client = new SyncClient(db)
      const digest = 'md5-abc123'
      const docId = 'PLUGIN/remote-attachment-missing-body'
      const calls: Array<{ docId: string; digest?: string }> = []

      db.applyRemoteChange({
        docId,
        rev: '2-remote',
        parentRev: null,
        deleted: false,
        timestamp: Date.now(),
        doc: {
          _id: docId,
          _rev: '2-remote',
          _attachments: {
            default: {
              stub: true,
              digest,
              content_type: 'text/plain',
              length: 12,
              revpos: 2
            }
          }
        }
      })

      expect(db.getAttachmentType(docId)?.digest).toBe(digest)
      expect(db.getAttachment(docId)).toBeNull()
      ;(client as any).retryScheduler.retryNow = () => {}
      ;(client as any).retryScheduler.emitStatus = () => {}
      ;(client as any).downloadAttachmentDirect = async (
        nextDocId: string,
        nextDigest?: string
      ) => {
        calls.push({ docId: nextDocId, digest: nextDigest })
      }
      ;(client as any).downloadMissingDocumentAttachments([
        {
          seq: 1,
          docId,
          rev: '2-remote',
          deleted: false,
          timestamp: Date.now(),
          doc: db.get(docId)
        }
      ])

      await waitUntil(() => calls.length > 0)
      expect(calls[0]).toEqual({ docId, digest })

      client.stop()
      db.close()
    })

    it('removeAttachment 生成普通文档 revision 并移除 _attachments.default', () => {
      const db = makeTempDb()

      expect(db.put({ _id: 'PLUGIN/remove-attachment', title: 'attachment-owner' }).ok).toBe(true)
      expect(
        db.postAttachment('PLUGIN/remove-attachment', Buffer.from('will remove'), 'text/plain').ok
      ).toBe(true)

      db.removeAttachment('PLUGIN/remove-attachment')

      const doc = db.get('PLUGIN/remove-attachment') as any
      expect(doc).not.toBeNull()
      expect(doc?._attachments?.default).toBeUndefined()
      expect(db.getAttachmentType('PLUGIN/remove-attachment')).toBeNull()

      const changes = db.getChangesSince(0) as any[]
      expect(changes.length).toBe(3)
      expect(changes.every((change) => change.docType !== 'attachment')).toBe(true)
      expect(changes[2].docId).toBe('PLUGIN/remove-attachment')
      expect(changes[2].deleted).toBe(false)

      db.close()
    })

    it('compactChangelog 清理旧条目', () => {
      const db = makeTempDb()

      db.put({ _id: 'PLUGIN/c1', data: '1' })
      db.put({ _id: 'PLUGIN/c2', data: '2' })
      db.put({ _id: 'PLUGIN/c3', data: '3' })

      expect(db.getChangesSince(0).length).toBe(3)

      // 清理 seq <= 2
      db.compactChangelog(2)
      const remaining = db.getChangesSince(0)
      expect(remaining.length).toBe(1)
      expect(remaining[0].seq).toBe(3)

      db.close()
    })

    it('resolveConflict 选择 loser leaf 生成新的当前版本', () => {
      const db = makeTempDb()

      const local = db.put({ _id: 'PLUGIN/resolve-me', value: 'local' })
      expect(local.ok).toBe(true)

      db.applyRemoteChange({
        docId: 'PLUGIN/resolve-me',
        rev: '9-remotewinner',
        parentRev: null,
        deleted: false,
        timestamp: Date.now() + 1000,
        doc: { _id: 'PLUGIN/resolve-me', _rev: '9-remotewinner', value: 'remote' }
      })

      let current = db.get('PLUGIN/resolve-me')
      expect(current).not.toBeNull()
      expect(current!.value).toBe('remote')

      let conflicts = db.getConflicts('PLUGIN/resolve-me')
      expect(conflicts.length).toBe(1)
      expect(conflicts[0]._rev).toBe(local.rev)

      const beforeSeq = db.getLastSeq()
      const resolve = db.resolveConflict('PLUGIN/resolve-me', local.rev!)
      expect(resolve.ok).toBe(true)
      expect(resolve.rev).toBeTruthy()

      current = db.get('PLUGIN/resolve-me')
      expect(current).not.toBeNull()
      expect(current!.value).toBe('local')
      expect(current!._rev).toBe(resolve.rev)

      conflicts = db.getConflicts('PLUGIN/resolve-me')
      expect(conflicts.length).toBe(0)

      const meta = db.getSyncMeta('PLUGIN/resolve-me')
      expect(meta?._hasConflicts).toBe(false)
      expect(meta?._conflictCount).toBe(0)
      expect(db.getLastSeq()).toBe(beforeSeq + 1)

      const changes = db.getChangesSince(beforeSeq)
      expect(changes.length).toBe(1)
      expect(changes[0].docId).toBe('PLUGIN/resolve-me')
      expect(changes[0].parentRev).toBe('9-remotewinner')

      db.close()
    })

    it('removeAndResolve 删除文档并收敛其他 leaf', () => {
      const db = makeTempDb()

      const local = db.put({ _id: 'PLUGIN/remove-resolve-me', value: 'local' })
      expect(local.ok).toBe(true)

      db.applyRemoteChange({
        docId: 'PLUGIN/remove-resolve-me',
        rev: '9-remotewinner',
        parentRev: null,
        deleted: false,
        timestamp: Date.now() + 1000,
        doc: { _id: 'PLUGIN/remove-resolve-me', _rev: '9-remotewinner', value: 'remote' }
      })
      expect(db.get('PLUGIN/remove-resolve-me')?.value).toBe('remote')
      expect(db.getConflicts('PLUGIN/remove-resolve-me').length).toBe(1)

      const beforeSeq = db.getLastSeq()
      const remove = db.removeAndResolve('PLUGIN/remove-resolve-me')
      expect(remove.ok).toBe(true)
      expect(db.get('PLUGIN/remove-resolve-me')).toBeNull()
      expect(db.getConflicts('PLUGIN/remove-resolve-me').length).toBe(0)

      const meta = db.getSyncMeta('PLUGIN/remove-resolve-me')
      expect(meta?._deleted).toBe(true)
      expect(meta?._hasConflicts).toBe(false)
      expect(meta?._conflictCount).toBe(0)

      const changes = db.getChangesSince(beforeSeq)
      expect(changes.length).toBe(1)
      expect(changes[0].docId).toBe('PLUGIN/remove-resolve-me')
      expect(changes[0].deleted).toBe(true)
      expect(changes[0].resolution?.retireOtherLeaves).toBe(true)

      db.close()
    })

    it('SyncCheckpointStore 使用结构化 checkpoint 并按 batchToSeq 推进 push', () => {
      const db = makeTempDb()
      const metaDb = db.getMetaDb()

      const store = new SyncCheckpointStore(db)
      let checkpoint = store.load('checkpoint-user', 'checkpoint-device')

      expect(checkpoint.remotePullSeq).toBe(0)
      expect(checkpoint.localPushSeq).toBe(0)
      expect(checkpoint.syncEpoch).toBe(0)
      expect(checkpoint.protocolVersion).toBe(0)

      checkpoint = store.commitPull(checkpoint, 7, { syncEpoch: 11, protocolVersion: 2 })
      expect(checkpoint.remotePullSeq).toBe(7)
      expect(checkpoint.syncEpoch).toBe(11)
      expect(checkpoint.protocolVersion).toBe(2)

      checkpoint = store.beginPush(checkpoint, [
        {
          seq: 4,
          docId: 'PLUGIN/checkpoint-4',
          rev: '1-a',
          deleted: false,
          timestamp: Date.now(),
          doc: { _id: 'PLUGIN/checkpoint-4', _rev: '1-a' }
        },
        {
          seq: 5,
          docId: 'PLUGIN/checkpoint-5',
          rev: '1-b',
          deleted: false,
          timestamp: Date.now(),
          doc: { _id: 'PLUGIN/checkpoint-5', _rev: '1-b' }
        }
      ])
      checkpoint = store.commitPush(checkpoint)

      expect(checkpoint.localPushSeq).toBe(5)
      const saved = JSON.parse(
        metaDb.get('_sync_checkpoint:checkpoint-user:checkpoint-device') as string
      )
      expect(saved.remotePullSeq).toBe(7)
      expect(saved.localPushSeq).toBe(5)
      expect(saved.syncEpoch).toBe(11)
      expect(saved.protocolVersion).toBe(2)

      db.close()
    })

    it('SyncTaskStore 持久化任务、查询 due task 并统计重试状态', () => {
      const db = makeTempDb()
      const store = new SyncTaskStore((db as any).getSyncTaskDb())
      const now = Date.now()

      store.upsert({
        id: 'upload_blob:PLUGIN/task:md5-a',
        type: 'upload_blob',
        payload: { docId: 'PLUGIN/task', digest: 'md5-a', contentType: 'text/plain' },
        nextRetryAt: now - 1
      })
      store.upsert({
        id: 'download_blob:PLUGIN/task:md5-b',
        type: 'download_blob',
        payload: { docId: 'PLUGIN/task', digest: 'md5-b', contentType: 'text/plain', length: 3 },
        nextRetryAt: now + 60000
      })

      expect(store.due(now).map((task) => task.id)).toEqual(['upload_blob:PLUGIN/task:md5-a'])
      expect(store.status().pendingUploads).toBe(1)
      expect(store.status().pendingDownloads).toBe(1)

      store.markFailed(
        'upload_blob:PLUGIN/task:md5-a',
        Object.assign(new Error('Attachment upload failed: 503'), { status: 503 })
      )
      const failed = store.get('upload_blob:PLUGIN/task:md5-a')
      expect(failed?.status).toBe('pending')
      expect(failed?.attempts).toBe(1)
      expect(failed?.nextRetryAt).toBeGreaterThan(now)

      store.markFailed(
        'download_blob:PLUGIN/task:md5-b',
        Object.assign(new Error('Unauthorized'), { status: 401 }),
        'auth_required'
      )
      expect(store.status().authRequired).toBe(1)
      expect(classifySyncError(Object.assign(new Error('bad request'), { status: 400 }))).toBe(
        'failed_permanent'
      )

      store.remove('upload_blob:PLUGIN/task:md5-a')
      expect(store.get('upload_blob:PLUGIN/task:md5-a')).toBeNull()

      db.close()
    })
  })

  // ==================== 端到端同步测试 ====================

  describe('端到端同步（LMDB → WebSocket → Server → LMDB）', () => {
    it('设备 A 写入 LMDB → 推送 → 设备 B 拉取 → 应用到 LMDB', async () => {
      const dbA = makeTempDb()
      const dbB = makeTempDb()

      // A 本地写入
      dbA.put({
        _id: 'PLUGIN/plugin-alpha',
        name: 'Alpha',
        version: '1.0.0',
        settings: { theme: 'dark' }
      })
      dbA.put({
        _id: 'ZTOOLS/user-settings',
        theme: 'dark',
        language: 'zh-CN'
      })

      const changesA = dbA.getChangesSince(0)
      expect(changesA.length).toBe(2)

      // A 连接并推送
      const clientA = await createWSClient(token, 'device-a-lmdb')
      const fullChanges = changesA.map((c) => ({
        ...c,
        doc: c.deleted ? null : dbA.get(c.docId)
      }))

      clientA.send({ type: 'push', changes: fullChanges })
      const pushRes = await clientA.waitFor('push_ok')
      expect(pushRes.seq).toBeGreaterThan(0)
      clientA.close()

      // B 连接并拉取
      const clientB = await createWSClient(token, 'device-b-lmdb')
      clientB.send({ type: 'pull', since: 0 })
      const pullRes = await clientB.waitFor('changes')
      expect(pullRes.changes.length).toBe(2)

      // 应用到 B 的 LMDB
      for (const change of pullRes.changes) {
        if (change.deleted) {
          dbB.applyRemoteRemove(change.docId)
        } else if (change.doc) {
          dbB.applyRemoteDoc(change.doc)
        }
      }

      // 验证 B 的数据
      const alpha = dbB.get('PLUGIN/plugin-alpha')
      expect(alpha).not.toBeNull()
      expect(alpha!.name).toBe('Alpha')
      expect(alpha!.settings.theme).toBe('dark')

      const settings = dbB.get('ZTOOLS/user-settings')
      expect(settings).not.toBeNull()
      expect(settings!.theme).toBe('dark')

      // B 的 changelog 应为空（远端应用不写入）
      expect(dbB.getChangesSince(0).length).toBe(0)

      clientB.close()
      dbA.close()
      dbB.close()
    })

    it('实时广播：B 写入 → A 实时收到', async () => {
      const dbA = makeTempDb()
      const dbB = makeTempDb()

      const clientA = await createWSClient(token, 'device-a-rt')
      const clientB = await createWSClient(token, 'device-b-rt')

      // A 先拉取（建立连接）
      clientA.send({ type: 'pull', since: 0 })
      await clientA.waitFor('changes')

      // 准备 A 接收广播
      const broadcastPromise = clientA.waitFor('change', 5000)

      // B 本地写入
      dbB.put({
        _id: 'PLUGIN/realtime-test',
        name: 'Realtime',
        source: 'device-B'
      })

      const bChanges = dbB.getChangesSince(0)
      clientB.send({
        type: 'push',
        changes: bChanges.map((c) => ({
          ...c,
          doc: c.deleted ? null : dbB.get(c.docId)
        }))
      })
      await clientB.waitFor('push_ok')

      // A 收到实时广播
      const broadcast = await broadcastPromise
      expect(broadcast.change.docId).toBe('PLUGIN/realtime-test')
      expect(broadcast.change.doc.source).toBe('device-B')

      // A 应用到本地 LMDB
      dbA.applyRemoteDoc(broadcast.change.doc)
      const applied = dbA.get('PLUGIN/realtime-test')
      expect(applied!.name).toBe('Realtime')
      expect(applied!.source).toBe('device-B')

      clientA.close()
      clientB.close()
      dbA.close()
      dbB.close()
    })

    it('LWW 覆盖写：B 更新 → A 收到最新版', async () => {
      const dbA = makeTempDb()
      const dbB = makeTempDb()

      // A 推送初始数据
      dbA.put({ _id: 'PLUGIN/lww-doc', version: '1.0' })
      const clientA = await createWSClient(token, 'device-a-lww')
      const initChanges = dbA.getChangesSince(0).map((c) => ({
        ...c,
        doc: dbA.get(c.docId)
      }))
      clientA.send({ type: 'push', changes: initChanges })
      await clientA.waitFor('push_ok')

      // B 拉取 → 本地修改 → 推送
      const clientB = await createWSClient(token, 'device-b-lww')
      clientB.send({ type: 'pull', since: 0 })
      const pullRes = await clientB.waitFor('changes')
      for (const c of pullRes.changes) {
        if (c.doc) dbB.applyRemoteDoc(c.doc)
      }

      // B 更新
      const existingDoc = dbB.get('PLUGIN/lww-doc')!
      dbB.put({ _id: 'PLUGIN/lww-doc', _rev: existingDoc._rev, version: '2.0' })

      // A 等待广播
      const updatePromise = clientA.waitFor('change', 5000)

      const bChanges = dbB.getChangesSince(0) // B 的本地 changelog（只有更新这条）
      clientB.send({
        type: 'push',
        changes: bChanges.map((c) => ({
          ...c,
          doc: c.deleted ? null : dbB.get(c.docId)
        }))
      })
      await clientB.waitFor('push_ok')

      const updateBroadcast = await updatePromise
      expect(updateBroadcast.change.doc.version).toBe('2.0')

      // A 应用更新
      dbA.applyRemoteDoc(updateBroadcast.change.doc)
      expect(dbA.get('PLUGIN/lww-doc')!.version).toBe('2.0')

      clientA.close()
      clientB.close()
      dbA.close()
      dbB.close()
    })

    it('删除同步：B 删除 → A 收到删除广播', async () => {
      const dbA = makeTempDb()
      const dbB = makeTempDb()

      // A 推送初始文档
      dbA.put({ _id: 'PLUGIN/to-delete', data: 'will be deleted' })
      const clientA = await createWSClient(token, 'device-a-del')
      clientA.send({
        type: 'push',
        changes: dbA.getChangesSince(0).map((c) => ({
          ...c,
          doc: dbA.get(c.docId)
        }))
      })
      await clientA.waitFor('push_ok')

      // B 拉取并应用
      const clientB = await createWSClient(token, 'device-b-del')
      clientB.send({ type: 'pull', since: 0 })
      const pullRes = await clientB.waitFor('changes')
      for (const c of pullRes.changes) {
        if (c.doc) dbB.applyRemoteDoc(c.doc)
      }
      expect(dbB.get('PLUGIN/to-delete')).not.toBeNull()

      // B 删除
      const docToRemove = dbB.get('PLUGIN/to-delete')!
      dbB.remove({ _id: 'PLUGIN/to-delete', _rev: docToRemove._rev })

      // A 等待删除广播
      const delPromise = clientA.waitFor('change', 5000)

      const delChanges = dbB.getChangesSince(0).filter((c) => c.deleted)
      clientB.send({
        type: 'push',
        changes: delChanges.map((c) => ({ ...c, doc: null }))
      })
      await clientB.waitFor('push_ok')

      const delBroadcast = await delPromise
      expect(delBroadcast.change.deleted).toBe(true)
      expect(delBroadcast.change.docId).toBe('PLUGIN/to-delete')

      // A 应用删除
      dbA.applyRemoteRemove('PLUGIN/to-delete')
      expect(dbA.get('PLUGIN/to-delete')).toBeNull()

      clientA.close()
      clientB.close()
      dbA.close()
      dbB.close()
    })

    it('全新设备首次拉取能收到云端已删除文档的 tombstone', async () => {
      const dbA = makeTempDb()
      const dbB = makeTempDb()
      const dbC = makeTempDb()
      const docId = 'PLUGIN/new-device-tombstone'

      const initial = dbA.put({ _id: docId, value: 'will be deleted before C joins' })
      const clientA = await createWSClient(token, 'device-a-tombstone')
      clientA.send({
        type: 'push',
        changes: dbA.getChangesSince(0).map((c) => ({
          ...c,
          doc: c.deleted ? null : dbA.get(c.docId)
        }))
      })
      await clientA.waitFor('push_ok')

      const clientB = await createWSClient(token, 'device-b-tombstone')
      clientB.send({ type: 'pull', since: 0 })
      const pullToB = await clientB.waitFor('changes')
      const initialChange = pullToB.changes.find((c: any) => c.docId === docId && !c.deleted)
      expect(initialChange).toBeTruthy()
      dbB.applyRemoteChange(initialChange)

      const remove = dbB.remove({ _id: docId, _rev: dbB.get(docId)!._rev })
      expect(remove.ok).toBe(true)
      expect(remove.rev).toMatch(/^2-/)

      const deleteChanges = dbB.getChangesSince(0).filter((c) => c.docId === docId && c.deleted)
      expect(deleteChanges.length).toBe(1)
      expect(deleteChanges[0].parentRev).toBe(initial.rev)

      clientB.send({
        type: 'push',
        changes: deleteChanges.map((c) => ({ ...c, doc: null }))
      })
      await clientB.waitFor('push_ok')

      const clientC = await createWSClient(token, 'device-c-tombstone-new')
      clientC.send({ type: 'pull', since: 0 })
      const pullToC = await clientC.waitFor('changes')
      const tombstone = pullToC.changes.find((c: any) => c.docId === docId && c.deleted)
      expect(tombstone).toBeTruthy()
      expect(tombstone.rev).toBe(remove.rev)
      expect(tombstone.parentRev).toBe(initial.rev)
      expect(tombstone.doc == null || Object.keys(tombstone.doc).length === 0).toBe(true)

      dbC.applyRemoteChange(tombstone)
      expect(dbC.get(docId)).toBeNull()
      expect(dbC.getSyncMeta(docId)?._deleted).toBe(true)
      expect(dbC.getSyncMeta(docId)?._rev).toBe(remove.rev)

      const recreated = dbC.put({ _id: docId, value: 'created on new device' })
      expect(recreated.ok).toBe(true)
      expect(recreated.rev).toMatch(/^3-/)
      expect(dbC.getChangesSince(0)[0].parentRev).toBe(remove.rev)

      clientA.close()
      clientB.close()
      clientC.close()
      dbA.close()
      dbB.close()
      dbC.close()
    })

    it('resolveConflict 收敛后另一设备拉取也归零冲突', async () => {
      const dbA = makeTempDb()
      const dbB = makeTempDb()

      // A 推送初始文档
      const initial = dbA.put({ _id: 'PLUGIN/resolve-sync', value: 'base' })
      expect(initial.ok).toBe(true)
      const clientA = await createWSClient(token, 'device-a-resolve')
      clientA.send({
        type: 'push',
        changes: dbA.getChangesSince(0).map((c) => ({
          ...c,
          doc: dbA.get(c.docId)
        }))
      })
      const initialPushRes = await clientA.waitFor('push_ok')

      // B 拉取初始文档
      const clientB = await createWSClient(token, 'device-b-resolve')
      clientB.send({ type: 'pull', since: 0 })
      const initialPull = await clientB.waitFor('changes')
      for (const c of initialPull.changes) {
        if (c.doc) dbB.applyRemoteChange(c)
      }

      // B 构造 sibling leaf 并通过 v2 push 推送到服务端，同时本地也应用该分支
      const siblingChange = {
        seq: 0,
        docId: 'PLUGIN/resolve-sync',
        rev: '9-b-leaf',
        parentRev: null,
        deleted: false,
        timestamp: Date.now() + 1000,
        doc: { _id: 'PLUGIN/resolve-sync', _rev: '9-b-leaf', value: 'remote-branch' }
      }
      dbB.applyRemoteChange(siblingChange)
      clientB.send({
        type: 'push',
        protocolVersion: 2,
        changes: [siblingChange]
      })
      const branchPushRes = await clientB.waitFor('push_ok')

      // A 通过增量 pull 获得 sibling 冲突
      clientA.send({ type: 'pull', since: initialPushRes.seq, protocolVersion: 2 })
      const conflictPull = await clientA.waitFor('changes')
      for (const c of conflictPull.changes) {
        if (c.docId === 'PLUGIN/resolve-sync') {
          dbA.applyRemoteChange(c)
        }
      }
      expect(dbA.getConflicts('PLUGIN/resolve-sync').length).toBe(1)

      // A 本地 resolve，选择本地 leaf 收敛
      const localWinnerRev = dbA.getConflicts('PLUGIN/resolve-sync')[0]._rev!
      const resolveResult = dbA.resolveConflict('PLUGIN/resolve-sync', localWinnerRev)
      expect(resolveResult.ok).toBe(true)
      expect(dbA.getConflicts('PLUGIN/resolve-sync').length).toBe(0)

      // A 推送 resolve 事件
      const resolveChanges = dbA
        .getChangesSince(0)
        .filter((c) => c.docId === 'PLUGIN/resolve-sync' && c.resolution?.retireOtherLeaves)
      expect(resolveChanges.length).toBe(1)
      clientA.send({
        type: 'push',
        changes: resolveChanges.map((c) => ({
          ...c,
          doc: c.deleted ? null : dbA.get(c.docId)
        }))
      })
      await clientA.waitFor('push_ok')

      // B 增量拉取 resolve 事件并应用，冲突应归零
      clientB.send({ type: 'pull', since: branchPushRes.seq })
      const resolvePull = await clientB.waitFor('changes')
      for (const c of resolvePull.changes) {
        if (c.docId === 'PLUGIN/resolve-sync') {
          dbB.applyRemoteChange(c)
        }
      }

      expect(dbB.get('PLUGIN/resolve-sync')?.value).toBe('base')
      expect(dbB.getConflicts('PLUGIN/resolve-sync').length).toBe(0)
      expect(dbB.getSyncMeta('PLUGIN/resolve-sync')?._hasConflicts).toBe(false)
      expect(dbB.getSyncMeta('PLUGIN/resolve-sync')?._conflictCount).toBe(0)

      clientA.close()
      clientB.close()
      dbA.close()
      dbB.close()
    }, 15000)

    it('live 模式 resolveConflict 后会自动推送到云端', async () => {
      const dbA = makeTempDb()
      const dbB = makeTempDb()
      const docId = `PLUGIN/live-resolve-${Date.now()}`
      const liveServerPort = SERVER_PORT + 10
      const liveServerUrl = `ws://localhost:${liveServerPort}`
      const serverChanges: any[] = []
      let serverSeq = 0
      const liveServer = new WebSocketServer({ port: liveServerPort })

      liveServer.on('connection', (ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'auth') {
            ws.send(
              JSON.stringify({
                type: 'auth_ok',
                serverSeq,
                protocolVersion: 2,
                syncEpoch: 0,
                features: { checkpoint: true }
              })
            )
            return
          }
          if (msg.type === 'get_checkpoint') {
            ws.send(
              JSON.stringify({
                type: 'checkpoint',
                checkpoint: {
                  id: msg.checkpointId,
                  remotePullSeq: 0,
                  localPushSeq: 0,
                  lastSeq: 0,
                  protocolVersion: 2,
                  syncEpoch: 0
                }
              })
            )
            return
          }
          if (msg.type === 'put_checkpoint') {
            ws.send(JSON.stringify({ type: 'checkpoint_ok', checkpoint: msg.checkpoint }))
            return
          }
          if (msg.type === 'pull') {
            ws.send(
              JSON.stringify({
                type: 'changes',
                changes: serverChanges.filter((change) => change.seq > msg.since),
                seq: serverSeq
              })
            )
            return
          }
          if (msg.type === 'push') {
            for (const change of msg.changes || []) {
              serverSeq += 1
              const nextChange = { ...change, seq: serverSeq }
              serverChanges.push(nextChange)
              for (const client of liveServer.clients) {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'change', change: nextChange }))
                }
              }
            }
            ws.send(JSON.stringify({ type: 'push_ok', seq: serverSeq }))
            return
          }
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }))
          }
        })
      })

      dbA.put({ _id: docId, value: 'base' })

      const syncClientA = new SyncClient(dbA)
      syncClientA.start({
        enabled: true,
        serverUrl: liveServerUrl,
        token,
        deviceId: 'device-a-live-resolve',
        syncInterval: 30,
        lastSyncTime: 0,
        username: 'lmdb-test-user'
      })
      await waitForSyncClientState(syncClientA, 'live', 8000)

      const clientB = await createWSClientAt(liveServerUrl, token, 'device-b-live-resolve')
      clientB.send({ type: 'pull', since: 0, protocolVersion: 2 })
      const initialPull = await clientB.waitFor('changes')
      const initialChange = initialPull.changes.find((c: any) => c.docId === docId)
      expect(initialChange).toBeTruthy()
      dbB.applyRemoteChange(initialChange)

      const siblingChange = {
        seq: 0,
        docId,
        rev: '9-live-branch',
        parentRev: null,
        deleted: false,
        timestamp: Date.now() + 1000,
        doc: { _id: docId, _rev: '9-live-branch', value: 'remote-branch' }
      }
      dbB.applyRemoteChange(siblingChange)
      clientB.send({
        type: 'push',
        protocolVersion: 2,
        changes: [siblingChange]
      })
      const branchPushRes = await clientB.waitFor('push_ok')

      await waitUntil(() => dbA.getConflicts(docId).length === 1, 8000)

      const localConflictRev = dbA.getConflicts(docId)[0]._rev!
      const resolveResult = dbA.resolveConflict(docId, localConflictRev)
      expect(resolveResult.ok).toBe(true)

      await waitUntil(
        () =>
          serverChanges.some(
            (change) => change.docId === docId && change.resolution?.retireOtherLeaves
          ),
        8000
      )

      clientB.send({ type: 'pull', since: branchPushRes.seq, protocolVersion: 2 })
      const resolvePull = await clientB.waitFor('changes', 8000)
      const resolveChange = resolvePull.changes.find(
        (c: any) => c.docId === docId && c.resolution?.retireOtherLeaves
      )
      expect(resolveChange).toBeTruthy()

      dbB.applyRemoteChange(resolveChange)
      expect(dbB.getConflicts(docId).length).toBe(0)
      expect(dbB.getSyncMeta(docId)?._hasConflicts).toBe(false)

      syncClientA.stop()
      clientB.close()
      liveServer.close()
      dbA.close()
      dbB.close()
    }, 20000)

    it('断线增量恢复', async () => {
      const dbA = makeTempDb()
      const dbB = makeTempDb()

      // B 连接，获取当前 seq
      const clientB = await createWSClient(token, 'device-b-offline')
      clientB.send({ type: 'pull', since: 0 })
      const initPull = await clientB.waitFor('changes')
      const bSeq = initPull.seq

      // B 断线
      clientB.close()
      await sleep(300)

      // A 在 B 离线期间推送数据
      dbA.put({ _id: 'PLUGIN/offline-data', data: 'created while B offline' })
      const clientA = await createWSClient(token, 'device-a-offline')
      clientA.send({
        type: 'push',
        changes: dbA.getChangesSince(0).map((c) => ({
          ...c,
          doc: dbA.get(c.docId)
        }))
      })
      await clientA.waitFor('push_ok')
      clientA.close()

      // B 重连，增量拉取
      const clientB2 = await createWSClient(token, 'device-b-offline')
      clientB2.send({ type: 'pull', since: bSeq })
      const incPull = await clientB2.waitFor('changes')

      const offlineDoc = incPull.changes.find((c: any) => c.docId === 'PLUGIN/offline-data')
      expect(offlineDoc).toBeTruthy()
      expect(offlineDoc.doc.data).toBe('created while B offline')

      // 应用到 B 的 LMDB
      dbB.applyRemoteDoc(offlineDoc.doc)
      expect(dbB.get('PLUGIN/offline-data')!.data).toBe('created while B offline')

      clientB2.close()
      dbA.close()
      dbB.close()
    })

    it('大批量文档推送 (100 条)', async () => {
      const db = makeTempDb()

      // 批量写入 LMDB
      for (let i = 0; i < 100; i++) {
        db.put({ _id: `PLUGIN/bulk-${i}`, index: i, data: `value-${i}` })
      }

      expect(db.getChangesSince(0).length).toBe(100)
      expect(db.getLastSeq()).toBe(100)

      // 推送到服务端
      const client = await createWSClient(token, 'device-bulk')
      const changes = db.getChangesSince(0).map((c) => ({
        ...c,
        doc: db.get(c.docId)
      }))

      client.send({ type: 'push', changes })
      const pushRes = await client.waitFor('push_ok')
      expect(pushRes.seq).toBeGreaterThan(0)

      // 另一个 LMDB 拉取
      const db2 = makeTempDb()
      const client2 = await createWSClient(token, 'device-bulk-recv')
      client2.send({ type: 'pull', since: pushRes.seq - 100 })
      const pullRes = await client2.waitFor('changes')
      expect(pullRes.changes.length).toBeGreaterThanOrEqual(100)

      // 批量应用
      for (const c of pullRes.changes) {
        if (c.doc && c.docId.startsWith('PLUGIN/bulk-')) {
          db2.applyRemoteDoc(c.doc)
        }
      }

      // 验证数据完整性
      for (let i = 0; i < 100; i++) {
        const doc = db2.get(`PLUGIN/bulk-${i}`)
        expect(doc).not.toBeNull()
        expect(doc!.index).toBe(i)
      }

      client.close()
      client2.close()
      db.close()
      db2.close()
    }, 15000)
  })

  // ==================== 服务端 API 测试 ====================

  describe('服务端 REST API', () => {
    it('/api/auth 自动注册 + 登录', async () => {
      const reg = await httpRequest('POST', '/api/auth', {
        uid: 'auto-reg-user',
        password: 'secret'
      })
      expect(reg.status).toBe(200)
      expect(reg.body.token).toBeTruthy()
      expect(reg.body.isNew).toBe(true)

      // 再次调用 = 登录
      const login = await httpRequest('POST', '/api/auth', {
        uid: 'auto-reg-user',
        password: 'secret'
      })
      expect(login.status).toBe(200)
      expect(login.body.token).toBeTruthy()
      expect(login.body.isNew).toBe(false)
    })

    it('/api/auth 密码错误', async () => {
      await httpRequest('POST', '/api/auth', {
        uid: 'auth-error-user',
        password: 'correct'
      })

      const bad = await httpRequest('POST', '/api/auth', {
        uid: 'auth-error-user',
        password: 'wrong'
      })
      expect(bad.status).toBe(401)
    })

    it('/health 健康检查', async () => {
      const res = await httpRequest('GET', '/health')
      expect(res.status).toBe(200)
      expect(typeof res.body.connections).toBe('number')
    })
  })

  // ==================== 首次同步场景测试 ====================

  describe('首次同步：历史数据推送', () => {
    it('localSeq=0 时推送所有已有 changelog', async () => {
      const db = makeTempDb()

      // 模拟应用使用一段时间后积累数据
      db.put({ _id: 'PLUGIN/p1', data: 'old-1' })
      db.put({ _id: 'PLUGIN/p2', data: 'old-2' })
      db.put({ _id: 'PLUGIN/p3', data: 'old-3' })
      db.put({ _id: 'ZTOOLS/user-settings', theme: 'dark' })

      expect(db.getLastSeq()).toBe(4)

      // 首次同步：localSeq 应该从 0 开始（而非 getLastSeq）
      const changes = db.getChangesSince(0) // 关键：since=0
      expect(changes.length).toBe(4)

      // 推送到服务端
      const client = await createWSClient(token, 'device-first-sync')
      const fullChanges = changes.map((c) => ({
        ...c,
        doc: c.deleted ? null : db.get(c.docId)
      }))

      client.send({ type: 'push', changes: fullChanges })
      const pushRes = await client.waitFor('push_ok')
      expect(pushRes.seq).toBeGreaterThan(0)

      // 另一个设备可以拉到这 4 条
      const client2 = await createWSClient(token, 'device-first-sync-verify')
      client2.send({ type: 'pull', since: pushRes.seq - 4 })
      const pullRes = await client2.waitFor('changes')
      expect(pullRes.changes.length).toBeGreaterThanOrEqual(4)

      client.close()
      client2.close()
      db.close()
    })

    it('forcePushAll：扫描所有文档推送（不依赖 changelog）', async () => {
      const db = makeTempDb()

      // 写入数据
      db.put({ _id: 'PLUGIN/fp1', data: 'force-1' })
      db.put({ _id: 'PLUGIN/fp2', data: 'force-2' })
      db.put({ _id: 'ZTOOLS/user-settings', fontSize: 14 })

      // 模拟 changelog 被清理的场景
      db.compactChangelog(db.getLastSeq())
      expect(db.getChangesSince(0).length).toBe(0)

      // forcePushAll 不依赖 changelog，直接扫描文档
      const allDocs: any[] = []
      for (const prefix of SYNC_PREFIXES) {
        allDocs.push(...db.allDocs(prefix))
      }
      expect(allDocs.length).toBe(3)

      // 构造推送数据
      const fullChanges = allDocs.map((doc) => ({
        seq: 0,
        docId: doc._id,
        rev: doc._rev || '',
        deleted: false,
        timestamp: Date.now(),
        doc
      }))

      // 推送到服务端
      const client = await createWSClient(token, 'device-force-push')
      client.send({ type: 'push', changes: fullChanges })
      const pushRes = await client.waitFor('push_ok')
      expect(pushRes.seq).toBeGreaterThan(0)

      // 验证服务端有数据
      const db2 = makeTempDb()
      const client2 = await createWSClient(token, 'device-force-push-verify')
      client2.send({ type: 'pull', since: pushRes.seq - 3 })
      const pullRes = await client2.waitFor('changes')

      const fp1 = pullRes.changes.find((c: any) => c.docId === 'PLUGIN/fp1')
      expect(fp1).toBeTruthy()
      expect(fp1.doc.data).toBe('force-1')

      const settings = pullRes.changes.find((c: any) => c.docId === 'ZTOOLS/user-settings')
      expect(settings).toBeTruthy()
      expect(settings.doc.fontSize).toBe(14)

      client.close()
      client2.close()
      db.close()
      db2.close()
    })
  })
})
