# {{PLUGIN_NAME}}

> {{DESCRIPTION}}

这是一个 **纯 Preload 脚本** 的 ZTools 插件，无需 UI 界面，适合快速实现后台功能。

## ✨ 功能特性

### 📌 适用场景

- **快速指令处理** - 接收指令后直接在后台处理，无需打开界面
- **系统集成** - 调用系统 API、执行脚本、启动应用等
- **数据处理** - 文本转换、数据格式化、加密解密等
- **剪贴板增强** - 监听和处理剪贴板内容
- **自动化任务** - 定时任务、批处理等

### 🎯 优势

- ✅ **轻量快速** - 无 UI 渲染，启动即刻响应
- ✅ **全功能** - 完整的 Node.js 能力支持
- ✅ **简单直接** - 单文件开发，逻辑清晰
- ✅ **低资源占用** - 无浏览器引擎，内存占用小

## 📁 项目结构

```
.
├── logo.png              # 插件图标
├── plugin.json           # 插件配置文件
├── preload.js            # Preload 脚本（主要逻辑）
├── package.json          # 项目依赖
└── README.md             # 项目文档
```

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

直接编辑 `preload.js` 文件，保存后 ZTools 会自动重新加载插件。

### 测试插件

1. 将插件目录复制到 ZTools 插件文件夹
2. 重启 ZTools 或手动刷新插件列表
3. 输入触发指令测试功能

## 📖 开发指南

### 1. 插件配置

编辑 `plugin.json` 文件：

```json
{
  "name": "你的插件名称",
  "description": "插件描述",
  "author": "作者名称",
  "version": "1.0.0",
  "preload": "preload.js",
  "logo": "logo.png",
  "features": [
    {
      "code": "myfeature",
      "explain": "功能说明",
      "icon": "logo.png",
      "cmds": ["触发指令"]
    }
  ]
}
```

### 2. Preload 脚本开发

`preload.js` 的基本结构：

```javascript
/**
 * 插件初始化
 * 在插件加载时执行一次
 */
window.exports = {
  /**
   * 功能：功能码对应的处理函数
   * @param {Object} action - 当前功能信息
   * @param {String} action.code - 功能码
   * @param {String} action.type - 触发类型
   * @param {Object} action.payload - 携带的数据
   */
  myfeature: (action, sendResponse) => {
    // 获取触发数据
    const { type, payload } = action

    // 处理逻辑
    if (type === 'text') {
      const result = processText(payload.text)
      // 返回处理结果
      sendResponse({ success: true, data: result })
    }

    // 显示提示
    window.ztools.showTip('处理完成')

    // 返回 true 表示插件已处理
    return true
  }
}

function processText(text) {
  // 你的处理逻辑
  return text.toUpperCase()
}
```

### 3. 处理不同类型的指令

#### 功能指令（文本触发）

```javascript
window.exports = {
  hello: (action, sendResponse) => {
    window.ztools.showTip('你好！')
    return true
  }
}
```

#### 匹配指令（正则匹配）

```json
// plugin.json
{
  "code": "extract",
  "cmds": [{
    "type": "regex",
    "match": "\\d+",
    "label": "提取数字"
  }]
}
```

```javascript
// preload.js
window.exports = {
  extract: (action) => {
    const numbers = action.payload.text.match(/\d+/g)
    window.ztools.showTip(`找到 ${numbers.length} 个数字`)
    return true
  }
}
```

#### 文件/文件夹匹配

```json
// plugin.json
{
  "code": "readfile",
  "cmds": [{
    "type": "files",
    "fileType": "file",
    "label": "读取文件"
  }]
}
```

```javascript
// preload.js
const fs = require('fs')

window.exports = {
  readfile: (action) => {
    const filePath = action.payload.files[0].path
    const content = fs.readFileSync(filePath, 'utf-8')

    // 复制到剪贴板
    window.ztools.copyText(content)
    window.ztools.showTip('内容已复制')

    return true
  }
}
```

#### 图片匹配

```json
// plugin.json
{
  "code": "saveimage",
  "cmds": [{
    "type": "img",
    "label": "保存图片"
  }]
}
```

```javascript
// preload.js
const fs = require('fs')
const path = require('path')

window.exports = {
  saveimage: (action) => {
    const imageData = action.payload.img
    const savePath = path.join(require('os').homedir(), 'Desktop', `image_${Date.now()}.png`)

    fs.writeFileSync(savePath, Buffer.from(imageData, 'base64'))
    window.ztools.showTip(`已保存到：${savePath}`)

    return true
  }
}
```

### 4. 使用 Node.js 模块

```javascript
const fs = require('fs')
const path = require('path')
const os = require('os')
const { exec } = require('child_process')

window.exports = {
  myfeature: (action) => {
    // 使用文件系统
    const files = fs.readdirSync(os.homedir())

    // 执行系统命令
    exec('echo "Hello"', (error, stdout) => {
      console.log(stdout)
    })

    return true
  }
}
```

### 5. 使用 ZTools API

```javascript
window.exports = {
  myfeature: async (action) => {
    // 获取剪贴板内容
    const text = await window.ztools.getClipboardContent()

    // 复制到剪贴板
    window.ztools.copyText('新内容')

    // 显示提示
    window.ztools.showTip('操作成功')

    // 隐藏主窗口
    window.ztools.hideMainWindow()

    // 打开外部链接
    window.ztools.shellOpenExternal('https://example.com')

    // 显示系统通知
    window.ztools.showNotification({
      title: '通知标题',
      body: '通知内容'
    })

    return true
  }
}
```

### 6. 数据持久化

使用 ZTools 提供的数据存储 API：

```javascript
window.exports = {
  saveData: async (action) => {
    // 保存数据
    await window.ztools.dbPut('mykey', { value: 'data' })

    // 读取数据
    const data = await window.ztools.dbGet('mykey')

    // 删除数据
    await window.ztools.dbRemove('mykey')

    return true
  }
}
```

## 🔧 高级用法

### 后台任务

```javascript
// 插件加载时启动定时任务
setInterval(() => {
  // 定时执行的任务
  console.log('后台任务执行中...')
}, 60000) // 每分钟执行一次

window.exports = {
  // 你的功能
}
```

### 错误处理

```javascript
window.exports = {
  myfeature: async (action) => {
    try {
      // 可能出错的代码
      const result = await riskyOperation()
      window.ztools.showTip('成功')
    } catch (error) {
      console.error('操作失败:', error)
      window.ztools.showTip('操作失败，请查看日志')
    }
    return true
  }
}
```

### 调试技巧

```javascript
window.exports = {
  myfeature: (action) => {
    // 打印调试信息
    console.log('接收到的 action:', action)
    console.log('载荷数据:', action.payload)

    // 在控制台查看所有可用 API
    console.log('ZTools API:', Object.keys(window.ztools))

    return true
  }
}
```

## 📚 示例插件

### 文本大小写转换

```javascript
window.exports = {
  uppercase: (action) => {
    const text = action.payload.text
    window.ztools.copyText(text.toUpperCase())
    window.ztools.showTip('已转换为大写')
    return true
  },

  lowercase: (action) => {
    const text = action.payload.text
    window.ztools.copyText(text.toLowerCase())
    window.ztools.showTip('已转换为小写')
    return true
  }
}
```

### 时间戳转换

```javascript
window.exports = {
  timestamp: (action) => {
    const timestamp = Date.now()
    window.ztools.copyText(timestamp.toString())
    window.ztools.showTip(`当前时间戳：${timestamp}`)
    return true
  },

  formattime: (action) => {
    const timestamp = parseInt(action.payload.text)
    const date = new Date(timestamp)
    const formatted = date.toLocaleString('zh-CN')

    window.ztools.copyText(formatted)
    window.ztools.showTip('已转换为可读时间')
    return true
  }
}
```

### Base64 编解码

```javascript
window.exports = {
  base64encode: (action) => {
    const text = action.payload.text
    const encoded = Buffer.from(text).toString('base64')
    window.ztools.copyText(encoded)
    window.ztools.showTip('已编码')
    return true
  },

  base64decode: (action) => {
    const text = action.payload.text
    const decoded = Buffer.from(text, 'base64').toString('utf-8')
    window.ztools.copyText(decoded)
    window.ztools.showTip('已解码')
    return true
  }
}
```

## 📚 相关资源

- [ZTools 官方文档](https://github.com/ztool-center/ztools)
- [ZTools API 文档](https://github.com/ztool-center/ztools-api-types)
- [Node.js 文档](https://nodejs.org/docs/)

## ❓ 常见问题

### Q: 如何调试 Preload 插件？

A: 在 ZTools 中打开开发者工具（F12），Console 中会显示 `console.log` 输出。

### Q: 如何处理异步操作？

A: 可以使用 `async/await` 或 Promise，但记得使用 try-catch 处理错误。

### Q: 插件不生效怎么办？

A:
1. 检查 `plugin.json` 配置是否正确
2. 检查 `preload.js` 是否有语法错误
3. 重启 ZTools 或重新加载插件

### Q: 如何添加第三方 npm 包？

A: 在 `package.json` 中添加依赖，运行 `npm install`，然后在 `preload.js` 中 `require` 使用。

### Q: 如何提高执行速度？

A:
- 避免同步阻塞操作
- 缓存重复计算结果
- 使用 Worker 处理耗时任务

## 📄 开源协议

MIT License

---

**祝你开发愉快！** 🎉
