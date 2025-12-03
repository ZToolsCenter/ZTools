# 无界面插件开发指南

## 概述

zTools 支持两种类型的插件：

1. **UI 插件**：带有界面的插件，通过 BrowserView 加载，用户可以看到并交互
2. **无界面插件（Headless Plugin）**：没有 UI 界面，仅在后台运行，通过系统通知或其他方式与用户交互

无界面插件适用于以下场景：

- 后台定时任务（例如：番茄钟、提醒器）
- 数据处理和转换（例如：剪贴板增强、文本转换）
- 系统监控（例如：网络状态、电池监控）
- 纯命令行工具（例如：计算器、单位转换）

## 插件类型判断

插件类型通过 `plugin.json` 配置文件中是否包含 `main` 字段来判断：

- **有 `main` 字段**：UI 插件，系统会创建 BrowserView 加载界面
- **无 `main` 字段**：无界面插件，系统会创建隐形窗口运行脚本

## 技术原理

无界面插件使用 **隐形 BrowserWindow** 方案实现：

1. 创建一个 `show: false` 的 BrowserWindow
2. 加载空白 HTML 页面（`data:text/html,...`）
3. 将插件入口脚本作为 `preload` 注入
4. 插件通过 `window.ztools` API 与系统交互

这种方案的优势：

- ✅ 与 UI 插件共享完全相同的 API
- ✅ 运行在渲染进程沙箱中，安全隔离
- ✅ 可以访问数据库、剪贴板等所有系统能力
- ✅ 未来可以轻松升级为 UI 插件

## 插件配置示例

### plugin.json

```json
{
  "name": "timer",
  "pluginName": "定时器",
  "description": "简单的倒计时定时器",
  "version": "1.0.0",
  "author": "Your Name",
  "entry": "index.js",
  "keywords": ["timer", "计时"],
  "features": [
    {
      "code": "timer",
      "explain": "定时器",
      "cmds": [
        {
          "type": "regex",
          "label": "定时 {分钟}",
          "match": "^timer\\s+(\\d+)$"
        }
      ]
    }
  ]
}
```

**关键点：**

- 没有 `main` 字段（无界面插件的标志）
- `entry` 字段指定插件的入口脚本（相当于 preload）
- 其他字段（name、features、keywords 等）与 UI 插件相同

## 开发示例

### 示例 1：倒计时定时器

```javascript
// plugins/timer/index.js

let timers = new Map()

window.ztools.onPluginEnter(({ payload }) => {
  // 解析用户输入，例如 "timer 5" 表示 5 分钟
  const match = payload.match(/(\d+)/)
  if (!match) {
    window.ztools.showNotification('❌ 请输入正确的时间格式，例如：timer 5')
    return
  }

  const minutes = parseInt(match[1])
  const timerId = Date.now()

  // 显示通知
  window.ztools.showNotification(`⏰ 定时器已启动：${minutes} 分钟`)

  // 启动定时器
  const timeout = setTimeout(
    () => {
      window.ztools.showNotification('⏰ 时间到！')
      timers.delete(timerId)
    },
    minutes * 60 * 1000
  )

  // 保存定时器引用
  timers.set(timerId, {
    timeout,
    minutes,
    startTime: Date.now()
  })

  // 可以保存到数据库以实现持久化
  window.ztools.db.put('active-timers', Array.from(timers.entries()))
})

// 应用启动时恢复定时器（可选）
window.addEventListener('load', async () => {
  const savedTimers = await window.ztools.db.get('active-timers')
  if (savedTimers) {
    // 恢复定时器逻辑...
  }
})
```

### 示例 2：剪贴板监听器

```javascript
// plugins/clipboard-logger/index.js

// 监听剪贴板变化
window.ztools.clipboard.onChange((item) => {
  console.log('剪贴板内容已更新:', item)

  // 根据类型做不同的处理
  if (item.type === 'text') {
    // 检查是否包含敏感信息（例如密码）
    if (item.content.includes('password')) {
      window.ztools.showNotification('⚠️ 检测到敏感信息！')
    }
  }

  // 保存到自定义数据库
  window.ztools.db.put(`log-${Date.now()}`, {
    type: item.type,
    timestamp: Date.now(),
    preview: item.content?.substring(0, 50)
  })
})

window.ztools.onPluginEnter(() => {
  window.ztools.showNotification('📋 剪贴板监听器已启动')
})
```

### 示例 3：实时计算器

```javascript
// plugins/calculator/index.js

window.ztools.onPluginEnter(({ payload }) => {
  try {
    // 安全地计算表达式（注意：eval 有安全风险，生产环境建议使用 math.js 等库）
    const result = Function(`'use strict'; return (${payload})`)()

    // 显示结果通知
    window.ztools.showNotification(`${payload} = ${result}`)

    // 也可以尝试将结果写回剪贴板
    // navigator.clipboard.writeText(String(result));
  } catch (error) {
    window.ztools.showNotification('❌ 计算错误：' + error.message)
  }
})

// 实时预览（通过搜索框）
window.ztools.setSubInput((text) => {
  try {
    const result = Function(`'use strict'; return (${text})`)()
    // 注意：这里无法直接更新 UI，需要通过其他方式反馈
    // 可能需要新的 API，例如 window.ztools.setResultPreview(result)
    console.log('计算结果:', result)
  } catch (error) {
    // 表达式不完整或有错误，忽略
  }
}, '输入表达式...')
```

## 可用 API

无界面插件可以使用 **所有** `window.ztools` 提供的 API，包括：

### 基础 API

- `window.ztools.onPluginEnter(callback)` - 监听插件进入事件
- `window.ztools.showNotification(body)` - 显示系统通知
- `window.ztools.sendInputEvent(event)` - 发送模拟输入事件

### 搜索框 API

- `window.ztools.setSubInput(onChange, placeholder)` - 设置搜索框行为

### 数据库 API

- `window.ztools.db.put(key, data)` - 保存数据
- `window.ztools.db.get(key)` - 获取数据
- `window.ztools.db.remove(doc)` - 删除数据

### 剪贴板 API

- `window.ztools.clipboard.getHistory()` - 获取历史记录
- `window.ztools.clipboard.search()` - 搜索历史
- `window.ztools.clipboard.onChange()` - 监听变化
- 更多详见 [CLIPBOARD_API.md](./CLIPBOARD_API.md)

**注意事项：**

- ~~`window.ztools.setExpendHeight()`~~ - 无界面插件无需调用此 API

完整 API 文档请参考 [PLUGIN_API.md](./PLUGIN_API.md)

## 用户交互方式

由于没有 UI 界面，无界面插件需要通过其他方式与用户交互：

1. **系统通知**：使用 `window.ztools.showNotification()` 反馈结果
2. **搜索框**：通过 `setSubInput()` 接收用户输入
3. **剪贴板**：将结果写入剪贴板
4. **模拟按键**：使用 `sendInputEvent()` 模拟操作

## 最佳实践

### 1. 提供即时反馈

```javascript
window.ztools.onPluginEnter((param) => {
  // 立即给用户反馈，告知操作已接收
  window.ztools.showNotification('✅ 任务已启动')

  // 执行耗时操作...
})
```

### 2. 错误处理

```javascript
window.ztools.onPluginEnter(async (param) => {
  try {
    // 执行操作...
  } catch (error) {
    window.ztools.showNotification('❌ 操作失败：' + error.message)
  }
})
```

### 3. 数据持久化

```javascript
// 保存状态到数据库
await window.ztools.db.put('config', {
  lastRun: Date.now(),
  count: 42
})

// 读取状态
const config = await window.ztools.db.get('config')
```

### 4. 资源清理

```javascript
let interval = null

window.ztools.onPluginEnter(() => {
  // 清理旧的定时器
  if (interval) {
    clearInterval(interval)
  }

  // 启动新的定时器
  interval = setInterval(() => {
    // ...
  }, 1000)
})

// 监听插件卸载事件（如果需要）
window.addEventListener('beforeunload', () => {
  if (interval) {
    clearInterval(interval)
  }
})
```

## 调试方法

无界面插件的调试可以通过以下方式：

1. **主进程日志**：在 `PluginManager` 中查看加载日志
2. **Console 日志**：虽然窗口不可见，但可以通过开发者工具查看
3. **系统通知**：使用通知输出调试信息（开发阶段）
4. **数据库检查**：通过其他插件或主程序查看数据库内容

## 生命周期

无界面插件的生命周期：

1. **加载**：用户首次触发插件时，系统创建隐形窗口并加载 entry 脚本
2. **运行**：插件脚本执行，监听器注册完成
3. **触发**：用户输入匹配时，触发 `onPluginEnter` 回调
4. **常驻**：窗口保持在后台，随时响应后续调用
5. **卸载**：应用关闭或手动终止插件时销毁窗口

## 性能考虑

- 每个无界面插件占用一个隐形 BrowserWindow（约 50-100MB 内存）
- 建议将频繁使用的功能写成无界面插件
- 偶尔使用的功能可以做成 UI 插件，用完即关

## 从 UI 插件迁移

如果你有一个现有的 UI 插件想改为无界面：

1. 将 `plugin.json` 中的 `main` 字段改为 `entry`
2. 删除所有 HTML/CSS 代码
3. 将核心逻辑提取到 entry 脚本中
4. 用系统通知替代 UI 反馈

## 示例插件目录结构

```
plugins/
└── my-headless-plugin/
    ├── plugin.json      # 配置文件（无 main 字段）
    ├── index.js         # 入口脚本
    ├── icon.png         # 插件图标（可选）
    └── README.md        # 说明文档（可选）
```

## 常见问题

### Q: 无界面插件可以弹出窗口吗？

A: 可以。你可以通过系统通知、或者调用外部应用实现交互，但无法在 zTools 内部显示 UI。

### Q: 如何让插件开机自启动？

A: 目前需要用户手动触发一次。未来版本可能会支持 `autoload` 配置。

### Q: 可以访问 Node.js API 吗？

A: 取决于 webPreferences 配置。默认情况下无法直接访问，需要通过 preload 桥接或主进程 IPC。

### Q: 性能开销大吗？

A: 每个插件约占用 50-100MB 内存。如果插件数量较多，建议按需加载而非全部常驻。

## 相关文档

- [插件 API 文档](./PLUGIN_API.md)
- [剪贴板 API 文档](./CLIPBOARD_API.md)
- [插件开发指南](./PLUGIN_DEVELOPMENT.md)（待补充）
