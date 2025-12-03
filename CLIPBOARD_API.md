# 剪贴板 API 文档

## window.ztools.clipboard.getHistory()

获取剪贴板历史记录，支持分页和过滤。

### 语法

```javascript
window.ztools.clipboard.getHistory(page, pageSize, filter)
```

### 参数

| 参数名     | 类型     | 必填 | 默认值      | 说明             |
| ---------- | -------- | ---- | ----------- | ---------------- |
| `page`     | `number` | 否   | `1`         | 页码，从1开始    |
| `pageSize` | `number` | 否   | `50`        | 每页返回的记录数 |
| `filter`   | `object` | 否   | `undefined` | 过滤条件对象     |

#### filter 对象结构

```typescript
{
  type?: 'text' | 'image' | 'file',  // 剪贴板类型过滤
  keyword?: string                    // 关键词搜索（搜索内容/文件名/预览文本）
}
```

### 返回值

返回一个 Promise，resolve 为包含分页信息的对象：

```typescript
Promise<{
  items: ClipboardItem[] // 剪贴板记录数组
  total: number // 总记录数
  page: number // 当前页码
  pageSize: number // 每页数量
}>
```

#### ClipboardItem 数据结构

```typescript
// 文件项
interface FileItem {
  path: string // 文件完整路径
  name: string // 文件名
  isDirectory: boolean // 是否为文件夹
  exists?: boolean // 文件是否存在（仅在查询时返回）
}

interface ClipboardItem {
  id: string // 唯一标识符
  type: 'text' | 'image' | 'file' // 剪贴板类型
  timestamp: number // 时间戳（毫秒）
  hash: string // 内容哈希值
  appName?: string // 复制时的应用名称
  bundleId?: string // 复制时的应用 Bundle ID

  // 文本类型字段
  content?: string // 文本内容

  // 文件类型字段
  files?: FileItem[] // 文件列表（支持多文件）

  // 图片类型字段
  imagePath?: string // 保存的图片路径

  // 通用字段
  preview?: string // 预览文本（所有类型都可能有）
}
```

### 使用示例

#### 基础用法 - 获取第一页

```javascript
// 获取第一页，每页10条记录
const result = await window.ztools.clipboard.getHistory(1, 10)

console.log(`总共 ${result.total} 条记录`)
console.log(`当前第 ${result.page} 页`)

result.items.forEach((item) => {
  console.log(`[${item.type}] ${new Date(item.timestamp).toLocaleString()}`)
  if (item.appName) {
    console.log(`  来自: ${item.appName}`)
  }
  if (item.type === 'text') {
    console.log(`内容: ${item.content}`)
  } else if (item.type === 'file') {
    console.log(`文件数量: ${item.files.length}`)
    item.files.forEach((file) => {
      console.log(`  - ${file.isDirectory ? '📁' : '📄'} ${file.name}`)
      console.log(`    存在: ${file.exists ? '是' : '否'}`)
    })
  } else if (item.type === 'image') {
    console.log(`图片路径: ${item.imagePath}`)
  }
})
```

#### 类型过滤 - 只获取文本类型

```javascript
const result = await window.ztools.clipboard.getHistory(1, 20, {
  type: 'text'
})

console.log(`文本记录共 ${result.total} 条`)
result.items.forEach((item) => {
  console.log(item.content)
})
```

#### 类型过滤 - 只获取图片

```javascript
const result = await window.ztools.clipboard.getHistory(1, 20, {
  type: 'image'
})

console.log(`图片记录共 ${result.total} 条`)
result.items.forEach((item) => {
  console.log(`图片路径: ${item.imagePath}`)
})
```

#### 关键词搜索

```javascript
// 搜索包含"密码"的记录
const result = await window.ztools.clipboard.getHistory(1, 50, {
  keyword: '密码'
})

console.log(`找到 ${result.total} 条匹配记录`)
result.items.forEach((item) => {
  if (item.type === 'text') {
    console.log(item.content)
  } else if (item.type === 'file') {
    item.files.forEach((file) => {
      console.log(file.name)
    })
  }
})
```

#### 组合过滤 - 搜索特定类型的关键词

```javascript
// 搜索文件名包含"报告"的文件类型记录
const result = await window.ztools.clipboard.getHistory(1, 20, {
  type: 'file',
  keyword: '报告'
})

console.log(`找到 ${result.total} 个相关文件`)
result.items.forEach((item) => {
  item.files.forEach((file) => {
    console.log(
      `${file.isDirectory ? '📁' : '📄'} ${file.name} - ${file.exists ? '存在' : '已删除'}`
    )
  })
})
```

#### 分页遍历所有记录

```javascript
async function getAllClipboardItems() {
  const pageSize = 50
  let page = 1
  let allItems = []

  while (true) {
    const result = await window.ztools.clipboard.getHistory(page, pageSize)
    allItems = allItems.concat(result.items)

    console.log(`已加载 ${allItems.length}/${result.total} 条记录`)

    // 判断是否还有下一页
    if (allItems.length >= result.total) {
      break
    }

    page++
  }

  return allItems
}

// 使用
const allItems = await getAllClipboardItems()
console.log(`总共获取了 ${allItems.length} 条记录`)
```

#### 构建剪贴板历史界面

```javascript
async function renderClipboardHistory() {
  const container = document.getElementById('clipboard-history')
  const result = await window.ztools.clipboard.getHistory(1, 20)

  container.innerHTML = `
    <div class="pagination">
      总共 ${result.total} 条记录，第 ${result.page} 页
    </div>
    <div class="items">
      ${result.items
        .map(
          (item) => `
        <div class="item" data-id="${item.id}">
          <span class="type">${item.type}</span>
          <span class="time">${new Date(item.timestamp).toLocaleString()}</span>
          <div class="content">
            ${
              item.type === 'text'
                ? item.content
                : item.type === 'file'
                  ? item.files.length === 1
                    ? `${item.files[0].isDirectory ? '📁' : '📄'} ${item.files[0].name}`
                    : `📦 ${item.files.length}个项目`
                  : `🖼️ 图片`
            }
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `
}
```

### 注意事项

1. **性能考虑**
   - 默认每页50条，建议不要一次性获取太多记录
   - 如需获取大量数据，使用分页逐步加载

2. **时间排序**
   - 记录按时间戳倒序排列（最新的在前面）
   - `timestamp` 是 Unix 时间戳（毫秒）

3. **文件存在性检查**
   - 只有 `type === 'file'` 的记录才会检查文件存在性
   - 每个文件都有 `exists` 字段标识是否存在
   - 文件可能在复制后被删除或移动，通过此字段判断
   - 支持多文件，每个文件都会单独检查存在性

4. **关键词搜索范围**
   - 搜索会匹配 `content`（文本内容）
   - 搜索会匹配 `files` 数组中所有文件的 `name`（文件名）
   - 搜索会匹配 `preview`（预览文本）
   - 搜索不区分大小写

5. **图片路径**
   - `imagePath` 是应用内部存储路径
   - 可以使用 `file:///` 协议加载图片
   - 例如：`<img src="file:///${item.imagePath}">`

### 错误处理

```javascript
try {
  const result = await window.ztools.clipboard.getHistory(1, 10)
  // 处理结果
} catch (error) {
  console.error('获取剪贴板历史失败:', error)
  // 失败时会返回空结果
  // { items: [], total: 0, page: 1, pageSize: 10 }
}
```

### 相关 API

- `window.ztools.clipboard.search(keyword)` - 快速搜索（内部调用 getHistory）
- `window.ztools.clipboard.write(id)` - 将记录写回剪贴板
- `window.ztools.clipboard.delete(id)` - 删除指定记录
- `window.ztools.clipboard.clear(type)` - 清空历史记录
- `window.ztools.clipboard.getStatus()` - 获取剪贴板状态

### 完整示例：剪贴板管理器插件

```javascript
// 插件入口
async function initClipboardManager() {
  let currentPage = 1
  const pageSize = 20
  let currentFilter = null

  // 渲染历史列表
  async function render() {
    const result = await window.ztools.clipboard.getHistory(currentPage, pageSize, currentFilter)

    document.getElementById('total').textContent = result.total
    document.getElementById('page').textContent = currentPage

    const itemsHTML = result.items
      .map((item) => {
        const time = new Date(item.timestamp).toLocaleString()
        let icon = '📝'
        let content = item.content || item.preview || ''

        if (item.type === 'image') {
          icon = '🖼️'
          content = `<img src="file:///${item.imagePath}" style="max-width: 100px">`
        } else if (item.type === 'file') {
          icon = '📦'
          if (item.files.length === 1) {
            const file = item.files[0]
            icon = file.isDirectory ? '📁' : file.exists ? '📄' : '❌'
            content = file.name
          } else {
            content = `${item.files.length}个项目 (${item.files.filter((f) => f.exists).length}/${item.files.length}存在)`
          }
        }

        return `
        <div class="clipboard-item" data-id="${item.id}">
          <span class="icon">${icon}</span>
          <div class="content">${content}</div>
          <span class="time">${time}</span>
          <button onclick="copyToClipboard('${item.id}')">复制</button>
          <button onclick="deleteItem('${item.id}')">删除</button>
        </div>
      `
      })
      .join('')

    document.getElementById('items').innerHTML = itemsHTML
  }

  // 类型过滤
  window.filterByType = async (type) => {
    currentFilter = type ? { type } : null
    currentPage = 1
    await render()
  }

  // 关键词搜索
  window.searchKeyword = async (keyword) => {
    currentFilter = keyword ? { keyword } : null
    currentPage = 1
    await render()
  }

  // 复制到剪贴板
  window.copyToClipboard = async (id) => {
    await window.ztools.clipboard.write(id)
    alert('已复制到剪贴板')
  }

  // 删除项
  window.deleteItem = async (id) => {
    if (confirm('确定删除这条记录吗？')) {
      await window.ztools.clipboard.delete(id)
      await render()
    }
  }

  // 翻页
  window.nextPage = async () => {
    currentPage++
    await render()
  }

  window.prevPage = async () => {
    if (currentPage > 1) {
      currentPage--
      await render()
    }
  }

  // 初始渲染
  await render()
}

// 插件启动时调用
window.ztools.onPluginEnter(initClipboardManager)
```

## 更新日志

- **v1.2.0** - 文件类型支持多文件
  - 修改 `files` 字段为数组，支持一次复制多个文件
  - 每个文件项包含 `path`、`name`、`isDirectory`、`exists` 字段
  - 移除 `filePath`、`fileName`、`fileType`、`fileExists` 字段
  - 自动识别文件夹和文件
  - 改进预览文本显示

- **v1.1.0** - 新增应用来源信息
  - 添加 `appName` 字段记录复制时的应用名称
  - 添加 `bundleId` 字段记录应用的 Bundle ID
  - 可用于按应用筛选或追踪内容来源

- **v1.0.0** - 初始版本
  - 支持分页查询
  - 支持类型过滤
  - 支持关键词搜索
  - 自动检查文件存在性
