# ZTools WebDAV 双向同步设计方案

## 一、需求分析

### 核心目标

- ✅ 多设备数据同步（macOS、Windows）
- ✅ 冲突检测与解决
- ✅ 增量同步（仅同步变更数据）
- ✅ 离线优先（本地优先，后台同步）
- ✅ 数据安全（密码加密存储）

### 同步范围

**需要同步**：

- 固定应用列表 (`ZTOOLS/pinned-apps`)
- 通用设置 (`ZTOOLS/settings-general`)
- 插件配置数据 (`PLUGIN/{pluginName}/*`)
- 插件附件数据（`attachment:PLUGIN/{pluginName}/*`）

**不同步**：

- 应用使用历史（每个设备独立）
- 剪贴板历史（数据量大，设备相关）
- 插件本体（通过插件市场安装）
- 系统应用列表（每个设备扫描本地）
- 临时缓存数据

---

## 二、技术方案

### 2.1 数据结构扩展

#### 文档元数据字段

在现有 `DbDoc` 基础上扩展：

```typescript
export interface DbDoc {
  _id: string
  _rev?: string // 现有字段

  // 新增同步字段（仅用于类型定义，实际存储在 metaDb）
  _lastModified?: number // 最后修改时间戳（毫秒），用于冲突解决
  _cloudSynced?: boolean // 是否已同步到云端，用于启动扫描优化

  [key: string]: any
}
```

**实际存储方案（重要变更）**：

- **同步元数据不存储在文档本身**，而是存储在独立的 `metaDb` 中
- **metaDb 存储格式**：`{ _rev: string, _lastModified?: number, _cloudSynced?: boolean }`
- **为什么这样设计**：
  1. 避免污染用户数据（插件读取文档时不会看到同步字段）
  2. 元数据更新不会触发文档版本变更
  3. 更好的数据隔离和管理
- **兼容性处理**：代码兼容旧格式（metaDb 只存储 `_rev` 字符串）和新格式（JSON 对象）

**同步字段说明**：

- `_lastModified`：用于 Last Write Wins 冲突解决，时间晚的版本胜出
- `_cloudSynced`：标记是否已同步，启动时只扫描 `_cloudSynced === false` 的文档
- 本地修改时：自动设置 `_cloudSynced = false`，`_lastModified = Date.now()`（存储在 metaDb）
- 同步成功后：调用 `updateSyncStatus(id, true)` 设置 `_cloudSynced = true`
- 无需队列机制，更简单直观

#### 同步元数据存储

新增命名空间：

- `SYNC/config` - 同步配置（服务器地址、用户名、密码、设备 ID 等）
- `SYNC/conflicts/{docId}` - 冲突记录（可选，用于日志）

**同步配置结构**：

```typescript
interface SyncConfig {
  enabled: boolean // 是否启用同步
  serverUrl: string // WebDAV 服务器地址
  username: string // 用户名
  password: string // 密码（使用 safeStorage 加密存储）
  syncInterval: number // 同步间隔（秒）
  lastSyncTime: number // 最后同步时间
  deviceId: string // 当前设备唯一 ID（自动生成）
}
```

---

### 2.2 核心模块

#### WebDAV 客户端

- 使用 `webdav` npm 包
- 封装上传/下载/列表/删除等操作
- 使用 PROPFIND 获取文件元数据（修改时间）
- 支持二进制文件上传（附件）

#### 同步引擎

核心流程（实际实现）：

1. **上传本地文档变更** → 扫描 `_cloudSynced === false` 的文档 → 比较 `_lastModified` → 上传到云端
2. **上传本地附件变更** → 独立扫描附件 → 上传到云端（`/ztools-sync/attachments/{docId}.bin`）
3. **下载云端文档变更** → 获取云端文件列表 → 对比修改时间 → 下载有变更的文档
4. **下载云端附件变更** → 获取云端附件列表 → 对比修改时间 → 下载有变更的附件
5. **冲突处理** → 比较 `_lastModified`，时间晚的胜出（Last Write Wins）
6. **更新元数据** → 调用 `updateSyncStatus(id, true)` 设置 `_cloudSynced = true`，记录最后同步时间

**关键实现细节**：

- 上传阶段返回已处理的文档 ID 列表（`processedDocIds`）
- 下载阶段排除已在上传阶段处理的文档，避免重复处理
- 附件和文档有独立的同步流程，但都遵循相同的冲突解决策略

#### 附件同步策略

- 附件存储在独立的 `attachmentDb` 中，格式：`attachment:{docId}` 和 `attachment-ext:{docId}`
- 附件大小限制：10MB（LMDB 限制）
- 附件不可更新（只能删除后重新创建）
- **附件有独立的上传/下载流程**（与设计文档不同）
  - `uploadLocalAttachments()` - 上传本地附件
  - `downloadRemoteAttachments()` - 下载云端附件
- 同步时直接上传二进制文件到 WebDAV（如 `/ztools-sync/attachments/{docId}.bin`）
- 附件元数据（type、size）存储在 `attachment-ext:{docId}` 中

---

### 2.3 性能优化：避免全量扫描

#### 问题

如果每次同步都扫描所有文档，性能会很差（假设 10,000 个文档，每次只有 5 个变更）。

#### 解决方案：\_cloudSynced 标记（存储在 metaDb）

**上传优化**（本地 → 云端）：

- 在 `put/remove` 方法中自动在 metaDb 设置 `_cloudSynced = false`
- 同步时仅扫描 metaDb 中 `_cloudSynced === false` 的文档
- 同步成功后调用 `updateSyncStatus(id, true)` 设置 `_cloudSynced = true`
- 性能：O(n) → O(未同步文档数量)，通常只有几个

**下载优化**（云端 → 本地）：

- 使用 WebDAV PROPFIND 一次性获取所有文件的修改时间
- 仅下载修改时间晚于 `lastSyncTime` 的文件
- 避免逐个下载再对比

**实现细节**：

- `getSyncMeta(id)` - 从 metaDb 获取同步元数据
- `updateSyncStatus(id, cloudSynced)` - 更新 metaDb 中的同步状态
- `shouldSync(id)` - 判断文档是否需要同步（基于命名空间前缀）

**性能对比**：

| 指标     | 全量扫描  | \_cloudSynced 优化 | 提升    |
| -------- | --------- | ------------------ | ------- |
| 扫描时间 | 500ms     | 5ms                | 100x    |
| 内存占用 | 50MB      | 1KB                | 99.998% |
| 磁盘 I/O | 10,000 次 | 5 次               | 2000x   |

---

### 2.4 冲突解决策略

**Last Write Wins (LWW)**：

- 比较本地和云端的 `_lastModified` 时间戳
- 时间晚的版本胜出，自动覆盖旧版本
- 简单高效，无需用户干预
- 适用于所有同步数据（设置、固定列表、插件配置）

**实现细节**：

- 上传时：如果云端版本更新（`remoteDoc._lastModified > localDoc._lastModified`），放弃上传，使用云端版本
- 下载时：如果本地版本更新（`localDoc._lastModified > remoteDoc._lastModified`），跳过下载，保留本地版本
- 同时修改：极少发生，时间戳精确到毫秒，冲突概率极低

---

### 2.5 安全性

#### 密码加密存储

- 使用 Electron 的 `safeStorage` API 加密密码
- 本地存储加密后的密码，使用时解密

#### 数据传输加密

- WebDAV 必须使用 HTTPS
- 连接时验证 SSL 证书

---

### 2.6 UI 界面

#### 设置页面（已实现）

- 启用/禁用同步开关
- 服务器配置（地址、用户名、密码）
- 同步间隔（5 分钟 / 10 分钟 / 30 分钟 / 1 小时）
- 测试连接按钮
- 保存配置按钮
- 立即同步按钮
- **强制从云端同步按钮**（新增功能）
  - 用途：强制覆盖本地数据，从云端下载所有数据
  - 场景：新设备首次同步、本地数据损坏、需要恢复云端备份
- 同步状态显示
  - 最后同步时间
  - 待同步文档数量
  - 上次同步结果（上传/下载/错误数量）

#### 同步日志（可选）

- 显示最近的同步记录
- 显示冲突自动解决的记录（哪个设备的版本胜出）

**UI 组件位置**：

- `internal-plugins/setting/src/components/settings/SyncSettings.vue` - 同步设置页面
- `internal-plugins/setting/src/components/common/Icon.vue` - 新增 `cloud` 图标

---

## 三、WebDAV 服务器推荐

### 自建方案

1. **坚果云**（国内推荐）
   - 免费版：1GB 空间，每月 3GB 流量
   - 支持 WebDAV，速度快，稳定

2. **Nextcloud**（开源自建）
   - 完全控制数据
   - 需要自己搭建服务器

3. **Synology NAS**（家庭方案）
   - 内置 WebDAV 服务
   - 局域网速度快

---

## 四、潜在问题与解决方案

### 问题 1：大量数据同步慢

**解决方案**：

- 分批同步（每次最多 50 个文档）
- 优先同步重要数据（设置 > 固定列表 > 插件配置）
- 附件跟随文档一起同步
- 后台静默同步，不阻塞 UI

### 问题 2：频繁冲突

**解决方案**：

- 增加同步频率（减少冲突窗口）
- LWW 策略自动解决，无需用户干预
- 同步日志记录冲突解决情况

### 问题 3：网络不稳定

**解决方案**：

- 离线队列（网络恢复后自动同步）
- 断点续传（大文件分块上传）
- 本地缓存（优先使用本地数据）

### 问题 4：隐私安全

**解决方案**：

- 端到端加密（可选）
- 密码本地加密存储
- 支持自建服务器

### 问题 5：附件同步占用带宽

**解决方案**：

- 附件大小限制（10MB）
- 仅同步插件附件，不同步剪贴板图片
- 可选择性禁用附件同步
- 使用 MD5 校验，避免重复上传

---

## 五、未来扩展

- **增量同步优化**：使用 `ETag` 或 `Last-Modified` 头部，仅下载变更的字段
- **实时同步**：使用 WebSocket 或 Server-Sent Events，云端变更立即推送
- **版本历史**：保留文档的历史版本，支持回滚
- **选择性同步**：用户可选择同步哪些数据类型（设置、固定列表、插件配置等）

---

## 六、总结

### 方案优势

✅ **离线优先**：本地数据优先，后台同步
✅ **冲突处理**：基于时间戳自动解决冲突
✅ **增量同步**：仅同步变更数据，节省带宽
✅ **高性能**：\_cloudSynced 标记（存储在 metaDb），避免全量扫描
✅ **安全可靠**：密码加密存储（safeStorage），HTTPS 传输
✅ **极简设计**：仅两个同步字段，易于维护
✅ **数据隔离**：同步元数据存储在 metaDb，不污染用户数据
✅ **强制同步**：支持强制从云端恢复数据

### 实际实现与设计文档的关键差异

#### 1. 同步元数据存储位置

- **设计**：存储在文档本身（`DbDoc` 字段）
- **实现**：存储在独立的 `metaDb` 中（JSON 对象）
- **优势**：避免污染用户数据，元数据更新不触发版本变更

#### 2. 附件同步流程

- **设计**：附件跟随文档一起同步
- **实现**：附件有独立的上传/下载流程
- **优势**：更灵活的同步控制，可以单独处理附件错误

#### 3. 新增功能

- **强制从云端同步**：`forceDownloadFromCloud()` 方法
- **设备 ID 自动生成**：使用 `pluginDeviceAPI.getDeviceIdPublic()`
- **待同步文档计数**：`sync:get-unsynced-count` API

#### 4. 兼容性处理

- 代码兼容旧格式（metaDb 只存储 `_rev` 字符串）和新格式（JSON 对象）
- 平滑迁移，无需数据库迁移脚本

### 核心代码文件

- `src/main/core/sync/syncEngine.ts` - 同步引擎核心逻辑
- `src/main/core/sync/webdavClient.ts` - WebDAV 客户端封装
- `src/main/core/sync/types.ts` - 类型定义
- `src/main/api/renderer/sync.ts` - 同步 API（IPC 接口）
- `src/main/core/lmdb/syncApi.ts` - LMDB 同步 API（元数据管理）
- `src/main/core/lmdb/promiseApi.ts` - LMDB Promise API（新增 `getSyncMeta` 和 `updateSyncStatus`）
- `internal-plugins/setting/src/components/settings/SyncSettings.vue` - 同步设置 UI
