# {{PLUGIN_NAME}}

> {{DESCRIPTION}}

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件。

## ✨ 功能特性

### 📌 已包含的示例功能

- **Hello** - 基础功能指令示例
  - 触发指令：`你好` / `hello`
  - 展示简单的 Vue 组件界面

- **读文件** - 文件读取功能示例
  - 功能指令：`读文件`
  - 匹配指令：支持拖拽文件触发
  - 演示如何使用 Node.js 能力读取文件内容

- **保存为文件** - 文件写入功能示例
  - 匹配指令：任意文本/图片 → `保存为文件`
  - 演示如何将剪贴板内容保存为文件

## 📁 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置文件
│   └── preload/              # Preload 脚本目录
│       ├── package.json      # Preload 依赖配置
│       └── services.js       # Node.js 能力扩展
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件
│   ├── env.d.ts              # 类型声明
│   ├── Hello/                # Hello 功能组件
│   │   └── index.vue
│   ├── Read/                 # 读文件功能组件
│   │   └── index.vue
│   └── Write/                # 写文件功能组件
│       └── index.vue
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置
├── tsconfig.json             # TypeScript 配置
├── package.json              # 项目依赖
└── README.md                 # 项目文档
```

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

## 📖 开发指南

### 1. 修改插件配置

编辑 `public/plugin.json` 文件：

```json
{
  "name": "你的插件名称",
  "description": "插件描述",
  "author": "作者名称",
  "version": "1.0.0",
  "features": [
    // 添加你的功能配置
  ]
}
```

### 2. 创建新功能

#### 步骤 1: 创建 Vue 组件

在 `src/` 目录下创建新的功能组件：

```vue
<!-- src/MyFeature/index.vue -->
<template>
  <div class="my-feature">
    <h1>{{ title }}</h1>
    <!-- 你的组件内容 -->
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const title = ref('我的新功能')
</script>

<style scoped>
.my-feature {
  padding: 20px;
}
</style>
```

#### 步骤 2: 注册路由

在 `src/App.vue` 中添加路由：

```vue
<script setup lang="ts">
import MyFeature from './MyFeature/index.vue'

const routes = {
  hello: Hello,
  read: Read,
  write: Write,
  myfeature: MyFeature // 添加新路由
}
</script>
```

#### 步骤 3: 配置功能

在 `plugin.json` 中添加功能配置：

```json
{
  "code": "myfeature",
  "explain": "我的新功能",
  "icon": "logo.png",
  "cmds": ["触发指令"]
}
```

### 3. 使用 Node.js 能力

#### 扩展 Preload 服务

编辑 `public/preload/services.js`：

```javascript
const fs = require('fs')
const path = require('path')

module.exports = {
  // 示例：读取文件
  readFile: (filePath) => {
    return fs.readFileSync(filePath, 'utf-8')
  },

  // 添加你的服务
  myService: (params) => {
    // 实现你的逻辑
    return result
  }
}
```

#### 在 Vue 组件中调用

```vue
<script setup lang="ts">
const handleRead = async () => {
  try {
    const content = await window.services.readFile('/path/to/file')
    console.log(content)
  } catch (error) {
    console.error('读取失败:', error)
  }
}
</script>
```

### 4. 使用 ZTools API

```vue
<script setup lang="ts">
// 获取剪贴板内容
const text = await window.ztools.getClipboardContent()

// 隐藏主窗口
window.ztools.hideMainWindow()

// 显示提示
window.ztools.showTip('操作成功')

// 更多 API 请参考官方文档
</script>
```

## 🎨 样式开发

### 使用 CSS 变量

ZTools 提供了一套 CSS 变量用于主题适配：

```css
.my-component {
  background: var(--bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
}
```

### 暗色模式支持

```css
@media (prefers-color-scheme: dark) {
  .my-component {
    /* 暗色模式样式 */
  }
}
```

## 📦 构建与发布

### 1. 构建插件

```bash
npm run build
```

### 2. 测试构建产物

将 `dist/` 目录中的所有文件复制到 ZTools 插件目录进行测试。

### 3. 发布到插件市场

1. 确保 `plugin.json` 中的信息完整准确
2. 准备好插件截图和详细说明
3. 访问 ZTools 插件市场提交插件

## 📚 相关资源

- [ZTools 官方文档](https://github.com/ztool-center/ztools)
- [ZTools API 文档](https://github.com/ztool-center/ztools-api-types)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)

## ❓ 常见问题

### Q: 如何调试插件？

A: 使用 `npm run dev` 启动开发服务器，在插件界面中点击插件头像图标，在弹出的菜单中选择"打开开发者工具"进行调试。

### Q: 如何访问 Node.js 能力？

A: 通过 `public/preload/services.js` 文件扩展服务，然后在组件中使用 `window.services` 调用。

### Q: 插件图标不显示？

A: 确保 `public/logo.png` 文件存在，且在 `plugin.json` 中正确配置了 `logo` 字段。

### Q: 如何处理大文件上传？

A: 建议使用 Node.js 流式处理，在 preload 脚本中实现文件分块处理逻辑。

## 📄 开源协议

MIT License

---

**祝你开发愉快！** 🎉
