# cc-ai-tools

<div align="center">

<img src="./.github/assets/icon.png" alt="cc-ai-tools Logo" width="120">

**一个高性能、可扩展的应用启动器和插件平台**

_基于 ZTools | 支持 macOS 和 Windows_

[![GitHub release](https://img.shields.io/github/v/release/BluerAngala/cc-ai-tools)](https://github.com/BluerAngala/cc-ai-tools/releases)
[![License](https://img.shields.io/github/license/BluerAngala/cc-ai-tools)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/BluerAngala/cc-ai-tools)

[English](./README_EN.md) | 简体中文

</div>

---

## 🙏 致谢上游

本项目 Fork 自 [ZToolsCenter/ZTools](https://github.com/ZToolsCenter/ZTools)，感谢原作者 [ZToolsCenter](https://github.com/ZToolsCenter) 及所有贡献者的出色工作。本分支在其基础上进行了个性化定制和功能扩展。

## ✨ 特性

- 🚀 **快速启动** - 拼音搜索、正则匹配、历史记录、固定应用
- 🧩 **插件系统** - 支持 UI 插件和无界面插件，完整的 API 支持
- 📋 **剪贴板管理** - 历史记录、搜索、图片支持、跨平台原生实现
- 🎨 **主题定制** - 系统/亮色/暗色模式，6 种主题色可选
- ⚡ **高性能** - LMDB 数据库、WebContentsView 架构、极速响应
- 🌍 **跨平台** - 原生支持 macOS 和 Windows，统一体验
- 🔒 **数据隔离** - 插件数据独立存储，安全可靠
- 🛠️ **开发友好** - 完整的 TypeScript 类型支持，热重载开发
- 🏪 **多源插件市场** - 支持官方市场、GitHub 仓库、自定义 CDN 多种插件来源

## 📸 预览

<div align="center">
  <img src="./.github/assets/demo.gif" alt="cc-ai-tools 演示" width="600">
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
        <p align="center"><i>插件市场 - 支持多源切换</i></p>
      </td>
    </tr>
  </table>
</div>

## 🚀 快速开始

### 安装

#### 方式 1：下载预编译版本（推荐）

从 [Releases](https://github.com/BluerAngala/cc-ai-tools/releases) 页面下载最新版本：

- **macOS**: `cc-ai-tools-x.x.x.dmg` 或 `cc-ai-tools-x.x.x-arm64-mac.zip`
- **Windows**: `cc-ai-tools-x.x.x-setup.exe` 或 `cc-ai-tools-x.x.x-win.zip`

#### 方式 2：从源码构建

```bash
# 克隆仓库（含子模块）
git clone https://github.com/BluerAngala/cc-ai-tools.git --recurse-submodules
cd cc-ai-tools

# 安装依赖（Electron 等原生模块会自动编译/下载）
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build:mac    # macOS
pnpm build:win    # Windows
```

### 使用

1. 启动应用后，使用快捷键 `Option+Z`（macOS）或 `Alt+Z`（Windows）唤起主界面
2. 输入应用名称或命令进行搜索
3. 按 `↑` `↓` `←` `→` 选择，`Enter` 确认，`Esc` 退出

## 🏪 插件市场

cc-ai-tools 支持多种插件来源，可在设置 → 插件市场 → 右上角齿轮图标中切换：

| 来源            | 说明                           | 功能                 |
| --------------- | ------------------------------ | -------------------- |
| **官方市场**    | ZTools 官方插件市场            | 完整分类、推荐、评论 |
| **GitHub 仓库** | 从 GitHub 仓库扫描 plugin.json | 支持公开/私有仓库    |
| **CDN 清单**    | 自定义 JSON 清单文件           | 灵活部署             |

## 🧩 插件开发

cc-ai-tools 是一个强大、可扩展的插件平台。通过简单的配置、丰富的 API 以及跨平台支持，您可以轻松开发出功能强大的插件。

**插件系统特点**：

- 📝 **简单配置** - 通过标准的 `plugin.json` 文件轻松定义插件
- 🔌 **丰富的 API** - 通过全局 `ztools` 对象访问系统能力
- 🎯 **灵活的指令** - 使用文本、正则或全局钩子触发您的插件
- 🌍 **跨平台** - 一次构建，在 Windows 和 macOS 上运行

## 🛠️ 技术栈

- **框架**: Electron + Vue 3 + TypeScript
- **构建**: Vite + electron-vite
- **数据库**: LMDB（高性能键值存储）
- **状态管理**: Pinia
- **搜索引擎**: Fuse.js（拼音支持）

## 💻 开发

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9（`npm i -g pnpm` 安装）
- macOS 或 Windows 开发环境

### 开发命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发模式（热重载）
pnpm typecheck        # 类型检查
pnpm build:mac        # 打包 macOS 应用
pnpm build:win        # 打包 Windows 应用
```

## 🐛 问题反馈

遇到问题？请在 [Issues](https://github.com/BluerAngala/cc-ai-tools/issues) 中反馈。

## 📄 许可证

本项目采用 [MIT License](./LICENSE) 许可证。

## 💝 致谢

- [ZToolsCenter/ZTools](https://github.com/ZToolsCenter/ZTools) - 上游项目，本项目的基石
- [uTools](https://u.tools/) - 灵感来源
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [LMDB](http://www.lmdb.tech/) - 高性能嵌入式数据库

---

<div align="center">

**如果这个项目对你有帮助，请给个 Star ⭐️**

</div>
