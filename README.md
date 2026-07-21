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

## ❤️ 赞助商

> [想出现在这里？](mailto:8589561@qq.com)

<details open>
<summary>点击折叠</summary>

<table>
  <tr>
    <td width="240" align="center">
      <a href="https://ztest.ai/?from=ztools">
        <img src="./.github/assets/sponsors/ztest.png" alt="真测 Ztest" width="220">
      </a>
    </td>
    <td>
      感谢 <a href="https://ztest.ai/?from=ztools">真测 Ztest</a> 赞助了本项目！真测 ztest.ai 是一个 AI 中转站模型检测平台，检测结果数据全公开，23 项探针覆盖协议、身份、能力、内容完整性、安全性、性能六大维度，交叉印证识别伪造与降级。作为独立第三方验证平台，实时监测 AI 中转站的模型真实性、响应质量与服务可用性。
    </td>
  </tr>
</table>

</details>

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
- **Windows**: `ztools-x.x.x-setup.exe` 或 `ztools-x.x.x-win.zip`

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
pnpm build:win    # Windows
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
pnpm build:win          # 打包 Windows 应用
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

[![Star History Chart](https://api.star-history.com/svg?repos=lzx8589561/ZTools&type=Date)](https://star-history.com/#lzx8589561/ZTools&Date)

---

<div align="center">

**如果这个项目对你有帮助，请给个 Star ⭐️**

Made with ❤️ by [lzx8589561](https://github.com/lzx8589561)

</div>
