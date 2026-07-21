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
import pluginLifecycleAPI from './plugin/lifecycle'
import { initPluginApiDispatcher } from './plugin/pluginApiDispatcher'
import pluginProvidersAPI from './plugin/providers'
import pluginRedirectAPI from './plugin/redirect'
import pluginScreenAPI from './plugin/screen'
import pluginShellAPI from './plugin/shell'
import pluginToastAPI from './plugin/toast'
import pluginToolsAPI from './plugin/tools'
import pluginUIAPI from './plugin/ui'
import pluginWindowAPI from './plugin/window'
import { setupImageAnalysisAPI } from './shared/imageAnalysis'
import {
  matchesFilesInput,
  matchesOverText,
  matchesRegexText,
  type FilesCmdLike,
  type OverCmdLike,
  type RegexCmdLike
} from '@shared/commandContextShared'
import zbrowserAPI from './plugin/zbrowser'
import pluginFFmpegAPI from './plugin/ffmpeg'

import httpServer from '../core/httpServer'
import mcpServer from '../core/mcpServer'
import providerManager from '../core/provider/providerManager'
import { runStartupDataMigrations } from '../core/startupDataMigrations'
import superPanelManager from '../core/superPanelManager'
import translationManager from '../core/translationManager'

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
   * 初始化所有API模块
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

    // 初始化插件 API 统一分发器（必须在插件 API 初始化之前）
    initPluginApiDispatcher()

    // 初始化插件API
    pluginToolsAPI.init(pluginManager)
    // Provider 管理器（翻译、OCR 等），需在插件 API 之后、消费方之前初始化
    providerManager.init(pluginManager)
    // 暴露给所有插件的 provider 消费入口（查询默认渠道 / 调用），依赖 providerManager 已就绪
    pluginProvidersAPI.init()
    pluginAiAPI.init(mainWindow, pluginManager)
    pluginLifecycleAPI.init(mainWindow, pluginManager)
    pluginUIAPI.init(mainWindow, pluginManager)
    // 注入主题信息变更钩子：当主题色/材质变更时通知所有插件视图
    windowManager.setOnThemeInfoChanged(() => {
      pluginUIAPI.broadcastThemeInfoToAllPlugins()
    })
    pluginClipboardAPI.init()
    pluginDeviceAPI.init()
    pluginDialogAPI.init(mainWindow)
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

    // 初始化软件更新API
    updaterAPI.init(mainWindow)

    // 初始化 HTTP 服务
    httpServer.init().catch((error) => {
      console.error('[API] HTTP 服务初始化失败:', error)
    })
    // 初始化 MCP 服务
    mcpServer.init().catch((error) => {
      console.error('[API] MCP 服务初始化失败:', error)
    })

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
          const result = await this.pluginManager.openPluginDevTools()
          if (result) {
            return { success: true }
          } else {
            return { success: false, error: '没有活动的插件' }
          }
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
    settingsAPI.cleanup()
  }

  /**
   * 设置启动参数（用于插件进入时传递参数）
   */
  public setLaunchParam(param: any): void {
    pluginLifecycleAPI.setLaunchParam(param)
  }

  /**
   * 获取启动参数
   */
  public getLaunchParam(): any {
    return appsAPI.getLaunchParam()
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
   * 归一化快捷键目标字符串，兼容历史上带空格的“插件 / 指令”格式。
   */
  private parseShortcutTarget(target: string): string[] {
    return target
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
  }

  /**
   * 预解析全局快捷键目标，判断启动前是否需要采集选中文本。
   * 仅文本类插件命令会触发复制取词，避免无关快捷键产生副作用。
   */
  public async prepareGlobalShortcut(target: string): Promise<GlobalShortcutPreparation> {
    try {
      const parts = this.parseShortcutTarget(target)
      const plugins: any = databaseAPI.dbGet('plugins')
      const disabledPlugins = pluginsAPI.getDisabledPluginSet()
      const pluginList = Array.isArray(plugins)
        ? plugins.filter((plugin: any) => !disabledPlugins.has(plugin.path))
        : []

      if (parts.length === 2) {
        const [pluginDescription, cmdName] = parts
        const plugin = pluginList.find(
          (p: any) => p.name === pluginDescription || p.title === pluginDescription
        )
        if (!plugin) {
          return { target, shouldCaptureSelectedText: false }
        }

        const result = await this.findCommandInPlugin(plugin, cmdName)
        return {
          target,
          shouldCaptureSelectedText: this.shouldCaptureSelectedTextForCmdType(result?.cmdType)
        }
      }

      if (parts.length !== 1) {
        return { target, shouldCaptureSelectedText: false }
      }

      const pluginMatches: Array<{ cmdType: string; plugin: any; feature: any }> = []
      for (const plugin of pluginList) {
        const result = await this.findCommandInPlugin(plugin, target)
        if (result) {
          pluginMatches.push({ cmdType: result.cmdType, plugin, feature: result.feature })
        }
      }

      return {
        target,
        shouldCaptureSelectedText:
          pluginMatches.length === 1 &&
          this.shouldCaptureSelectedTextForCmdType(pluginMatches[0].cmdType)
      }
    } catch {
      return { target, shouldCaptureSelectedText: false }
    }
  }

  private shouldCaptureSelectedTextForCmdType(cmdType?: string): boolean {
    return cmdType === 'text' || cmdType === 'over' || cmdType === 'regex'
  }

  /**
   * 获取快捷键上下文中的有效文本输入。
   */
  private getShortcutTextInput(context?: ShortcutLaunchContext): string {
    return context?.pastedText ?? context?.searchQuery ?? ''
  }

  /**
   * 判断当前快捷键上下文是否包含可用于细粒度匹配的输入。
   */
  private hasContextualShortcutInput(context?: ShortcutLaunchContext): boolean {
    if (!context) {
      return false
    }

    if (context.pastedImage) {
      return true
    }

    if (Array.isArray(context.pastedFiles) && context.pastedFiles.length > 0) {
      return true
    }

    return this.getShortcutTextInput(context).trim().length > 0
  }

  /**
   * 判断文本类匹配指令是否满足当前快捷键上下文。
   */
  private matchesTextCommandContext(cmd: any, text: string): boolean {
    if (cmd?.type === 'regex') {
      return matchesRegexText(text, cmd as RegexCmdLike, { preserveFlags: true })
    }

    if (cmd?.type === 'over') {
      return matchesOverText(text, cmd as OverCmdLike, {
        useExclude: true,
        preserveExcludeFlags: true,
        allowPlainExclude: true
      })
    }

    return false
  }

  /**
   * 判断文件类匹配指令是否满足当前快捷键上下文。
   */
  private matchesFilesCommandContext(cmd: any, files: ShortcutInputFile[]): boolean {
    return matchesFilesInput(files, cmd as FilesCmdLike, {
      preserveFlags: true,
      allowPlainString: true
    })
  }

  /**
   * 计算候选命令在当前快捷键上下文下的优先级。
   */
  private getCommandContextPriority(
    cmd: any,
    cmdType: string,
    context?: ShortcutLaunchContext
  ): number {
    if (!this.hasContextualShortcutInput(context)) {
      return 0
    }

    if (cmdType === 'files') {
      return this.matchesFilesCommandContext(cmd, context?.pastedFiles || []) ? 500 : -1
    }

    if (cmdType === 'img') {
      return context?.pastedImage ? 450 : -1
    }

    const textInput = this.getShortcutTextInput(context)
    if (cmdType === 'regex') {
      return this.matchesTextCommandContext(cmd, textInput) ? 400 : -1
    }

    if (cmdType === 'over') {
      return this.matchesTextCommandContext(cmd, textInput) ? 350 : -1
    }

    return 0
  }

  /**
   * 在指定插件中查找匹配的命令
   */
  private async findCommandInPlugin(
    plugin: any,
    cmdName: string,
    context?: ShortcutLaunchContext
  ): Promise<{ feature: any; cmdLabel: string; cmdType: string } | null> {
    const dynamicFeatures = pluginFeatureAPI.loadDynamicFeatures(plugin.name)
    const allFeatures = [...(plugin.features || []), ...dynamicFeatures]
    const matches: Array<{ feature: any; cmdLabel: string; cmdType: string; cmd: any }> = []

    for (const feature of allFeatures) {
      if (feature.cmds && Array.isArray(feature.cmds)) {
        for (const cmd of feature.cmds) {
          if (typeof cmd === 'string') {
            if (cmd === cmdName) {
              matches.push({ feature, cmdLabel: cmd, cmdType: 'text', cmd })
            }
            continue
          }

          if (typeof cmd === 'object' && cmd?.label === cmdName) {
            matches.push({ feature, cmdLabel: cmd.label, cmdType: cmd.type || 'text', cmd })
          }
        }
      }
    }

    if (matches.length === 0) {
      return null
    }

    if (!this.hasContextualShortcutInput(context)) {
      const [firstMatch] = matches
      return {
        feature: firstMatch.feature,
        cmdLabel: firstMatch.cmdLabel,
        cmdType: firstMatch.cmdType
      }
    }

    const prioritizedMatch = matches
      .map((match, index) => ({
        ...match,
        index,
        priority: this.getCommandContextPriority(match.cmd, match.cmdType, context)
      }))
      .sort((a, b) => b.priority - a.priority || a.index - b.index)[0]

    const selectedMatch = prioritizedMatch.priority > 0 ? prioritizedMatch : matches[0]
    return {
      feature: selectedMatch.feature,
      cmdLabel: selectedMatch.cmdLabel,
      cmdType: selectedMatch.cmdType
    }
  }

  /**
   * 启动匹配到的插件命令
   */
  private async launchMatchedPlugin(
    plugin: any,
    feature: any,
    cmdLabel: string,
    cmdType: string,
    context?: ShortcutLaunchContext
  ): Promise<void> {
    const launchOptions = {
      path: plugin.path,
      type: 'plugin' as const,
      featureCode: feature.code,
      name: cmdLabel,
      cmdType,
      param: {
        ...this.buildShortcutLaunchParam(cmdType, context),
        code: feature.code
      }
    }
    console.log(`[API] 启动插件:`, launchOptions)

    await appsAPI.launch(launchOptions)
  }

  /**
   * 启动系统应用或系统设置（direct 类型指令）
   */
  private async launchDirectCommand(command: any, context?: ShortcutLaunchContext): Promise<void> {
    console.log('[API] 通过全局快捷键启动系统应用:', command.name, command.path)
    await appsAPI.launch({
      path: command.path,
      type: 'direct',
      name: command.name,
      cmdType: command.cmdType || 'text',
      param: this.buildShortcutLaunchParam(command.cmdType || 'text', context)
    })
  }

  /**
   * 处理全局快捷键触发（供 windowManager 调用）
   */
  public async handleGlobalShortcutTrigger(
    target: string,
    context?: ShortcutLaunchContext
  ): Promise<void> {
    return this.handleGlobalShortcut(target, context)
  }

  /**
   * 处理全局快捷键触发
   * 支持两种格式：
   *   - "插件名称/指令名称"（精确匹配指定插件）
   *   - "指令名称"（在所有插件和系统应用中搜索，若多个匹配则提示）
   */
  private async handleGlobalShortcut(
    target: string,
    context?: ShortcutLaunchContext
  ): Promise<void> {
    try {
      const plugins: any = databaseAPI.dbGet('plugins')
      const disabledPlugins = pluginsAPI.getDisabledPluginSet()
      const pluginList = Array.isArray(plugins)
        ? plugins.filter((plugin: any) => !disabledPlugins.has(plugin.path))
        : []

      const parts = this.parseShortcutTarget(target)

      if (parts.length === 2) {
        // 格式: 插件名称/指令名称
        const [pluginDescription, cmdName] = parts
        const plugin = pluginList.find(
          (p: any) => p.name === pluginDescription || p.title === pluginDescription
        )
        if (!plugin) {
          const msg = `[API] 未找到插件: ${pluginDescription}`
          console.error(msg)
          if (Notification.isSupported()) {
            new Notification({ title: 'ZTools', body: msg }).show()
          }
          return
        }

        const result = await this.findCommandInPlugin(plugin, cmdName, context)
        if (!result) {
          const msg = `[API] 未找到命令: ${pluginDescription}/${cmdName}`
          console.error(msg)
          if (Notification.isSupported()) {
            new Notification({ title: 'ZTools', body: msg }).show()
          }
          return
        }

        await this.launchMatchedPlugin(
          plugin,
          result.feature,
          result.cmdLabel,
          result.cmdType,
          context
        )
      } else {
        // 格式: 指令名称（在所有插件和系统应用中搜索）
        const cmdName = target
        const pluginMatches: { plugin: any; feature: any; cmdLabel: string; cmdType: string }[] = []

        for (const plugin of pluginList) {
          const result = await this.findCommandInPlugin(plugin, cmdName, context)
          if (result) {
            pluginMatches.push({
              plugin,
              feature: result.feature,
              cmdLabel: result.cmdLabel,
              cmdType: result.cmdType
            })
          }
        }

        // 同时查找系统应用（直接启动类型：应用、系统设置等）
        const directCommand = await appsAPI.findDirectCommandByName(cmdName)

        const totalMatches = pluginMatches.length + (directCommand ? 1 : 0)

        if (totalMatches === 0) {
          const msg = `[API] 未找到命令: ${cmdName}`
          console.error(msg)
          if (Notification.isSupported()) {
            new Notification({ title: 'ZTools', body: msg }).show()
          }
          return
        }

        if (totalMatches > 1) {
          const matchNames = pluginMatches.map((m) => m.plugin.title || m.plugin.name)
          if (directCommand) {
            matchNames.push(`系统应用「${directCommand.name}」`)
          }
          const msg = `[API] 多个指令匹配「${cmdName}」: ${matchNames.join('、')}，请使用「插件名称/${cmdName}」格式精确指定`
          console.warn(msg)
          if (Notification.isSupported()) {
            new Notification({ title: 'ZTools', body: msg }).show()
          }
          return
        }

        // 唯一匹配，直接启动
        if (pluginMatches.length === 1) {
          const { plugin, feature, cmdLabel, cmdType } = pluginMatches[0]
          await this.launchMatchedPlugin(plugin, feature, cmdLabel, cmdType, context)
        } else if (directCommand) {
          await this.launchDirectCommand(directCommand, context)
        }
      }
    } catch (error) {
      console.error('[API] 处理全局快捷键失败:', error)
    }
  }

  /**
   * 归一化来自渲染进程的快捷键启动上下文，保证 payload 构造逻辑可直接复用
   */
  private normalizeShortcutContext(context?: ShortcutLaunchContext): ShortcutLaunchContext {
    return {
      searchQuery: context?.searchQuery || '',
      pastedImage: context?.pastedImage || null,
      pastedFiles: context?.pastedFiles
        ? context.pastedFiles.map((file) => ({
            path: file.path,
            name: file.name,
            isDirectory: file.isDirectory,
            isFile: file.isFile ?? !file.isDirectory
          }))
        : null,
      pastedText: context?.pastedText || null
    }
  }

  /**
   * 按命令类型构造快捷键启动参数，使应用快捷键与搜索结果启动的入参模型一致
   */
  private buildShortcutLaunchParam(
    cmdType?: string,
    context?: ShortcutLaunchContext
  ): {
    payload: any
    type: string
    inputState: ShortcutLaunchContext
  } {
    const normalizedContext = this.normalizeShortcutContext(context)
    const normalizedCmdType = cmdType || 'text'
    let payload: any = normalizedContext.searchQuery

    if (normalizedCmdType === 'img' && normalizedContext.pastedImage) {
      payload = normalizedContext.pastedImage
    } else if (
      (normalizedCmdType === 'over' || normalizedCmdType === 'regex') &&
      normalizedContext.pastedText
    ) {
      payload = normalizedContext.pastedText
    } else if (normalizedCmdType === 'files' && normalizedContext.pastedFiles) {
      payload = normalizedContext.pastedFiles
    }

    return {
      payload,
      type: normalizedCmdType,
      inputState: normalizedContext
    }
  }
}

// 导出单例
export default new APIManager()
