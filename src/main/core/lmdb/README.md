# LMDB 数据库模块

基于 LMDB 实现的高性能本地数据库，完全兼容 UTools 数据库 API 规范。

## 特性

✅ **完全兼容 UTools API** - 提供与 UTools 完全一致的 API 接口  
✅ **同步 + Promise 双模式** - 支持同步和异步两种调用方式  
✅ **高性能** - 基于 LMDB，比 PouchDB 更快，内存占用更低  
✅ **ACID 事务** - 完整的事务支持，保证数据一致性  
✅ **版本控制** - 自动管理文档版本（_rev）  
✅ **附件支持** - 支持存储二进制附件（最大 10M）  

## 目录结构

```
lmdb/
├── index.ts          # 主数据库类
├── lmdbInstance.ts   # 单例实例
├── types.ts          # TypeScript 类型定义
├── syncApi.ts        # 同步 API 实现
├── promiseApi.ts     # Promise API 实现
├── utils.ts          # 工具函数
└── README.md         # 本文件
```

## API 文档

### 同步 API

#### `put(doc)`
创建或更新文档（同步）

```typescript
const doc = { _id: 'test/doc-1', data: 'hello' }
const result = db.put(doc)

if (result.ok) {
  doc._rev = result.rev  // 更新版本号
  console.log('保存成功')
} else if (result.error) {
  console.error('保存失败:', result.message)
}
```

#### `get(id)`
根据 ID 获取文档（同步）

```typescript
const doc = db.get('test/doc-1')
if (doc) {
  console.log('文档内容:', doc)
} else {
  console.log('文档不存在')
}
```

#### `remove(docOrId)`
删除文档（同步）

```typescript
// 方式1: 通过文档对象删除
const result1 = db.remove(doc)

// 方式2: 通过 ID 删除
const result2 = db.remove('test/doc-1')

if (result.ok) {
  console.log('删除成功')
}
```

#### `bulkDocs(docs)`
批量创建或更新文档（同步）

```typescript
const docs = [
  { _id: 'test/doc-2', a: 'value 2' },
  { _id: 'test/doc-3', a: 'value 3' }
]

const results = db.bulkDocs(docs)
results.forEach((result, index) => {
  if (result.ok) {
    docs[index]._rev = result.rev
  }
})
```

#### `allDocs(key?)`
获取文档数组（同步）

```typescript
// 获取所有文档
const allDocs = db.allDocs()

// 获取指定前缀的文档
const testDocs = db.allDocs('test/')

// 根据 ID 数组获取文档
const specificDocs = db.allDocs(['test/doc-2', 'test/doc-3'])
```

#### `postAttachment(id, attachment, type)`
存储附件（同步）

```typescript
import fs from 'fs'

const buffer = fs.readFileSync('/path/to/image.png')
const result = db.postAttachment('my-image', buffer, 'image/png')

if (result.ok) {
  console.log('附件存储成功')
}
```

#### `getAttachment(id)`
获取附件（同步）

```typescript
const buffer = db.getAttachment('my-image')
if (buffer) {
  fs.writeFileSync('/path/to/output.png', buffer)
}
```

#### `getAttachmentType(id)`
获取附件类型（同步）

```typescript
const type = db.getAttachmentType('my-image')
console.log('附件类型:', type)  // 'image/png'
```

### Promise API

所有同步 API 都有对应的 Promise 版本，通过 `db.promises` 访问：

```typescript
// Promise API 示例
const doc = { _id: 'test/doc-1', data: 'hello' }
const result = await db.promises.put(doc)

if (result.ok) {
  doc._rev = result.rev
}

const retrieved = await db.promises.get('test/doc-1')
const allDocs = await db.promises.allDocs('test/')

// 附件操作
const buffer = fs.readFileSync('/path/to/image.png')
await db.promises.postAttachment('my-image', buffer, 'image/png')
const imageData = await db.promises.getAttachment('my-image')
```

## 类型定义

### DbDoc
```typescript
interface DbDoc {
  _id: string       // 文档 ID（必需）
  _rev?: string     // 文档版本号（更新时必需）
  [key: string]: any // 自定义字段
}
```

### DbResult
```typescript
interface DbResult {
  id: string         // 文档 ID
  rev?: string       // 新的版本号
  ok?: boolean       // 操作是否成功
  error?: boolean    // 是否发生错误
  name?: string      // 错误名称
  message?: string   // 错误消息
}
```

## 使用示例

### 基础 CRUD 操作

```typescript
import lmdbInstance from '@/core/lmdb/lmdbInstance'

// 创建文档
const doc = { _id: 'user/123', name: 'John', age: 30 }
const result = lmdbInstance.put(doc)

// 读取文档
const user = lmdbInstance.get('user/123')
console.log(user)  // { _id: 'user/123', _rev: '1-xxx', name: 'John', age: 30 }

// 更新文档
user.age = 31
lmdbInstance.put(user)

// 删除文档
lmdbInstance.remove('user/123')
```

### 命名空间管理

```typescript
// 使用前缀组织数据
lmdbInstance.put({ _id: 'settings/theme', value: 'dark' })
lmdbInstance.put({ _id: 'settings/language', value: 'zh-CN' })
lmdbInstance.put({ _id: 'cache/data1', value: 'cached' })

// 按前缀查询
const allSettings = lmdbInstance.allDocs('settings/')
// 返回: [{ _id: 'settings/theme', ... }, { _id: 'settings/language', ... }]
```

### 版本冲突处理

```typescript
const doc = lmdbInstance.get('test/doc-1')

// 模拟并发更新
doc.value = 'new value 1'
const result1 = lmdbInstance.put(doc)

// 使用旧版本更新会失败
doc._rev = '1-old-version'
doc.value = 'new value 2'
const result2 = lmdbInstance.put(doc)

if (result2.error && result2.name === 'conflict') {
  console.log('版本冲突，请重新获取文档')
}
```

### 附件存储示例

```typescript
import fs from 'fs'

// 存储图片附件
const imageBuffer = fs.readFileSync('./avatar.png')
lmdbInstance.postAttachment('user-avatar-123', imageBuffer, 'image/png')

// 获取附件
const buffer = lmdbInstance.getAttachment('user-avatar-123')
const type = lmdbInstance.getAttachmentType('user-avatar-123')

// 保存到文件
if (buffer) {
  fs.writeFileSync('./downloaded-avatar.png', buffer)
}
```

## 性能优化建议

### 1. 使用批量操作
```typescript
// ❌ 不推荐：逐个插入
for (const item of items) {
  db.put({ _id: `item/${item.id}`, ...item })
}

// ✅ 推荐：批量插入
const docs = items.map(item => ({ _id: `item/${item.id}`, ...item }))
db.bulkDocs(docs)
```

### 2. 合理使用前缀查询
```typescript
// ✅ 高效：使用前缀查询
const userDocs = db.allDocs('user/')

// ❌ 低效：获取所有文档后过滤
const allDocs = db.allDocs()
const userDocs = allDocs.filter(doc => doc._id.startsWith('user/'))
```

### 3. 控制文档大小
```typescript
// 单个文档不超过 1MB
// 大数据使用附件存储（最大 10MB）
```

## 注意事项

⚠️ **文档大小限制**: 单个文档不超过 1MB  
⚠️ **附件大小限制**: 单个附件不超过 10MB  
⚠️ **版本控制**: 更新文档时必须提供正确的 `_rev`  
⚠️ **附件不可更新**: 附件只能创建，不能更新（需要先删除再创建新的）  
⚠️ **真删除**: 删除操作是永久性的，无法恢复  

## 对比 PouchDB

| 特性 | LMDB | PouchDB |
|-----|------|---------|
| 读性能 | ⚡⚡⚡ 极快 | ⚡⚡ 中等 |
| 写性能 | ⚡⚡⚡ 快 | ⚡⚡ 中等 |
| 内存占用 | 📉 极低 | 📊 较高 |
| ACID 事务 | ✅ 完整 | ⚡ 有限 |
| 云同步 | ❌ 不支持 | ✅ 支持 |
| 复杂查询 | ❌ 不支持 | ✅ 支持 |

## 常见问题

### Q: 如何迁移 PouchDB 数据到 LMDB？
```typescript
// 导出 PouchDB 数据
const pouchDocs = await pouchDB.allDocs({ include_docs: true })

// 导入到 LMDB
const docs = pouchDocs.rows.map(row => row.doc)
lmdbInstance.bulkDocs(docs)
```

### Q: 如何备份数据？
LMDB 数据存储在 `userData/lmdb` 目录下，直接复制该目录即可。

### Q: 数据库文件太大怎么办？
```typescript
// 定期清理不需要的数据
const oldDocs = lmdbInstance.allDocs('cache/')
oldDocs.forEach(doc => lmdbInstance.remove(doc._id))
```

## 许可证

MIT
