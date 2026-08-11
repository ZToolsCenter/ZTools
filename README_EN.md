# cc-ai-tools

<div align="center">

<img src="./.github/assets/icon.png" alt="cc-ai-tools Logo" width="120">

**A high-performance, extensible application launcher and plugin platform**

_Based on ZTools | Supports macOS and Windows_

[![GitHub release](https://img.shields.io/github/v/release/BluerAngala/cc-ai-tools)](https://github.com/BluerAngala/cc-ai-tools/releases)
[![License](https://img.shields.io/github/license/BluerAngala/cc-ai-tools)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/BluerAngala/cc-ai-tools)

English | [简体中文](./README.md)

</div>

---

## 🙏 Acknowledgments

This project is forked from [ZToolsCenter/ZTools](https://github.com/ZToolsCenter/ZTools). Special thanks to the original author [ZToolsCenter](https://github.com/ZToolsCenter) and all contributors for their excellent work. This branch adds personal customizations and feature extensions on top of the original.

## ✨ Features

- 🚀 **Fast Launch** - Pinyin search, regex matching, history, pinned apps
- 🧩 **Plugin System** - UI and headless plugins with full API support
- 📋 **Clipboard Manager** - History, search, image support, cross-platform native
- 🎨 **Theme Customization** - System/Light/Dark mode, 6 theme colors
- ⚡ **High Performance** - LMDB database, WebContentsView architecture
- 🌍 **Cross-Platform** - Native macOS and Windows support
- 🔒 **Data Isolation** - Independent plugin data storage
- 🛠️ **Developer Friendly** - Full TypeScript support, hot reload
- 🏪 **Multi-Source Plugin Market** - Official market, GitHub repos, custom CDN

## 🚀 Quick Start

### Install

#### Option 1: Download Pre-built (Recommended)

Download from [Releases](https://github.com/BluerAngala/cc-ai-tools/releases):

- **macOS**: `cc-ai-tools-x.x.x.dmg` or `cc-ai-tools-x.x.x-arm64-mac.zip`
- **Windows**: `cc-ai-tools-x.x.x-setup.exe` or `cc-ai-tools-x.x.x-win.zip`

#### Option 2: Build from Source

```bash
git clone https://github.com/BluerAngala/cc-ai-tools.git --recurse-submodules
cd cc-ai-tools
pnpm install
pnpm dev
```

### Usage

1. Launch the app, press `Option+Z` (macOS) or `Alt+Z` (Windows) to open
2. Type to search apps or commands
3. Use `↑` `↓` `←` `→` to navigate, `Enter` to confirm, `Esc` to exit

## 🏪 Plugin Market

cc-ai-tools supports multiple plugin sources, configurable in Settings → Plugin Market → gear icon:

| Source       | Description                        | Features                                   |
| ------------ | ---------------------------------- | ------------------------------------------ |
| **Official** | ZTools official market             | Full categories, recommendations, comments |
| **GitHub**   | Scan plugin.json from GitHub repos | Public & private repos                     |
| **CDN**      | Custom JSON manifest               | Flexible deployment                        |

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

## 💝 Credits

- [ZToolsCenter/ZTools](https://github.com/ZToolsCenter/ZTools) - Upstream project, the foundation of this fork
- [uTools](https://u.tools/) - Inspiration
- [Electron](https://www.electronjs.org/) - Cross-platform desktop framework
- [Vue.js](https://vuejs.org/) - Progressive JavaScript framework
- [LMDB](http://www.lmdb.tech/) - High-performance embedded database
