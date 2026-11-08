import { BrowserWindow, ipcMain, Notification } from 'electron'
import type { PluginManager } from '../managers/pluginManager'

// 共享API（主程序和插件都能用）
import clipboardAPI from './shared/clipboard'
import databaseAPI from './shared/database'

import updaterAPI from './updater'

// 主程序渲染进程专用API
import aiModelsAPI from './renderer/aiModels'
import appsAPI from './renderer/commands'
import localShortcutsAPI from './renderer/localShortcuts'
import pluginsAPI from './renderer/plugins'
import settingsAPI from './renderer/settings'
import storageAPI from './renderer/storage'
import syncAPI from './renderer/sync'
import systemAPI from './renderer/system'
import { systemSettingsAPI } from './renderer/systemSettings'
import windowAPI from './renderer/window'

// 插件专用API
import clipboardManager from '../managers/clipboardManager' // paste API 需要暂停剪贴板监听
import windowManager from '../managers/windowManager' // paste/type API 需要隐藏主窗口
import pluginAiAPI from './plugin/ai'
import pluginClipboardAPI from './plugin/clipboard'
import pluginDeviceAPI from './plugin/device'
import pluginDialogAPI from './plugin/dialog'
import { pluginFeatureAPI } from './plugin/feature'
import pluginHttpAPI from './plugin/http'
import pluginInputAPI from './plugin/input'
import internalPluginAPI from './plugin/internal'
import pluginInternalApiPermissionsAPI from './plugin/internalApiPermissions'
import pluginLifecycleAPI from './plugin/lifecycle'
import { initPluginApiDispatcher } from './plugin/pluginApiDispatcher'
import pluginProvidersAPI from './plugin/providers'
import pluginRedirectAPI from './plugin/redirect'
import pluginScreenAPI from './plugin/screen'
import pluginShellAPI from './plugin/shell'
import pluginToastAPI from './plugin/toast'
import pluginToolsAPI from './plugin/tools'
import pluginUIAPI from './plugin/ui'
import pluginUserAPI from './plugin/user'
import pluginPaymentAPI from './plugin/payment'
import pluginWindowAPI from './plugin/window'
import { setupImageAnalysisAPI } from './shared/imageAnalysis'
import zbrowserAPI from './plugin/zbrowser'
import pluginFFmpegAPI from './plugin/ffmpeg'

import httpServer from '../core/httpServer'
import mcpServer from '../core/mcpServer'
import providerManager from '../core/provider/providerManager'
import { startProviderBridgeHost } from '../core/provider/providerBridgeHost'
import { runStartupDataMigrations } from '../core/startupDataMigrations'
import superPanelManager from '../core/superPanelManager'
import translationManager from '../core/translationManager'
import { initializeCommandService, getCommandService } from '../core/commands/runtime'
import { startScheduledTasks, stopScheduledTasks } from '../core/scheduledTasks/runtime'
import { COMMAND_ALIASES_KEY } from '../../shared/commandShared'
import { ENABLED_MAIN_PUSH_PLUGINS_KEY, normalizeConfigList } from '../../shared/pluginSettings'

/**
 * 快捷键触发时携带的文件输入
 */
interface ShortcutInputFile {
  path: string
  name: string
  isDirectory: boolean
  isFile?: boolean
}

/**
 * 快捷键触发启动链路时使用的输入上下文
 */
interface ShortcutLaunchContext {
  searchQuery: string
  pastedImage: string | null
  pastedFiles: ShortcutInputFile[] | null
  pastedText: string | null
}

export interface GlobalShortcutPreparation {
  target: string
  shouldCaptureSelectedText: boolean
}

/**
 * API管理器 - 统一初始化和管理所有API模块
 */
class APIManager {
  private pluginManager: PluginManager | null = null

  /**
   * 初始化 API、主进程指令服务和窗口适配器。
   * @param mainWindow 主搜索窗口
   * @param pluginManager 插件运行时
   * @returns 无返回值
   */
  public init(mainWindow: BrowserWindow, pluginManager: PluginManager): void {
    this.pluginManager = pluginManager

    // 初始化共享API
    databaseAPI.init(pluginManager)
    // 启动时统一迁移mac图标历史遗留数据
    runStartupDataMigrations()
    clipboardAPI.init()
    setupImageAnalysisAPI()

    // 初始化主程序API
    aiModelsAPI.init()
    appsAPI.init(mainWindow, pluginManager)
    appsAPI.setShowWindowCallback(() => windowManager.showWindow())
    pluginsAPI.init(mainWindow, pluginManager)
    pluginsAPI.setCommandsCacheInvalidator(() => appsAPI.invalidateCommandsCache(false))
    windowAPI.init(mainWindow)
    settingsAPI.init(mainWindow, pluginManager)
    storageAPI.init()
    systemAPI.init(mainWindow)
    systemSettingsAPI.init()
    syncAPI.init(mainWindow, pluginManager)
    localShortcutsAPI.init(mainWindow)
    localShortcutsAPI.setCommandsCacheInvalidator(() => appsAPI.invalidateCommandsCache(false))

    // 初始化插件 API 统一分发器（必须在插件 API 初始化之前）
    initPluginApiDispatcher()

    // 初始化插件API
    pluginToolsAPI.init(pluginManager)
    // Provider 管理器（翻译、OCR 等），需在插件 API 之后、消费方之前初始化
    providerManager.init(pluginManager)
    // 暴露给所有插件的 provider 消费入口（查询默认渠道 / 调用），依赖 providerManager 已就绪
    pluginProvidersAPI.init()
    // Provider 桥接宿主：原生层（截图翻译等）反向调用 ocr/translation provider
    startProviderBridgeHost()
    pluginAiAPI.init(mainWindow, pluginManager)
    pluginLifecycleAPI.init(mainWindow, pluginManager)
    pluginUIAPI.init(mainWindow, pluginManager)
    pluginUserAPI.init(pluginManager)
    pluginPaymentAPI.init(mainWindow, pluginManager)
    // 注入主题信息变更钩子：当主题色/材质变更时通知所有插件视图
    windowManager.setOnThemeInfoChanged(() => {
      pluginUIAPI.broadcastThemeInfoToAllPlugins()
    })
    pluginClipboardAPI.init()
    pluginDeviceAPI.init()
    pluginDialogAPI.init(mainWindow, pluginManager)
    pluginWindowAPI.init(mainWindow, pluginManager)
    pluginScreenAPI.init(mainWindow)
    // 初始化插件输入 API（需要 windowManager 和 clipboardManager 支持 paste/type 功能）
    pluginInputAPI.init(pluginManager, windowManager, clipboardManager)
    // 初始化插件 Shell API（需要 clipboardManager 获取当前窗口信息）
    pluginShellAPI.init(clipboardManager)
    pluginRedirectAPI.init(mainWindow, pluginManager)
    pluginFeatureAPI.init(pluginManager)
    pluginFeatureAPI.setCommandsCacheInvalidator(() => appsAPI.invalidateCommandsCache(false))
    pluginHttpAPI.init(pluginManager)
    pluginToastAPI.init(pluginManager)
    pluginFFmpegAPI.init()

    // 初始化 zbrowser 浏览器自动化 API
    zbrowserAPI.init(mainWindow, pluginManager)

    // 初始化内置插件专用API
    internalPluginAPI.init(mainWindow, pluginManager)

    // 初始化插件高级 API 权限管理（申请 / 审批 / 按通道授权）
    pluginInternalApiPermissionsAPI.init(mainWindow, pluginManager)

    // 初始化软件更新API
    updaterAPI.init(mainWindow)

    // 初始化 HTTP 服务，并复用应用内插件启动入口处理外部插件启动请求。
    httpServer.setPluginLauncher((options) => this.launchPlugin(options))
    httpServer.init().catch((error) => {
      console.error('[API] HTTP 服务初始化失败:', error)
    })
    // 初始化 MCP 服务
    mcpServer.init().catch((error) => {
      console.error('[API] MCP 服务初始化失败:', error)
    })

    // 统一目录由主进程采集，名称索引及第三方正则在隔离 Worker 中执行。
    const commandService = initializeCommandService(
      {
        sources: async () => ({
          apps:
            databaseAPI.dbGet('settings-general')?.localAppSearch === false
              ? databaseAPI.dbGet('cached-commands') || []
              : await appsAPI.getApps(),
          localAppSearchEnabled: databaseAPI.dbGet('settings-general')?.localAppSearch !== false,
          plugins: await pluginsAPI.getAllPlugins(),
          settings: await systemSettingsAPI.getSystemSettings(),
          localShortcuts: databaseAPI.dbGet('local-shortcuts') || [],
          aliases: databaseAPI.dbGet(COMMAND_ALIASES_KEY) || {},
          disabledPlugins: normalizeConfigList(databaseAPI.dbGet('disabled-plugins')),
          disabledCommands: normalizeConfigList(databaseAPI.dbGet('disable-commands')),
          enabledMainPushPlugins: normalizeConfigList(
            databaseAPI.dbGet(ENABLED_MAIN_PUSH_PLUGINS_KEY)
          )
        }),
        read: (key) => databaseAPI.dbGet(key),
        write: (key, value) => {
          const result = databaseAPI.dbPut(key, value)
          // 存储 API 以结果对象报告失败，转换为服务可回滚的错误。
          if (!result?.ok) throw new Error(result?.message || result?.error || '指令状态保存失败')
        },
        launch: (options) => appsAPI.launch(options),
        queryMainPush: (path, code, data) => pluginManager.queryMainPush(path, code, data),
        selectMainPush: (path, code, data) => pluginManager.selectMainPush(path, code, data)
      },
      mainWindow.webContents
    )
    appsAPI.setCatalogProvider(
      () => commandService.getCatalog(),
      () => commandService.invalidate()
    )

    // 初始化超级面板管理器
    superPanelManager.init(mainWindow)

    // 初始化翻译管理器
    translationManager.init()

    // 将内置 Bergamot 翻译引擎注册为 translation 类型 provider
    providerManager.registerBuiltinProvider({
      name: 'bergamot',
      type: 'translation',
      label: '离线翻译引擎（Bergamot）',
      description: '英译中离线引擎，首次启用需下载约 55MB 模型',
      isReady: () => translationManager.getStatus().status === 'ready',
      invoke: async (input) => {
        const { text, from } = input as { text: string; from?: string; to?: string }
        // 当前内置引擎仅支持 en→zh，忽略 from/to 参数
        const result = await translationManager.translate(text)
        return { text: result || '', detectedFrom: from }
      }
    })

    // 设置一些特殊的IPC处理器
    this.setupSpecialHandlers()

    // 设置全局快捷键处理器（需要访问多个模块）
    settingsAPI.setGlobalShortcutHandler((target, context) =>
      this.handleGlobalShortcut(target, context)
    )

    // 定时任务在主进程调度，依赖上面已初始化的指令服务。
    startScheduledTasks(pluginManager)
  }

  /**
   * 设置特殊的IPC处理器
   * 这些处理器需要协调多个模块，所以放在这里统一管理
   */
  private setupSpecialHandlers(): void {
    // 系统设置 API
    ipcMain.handle('get-system-settings', () => systemSettingsAPI.getSystemSettings())
    ipcMain.handle('is-windows', () => systemSettingsAPI.isWindows())

    // 打开插件开发者工具
    ipcMain.handle('open-plugin-devtools', async () => {
      try {
        if (this.pluginManager) {
          return await this.pluginManager.openPluginDevTools()
        }
        return { success: false, error: '功能不可用' }
      } catch (error: unknown) {
        console.error('[API] 打开开发者工具失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 分离当前插件到独立窗口
    ipcMain.handle('detach-plugin', async () => {
      try {
        if (this.pluginManager) {
          const result = await this.pluginManager.detachCurrentPlugin()
          return result
        }
        return { success: false, error: '功能不可用' }
      } catch (error: unknown) {
        console.error('[API] 分离插件失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })
  }

  /**
   * 清理 API 管理器持有的运行时资源。
   */
  public cleanup(): void {
    stopScheduledTasks()
    settingsAPI.cleanup()
  }

  /**
   * 获取目标插件的进入参数快照。
   * @param pluginPath 目标插件路径
   * @returns 参数副本
   */
  public getLaunchParam(pluginPath?: string): any {
    return appsAPI.getLaunchParam(pluginPath)
  }

  /**
   * 数据库辅助方法（供其他模块使用）
   */
  public dbPut(key: string, data: any): any {
    return databaseAPI.dbPut(key, data)
  }

  public dbGet(key: string): any {
    return databaseAPI.dbGet(key)
  }

  public dbRemove(key: string): any {
    return databaseAPI.dbRemove(key)
  }

  /**
   * 启动插件（供其他模块使用）
   */
  public async launchPlugin(options: {
    path: string
    type?: 'direct' | 'plugin'
    featureCode?: string
    param?: any
    name?: string
    cmdType?: string
  }): Promise<any> {
    return await appsAPI.launch(options)
  }

  /**
   * 调整窗口高度（供 pluginManager 使用）
   */
  public resizeWindow(height: number): void {
    windowAPI.resizeWindow(height)
  }

  /**
   * 使用统一目录预解析是否需要复制取词。
   * @param target 快捷键配置名称
   * @returns 选中文本采集策略
   */
  public async prepareGlobalShortcut(target: string): Promise<GlobalShortcutPreparation> {
    const candidates = await getCommandService().getTargetCandidates(target)
    const unique = new Set(candidates.map((command) => command.targetId))
    return {
      target,
      shouldCaptureSelectedText:
        unique.size === 1 &&
        candidates.some(
          (command) =>
            command.type === 'plugin' &&
            ['text', 'over', 'regex'].includes(command.cmdType || 'text')
        )
    }
  }

  /**
   * 将外部快捷键触发交给统一服务。
   * @param target 快捷键配置名称
   * @param context 捕获的输入状态
   * @returns 操作结束的 Promise
   */
  public async handleGlobalShortcutTrigger(
    target: string,
    context?: ShortcutLaunchContext
  ): Promise<void> {
    await this.handleGlobalShortcut(target, context)
  }

  /**
   * 在主进程统一解析、校验并执行快捷键目标。
   * @param target 快捷键配置名称
   * @param context 不可变输入快照
   * @returns 操作结束的 Promise
   */
  private async handleGlobalShortcut(
    target: string,
    context?: ShortcutLaunchContext
  ): Promise<void> {
    const result = await getCommandService().execute('global-shortcut', {
      target,
      context,
      source: 'global-shortcut'
    })
    if (!result.success && Notification.isSupported())
      new Notification({ title: 'ZTools', body: result.error || '快捷键启动失败' }).show()
  }
}

// 导出单例
export default new APIManager()
