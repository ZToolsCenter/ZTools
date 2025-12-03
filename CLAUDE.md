# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ZTools 是一个基于 Electron + Vue 3 + TypeScript 的 macOS 应用启动器和插件平台，类似 Alfred/Raycast。核心功能包括：

- 应用快速启动（支持拼音搜索）
- 可扩展的插件系统
- 剪贴板历史管理
- 自定义快捷键和界面

## 开发命令

```bash
# 开发
npm run dev          # 启动开发模式（热重载）

# 类型检查
npm run typecheck:node  # 主进程 + preload
npm run typecheck:web   # 渲染进程
npm run typecheck       # 全部

# 构建
npm run build           # 仅编译源码
npm run build:mac       # 打包 macOS 应用
npm run build:unpack    # 打包但不生成安装包（调试用）
```

## 核心架构

### Electron 三层结构

```
Main Process (src/main/)
  ├─ index.ts              # 应用入口
  ├─ windowManager.ts      # 窗口管理、快捷键注册
  ├─ pluginManager.ts      # 插件 BrowserView 管理
  ├─ api.ts                # IPC 通信中心（所有 ipcMain.handle）
  ├─ clipboardManager.ts   # 剪贴板监听和历史管理
  └─ core/db/              # PouchDB 数据持久化
         ↓ IPC
Preload Script (src/preload/index.ts)
  ├─ contextBridge.exposeInMainWorld('ztools', {...})
  └─ 类型安全的 API 暴露到 window.ztools
         ↓
Renderer Process (src/renderer/)
  ├─ App.vue              # 三种视图模式：Search/Plugin/Settings
  ├─ stores/              # Pinia 状态管理
  │   ├─ appDataStore.ts  # 应用列表、搜索、历史记录、固定列表
  │   └─ windowStore.ts   # 窗口信息、配置
  └─ components/          # Vue 组件
```

### 插件系统设计

**关键机制**：

- 使用 **BrowserView** 而非 BrowserWindow，插件作为主窗口的视图层
- 插件通过 `resources/preload.js` 访问受限的主进程 API
- 支持两种模式：
  - **生产插件**：打包的 ZIP 文件 → 解压到 `userData/plugins/`
  - **开发插件**：本地文件夹，支持 HTTP URL（如 `http://localhost:5173`）

**插件启动流程**：

```
用户输入 → appDataStore.search() 匹配
    ↓
launch('plugin:/path/to/plugin:featureCode')
    ↓
pluginManager.createPluginView()
    ↓
1. 从缓存 pluginViews 查找或创建新 BrowserView
2. 设置边界（y=59px, height=541px）
3. 加载插件 URL（本地文件或 HTTP）
4. 发送 on-plugin-enter 事件（携带 launchParam）
```

**插件配置** (`plugin.json`):

```json
{
  "name": "插件名称",
  "main": "dist/index.html", // 生产模式入口
  "development": { "main": "http://localhost:5173" },
  "features": [
    {
      "code": "search",
      "explain": "搜索功能",
      "cmds": [
        "搜索", // 文本命令
        {
          // 正则命令
          "type": "regex",
          "match": "/^calc (.+)$/",
          "label": "计算器",
          "minLength": 5
        }
      ]
    }
  ]
}
```

**重要规则**：

- 每个 `feature.cmds` 都会生成独立的搜索项
- 插件卸载时，后端自动清理历史记录和固定列表中的相关项
- 插件缓存在 `pluginViews` 数组中，切换时复用（注意内存管理）

### 状态管理 (Pinia)

#### appDataStore.ts

负责应用和插件的核心数据：

**关键状态**：

- `apps: App[]` - Fuse.js 搜索的应用列表（应用 + 文本插件命令）
- `regexApps: App[]` - 正则匹配的插件命令列表
- `history: HistoryItem[]` - 使用历史（最多 27 个）
- `pinnedApps: App[]` - 固定应用（最多 18 个）
- `fuse: Fuse<App>` - 搜索引擎实例

**搜索策略**：

```typescript
search(query: string): {
  bestMatches: SearchResult[],  // Fuse.js 模糊搜索（名称、拼音、拼音首字母）
  regexMatches: SearchResult[]  // 正则匹配（需满足 minLength）
}
```

**插件命令拆分逻辑**：

- 文本命令（如 "搜索"）→ 存入 `apps`，支持拼音搜索
- 正则命令（如 `/^calc (.+)$/`）→ 存入 `regexApps`，独立匹配
- 插件名本身也作为一个搜索项（path 不包含 feature code）

**数据加载时机**：

- `initializeData()` - 应用启动时调用一次，并行加载历史、固定列表、应用列表
- `loadApps()` - 插件安装/删除时刷新
- `reloadUserData()` - 插件删除时刷新历史和固定列表

#### windowStore.ts

窗口和 UI 配置：

- `currentWindow` - 打开前激活的窗口信息（用于恢复）
- `currentPlugin` - 当前显示的插件信息
- `autoPaste` - 自动粘贴配置（off/1s/3s/5s/10s）

### 数据持久化 (PouchDB)

**存储结构**：

```typescript
// 数据库路径: app.getPath('userData')/default
// 两个桶（namespace）: ZTOOLS / CLIPBOARD

interface Doc<T> {
  _id: string // 键名（如 'plugins', 'app-history'）
  _rev?: string // PouchDB 版本号
  data: string // JSON.stringify(实际数据)
}
```

**主要存储键（ZTOOLS 桶）**：

- `plugins` - 插件列表
- `app-history` - 应用使用历史
- `pinned-apps` - 固定应用列表
- `settings-general` - 通用设置

**CLIPBOARD 桶**：

- 每条剪贴板记录一个文档（`_id` 为 UUID）
- 图片保存到 `userData/clipboard/images/`
- 支持类型：文本、图片（PNG）、文件列表

### IPC 通信模式

**关键接口（api.ts）**：

应用管理：

- `get-apps` - 扫描系统应用（`appScanner.js`）
- `launch` - 启动应用或插件

插件管理：

- `import-plugin` - 导入 ZIP 插件
- `import-dev-plugin` - 添加开发插件
- `delete-plugin` - 删除插件 + 清理历史和固定列表
- `get-plugins` - 获取插件列表

事件推送（Main → Renderer）：

- `focus-search` - 显示搜索窗口
- `plugins-changed` - 插件列表变化（安装/删除后）
- `plugin-opened` / `plugin-closed` - 插件生命周期
- `window-info-changed` - 窗口信息更新

### 剪贴板系统

**原生模块**（`resources/lib/clipboard_monitor.node`）：

- 监听系统剪贴板变化（自动去重）
- 监听窗口激活事件（记录复制来源）
- **仅支持 macOS**，跨平台需要适配

**数据流**：

```
系统剪贴板变化 → 原生模块回调
    ↓
clipboardManager.handleClipboardChange()
    ↓
解析类型（优先级：文件 > 图片 > 文本）
    ↓
生成 ClipboardItem（含 hash、时间戳、来源应用）
    ↓
保存到 CLIPBOARD 桶 + 清理旧记录
    ↓
通知插件：pluginManager.sendPluginMessage('clipboard-change', item)
```

**图片处理规则**：

- 单张限制：10MB
- 总容量限制：500MB
- 超限时自动清理最旧图片

## 关键代码路径

### 修改插件系统

- `src/main/pluginManager.ts` - BrowserView 创建和管理
- `src/main/api.ts` - 插件安装/删除逻辑
- `resources/preload.js` - 插件可用的 API

### 修改搜索逻辑

- `src/renderer/src/stores/appDataStore.ts` - 搜索引擎和数据加载
- `src/renderer/src/components/SearchResults.vue` - 搜索结果展示和键盘导航

### 修改数据持久化

- `src/main/core/db/index.ts` - Database 类
- `src/main/core/db/dbInstance.ts` - PouchDB 实例初始化

### 修改剪贴板功能

- `src/main/clipboardManager.ts` - 剪贴板监听和历史管理
- `resources/lib/clipboard_monitor.node` - 原生模块（需要 C++ 修改）

## 常见任务指南

### 添加新的 IPC 接口

1. 在 `src/main/api.ts` 中添加 handler：

```typescript
ipcMain.handle('new-feature', async (_event, param) => {
  // 实现逻辑
  return { success: true, data: result }
})
```

2. 在 `src/preload/index.ts` 中暴露：

```typescript
contextBridge.exposeInMainWorld('ztools', {
  newFeature: (param) => ipcRenderer.invoke('new-feature', param)
})
```

3. 在 `src/renderer/src/env.d.ts` 中添加类型：

```typescript
interface Window {
  ztools: {
    newFeature: (param: string) => Promise<{ success: boolean; data?: any }>
  }
}
```

### 添加新的 Pinia Store

1. 创建 `src/renderer/src/stores/xxxStore.ts`
2. 使用 `defineStore` 定义状态和方法
3. 在 `App.vue` 或组件中导入使用

### 修改插件 API

插件可用的 API 定义在 `resources/preload.js`（**不经过 Vite 构建**）：

- 修改后需要重启应用才能生效
- 文档：`docs/PLUGIN_API.md`（如存在）

## 注意事项

### 类型安全

- 主进程和 preload 的类型检查是分开的（`npm run typecheck:node`）
- 渲染进程类型检查（`npm run typecheck:web`）
- `env.d.ts` 需要与 `preload/index.ts` 保持同步

### 插件缓存管理

- 所有插件 BrowserView 都缓存在 `pluginViews` 数组
- 长时间运行可能导致内存占用高
- 考虑添加 LRU 清理策略或手动清理接口

### 跨平台限制

- `clipboard_monitor.node` 仅支持 macOS
- `appleScriptHelper.ts` 使用 AppleScript（macOS 专用）
- Windows/Linux 需要替代方案

### 数据库操作

- 所有数据库调用都应该包含错误处理
- 插件删除时需要同步清理历史记录和固定列表（已实现）
- 图片和剪贴板数据有容量限制，需要定期清理

### 搜索性能

- `getApps()` 每次都扫描系统应用，考虑缓存 + 增量更新
- Fuse.js 搜索阈值设置为 0
- 正则匹配需要检查 `minLength`，避免短查询性能问题

## 用户指令遵守

根据用户的 `~/.claude/CLAUDE.md` 配置：

- 用中文回答问题
- 审视输入中的潜在问题，给出超出思考框架的建议
- 如果用户说的离谱，直接指出问题

## 架构设计原则

1. **职责分离**：主进程负责系统交互，渲染进程负责 UI，preload 负责安全隔离
2. **数据单向流动**：Store → Component，通过事件或 action 修改 Store
3. **插件隔离**：插件通过受限的 preload API 访问主进程，避免直接访问 Node.js API
4. **性能优先**：搜索结果缓存在 Store，插件 BrowserView 复用
5. **容错设计**：IPC 调用、数据库操作、插件加载都应该有错误处理
