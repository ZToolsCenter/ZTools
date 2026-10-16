# Deepin 25 打包和安装指南

本文记录在 Deepin 25 amd64 上编译、打包、安装 ZTools 的流程。推荐直接使用本目录里的两个脚本：

```bash
./docs/deepin25/build-deepin25.sh
./docs/deepin25/install-deepin25.sh
```

`build-deepin25.sh` 负责清理旧产物、安装依赖、构建 setting 内置插件、执行类型检查、生成 Linux deb/AppImage/update zip。`install-deepin25.sh` 会安装最新 deb 包，并创建带图标的桌面启动器。

## 环境

建议使用 Node.js 20.19+ 或 22.12+。Deepin 25 上 Node 20.15.1 也能完成打包，但 `electron-vite`、Vite、UnoCSS 相关依赖会提示 engine warning。

查看当前环境：

```bash
node --version
npm --version
dpkg --print-architecture
```

安装基础工具：

```bash
sudo apt update
sudo apt install -y git curl python3 make g++ dpkg-dev fakeroot desktop-file-utils
```

## 一键编译

在项目根目录执行：

```bash
./docs/deepin25/build-deepin25.sh
```

脚本默认使用 `https://registry.npmmirror.com`，可以通过环境变量改回 npm 官方源：

```bash
NPM_REGISTRY=https://registry.npmjs.org ./docs/deepin25/build-deepin25.sh
```

脚本默认打 `x64` 包。需要指定架构时：

```bash
ZTOOLS_LINUX_ARCH=x64 ./docs/deepin25/build-deepin25.sh
ZTOOLS_LINUX_ARCH=arm64 ./docs/deepin25/build-deepin25.sh
```

产物会生成在 `dist/`：

```text
dist/ZTools-2.6.1-linux-x86_64.AppImage
dist/ZTools_2.6.1_amd64.deb
dist/update-linux-x64-2.6.1.zip
```

## 一键安装

打包完成后执行：

```bash
./docs/deepin25/install-deepin25.sh
```

脚本会自动选择 `dist/` 里最新的 `ZTools_*_*.deb`，执行 `sudo apt install -y`，然后安装两个启动入口：

- 桌面图标：当前用户桌面目录下的 `ZTools.desktop`
- 应用菜单：`~/.local/share/applications/ztools.desktop`

桌面文件会被设为可执行；如果系统支持 `gio`，脚本还会尝试设置可信标记。脚本会刷新用户级 desktop database，方便 Deepin 启动器尽快识别菜单入口。

也可以指定 deb 路径：

```bash
./docs/deepin25/install-deepin25.sh ./dist/ZTools_2.6.1_amd64.deb
```

如果 deb 已经安装，只想补桌面图标和应用菜单入口：

```bash
./docs/deepin25/install-deepin25.sh --launcher-only
```

启动器使用 `/opt/ZTools` 安装目录里的图标：

```ini
Icon=/opt/ZTools/resources/app.asar.unpacked/resources/icons/icon-ztools.png
Exec=/opt/ZTools/ztools %U
```

deb 包会把图标安装到系统图标目录，例如：

```text
/usr/share/icons/hicolor/1024x1024/apps/ztools.png
```

不要在桌面文件里写本机源码目录里的绝对图标路径，例如 `/home/passio/Codes/ZTools/build/icon.png`。安装到别的机器或移动项目目录后，这种路径会失效。

`install-deepin25.sh` 会优先使用 `/opt/ZTools/resources/app.asar.unpacked/resources/icons/icon-ztools.png`。如果安装目录图标不存在，脚本会尝试 `/opt/ZTools/resources/app.asar.unpacked/resources/icons/icon.png` 和 `/usr/share/icons/hicolor/1024x1024/apps/ztools.png`，最后才回退到 `Icon=ztools`。

## 运行和卸载

安装后可以从桌面启动器启动，也可以在终端运行：

```bash
ztools
```

卸载：

```bash
sudo apt remove ztools
```

AppImage 不需要安装：

```bash
chmod +x dist/ZTools-2.6.1-linux-x86_64.AppImage
./dist/ZTools-2.6.1-linux-x86_64.AppImage
```

## 常见问题

### 启动时报 Cannot find module '@electron-toolkit/utils'

根目录依赖必须用 pnpm 安装。这个仓库有 `pnpm-lock.yaml`，`electron-builder` 会通过 `pnpm list --prod` 收集生产依赖。如果根目录用 npm 安装后直接打包，生产依赖可能不会进入 `app.asar`，启动时就会缺 `@electron-toolkit/utils`。

`build-deepin25.sh` 已经处理了这件事：根目录使用 pnpm 默认 node linker，setting 插件使用 pnpm hoisted node linker。

### 系统没有 pnpm

脚本会先查找全局 `pnpm`。如果没有，会用 `npm exec --yes pnpm@10` 准备一个临时 pnpm，并把 npx 缓存里的 pnpm 加入当前脚本的 `PATH`。

如果你想手动安装：

```bash
npm install -g pnpm
```

### setting 插件缺少 oxc-parser native binding

Deepin 25 amd64/glibc 环境下，setting 插件使用 hoisted 安装可以避开该问题。脚本里对应命令是：

```bash
pnpm --dir internal-plugins/setting install --frozen-lockfile --node-linker=hoisted
pnpm --dir internal-plugins/setting build
```

### npm 或 Electron 下载超时

可以切换 registry：

```bash
NPM_REGISTRY=https://registry.npmmirror.com ./docs/deepin25/build-deepin25.sh
```

Electron 和 electron-builder 的下载缓存通常在：

```text
$HOME/.cache/electron
$HOME/.cache/electron-builder
```

### apt 提示 _apt 无法访问本地 deb

如果你看到类似提示：

```text
N: 由于文件 '.../dist/ZTools_2.6.1_amd64.deb' 无法被用户 '_apt' 访问，已脱离沙盒并提权为根用户来进行下载。
```

这通常是本地文件权限或路径权限导致的 apt 提示。只要安装退出码为 0，ZTools 已经安装成功。可以用下面命令确认：

```bash
which ztools
dpkg -l ztools
```

## 验证产物

查看 deb 元数据：

```bash
dpkg-deb --info dist/ZTools_2.6.1_amd64.deb
```

确认 asar 内包含运行时依赖：

```bash
npx asar list dist/linux-unpacked/resources/app.asar | grep '@electron-toolkit/utils'
```

本次已验证的产物：

```text
ZTools-2.6.1-linux-x86_64.AppImage  117M
ZTools_2.6.1_amd64.deb              79M
update-linux-x64-2.6.1.zip          15M
```

SHA-256：

```text
b56d762e6f0d19772423d9cfe5e69fcf4969846a94e58e9a3d7f9d7b4ab01a3d  dist/ZTools-2.6.1-linux-x86_64.AppImage
519430877bea0c7f73c9c535f56577e6cd625c9ed147d9cc465e8a73894dbfb9  dist/ZTools_2.6.1_amd64.deb
e4458d2df8016f4094f71ebf4e53529fe009680951ff47e786b472f6f73391c5  dist/update-linux-x64-2.6.1.zip
```
