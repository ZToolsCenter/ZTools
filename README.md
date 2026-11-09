# ZTools

<div align="center">

<img src="./.github/assets/icon.png" alt="ZTools Logo" width="120">

**A High-Performance, Extensible Application Launcher and Plugin Platform**

_Open Source Implementation of uTools | Supports macOS and Windows_

[![GitHub release](https://img.shields.io/github/v/release/lzx8589561/ZTools)](https://github.com/ZToolsCenter/ZTools/releases)
[![License](https://img.shields.io/github/license/lzx8589561/ZTools)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/ZToolsCenter/ZTools)

English | [简体中文](./README_CN.md)

</div>

## ✨ Features

- 🚀 **Quick Launch** - Pinyin search, regex matching, history tracking, pinned apps
- 🧩 **Plugin System** - Support for UI plugins and headless plugins with complete API support
- 📋 **Clipboard Management** - History tracking, search, image support, cross-platform native implementation
- 🎨 **Theme Customization** - System/light/dark mode with 6 theme colors to choose from
- ⚡ **High Performance** - LMDB database, WebContentsView architecture, ultra-fast response
- 🌍 **Cross-Platform** - Native support for macOS and Windows with unified experience
- 🔒 **Data Isolation** - Independent plugin data storage, secure and reliable
- 🛠️ **Developer Friendly** - Complete TypeScript type support, hot reload development
- ⚙️ **Modern Tech Stack** - Electron 41 + Node 24.15 + Chrome 146

## 📸 Preview

<div align="center">
  <img src="./.github/assets/demo.gif" alt="ZTools Demo" width="600">
  <p><i>Quick launch and search functionality demo</i></p>
</div>

### Interface Showcase

<div align="center">
  <table>
    <tr>
      <td width="50%">
        <img src="./.github/assets/main-light.png" alt="Main Interface - Light Theme">
        <p align="center"><i>Main Interface - Light Theme</i></p>
      </td>
      <td width="50%">
        <img src="./.github/assets/main-dark.png" alt="Main Interface - Dark Theme">
        <p align="center"><i>Main Interface - Dark Theme</i></p>
      </td>
    </tr>
    <tr>
      <td width="50%">
        <img src="./.github/assets/settings.png" alt="Settings">
        <p align="center"><i>Settings - Theme Customization and General Settings</i></p>
      </td>
      <td width="50%">
        <img src="./.github/assets/plugin-market.png" alt="Plugin Market">
        <p align="center"><i>Plugin Market - Online Installation and Management</i></p>
      </td>
    </tr>
  </table>
</div>

## 🚀 Quick Start

### Installation

#### Method 1: Download Pre-built Version (Recommended)

Download the latest version from [Releases](https://github.com/ZToolsCenter/ZTools/releases):

- **macOS**: `ztools-x.x.x.dmg` or `ZTools-x.x.x-arm64-mac.zip`
- **Windows**: `ztools-x.x.x-setup.exe` or `ztools-x.x.x-win.zip`

#### Method 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/ZToolsCenter/ZTools.git
cd ZTools

# Install dependencies
pnpm install

# Development mode
pnpm dev

# Build
pnpm build:mac    # macOS
pnpm build:win    # Windows
pnpm build:linux  # Linux (Default Arch)
pnpm build:linux:x64 # Linux (amd64/x64)
pnpm build:linux:arm64 # Linux (arm64)
```

### Usage

1. After launching the app, use the shortcut `Option+Z` (macOS) or `Alt+Z` (Windows) to open the main interface
2. Enter application name or command to search
3. Use `↑` `↓` `←` `→` to navigate, `Enter` to confirm, `Esc` to exit

## 🧩 Plugin Development

ZTools is a powerful and extensible plugin platform that enhances your productivity with custom plugins. With simple configuration, rich APIs, and cross-platform support, you can easily develop powerful plugins.

**Plugin System Features**:

- 📝 **Simple Configuration** - Easily define plugins through standard `plugin.json` files, no complex setup required
- 🔌 **Rich APIs** - Access system capabilities through the global `ztools` object, including notifications, simulated input, and persistent storage
- 🎯 **Flexible Commands** - Trigger your plugins using text, regex, or global hooks to adapt to any workflow
- 🌍 **Cross-Platform** - Build once, run on Windows, macOS, and Linux with a consistent experience across all devices

> 📖 **Full Documentation**: Visit [ZTools Developer Documentation](https://ztoolscenter.github.io/ZTools-doc/) for more details

## 🛠️ Tech Stack

- **Framework**: Electron 41 + Vue 3 + TypeScript
- **Build**: Vite + electron-vite
- **Database**: LMDB (high-performance key-value storage)
- **State Management**: Pinia
- **Search Engine**: Fuse.js (with Pinyin support)
- **Native Modules**: C++ (Node-API)
  - Clipboard monitoring
  - Window management
  - Region screenshot (Windows)

## 📁 Project Structure

```
ztools/
├── src/
│   ├── main/              # Main process
│   │   ├── api/          # IPC API modules
│   │   ├── core/         # Core functionality (database, native modules)
│   │   ├── windowManager.ts
│   │   └── pluginManager.ts
│   ├── preload/          # Preload scripts
│   └── renderer/         # Renderer process (Vue)
│       ├── components/
│       ├── stores/       # Pinia state management
│       └── App.vue
├── resources/            # Resource files
│   ├── lib/             # Native modules (.node)
│   └── preload.js       # Plugin preload
└── CLAUDE.md            # Complete technical documentation
```

## 📚 Documentation

- [CLAUDE.md](./CLAUDE.md) - Complete technical documentation and architecture description
- [Development Commands](#development-commands) - Common command reference
- [Plugin Development](#plugin-development) - Plugin development guide

## 💻 Development

### Requirements

- Node.js >= 18
- npm >= 9
- macOS or Windows development environment

### Development Commands

```bash
# Install dependencies
pnpm install

# Development mode (hot reload)
pnpm dev

# Type checking
pnpm typecheck          # All
pnpm typecheck:node     # Main process + preload
pnpm typecheck:web      # Renderer process

# Code formatting
pnpm format             # Prettier formatting
pnpm lint               # ESLint check

# Build
pnpm build              # Compile source code only
pnpm build:mac          # Package macOS app
pnpm build:win          # Package Windows app
pnpm build:linux        # Package Linux app (Default Arch)
pnpm build:linux:x64    # Package Linux app (amd64/x64)
pnpm build:linux:arm64  # Package Linux app (arm64)
pnpm build:unpack       # Package without installer (for debugging)
```

### Debugging

- Main process: Press F5 in VS Code, or use `pnpm dev` to view terminal logs
- Renderer process: Press `Cmd+Option+I` (macOS) or `Ctrl+Shift+I` (Windows) to open developer tools
- Plugins: Click "Open DevTools" button on the plugin page

## 🗺️ Roadmap

### Completed ✅

- [x] Quick app launch and search
- [x] Plugin system (UI + headless)
- [x] Clipboard history management
- [x] Cross-platform support (macOS + Windows)
- [x] LMDB database migration
- [x] Theme customization
- [x] Data isolation
- [x] Plugin market
- [x] Custom global shortcuts
- [x] Separate plugins into independent windows
- [ ] Plugin auto-update
- [ ] Cloud sync (optional)
- [ ] Linux support
- [ ] MCP toolkit

## 🐛 Issue Reporting

Having issues? Please report them in [Issues](https://github.com/ZToolsCenter/ZTools/issues).

When submitting an issue, please include:

- Operating system version
- ZTools version
- Steps to reproduce
- Error logs (if any)

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

## 💝 Acknowledgments

- [uTools](https://u.tools/) - Source of inspiration
- [Electron](https://www.electronjs.org/) - Cross-platform desktop app framework
- [Vue.js](https://vuejs.org/) - Progressive JavaScript framework
- [LMDB](http://www.lmdb.tech/) - High-performance embedded database

---

<div align="center">

**If this project helps you, please give it a Star ⭐️**

Made with ❤️ by [lzx8589561](https://github.com/lzx8589561)

</div>
---

## 🔧 本 Fork 的改动（myhjm94/ZTools）

本仓库 Fork 自 [ZToolsCenter/ZTools](https://github.com/ZToolsCenter/ZTools)，在 v3.2.0 基础上做了以下定制，
主要面向 Windows 使用场景，共涉及 14 个文件。

### 1. 修复 Windows 透明窗口底部灰条
- **问题**：无边框透明窗口底部会露出一条灰色底色。
- **原因**：Chromium 的 `EnableTransparentHwndEnlargement` 会为透明窗口放大 HWND 以绘制阴影/圆角，
  导致 HWND 与网页渲染区高度不一致（实测 47px vs 30px），把窗口的亚克力底色露了出来。
- **方案**：主进程启动早期把 `EnableTransparentHwndEnlargement` 合并进 `disable-features`（仅 Windows），
  使两者尺寸严格一致；灰条消失，阴影与圆角仍由 DWM 正常绘制。
- 文件：`src/main/index.ts`

### 2. 新增「搜索框大小」设置
- 设置 → 通用 → 搜索 中新增滑块（20%–80%，步进 5%，默认值由原 800px 反推）。
- 百分比含义为「主窗口宽度 ÷ 当前显示器宽度（DIP）」，拖动即时生效并持久化。
- 设置页 UI 与文字随窗口宽度等比缩放（`setZoomFactor`，缩放系数 = 窗口宽度 / 800）。
- 旧数据自动迁移：以 800px 为基准的旧值按 `800 × 旧值/100 ÷ 屏幕宽度` 换算，
  并写入 `searchBoxScaleUnit: 'screen'` 标记。
- 文件：`src/main/common/constants.ts`、`src/main/managers/windowManager.ts`、
  `src/main/managers/pluginManager.ts`、`src/main/api/renderer/window.ts`、
  `src/main/api/plugin/internal.ts`、`src/main/appMain.ts`、`resources/preload.js`、
  `internal-plugins/setting/src/env.d.ts`、
  `internal-plugins/setting/src/views/GeneralSetting/GeneralSetting.vue`

### 3. 搜索结果按搜索词热度排序 + 系统应用默认沉底
- 记录每个搜索词的命中次数（`searchTermStats`，对前缀匹配的词做聚合统计）。
- 排序优先级：**当前搜索词热度 > 完全匹配 > 前缀匹配 > Windows 系统应用/自带组件 > 使用频率**。
- Windows 系统应用（`subType=app`）与自带组件（`system-setting`）默认排在最后，
  被使用过、产生热度后才会提前。
- 文件：`src/renderer/src/stores/commandDataStore.ts`、
  `src/renderer/src/composables/useSearchResults.ts`、
  `src/renderer/src/components/search/SearchResults.vue`

### 4. 修复设置界面「更换头像」选完不生效
- **问题**：设置 → 通用 → 搜索框头像 → 选择图片，弹窗正常但选完无任何反应。
- **原因**：共用的 `openDialog()` 弹出原生模态框时未抑制「失焦自动隐藏」，主窗口 blur → 隐藏窗口 →
  设置插件视图被销毁，`selectAvatar` 的结果回不到渲染层，且不报错。
- **方案**：用 `windowManager.withBlurHideSuppressed()` 包裹 `showOpenDialog`（动态 import 规避循环依赖）。
  该修复同时惠及所有走 `openDialog()` 的原生文件对话框（选择图片、导入指令/插件等）。
- 文件：`src/main/utils/windowUtils.ts`

### 说明
- 安装版（`resources/app.asar`）需重新构建或替换 asar 后改动才会生效；源码构建自带以上修复。
- 与上游同步（rebase/合并）后，建议重新核对以上文件的改动是否仍成立。
