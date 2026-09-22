# Linux 支持说明

ZTools 上游仅官方支持 macOS 与 Windows。本文记录 Linux 移植的实现方式与已知限制。

验证环境：Ubuntu 26.04、GNOME 50.1、**Wayland** 会话、x86_64、Electron 41.4.0。

所有 Linux 改动均以 `process.platform === 'linux'` 守卫，不影响 macOS/Windows 行为。

## 运行

```bash
pnpm install
pnpm dev            # 开发模式，会同时启动设置插件的 dev server（必需）
pnpm build:linux    # 生成 AppImage 与 deb
```

`pnpm build && electron .` 直接运行构建产物时设置页打不开：内置插件的
`development.main` 指向 `http://localhost:5177`，没有 dev server 就会
`ERR_CONNECTION_REFUSED`。这是既有开发流程约定，用 `pnpm dev` 或打包产物即可。

## Wayland 后端

`src/main/index.ts` 检测到 Wayland 会话时会带上 `--ozone-platform=x11` 重新 exec 自身
（`ZTOOLS_NATIVE_WAYLAND=1` 可关闭）。原生 Wayland 下这些能力全部失效：

| 能力                                   | 原生 Wayland        | XWayland  |
| -------------------------------------- | ------------------- | --------- |
| `setPosition` / `getCursorScreenPoint` | 无效 / 恒为 `(0,0)` | 正常      |
| `alwaysOnTop`                          | 不支持              | 正常      |
| `globalShortcut.register()`            | 全部返回 false      | 返回 true |

注意 `app.commandLine.appendSwitch()` 与 `ELECTRON_OZONE_PLATFORM_HINT` 实测**只对渲染层生效**，
`globalShortcut` 仍走 Wayland 分支并全部失败，因此必须把参数放到真实命令行上重新 exec。

## 全局唤起快捷键

XWayland 下 `register()` 虽返回 true，但底层是 X11 被动抓键，只在 XWayland 窗口持有焦点时
才收得到按键，且抓键泄漏会卡死桌面输入。因此 Linux 改用**系统持有按键**的方案：
托盘菜单「安装系统唤出快捷键…」把唤出键注册为 GNOME 自定义快捷键，按下时执行
`ztools --toggle`，该进程通过 `second-instance` 通知主实例切换窗口
（`src/main/core/linuxShortcutIntegration.ts`）。

手动配置等价于在「设置 → 键盘 → 自定义快捷键」中把快捷键绑定到：

```
"<可执行文件路径>" ["<项目路径>"] --toggle
```

## 已知限制

以下功能需要全局输入钩子或输入注入协议，GNOME Wayland 均不提供，属于平台限制：

- 双击修饰键呼出、超级面板鼠标按键触发（需要全局键盘/鼠标钩子）
- 自动粘贴到上一个应用（需要 `zwp_virtual_keyboard_v1` 类协议，可选方案是外部 `ydotool`）
- 读取选中文本（无可用的辅助功能 API）

此外：

- 剪贴板只轮询 `readText()`，图片与文件的捕获尚未实现
- `skipTaskbar` 是 macOS/Windows-only，窗口会出现在任务栏与 Alt-Tab 中
- 开机自启开关依赖 `app.setLoginItemSettings`，Linux 需改为写 XDG autostart

## 调试

```bash
ZTOOLS_NATIVE_WAYLAND=1 pnpm dev     # 强制原生 Wayland（定位与快捷键降级）
gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings
```

日志中 `[Bootstrap]` 会说明是否重新 exec，快捷键注册结果也会明确打印。
