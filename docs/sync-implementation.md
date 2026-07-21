# ZTools 数据同步系统 — 当前实现文档

> 本文描述仓库当前实现，而不是目标设计。若代码继续演进，应同步更新本文，避免协议、存储结构和 UI 行为出现口径差异。

---

## 一、架构总览

当前同步系统由 Electron 客户端、本地 LMDB、Go 同步服务端和 MySQL 组成。主体协议是 `Changelog + WebSocket`，文档版本模型参考 CouchDB/PouchDB 的 revision tree 思路，但协议本身是自定义的。

```
客户端 (Electron)                                        服务端 (Go)
┌──────────────────────────────────────┐              ┌───────────────────────────────┐
│  设置插件 SyncSetting.vue            │              │  HTTP REST API                │
│  登录 / 启停 / 状态 / 冲突处理       │              │  ├─ POST /api/auth            │
├──────────────────────────────────────┤              │  ├─ POST /api/register        │
│  IPC 层 renderer/sync.ts             │──── HTTP ───►│  ├─ POST /api/login           │
│  保存配置、派发 SyncClient 操作      │              │  ├─ GET  /health              │
├──────────────────────────────────────┤              │  ├─ /api/sync/attachments/*   │
│  SyncClient                          │◄═══ WS ════►│  └─ GET /api/admin/**         │
│  Pull → Push → Live                  │              ├───────────────────────────────┤
│  文档走 WS，附件走 HTTP              │──── HTTP ───►│  WebSocket Server             │
├──────────────────────────────────────┤              │  auth / pull / push / ping    │
│  LMDB                                │              ├───────────────────────────────┤
│  ├─ mainDb       当前 winner 文档     │              │  MySQL                        │
│  ├─ metaDb       元信息和 checkpoint │              │  ├─ users                     │
│  ├─ revisionDb   本地 revision graph │              │  ├─ documents 当前投影        │
│  ├─ changelogDb  本地文档变更日志    │              │  ├─ document_revisions        │
│  └─ attachmentDb 附件二进制和元信息  │              │  ├─ changelog                 │
└──────────────────────────────────────┘              │  ├─ device_sync_state         │
                                                      │  ├─ attachment_blobs          │
                                                      │  ├─ revision_attachments      │
                                                      │  ├─ sync_checkpoints          │
                                                      │  └─ sync_meta                 │
                                                      └───────────────────────────────┘
```

### 模块职责

| 模块         | 路径                                                             | 当前职责                                                                                    |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 设置 UI      | `internal-plugins/setting/src/views/SyncSetting/SyncSetting.vue` | 登录/注册、启停同步、显示状态、手动同步、强制推送、冲突列表和冲突解决                       |
| IPC 层       | `src/main/api/renderer/sync.ts`                                  | 调用服务端登录接口，保存/读取同步配置，启动/停止 `SyncClient`，暴露统计和冲突 IPC           |
| SyncClient   | `src/main/core/sync/syncClient.ts`                               | WebSocket 连接、认证、Pull/Push/Live 三阶段、心跳、重连、附件 HTTP 上传下载                 |
| LMDB SyncApi | `src/main/core/lmdb/syncApi.ts`                                  | 文档 CRUD、`_rev` 生成与校验、本地 changelog、本地 revision graph、冲突解决、附件本地 API   |
| 同步服务端   | `sync-server-go/cmd/server/main.go`                              | REST + WebSocket 协议、revision 写入、changelog 查询、广播、附件 blob、checkpoint、管理接口 |
| 服务端数据层 | `sync-server-go/internal/repository`                             | MySQL 查询、事务、revision/附件/checkpoint 持久化                                           |
| 服务端业务层 | `sync-server-go/internal/sync`                                   | Push/Pull、revision tree、CouchDB 风格附件 metadata、checkpoint、compaction                 |
| 服务端接口层 | `sync-server-go/internal/transport`                              | WebSocket、认证接口、附件 HTTP 接口、管理接口                                               |
| 服务端迁移   | `sync-server-go/internal/store/migrations`                       | Flyway 风格 `Vxxx__name.sql` 迁移，历史脚本不修改，只追加新版本                             |
| 服务端认证   | `sync-server-go/internal/auth`                                   | bcrypt 密码哈希、JWT 签发与校验                                                             |

---

## 二、服务端

### 2.1 依赖

```
gorm / mysql driver   MySQL 访问
gorilla/websocket     WebSocket 服务器
golang-jwt/jwt        JWT
bcrypt                密码哈希
```

### 2.2 MySQL 表结构

当前服务端使用 `documents` 保存每个文档的当前 winner 投影，同时使用 `document_revisions` 保留叶子版本和历史版本。迁移脚本位于 `sync-server-go/internal/store/migrations`，启动时按 `schema_migrations` 记录顺序执行；已经发布的历史迁移脚本不再修改。

```sql
CREATE TABLE users (
  uid TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE documents (
  uid TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  rev TEXT NOT NULL,
  last_modified INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (uid, doc_id)
);

CREATE TABLE document_revisions (
  uid TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  rev TEXT NOT NULL,
  parent_rev TEXT,
  doc_json TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  last_modified INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  device_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  is_leaf INTEGER NOT NULL DEFAULT 1,
  is_winner INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, doc_id, rev)
);

CREATE TABLE changelog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  rev TEXT NOT NULL,
  deleted INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL,
  device_id TEXT,
  doc_type TEXT DEFAULT 'doc',
  attachment_meta TEXT,
  parent_rev TEXT,
  winner_rev TEXT,
  protocol_version INTEGER DEFAULT 1,
  resolution TEXT
);

CREATE TABLE device_sync_state (
  uid TEXT NOT NULL,
  device_id TEXT NOT NULL,
  last_seq INTEGER DEFAULT 0,
  last_seen INTEGER,
  device_name TEXT,
  PRIMARY KEY (uid, device_id)
);

CREATE TABLE attachment_blobs (
  uid VARCHAR(191) NOT NULL,
  digest VARCHAR(191) NOT NULL,
  content_type VARCHAR(191) NOT NULL,
  length BIGINT NOT NULL,
  data LONGBLOB NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (uid, digest)
);

CREATE TABLE revision_attachments (
  uid VARCHAR(191) NOT NULL,
  doc_id VARCHAR(255) NOT NULL,
  rev VARCHAR(191) NOT NULL,
  name VARCHAR(120) NOT NULL,
  digest VARCHAR(191) NOT NULL,
  content_type VARCHAR(191) NOT NULL,
  length BIGINT NOT NULL,
  revpos BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (uid, doc_id, rev, name)
);

CREATE TABLE sync_checkpoints (
  uid VARCHAR(191) NOT NULL,
  checkpoint_id VARCHAR(191) NOT NULL,
  source_id VARCHAR(191) NOT NULL,
  target_id VARCHAR(191) NOT NULL,
  last_seq BIGINT NOT NULL DEFAULT 0,
  checkpoint_json LONGTEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (uid, checkpoint_id)
);

CREATE TABLE sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

旧库启动时会把 `documents` 中已有的投影 seed 到 `document_revisions`，并初始化：

```
protocol_version = 2
sync_epoch = 当前 changelog 最大 seq
```

### 2.3 REST API

同步相关接口：

| 端点                                               | 方法 | 鉴权         | 说明                                                 |
| -------------------------------------------------- | ---- | ------------ | ---------------------------------------------------- |
| `/api/auth`                                        | POST | 否           | 统一入口：账号不存在则创建，存在则校验密码           |
| `/api/register`                                    | POST | 否           | 显式注册                                             |
| `/api/login`                                       | POST | 否           | 显式登录                                             |
| `/health`                                          | GET  | 否           | 健康检查，返回在线连接数                             |
| `/api/sync/attachments`                            | GET  | Bearer token | 列出当前用户当前 winner revision 引用的附件 metadata |
| `/api/sync/attachments?action=compact&graceMs=...` | POST | Bearer token | 清理没有 revision 引用的附件 blob                    |
| `/api/sync/attachments/blobs/:digest`              | PUT  | Bearer token | 上传 digest blob，服务端重新计算 MD5 并校验          |
| `/api/sync/attachments/blobs/:digest`              | GET  | Bearer token | 按 digest 下载附件二进制                             |

管理接口当前未加鉴权，默认只适合内网或受保护网络使用：

| 端点                                    | 方法 | 说明                                                                      |
| --------------------------------------- | ---- | ------------------------------------------------------------------------- |
| `/api/admin/stats`                      | GET  | 全局统计，包含用户、文档、revision、changelog、附件、协议版本、sync epoch |
| `/api/admin/users`                      | GET  | 用户列表和在线设备摘要                                                    |
| `/api/admin/users/:uid/documents`       | GET  | 当前投影文档列表                                                          |
| `/api/admin/users/:uid/document/:docId` | GET  | 单文档投影和 revisions                                                    |
| `/api/admin/users/:uid/changelog`       | GET  | 最近 100 条 changelog                                                     |
| `/api/admin/users/:uid/devices`         | GET  | 设备列表和在线状态                                                        |
| `/api/admin/users/:uid/attachments`     | GET  | 附件列表和大小                                                            |

### 2.4 认证机制

```
密码存储: bcrypt.GenerateFromPassword(password, bcrypt.DefaultCost)
密码验证: bcrypt.CompareHashAndPassword(stored_hash, password)
Token:    jwt.sign({ uid }, JWT_SECRET, { expiresIn: '30d' })
验证:     jwt.verify(token, JWT_SECRET)
默认密钥: JWT_SECRET 环境变量 || 'ztools-sync-secret-dev'
```

WebSocket 认证除了校验 JWT，还会查询 `users` 表确认用户仍存在。失败时发送 error 并以 `4003` 关闭连接；30 秒内未认证则以 `4001` 关闭。

### 2.5 WebSocket 协议

客户端到服务端：

| type             | 字段                                             | 说明                                                               |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `auth`           | `token, deviceId, deviceName?, protocolVersion?` | JWT 认证，记录设备 ID 和设备名                                     |
| `get_checkpoint` | `checkpointId`                                   | 读取 CouchDB `_local/<replication-id>` 风格远端 checkpoint         |
| `put_checkpoint` | `checkpoint`                                     | 写入远端 checkpoint，只有本地批次成功后发送                        |
| `pull`           | `since, snapshot?, protocolVersion?`             | 拉取 changelog 增量；`snapshot=true` 时拉取当前所有 leaf revisions |
| `push`           | `changes[], protocolVersion?`                    | 推送本地文档变更                                                   |
| `ping`           | -                                                | 心跳                                                               |

服务端到客户端：

| type            | 字段                                              | 说明                                                               |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `auth_ok`       | `serverSeq, protocolVersion, syncEpoch, features` | 认证成功；当前 features 包含 `revisionRetention` 和 `snapshotPull` |
| `changes`       | `changes[], seq, snapshot?, reset?, syncEpoch?`   | Pull 响应                                                          |
| `change`        | `change`                                          | 实时广播给其他设备                                                 |
| `push_ok`       | `seq`                                             | Push 成功，返回本次写入的最后服务端 seq                            |
| `push_missing`  | `missingDigests[]`                                | Push 引用的附件 blob 不存在，客户端需补传后重试同批次              |
| `checkpoint`    | `checkpoint`                                      | 远端 checkpoint 读取结果                                           |
| `checkpoint_ok` | `checkpoint`                                      | 远端 checkpoint 写入成功                                           |
| `pong`          | -                                                 | 心跳响应                                                           |
| `error`         | `message`                                         | 协议错误                                                           |

`FullChangeEntry` 当前结构：

```ts
interface FullChangeEntry {
  seq: number
  docId: string
  rev: string
  parentRev?: string | null
  deleted: boolean
  timestamp: number
  doc: object | null
  docType?: 'doc'
  winnerRev?: string
  isWinner?: boolean
  resolution?: { retireOtherLeaves?: boolean }
}
```

### 2.6 服务端文档同步逻辑

#### Push

protocol v2 客户端推送文档时，服务端执行 revision 写入，而不是简单覆盖：

1. 校验文档 `_attachments` stub 引用的 digest blob 是否已存在；缺失时返回 `push_missing`，不写 revision。
2. 如果 `document_revisions` 已有相同 `(uid, doc_id, rev)`，视为重复变更，不追加 changelog。
3. 插入新 revision：
   - `parent_rev` 来自客户端。
   - `generation` 由 `rev` 前缀解析。
   - `deleted=true` 时 `doc_json` 保存 `{}`。
   - `_attachments` 只保存 stub metadata；二进制只存在 `attachment_blobs`。
   - 如果存在 parent revision，将 parent 标记为非 leaf。
4. 若 `resolution.retireOtherLeaves=true`，把同文档其他 leaf 标记为非 leaf。
5. 从当前 leaf revisions 中选择 winner：
   - 优先非删除 leaf。
   - `generation` 大者赢。
   - generation 相同时 `rev` 字典序大者赢。
6. 更新 `documents` 当前投影和 revision winner 标记。
7. 写入 `changelog`，包含 `parent_rev`、`winner_rev`、`protocol_version`、`resolution`。
8. 写入 `revision_attachments`。
9. 广播 `change` 给同用户其他设备。

#### Pull

普通 Pull：

1. 查询 `changelog WHERE uid=? AND seq>? ORDER BY seq`。
2. 从 `document_revisions` 读取对应 revision。
3. 如果该 revision 有附件，返回 CouchDB 风格 `_attachments` stub：`stub/digest/content_type/length/revpos`。
4. 响应中的 `seq` 是返回变更中的最后 seq；没有变更时保持请求的 `since`。

Snapshot Pull：

当客户端发现本地协议版本低于当前协议，或本地 `sync_epoch` 低于服务端 `sync_epoch`，会在 Pull 请求中携带 `snapshot:true`。服务端此时返回当前用户所有 leaf revisions，并设置：

```
snapshot: true
reset: true
seq: 当前用户最大 changelog seq
syncEpoch: 当前服务端 sync_epoch
```

客户端应用 snapshot 后保存本地协议版本和 sync epoch。

### 2.7 附件同步逻辑

附件 metadata 属于文档 revision 的 `_attachments`。真实二进制只按 digest 存在 `attachment_blobs`，不会再通过旧的 `/api/sync/attachments/:docId` 旁路同步。

| 行为                                        | 服务端处理                                                      |
| ------------------------------------------- | --------------------------------------------------------------- |
| PUT `/api/sync/attachments/blobs/:digest`   | 保存 blob；重新计算 `md5-...`，和 URL digest 不一致时返回 400   |
| GET `/api/sync/attachments/blobs/:digest`   | 返回 BLOB 和 `Content-Type`                                     |
| Push 文档 revision                          | 校验 `_attachments` 引用的 digest；缺失时返回 `push_missing`    |
| Pull 文档 revision                          | 在文档中返回 `_attachments` stub；客户端按 digest 下载缺失 blob |
| POST `/api/sync/attachments?action=compact` | 删除没有任何 revision 引用且超过 graceMs 的 blob                |

附件新增、替换、删除都体现为普通文档 revision 的 `_attachments` 变化，不再产生 `docType:'attachment'` changelog。

---

## 三、客户端

### 3.1 LMDB 存储层

当前本地 LMDB 打开 5 个子数据库：

| 子数据库       | 用途                                   | Key 格式                                        | Value                |
| -------------- | -------------------------------------- | ----------------------------------------------- | -------------------- |
| `mainDb`       | 当前 winner 文档                       | `docId`                                         | JSON string          |
| `metaDb`       | 文档同步元信息、checkpoint、协议元信息 | `docId` / 特殊 key                              | string               |
| `revisionDb`   | 本地 revision graph                    | `rev:{docId}:{rev}`                             | JSON string          |
| `changelogDb`  | 本地文档变更日志                       | `seq.padStart(10, '0')`                         | JSON string          |
| `attachmentDb` | 附件二进制和元信息                     | `attachment:{docId}` / `attachment-ext:{docId}` | binary / JSON string |

`metaDb` 常用值：

```ts
// 文档 meta
{
  _rev: string,
  _winningRev: string,
  _lastModified: number,
  _cloudSynced: boolean,
  _deleted: boolean,
  _hasConflicts: boolean,
  _conflictCount: number
}
```

特殊 key：

| key                                                      | 说明                              |
| -------------------------------------------------------- | --------------------------------- |
| `_changelog_seq`                                         | 本地 changelog 最大 seq           |
| `_sync_checkpoint` / `_sync_checkpoint:{uid}:{deviceId}` | 当前账号和设备的结构化 checkpoint |
| `_sync_uid`                                              | 上次同步账号，用于账号切换检测    |

结构化 checkpoint 保存：

```ts
{
  remotePullSeq: number,
  localPushSeq: number,
  syncEpoch: number,
  protocolVersion: number,
  pull?: { inProgress, batchSince, targetSeq, lastError },
  push?: { inProgress, batchFromSeq, batchToSeq, changeIds, attempts, lastError }
}
```

`remotePullSeq` 对应服务端 changelog 坐标，只在 Pull/实时 change 应用成功后提交；`localPushSeq` 对应本地 changelog 坐标，只在当前 Push 批次收到 `push_ok` 后推进到该批次的 `batchToSeq`。认证后客户端会读取服务端 `sync_checkpoints` 中的远端 checkpoint，合并后再开始 Pull；本地 checkpoint 成功提交后会异步写回远端 checkpoint。

旧版本曾使用 `\x00{docId}` 存冲突 loser 列表；当前 revision graph 实现会清理这个 legacy key，冲突来源是 `revisionDb` 中的多个 leaf revisions。

### 3.2 同步白名单

本地写入时，只有以下文档前缀会进入 changelog 并参与云同步：

```ts
;[
  'ZTOOLS/settings-general',
  'ZTOOLS/ai-models',
  'ZTOOLS/web-search-engines',
  'ZTOOLS/avatar',
  'PLUGIN/'
]
```

当前 `sync:get-unsynced-count`、`sync:get-conflict-count`、`sync:list-conflicts` 的统计实现只扫描：

```ts
;['ZTOOLS/settings-general', 'PLUGIN/']
```

因此 UI 上的待同步数量/冲突数量可能不包含 `ZTOOLS/ai-models`、`ZTOOLS/web-search-engines`、`ZTOOLS/avatar`。

### 3.3 本地写入和远端应用

| 行为                  | 来源                 | 写 mainDb                  | 写 revisionDb       | 写 changelogDb | `_cloudSynced` | 触发事件 |
| --------------------- | -------------------- | -------------------------- | ------------------- | -------------- | -------------- | -------- |
| `put()`               | 本地用户操作         | 是                         | 是                  | 是             | `false`        | `change` |
| `remove()`            | 本地用户操作         | winner 为 tombstone 时删除 | 是                  | 是             | `false`        | `change` |
| `applyRemoteChange()` | Pull / live 远端变更 | 刷新 winner 投影           | 是                  | 否             | `true`         | 否       |
| `applyRemoteBatch()`  | Pull 批量            | 同上                       | 是                  | 否             | `true`         | 否       |
| `resolveConflict()`   | 用户选择某个 leaf    | 是                         | 是，生成新 revision | 是             | `false`        | `change` |

本地 `put()` 对已有文档要求传入当前 winner `_rev`，否则返回 conflict。远端 change 使用 revision graph 合并，不走本地 changelog，避免远端变更被再次当成本地操作推回去。

### 3.4 `_rev` 和 winner 算法

`_rev` 格式：

```
N-hash
```

`N` 是 generation，`hash` 由本地随机生成。winner 算法：

1. 在 leaf revisions 中优先选择非删除 revision。
2. generation 大者胜。
3. generation 相同，`rev` 字典序大者胜。

### 3.5 冲突处理

冲突定义：同一个 docId 下存在多个 leaf revisions，且除 winner 外仍有其他 leaf。

本地 meta 会记录：

```ts
_hasConflicts: true
_conflictCount: loserLeafCount
```

相关 API：

| API                                 | 说明                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `getConflicts(docId)`               | 返回非 winner leaf 的文档或 tombstone 描述                                          |
| `resolveConflict(docId, sourceRev)` | 以指定 leaf 内容生成一个新的 winner revision，并 retire 其他 leaf                   |
| `clearConflicts(docId)`             | 仅清理 legacy conflict key 和 meta 标记；当前正常冲突收敛应使用 `resolveConflict()` |

冲突解决会写入本地 changelog，并在推送到服务端后携带：

```ts
resolution: {
  retireOtherLeaves: true
}
```

服务端和其他设备收到该 resolution 后，会把同文档其他 leaf 标记为非 leaf，从而完成收敛。

### 3.6 附件本地 API

| 方法                                     | 当前行为                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `postAttachment(id, buf, type)`          | 写入本地 blob，生成新文档 revision，并写入 `_attachments.default` stub |
| `putAttachmentFromRemote(id, buf, type)` | 写入/覆盖附件，不触发事件                                              |
| `removeAttachment(id)`                   | 生成新文档 revision，并从 `_attachments` 删除对应 name                 |
| `removeAttachmentSilent(id)`             | 删除附件，不触发事件                                                   |
| `getAttachment(id)`                      | 获取附件二进制                                                         |
| `getAttachmentType(id)`                  | 获取 `{ type, length, md5, digest }`                                   |
| `listAttachments()`                      | 扫描 `attachment-ext:*`                                                |

附件没有独立 changelog 类型。附件 metadata 随文档 revision 进入本地 changelog；SyncClient 推送文档前会按 `_attachments` digest 上传本地缺失 blob。服务端如果返回 `push_missing`，客户端会补传缺失 digest 并重试同一批次。远端文档带 `_attachments` stub 时，客户端会在应用文档后按 digest 下载本地缺失 blob。

### 3.7 SyncClient 三阶段

```
start(config)
  → checkAndResetOnAccountSwitch(username)
  → connect()
  → auth
  → get_checkpoint
  → pull
  → push
  → live
```

#### Auth

连接 WebSocket 后发送：

```ts
{
  type: 'auth',
  token,
  deviceId,
  deviceName: os.hostname(),
  protocolVersion: 2
}
```

收到 `auth_ok` 后，客户端根据服务端 `features.snapshotPull`、checkpoint 中的 `protocolVersion`、`syncEpoch` 判断是否需要 snapshot pull。

#### Pull

客户端发送：

```ts
{
  type: 'pull',
  since: checkpoint.remotePullSeq,
  snapshot: shouldRequestSnapshot,
  protocolVersion: 2
}
```

响应处理：

1. 文档变更进入 `applyRemoteBatch()`。
2. 文档变更多于 20 条时分批处理，每批 20 条，并用 `setImmediate` 让出事件循环。
3. Pull 批次全部应用成功后提交 `remotePullSeq`，并写回本地/远端 checkpoint。
4. 对文档 `_attachments` stub 中本地缺失的 digest，异步 HTTP GET 下载 blob。
5. snapshot/reset 响应会把 `protocolVersion=2` 和服务端 `syncEpoch` 保存到 checkpoint。

#### Push

如果 `checkpoint.localPushSeq === 0`，客户端走全量扫描：

1. 扫描所有 `SYNC_PREFIXES` 文档。
2. 过滤 `_cloudSynced === true` 的文档。
3. 构造 `FullChangeEntry[]` 并进入分批 push。

如果 `checkpoint.localPushSeq > 0`，客户端读取本地 changelog 增量，并过滤 stale 条目：

| 条目类型 | 过滤条件                                                     |
| -------- | ------------------------------------------------------------ |
| 写入     | 当前文档不存在，或当前 `_rev` 与 changelog 记录的 rev 不一致 |
| 删除     | 当前文档又存在，说明删除意图已被远端恢复覆盖                 |

分批 push：

```
PUSH_BATCH_SIZE = 50
beginBatchPush()
  → sendNextBatch()
  → push_ok
  → pushOffset += 50
  → sendNextBatch()
```

全部批次完成后：

1. `localPushSeq` 只推进到已收到 `push_ok` 的批次 `batchToSeq`。
2. 扫描同步白名单并把文档 `_cloudSynced` 批量标为 `true`。
3. 进入 live 模式。

`forcePushAll()` 会扫描所有同步文档，并复用分批 push/checkpoint 路径；全量扫描开始时会记录 `fullScanPushUpperSeq`，避免扫描期间新产生的本地 changelog 被误跳过。

#### Live

live 模式监听：

| 本地事件           | 处理                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| `change`           | 读取 `getChangesSince(localPushSeq)`，构造完整文档变更，进入分批 push |
| `attachment-added` | 尝试提前上传 blob；失败也不会推进 checkpoint，后续 push 会补传        |

收到远端 `change`：

| change 类型 | 处理                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| 文档 change | `applyRemoteChange(change)`，提交 `remotePullSeq`，有 doc 时触发 `pull` 事件，并按 `_attachments` stub 下载缺失 blob |

### 3.8 账号切换、重连、心跳

账号切换检测使用 `username`：

```ts
if metaDb.get('_sync_uid') !== username:
  reset _sync_checkpoint:{uid}:{deviceId}
  _sync_uid = username
```

重连策略：

```
初始 1000ms
每次翻倍
上限前最大 60000ms
超过后使用 60000 + random(0, 60000)
```

心跳间隔固定为 30 秒。`SyncConfig.syncInterval` 目前保存在配置中，但没有用于心跳或定时自动同步。

### 3.9 同步配置存储

当前实现把同步配置保存为 LMDB 文档：

```ts
{
  _id: 'SYNC/config',
  data: {
    enabled,
    serverUrl,
    token,
    syncInterval,
    lastSyncTime,
    deviceId,
    username
  }
}
```

注意：当前代码没有使用 Electron `safeStorage` 加密 token。`token` 以配置对象字段形式存入 LMDB。若要加强安全性，需要在 `sync:save-config` 和 `sync:get-config` 中补加密/解密迁移逻辑。

---

## 四、头像同步

头像独立存储在：

```
ZTOOLS/avatar
```

文档内容形态：

```ts
{
  data: 'data:image/png;base64,...'
}
```

该 key 位于同步白名单中，因此通过普通文档同步链路参与同步。头像保存逻辑会将图片缩放到较小尺寸后保存为 data URL，并从旧的 `settings-general.avatar` 字段迁出。

---

## 五、IPC 接口

当前主进程暴露的同步 IPC：

| IPC Channel                | 说明                                                           |
| -------------------------- | -------------------------------------------------------------- |
| `sync:test-connection`     | 测试 WebSocket 是否可连接，不做 token 认证                     |
| `sync:login`               | 调用服务端 `/api/auth`，返回 token 和 `isNew`                  |
| `sync:save-config`         | 保存 `SYNC/config`，并按 enabled 启停 SyncClient               |
| `sync:get-config`          | 读取 `SYNC/config`                                             |
| `sync:get-state`           | 返回当前 SyncClient 状态                                       |
| `sync:perform-sync`        | 停止后立即重新连接同步                                         |
| `sync:stop-auto-sync`      | 停止同步并阻止重连                                             |
| `sync:get-unsynced-count`  | 查询未同步文档数量；当前只扫描 `settings-general` 和 `PLUGIN/` |
| `sync:get-conflict-count`  | 查询冲突数量；当前只扫描 `settings-general` 和 `PLUGIN/`       |
| `sync:list-conflicts`      | 列出冲突文档；当前只扫描 `settings-general` 和 `PLUGIN/`       |
| `sync:get-conflict-detail` | 返回 winner 和 loser leaves                                    |
| `sync:resolve-conflict`    | 选择某个 revision 生成新 winner                                |
| `sync:force-push-all`      | 强制扫描本地同步文档并推送                                     |

主进程还会向渲染进程发送：

| Event                | 说明         |
| -------------------- | ------------ |
| `sync:state-changed` | 同步状态变化 |
| `sync:docs-pulled`   | 收到远端文档 |
| `sync:error`         | 同步错误     |

---

## 六、流程示例

### 6.1 新设备首次登录

```
用户输入 serverUrl / username / password
→ POST /api/auth
→ 服务端自动注册或校验密码，返回 JWT
→ IPC 保存 SYNC/config（当前 token 未加密）
→ SyncClient.start(config)
→ 账号首次同步，重置结构化 checkpoint
→ WS auth(protocolVersion=2)
→ get_checkpoint(checkpointId)
→ pull(since=0, snapshot=true)
→ 服务端返回所有 leaf revisions，附件以 _attachments stub 存在于文档中
→ 客户端 applyRemoteBatch() 写入本地 revision graph
→ 附件按 digest 下载缺失 blob
→ push:
    首次 localPushSeq=0，扫描本地同步白名单
    过滤 _cloudSynced=true 的远端文档
    推送仍未同步的本地文档
→ live
```

### 6.2 多设备实时文档同步

```
设备 A put('ZTOOLS/settings-general')
→ 本地生成新 _rev
→ 写 revisionDb / mainDb / changelogDb
→ emit change
→ live handler 读取 getChangesSince(localPushSeq)
→ WS push(protocolVersion=2)
→ 服务端写 document_revisions，刷新 documents winner 投影，追加 changelog
→ 服务端广播 change 给设备 B
→ 设备 B applyRemoteChange()
→ 设备 B 刷新本地 winner 和冲突 meta
```

### 6.3 冲突解决同步

```
设备 A 和 B 离线分别修改同一 doc
→ 重连后服务端保留多个 leaf revisions
→ 客户端 meta 标记 _hasConflicts=true
→ 设置页展示 winner 和 loser leaves
→ 用户选择某个 sourceRev
→ resolveConflict(docId, sourceRev)
→ 本地生成新 revision，并 retire 其他 leaves
→ push 携带 resolution.retireOtherLeaves=true
→ 服务端和其他设备把其他 leaf 标为非 leaf
→ 冲突收敛
```

### 6.4 附件实时同步

```
设备 A postAttachment(id, buf, type)
→ 写 attachmentDb，并生成带 _attachments.default stub 的新文档 revision
→ 本地 changelog 记录普通文档变更
→ push 前 HTTP PUT /api/sync/attachments/blobs/:digest 上传 blob
→ WS push 文档 revision
→ 服务端校验 blob 存在，写 document_revisions / revision_attachments / changelog
→ 设备 B 收到文档 change 或 pull 到文档 change
→ applyRemoteChange() 保存 _attachments stub
→ HTTP GET /api/sync/attachments/blobs/:digest 下载本地缺失 blob
```

### 6.5 断线恢复

```
设备断线
→ 文档本地变更继续写 changelogDb
→ 如果断线发生在 push 批次中，checkpoint.push 记录失败，不推进 localPushSeq
→ 重连后 auth + get_checkpoint
→ pull(since=remotePullSeq)
→ 应用远端文档变更，并按 _attachments stub 下载缺失 blob
→ push getChangesSince(localPushSeq)
→ 过滤已被远端覆盖的 stale 条目
→ 推送仍有效的本地文档变更
→ live
```

注意：附件 metadata 已经跟随文档 changelog 持久化；附件二进制上传/补传失败不会推进 push checkpoint，后续重连会随同一文档 revision 再次补传。

---

## 七、错误处理

| 场景                   | HTTP 状态       | WS Code | 当前行为                                           |
| ---------------------- | --------------- | ------- | -------------------------------------------------- |
| JWT 无效               | 401 或 WS error | 4003    | HTTP 返回 Unauthorized；WS 发送 error 后关闭       |
| 用户不存在             | 401 或 WS error | 4003    | 附件 API 和 WS 都会额外查 users 表                 |
| 认证超时               | -               | 4001    | 30 秒未 auth 关闭连接                              |
| 密码错误               | 401             | -       | `/api/auth` 返回 `密码错误`                        |
| 参数缺失               | 400             | -       | 登录/注册返回错误                                  |
| 附件超过 10MB          | 413             | -       | 本地和服务端都有大小限制                           |
| 无效 JSON              | -               | -       | WS 返回 `{ type:'error', message:'Invalid JSON' }` |
| Pull 单条应用失败      | -               | -       | `applyRemoteBatch()` 记录日志并继续处理后续条目    |
| 远端 change 缺少 docId | -               | -       | 本地返回 not_found 错误结果                        |
| 重复 revision push     | -               | -       | 服务端不追加 changelog，刷新投影后继续             |

---

## 八、端口与配置

| 配置项       | 环境变量         | 默认值                            |
| ------------ | ---------------- | --------------------------------- |
| 服务端口     | `PORT`           | `23517`                           |
| JWT 密钥     | `JWT_SECRET`     | `ztools-sync-secret-dev`          |
| MySQL DSN    | `MYSQL_DSN`      | 未设置时由下列 MySQL 环境变量拼接 |
| MySQL 主机   | `MYSQL_HOST`     | `MacBook-Air.local`               |
| MySQL 端口   | `MYSQL_PORT`     | `3306`                            |
| MySQL 数据库 | `MYSQL_DATABASE` | `ztools-server`                   |
| MySQL 用户   | `MYSQL_USER`     | `root`                            |
| 静态资源目录 | `STATIC_DIR`     | `public`                          |

---

## 九、当前实现边界

| 项目           | 当前状态                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| 文档同步       | 已实现 revision graph、增量同步、snapshot pull、实时广播、冲突解决                                        |
| 附件同步       | 已实现 CouchDB 风格 `_attachments` metadata、digest blob 上传/下载、missingDigests 补传和 blob compaction |
| token 存储     | 当前为 LMDB 明文配置字段，未使用 safeStorage                                                              |
| 管理接口       | 未加鉴权                                                                                                  |
| UI 统计口径    | 未覆盖全部同步白名单                                                                                      |
| 定时同步       | `syncInterval` 未实际参与调度；当前主要依赖启动、重连、手动触发和 live 事件                               |
| changelog 清理 | 本地有 `compactChangelog(upToSeq)` API，但同步流程中未自动调用                                            |

---

## 十、测试覆盖

主要同步测试位于：

```
tests/main/syncLmdb.test.ts
```

覆盖范围包括：

- 本地 LMDB 写入和 changelog。
- 远端变更应用不写本地 changelog。
- WebSocket push/pull。
- 实时广播。
- 删除同步。
- 断线增量恢复。
- 大批量文档推送。
- revision 冲突和 `resolveConflict()` 收敛。

当前可用验证命令：

```bash
pnpm typecheck:node
pnpm vitest run tests/main/syncLmdb.test.ts
cd sync-server-go && go test ./...
cd internal-plugins/setting && pnpm build
cd sync-server-go/web && pnpm build
```
