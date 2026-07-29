import './core/appData/configureAppDataRoot'
import { platform } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, session, webContents } from 'electron'
import log from 'electron-log'
import path from 'path'
import lmdbInstance from './core/lmdb/lmdbInstance'
import api from './api/index'
import appsAPI from './api/renderer/commands'
import pluginsAPI from './api/renderer/plugins'
import appWatcher from './appWatcher'
import activityHeartbeatService from './core/activity/heartbeatService'
import {
  ensureMacAccessibilityPermission,
  focusAccessibilityPermissionWindow,
  isAccessibilityPermissionWindowActive
} from './core/accessibilityPermissionGate'
import {
  handleFirstRunStorageImport,
  isLegacyImportWindowActive
} from './core/firstRunStorageImport'
import floatingBallManager from './core/floatingBallManager'
import httpServer from './core/httpServer'
import mcpServer from './core/mcpServer'
import { registerIconProtocolForSession, registerIconScheme } from './core/iconProtocol'
import { getLogsPath } from './core/appData/appDataPaths'
import { loadInternalPlugins } from './core/internalPluginLoader'
import pluginManager from './managers/pluginManager'
import windowManager from './managers/windowManager'

// 待打开的 .zpx 文件路径（在 app.ready 之前收到的文件打开事件）
let pendingZpxFile: string | null = null
let applicationInitialized = false

// macOS 在 ready 事件前隐藏 Dock 图标，避免应用启动期间短暂显示。
if (platform.isMacOS) {
  app.dock?.hide()
}

app.on('second-instance', (_event, argv) => {
  // Windows: 检查命令行参数中是否有 .zpx 文件路径
  const zpxPath = argv.find((arg) => arg.endsWith('.zpx'))
  if (zpxPath) {
    console.log('[Main] 第二实例传入 ZPX 文件:', zpxPath)
    if (applicationInitialized) {
      windowManager.openPluginInstaller(zpxPath)
    } else {
      pendingZpxFile = zpxPath
    }
  }

  if (focusAccessibilityPermissionWindow()) return

  // 当运行第二个实例时，焦点聚焦到这个实例
  if (applicationInitialized) windowManager.showWindow()
})

// macOS: 监听文件打开事件（双击 .zpx 文件或拖拽到 Dock 图标）
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (!filePath.endsWith('.zpx')) return

  console.log('[Main] 收到 open-file 事件:', filePath)

  if (applicationInitialized) {
    // 应用已就绪，直接打开安装页面
    windowManager.openPluginInstaller(filePath)
  } else {
    // 应用还未就绪，暂存路径等 ready 后处理
    pendingZpxFile = filePath
  }
})

// ========== 注册自定义协议为特权协议（必须在 app.ready 之前调用）==========
registerIconScheme()

// ========== GPU 加速控制（必须在 app.ready 之前）==========
// app.disableHardwareAcceleration() 只能在 app ready 之前生效，所以需要提前直接读数据库
try {
  const settingsDoc = lmdbInstance.get('ZTOOLS/settings-general')
  if (settingsDoc?.data?.disableGpuAcceleration === true) {
    app.disableHardwareAcceleration()
    console.log('[Main] 已禁用 GPU 硬件加速（用户设置）')
  }
} catch {
  // 读取失败时忽略，保持默认行为（GPU 加速开启）
}

// 配置 electron-log
log.transports.file.level = 'debug'
log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB
log.transports.file.resolvePathFn = () => {
  return path.join(getLogsPath(), 'main.log')
}
log.transports.console.level = 'debug'

// 生产环境接管 console
// if (process.env.NODE_ENV === 'production') {
Object.assign(console, log.functions)
// }

// 安装日志收集器 hook（用于设置插件的调试控制台）
import logCollector from './core/logCollector.js'
logCollector.install()

// 开发模式下禁用某些警告
if (process.env.NODE_ENV !== 'production') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

// 添加 Chromium 命令行开关，禁用跨域限制
// app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
// app.commandLine.appendSwitch('disable-site-isolation-trials')
// app.commandLine.appendSwitch('disable-web-security')

// 导出函数供 API 使用
/**
 * 更新主窗口使用的全局唤起快捷键。
 */
export function updateShortcut(shortcut: string): boolean {
  return windowManager.registerShortcut(shortcut)
}

/**
 * 读取当前已经生效的全局唤起快捷键。
 */
export function getCurrentShortcut(): string {
  return windowManager.getCurrentShortcut()
}

app.whenReady().then(async () => {
  // 启动时仅处理一次：关闭静默启动则在渲染就绪后显示主窗口（需在创建窗口前注册，避免竞态）
  ipcMain.once('renderer-ready', () => {
    try {
      const settingsDoc = lmdbInstance.get('ZTOOLS/settings-general')
      const silentStart = settingsDoc?.data?.silentStart ?? true
      if (!silentStart) {
        windowManager.showWindow()
        console.log('[Main] 静默启动已关闭，渲染进程就绪后自动显示搜索窗口')
      }
    } catch {
      console.log('[Main] 读取静默启动设置失败，按默认行为启动')
    }
  })

  // macOS 辅助功能权限检查和请求（如果未授权则弹窗提示）
  await ensureMacAccessibilityPermission()

  // 处理首次运行时的旧数据导入（如果存在旧数据）
  await handleFirstRunStorageImport()

  // 注册自定义图标协议到默认 session (ztools-icon://)
  registerIconProtocolForSession(session.defaultSession)

  // ✅ 首先加载内置插件
  loadInternalPlugins()

  // 创建主窗口
  const mainWindow = windowManager.createWindow()

  // 初始化 API 和插件管理器
  if (mainWindow) {
    api.init(mainWindow, pluginManager)
    pluginManager.init(mainWindow)
    // 首次应用列表准备完成后再初始化应用目录监听器，避免启动时与应用扫描抢占磁盘 I/O
    appsAPI.setAfterFirstAppsReadyCallback(() => {
      appWatcher.init(mainWindow)
    })
    activityHeartbeatService.start()
  }

  // 注册全局快捷键
  windowManager.registerShortcut()

  // 初始化悬浮球（从配置决定是否显示）
  await floatingBallManager.init()

  // 自动启动已配置的"跟随主程序同时启动运行"的插件
  if (mainWindow) {
    try {
      const autoStartPlugins = api.dbGet('auto-start-plugin')
      const disabledPlugins = pluginsAPI.getDisabledPluginSet()
      if (autoStartPlugins && Array.isArray(autoStartPlugins) && autoStartPlugins.length > 0) {
        console.log('[Main] 开始处理自动启动插件:', { count: autoStartPlugins.length })
        const plugins = api.dbGet('plugins')
        if (plugins && Array.isArray(plugins)) {
          for (const pluginName of autoStartPlugins) {
            if (typeof pluginName !== 'string') continue
            const plugin = plugins.find((p: any) => p?.name === pluginName)
            if (plugin?.path && !disabledPlugins.has(plugin.path)) {
              console.log('[Main] 自动启动插件:', { pluginName: plugin.name })
              pluginManager.preloadPlugin(plugin.path).catch((error) => {
                console.error('[Main] 自动启动插件失败:', plugin.name, error)
              })
            } else {
              console.warn('[Main] 自动启动插件已跳过，未找到对应变体:', pluginName)
            }
          }
        }
      }
    } catch (error) {
      console.error('[Main] 读取自动启动插件配置失败:', error)
    }
  }

  applicationInitialized = true

  // 处理文件关联打开：macOS pending 文件 / Windows 命令行参数
  const zpxFromArgs =
    pendingZpxFile || process.argv.find((arg) => arg.endsWith('.zpx') && !arg.startsWith('-'))
  if (zpxFromArgs) {
    pendingZpxFile = null
    // 等待窗口和插件系统完全初始化后再打开
    setTimeout(() => {
      console.log('[Main] 处理启动时的 ZPX 文件:', zpxFromArgs)
      windowManager.openPluginInstaller(zpxFromArgs)
    }, 1500)
  }
})

app.on('window-all-closed', () => {
  if (isLegacyImportWindowActive() || isAccessibilityPermissionWindowActive()) return

  if (!platform.isMacOS) {
    app.quit()
  }
})

app.on('will-quit', () => {
  windowManager.unregisterAllShortcuts()
  api.cleanup()
  // 停止应用目录监听
  appWatcher.stop()
  // 清理悬浮球
  floatingBallManager.cleanup()
  // 关闭 HTTP 服务器
  httpServer.stop()
  // 关闭 MCP 服务器
  mcpServer.stop()
  // 停止活动心跳
  activityHeartbeatService.stop()
})

app.on('before-quit', (event) => {
  // 检查是否是通过托盘菜单主动退出
  if (!windowManager.getQuitting()) {
    // 不是主动退出（如 Command+Q），阻止退出
    event.preventDefault()
    console.log('[Main] 阻止了 Command+Q 退出，请使用托盘菜单退出')
    const hasActivePlugin = pluginManager.getCurrentPluginPath() !== null
    // 仅在 killPlugin 内置快捷键启用时才隐藏窗口；
    // 禁用时意味着用户希望把 Cmd+Q 用作其他用途（如呼出快捷键），保持窗口可见
    // 插件模式下的 Cmd+Q 由 pluginManager 负责终止插件并返回搜索页，这里不再隐藏主窗口
    if (windowManager.isKillPluginShortcutEnabled() && !hasActivePlugin) {
      windowManager.hideWindow(false)
    }
  } else {
    // 主动退出时，同步销毁所有窗口
    console.log('[Main] 开始同步销毁所有窗口...')

    // 先清理悬浮球窗口（避免 close 事件干扰）
    floatingBallManager.cleanup()

    // 通过 Electron API 获取所有 webContents 并销毁（包括主窗口、分离窗口、插件视图）
    const allContents = webContents.getAllWebContents()
    console.log('[Main] 找到', allContents.length, '个 webContents')
    for (const contents of allContents) {
      if (!contents.isDestroyed()) {
        ;(contents as any).destroy()
      }
    }

    console.log('[Main] 所有窗口同步销毁完成')
  }
})

app.on('activate', () => {
  if (focusAccessibilityPermissionWindow()) return

  if (!applicationInitialized) return

  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createWindow()
  }
})

// 开发模式下监听 Ctrl+C 信号
if (process.env.NODE_ENV !== 'production') {
  process.on('SIGINT', () => {
    console.log('[Main] 收到 SIGINT 信号，退出应用')
    app.quit()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('[Main] 收到 SIGTERM 信号，退出应用')
    app.quit()
    process.exit(0)
  })
}
