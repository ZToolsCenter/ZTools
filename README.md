# ZTools

<div align="center">

<img src="./.github/assets/icon.png" alt="ZTools Logo" width="120">

**一个高性能、可扩展的应用启动器和插件平台**

_uTools 的开源实现 | 支持 macOS 和 Windows_

[![GitHub release](https://img.shields.io/github/v/release/lzx8589561/ZTools)](https://github.com/ZToolsCenter/ZTools/releases)
[![License](https://img.shields.io/github/license/lzx8589561/ZTools)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/ZToolsCenter/ZTools)

[English](./README_EN.md) | 简体中文

</div>

## ❤️ 赞助商

> [想出现在这里？](mailto:8589561@qq.com)

<details open>
<summary>点击折叠</summary>

<table>
  <tr>
    <td width="240" align="center">
      <a href="https://go.apimart.ai/gh-ztools">
        <img src="./.github/assets/sponsors/apimart.png" alt="APIMart" width="220">
      </a>
    </td>
    <td>
      感谢 <a href="https://go.apimart.ai/gh-ztools">APIMart</a>  赞助了本项目！APIMart 是专注 AI 图片/视频生成的低价 API 平台，GPT-Image-2 低至 $0.006/张，1 美元可出图 160+ 张。图片、视频一套异步 API 通吃，提交任务拿 ID、回调取结果，跑批万张不超时、换模型不改代码。按量付费、无月费，通过此<a href="https://go.apimart.ai/gh-ztools">注册链接</a>注册即可开用。
    </td>
  </tr>
</table>

</details>

---

## ✨ 特性

- 🚀 **快速启动** - 拼音搜索、正则匹配、历史记录、固定应用
- 🧩 **插件系统** - 支持 UI 插件和无界面插件，完整的 API 支持
- 📋 **剪贴板管理** - 历史记录、搜索、图片支持、跨平台原生实现
- 🎨 **主题定制** - 系统/亮色/暗色模式，6 种主题色可选
- ⚡ **高性能** - LMDB 数据库、WebContentsView 架构、极速响应
- 🌍 **跨平台** - 原生支持 macOS 和 Windows，统一体验
- 🔒 **数据隔离** - 插件数据独立存储，安全可靠
- 🛠️ **开发友好** - 完整的 TypeScript 类型支持，热重载开发
- ⚙️ **最新技术栈** - Electron 41 + Node 24.15 + Chrome 146

## 📸 预览

<div align="center">
  <img src="./.github/assets/demo.gif" alt="ZTools 演示" width="600">
  <p><i>快速启动应用和搜索功能演示</i></p>
</div>

### 界面展示

<div align="center">
  <table>
    <tr>
      <td width="50%">
        <img src="./.github/assets/main-light.png" alt="主界面 - 亮色主题">
        <p align="center"><i>主界面 - 亮色主题</i></p>
      </td>
      <td width="50%">
        <img src="./.github/assets/main-dark.png" alt="主界面 - 暗色主题">
        <p align="center"><i>主界面 - 暗色主题</i></p>
      </td>
    </tr>
    <tr>
      <td width="50%">
        <img src="./.github/assets/settings.png" alt="设置界面">
        <p align="center"><i>设置界面 - 主题定制和通用设置</i></p>
      </td>
      <td width="50%">
        <img src="./.github/assets/plugin-market.png" alt="插件市场">
        <p align="center"><i>插件市场 - 在线安装和管理插件</i></p>
      </td>
    </tr>
  </table>
</div>

## 🚀 快速开始

### 安装

#### 方式 1：下载预编译版本（推荐）

从 [Releases](https://github.com/ZToolsCenter/ZTools/releases) 页面下载最新版本：

- **macOS**: `ztools-x.x.x.dmg` 或 `ZTools-x.x.x-arm64-mac.zip`
- **Windows x64 / ARM64**: `ZTools-x.x.x-win-{arch}-setup.exe` 或 `ZTools-x.x.x-win-{arch}.zip`

#### 方式 2：从源码构建

```bash
# 克隆仓库
git clone https://github.com/ZToolsCenter/ZTools.git
cd ZTools

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build:mac    # macOS
pnpm build:win:x64   # Windows x64（build:win 仍为 x64 别名）
pnpm build:win:arm64 # Windows ARM64
pnpm build:linux  # Linux (当前主机架构)
pnpm build:linux:x64 # Linux (按 amd64/x64 架构打包)
pnpm build:linux:arm64 # Linux (按 arm64 架构打包)
```

### 使用

1. 启动应用后，使用快捷键 `Option+Z`（macOS）或 `Alt+Z`（Windows）唤起主界面
2. 输入应用名称或命令进行搜索
3. 按 `↑` `↓` `←` `→` 选择，`Enter` 确认，`Esc` 退出

## 🧩 插件开发

ZTools 是一个强大、可扩展的插件平台，使用自定义插件提升您的生产力。通过简单的配置、丰富的 API 以及跨平台支持，您可以轻松开发出功能强大的插件。

**插件系统特点**：

- 📝 **简单配置** - 通过标准的 `plugin.json` 文件轻松定义插件，无需复杂的设置
- 🔌 **丰富的 API** - 通过全局 `ztools` 对象访问系统能力，包括通知、模拟输入和持久化存储
- 🎯 **灵活的指令** - 使用文本、正则或全局钩子触发您的插件，以适应任何工作流
- 🌍 **跨平台** - 一次构建，在 Windows、macOS 和 Linux 上运行，在所有设备上获得一致的体验

> 📖 **完整文档**：查看 [ZTools 开发者文档](https://ztoolscenter.github.io/ZTools-doc/) 了解更多详情

## 🛠️ 技术栈

- **框架**: Electron 41 + Vue 3 + TypeScript
- **构建**: Vite + electron-vite
- **数据库**: LMDB（高性能键值存储）
- **状态管理**: Pinia
- **搜索引擎**: Fuse.js（拼音支持）
- **原生模块**: C++ (Node-API)
  - 剪贴板监听
  - 窗口管理
  - 区域截图（Windows）

## 📁 项目结构

```
ztools/
├── src/
│   ├── main/              # 主进程
│   │   ├── api/          # IPC API 模块
│   │   ├── core/         # 核心功能（数据库、原生模块）
│   │   ├── windowManager.ts
│   │   └── pluginManager.ts
│   ├── preload/          # Preload 脚本
│   └── renderer/         # 渲染进程（Vue）
│       ├── components/
│       ├── stores/       # Pinia 状态管理
│       └── App.vue
├── resources/            # 资源文件
│   ├── lib/             # 原生模块（.node）
│   └── preload.js       # 插件 Preload
└── CLAUDE.md            # 完整技术文档
```

## 📚 文档

- [CLAUDE.md](./CLAUDE.md) - 完整技术文档和架构说明
- [开发命令](#开发命令) - 常用命令说明
- [插件开发](#插件开发) - 插件开发指南

## 💻 开发

### 环境要求

- Node.js >= 18
- npm >= 9
- macOS 或 Windows 开发环境

### 代码拉取

1. 先 fork 仓库

- 如果需要贡献代码请 fork [ztools-api-types](https://github.com/ZToolsCenter/ztools-api-types) 和 [ztools-plugin-cli](https://github.com/ZToolsCenter/ztools-plugin-cli) 仓库

2. 拉取完整代码

```bash
git clone https://github.com/ZToolsCenter/ZTools.git --recurse-submodules
```

### 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm dev

# 类型检查
pnpm typecheck          # 全部
pnpm typecheck:node     # 主进程 + preload
pnpm typecheck:web      # 渲染进程

# 代码格式化
pnpm format             # Prettier 格式化
pnpm lint               # ESLint 检查

# 构建
pnpm build              # 仅编译源码
pnpm build:mac          # 打包 macOS 应用
pnpm build:win:x64      # 打包 Windows x64 应用（build:win 仍为 x64 别名）
pnpm build:win:arm64    # 打包 Windows ARM64 应用
pnpm build:linux        # 打包 Linux 应用 (当前主机架构)
pnpm build:linux:x64    # 打包 Linux 应用 (amd64/x64)
pnpm build:linux:arm64  # 打包 Linux 应用 (arm64)
pnpm build:unpack       # 打包但不生成安装包（调试用）
```

### 调试

- 主进程：在 VS Code 中按 F5，或使用 `pnpm dev` 查看终端日志
- 渲染进程：在应用中按 `Cmd+Option+I`（macOS）或 `Ctrl+Shift+I`（Windows）打开开发者工具
- 插件：在插件页面点击"打开开发者工具"按钮

## 🗺️ 路线图

### 已完成 ✅

- [x] 应用快速启动和搜索
- [x] 插件系统（UI + 无界面）
- [x] 剪贴板历史管理
- [x] 跨平台支持（macOS + Windows）
- [x] LMDB 数据库迁移
- [x] 主题定制
- [x] 数据隔离
- [x] 插件市场
- [x] 全局快捷键自定义
- [x] 插件分离为独立窗口
- [ ] 插件自动更新
- [ ] 云同步（可选）
- [ ] Linux 支持
- [ ] MCP工具集

## 🐛 问题反馈

遇到问题？请在 [Issues](https://github.com/ZToolsCenter/ZTools/issues) 中反馈。

提交 Issue 时请包含：

- 操作系统版本
- ZTools 版本
- 复现步骤
- 错误日志（如有）

## 📄 许可证

本项目采用 [MIT License](./LICENSE) 许可证。

## 💝 致谢

- [uTools](https://u.tools/) - 灵感来源
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [LMDB](http://www.lmdb.tech/) - 高性能嵌入式数据库

## ⭐ Star 历史

<a href="https://www.star-history.com/?repos=lzx8589561%2FZTools%2CZT+o+o+l+s%2FZT+o+o+l+s%2CZToolsCenter%2FZTools&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=lzx8589561/ZTools%2CZT o o l s/ZT o o l s%2CZToolsCenter/ZTools&type=date&theme=dark&legend=top-left&sealed_token=8lwZs-1zJ6pF0LHgiIcQXna7H9Bs2glgI5AFB360X1hZgyZRlaTNTDMxhxfB6Vzsb7dYXVq9EP0McDNxUTk4hC4IRQRjBgKiDrcCVWFVykNy_y4x4Zi4DQ" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=lzx8589561/ZTools%2CZT o o l s/ZT o o l s%2CZToolsCenter/ZTools&type=date&legend=top-left&sealed_token=8lwZs-1zJ6pF0LHgiIcQXna7H9Bs2glgI5AFB360X1hZgyZRlaTNTDMxhxfB6Vzsb7dYXVq9EP0McDNxUTk4hC4IRQRjBgKiDrcCVWFVykNy_y4x4Zi4DQ" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=lzx8589561/ZTools%2CZT o o l s/ZT o o l s%2CZToolsCenter/ZTools&type=date&legend=top-left&sealed_token=8lwZs-1zJ6pF0LHgiIcQXna7H9Bs2glgI5AFB360X1hZgyZRlaTNTDMxhxfB6Vzsb7dYXVq9EP0McDNxUTk4hC4IRQRjBgKiDrcCVWFVykNy_y4x4Zi4DQ" />
 </picture>
</a>

---

<div align="center">

**如果这个项目对你有帮助，请给个 Star ⭐️**

Made with ❤️ by [lzx8589561](https://github.com/lzx8589561)

</div>
