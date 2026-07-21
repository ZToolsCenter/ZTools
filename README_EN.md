# ZTools

<div align="center">

<img src="./.github/assets/icon.png" alt="ZTools Logo" width="120">

**A High-Performance, Extensible Application Launcher and Plugin Platform**

_Open Source Implementation of uTools | Supports macOS and Windows_

[![GitHub release](https://img.shields.io/github/v/release/lzx8589561/ZTools)](https://github.com/ZToolsCenter/ZTools/releases)
[![License](https://img.shields.io/github/license/lzx8589561/ZTools)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/ZToolsCenter/ZTools)

English | [简体中文](./README.md)

</div>

---

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

## ❤️ Sponsors

> [Want to appear here?](mailto:8589561@qq.com)

<details open>
<summary>Click to collapse</summary>

<table>
  <tr>
    <td width="240" align="center">
      <a href="https://ztest.ai/?from=ztools">
        <img src="./.github/assets/sponsors/ztest.png" alt="Ztest" width="220">
      </a>
    </td>
    <td>
      Thanks to <a href="https://ztest.ai/?from=ztools">Ztest</a> for sponsoring this project! Ztest.ai is a model verification platform for AI API relay services that makes all test result data publicly available. Its 23 probes cover six dimensions: protocol, identity, capability, content integrity, security, and performance. By cross-validating results, it identifies model spoofing and degradation. As an independent third-party verification platform, Ztest monitors the model authenticity, response quality, and service availability of AI API relay services in real time.
    </td>
  </tr>
</table>

</details>

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

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lzx8589561/ZTools&type=Date)](https://star-history.com/#lzx8589561/ZTools&Date)

---

<div align="center">

**If this project helps you, please give it a Star ⭐️**

Made with ❤️ by [lzx8589561](https://github.com/lzx8589561)

</div>
