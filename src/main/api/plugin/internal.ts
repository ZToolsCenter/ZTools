import { app, dialog, IpcMainInvokeEvent, ipcMain } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import windowManager from '../../managers/windowManager.js'
import dndManager from '../../core/dndManager.js'
import logCollector from '../../core/logCollector.js'
import { NativeLogger } from '../../core/native/index.js'
import clipboardManager from '../../managers/clipboardManager.js'
import detachedWindowManager from '../../core/detachedWindowManager.js'
import floatingBallManager from '../../core/floatingBallManager.js'
import httpServer from '../../core/httpServer.js'
import mcpServer from '../../core/mcpServer.js'
import superPanelManager from '../../core/superPanelManager.js'
import translationManager from '../../core/translationManager.js'
import providerManager from '../../core/provider/providerManager.js'
import aiModelsAPI from '../renderer/aiModels.js'
import commandsAPI from '../renderer/commands.js'
import pluginsAPI from '../renderer/plugins.js'
import type { DeletePluginOptions } from '../renderer/plugins'
import { promises as fs } from 'fs'
import settingsAPI from '../renderer/settings.js'
import systemAPI from '../renderer/system.js'
import windowAPI from '../renderer/window.js'
import pluginToolsAPI from './tools'
import databaseAPI from '../shared/database'
import { analyzeImage } from '../shared/imageAnalysis'
import updaterAPI from '../updater.js'
import notificationsAPI from '../renderer/notifications.js'
import {
  COMMAND_ALIASES_KEY,
  normalizeCommandAliases,
  type CommandAliasStore
} from '@shared/commandShared'
import { normalizeSearchWallpaperConfig, type SearchWallpaperConfig } from '@shared/searchWallpaper'
import { registerInternalApiChannel } from '../../core/internalPlugins'
import { getScheduledTaskService } from '../../core/scheduledTasks/runtime'
import type { ScheduledTaskDraft } from '@shared/scheduledTasks'

/**
 * 权限错误类
 */
export class PermissionDeniedError extends Error {
  constructor(apiName: string) {
    super(`API "${apiName}" 仅限内置插件调用`)
    this.name = 'PermissionDeniedError'
  }
}

/**
 * 检查调用方是否有权访问 internal API
 * @param pluginManager 插件管理器实例
 * @param event IPC 事件对象
 * @param apiName 可选的通道名；提供时按通道粒度判定（完全授权或该通道被单独授权均放行），
 *                缺省时退化为仅完全授权（内置名单 / 手动名单）可调用
 * @returns 是否允许调用（授权插件或主渲染进程）
 */
export function requireInternalPlugin(
  pluginManager: PluginManager | null,
  event: IpcMainInvokeEvent,
  apiName?: string
): boolean {
  if (!pluginManager) return true // 没有 pluginManager，允许通过
  const pluginInfo = pluginManager.getPluginInfoByWebContents(event.sender)

  if (!pluginInfo) {
    // 不是插件调用（可能是主渲染进程），允许通过
    return true
  }

  // 完全授权（内置插件或手动录入名单）放行所有通道
  if (pluginInfo.canUseInternalApi) return true

  // 未指定通道名时保持既有语义：仅完全授权可调用
  if (apiName === undefined) return false

  // 按通道授权：仅放行名单中登记的 API
  return pluginInfo.internalApiPermissions.includes(apiName)
}

/**
 * 内置插件专用 API 类
 * 提供与主渲染进程相同的 API，但仅限内置插件调用
 * 采用转发策略：将内置插件的 API 调用转发到已有的 renderer API
 */
export class InternalPluginAPI {
  /** 当前用于鉴权和插件查询的插件管理器。 */
  private pluginManager: PluginManager | null = null
  /** 当前主窗口实例，供部分内部能力复用。 */
  private mainWindow: Electron.BrowserWindow | null = null

  /**
   * 初始化内置插件专用 API，并注册对应的 IPC 通道。
   */
  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  /**
   * 注册 internal IPC 通道并登记到通道注册表。
   * 统一经注册表登记后，插件申请与设置页展示才能引用真实存在的通道名。
   * @param channel 通道名（internal: 前缀）
   * @param handler 通道处理函数
   * @returns 无返回值
   */
  private handleInternal(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: any[]) => any
  ): void {
    registerInternalApiChannel(channel)
    ipcMain.handle(channel, handler)
  }

  /**
   * 校验调用方是否有权访问指定 internal 通道，无权时抛出权限错误。
   * @param event IPC 事件对象
   * @param apiName 通道名
   * @returns 无返回值
   * @throws 调用方未获授权时抛出 PermissionDeniedError
   */
  private requireApi(event: IpcMainInvokeEvent, apiName: string): void {
    if (!requireInternalPlugin(this.pluginManager, event, apiName)) {
      throw new PermissionDeniedError(apiName)
    }
  }

  /**
   * 注册仅允许内置插件访问的 IPC 能力。
   * @returns 无返回值
   */
  private setupIPC(): void {
    // ==================== 数据库 API (ZTOOLS/ 命名空间) ====================
    this.handleInternal('internal:db-put', (event, key: string, value: any) => {
      this.requireApi(event, 'internal:db-put')
      return databaseAPI.dbPut(key, value)
    })

    this.handleInternal('internal:db-get', (event, key: string) => {
      this.requireApi(event, 'internal:db-get')
      return databaseAPI.dbGet(key)
    })

    // ==================== 应用启动 API ====================
    this.handleInternal('internal:launch', async (event, options: any) => {
      this.requireApi(event, 'internal:launch')
      console.log('[Internal] 启动应用', options)
      return await commandsAPI.launch(options)
    })

    this.handleInternal('internal:quit-app', async (event) => {
      this.requireApi(event, 'internal:quit-app')
      // 与托盘「退出」一致：设置退出标志后再 quit，否则 before-quit 会阻止并只隐藏窗口
      windowManager.setQuitting(true)
      app.quit()
      return { success: true }
    })

    // ==================== 指令管理 API ====================
    this.handleInternal('internal:get-commands', async (event) => {
      this.requireApi(event, 'internal:get-commands')

      // 设置页使用这份 canonical commands 构建 alias 目标列表，不在这里展开 alias 搜索字段。
      // 强制刷新缓存，确保获取最新的指令列表（包括本地启动项）
      console.log('[Internal] 收到获取指令列表请求（设置页 alias 目标），强制刷新缓存')
      commandsAPI.invalidateCommandsCache(false)
      const result = await commandsAPI.getCommands()
      console.log('[Internal] 返回指令列表摘要:', {
        commands: result.commands?.length || 0,
        regexCommands: result.regexCommands?.length || 0,
        plugins: result.plugins?.length || 0
      })
      return result
    })

    this.handleInternal(
      'internal:update-command-aliases',
      async (event, aliases: CommandAliasStore) => {
        this.requireApi(event, 'internal:update-command-aliases')

        const inputCommandCount = Object.keys(aliases || {}).length
        const inputAliasCount = Object.values(aliases || {}).reduce(
          (count, entries) => count + (Array.isArray(entries) ? entries.length : 0),
          0
        )
        console.log('[Internal] 收到更新指令别名请求:', {
          commandCount: inputCommandCount,
          aliasCount: inputAliasCount
        })

        // alias 保存链路：归一化 -> 持久化 -> 通知主窗口按当前缓存重建 alias 搜索索引。
        const normalizedAliases = normalizeCommandAliases(aliases)
        const normalizedCommandCount = Object.keys(normalizedAliases).length
        const normalizedAliasEntries = Object.values(normalizedAliases).flat()
        console.log('[Internal] 指令别名归一化完成:', {
          commandCount: normalizedCommandCount,
          aliasCount: normalizedAliasEntries.length,
          aliasWithIconCount: normalizedAliasEntries.filter((entry) => Boolean(entry.icon)).length
        })

        try {
          const saveResult = databaseAPI.dbPut(COMMAND_ALIASES_KEY, normalizedAliases)
          if (!saveResult?.ok) {
            console.error('[Internal] 指令别名写入数据库失败:', saveResult)
            throw new Error(saveResult?.message || '指令别名写入数据库失败')
          }

          console.log('[Internal] 指令别名已写入数据库:', {
            key: COMMAND_ALIASES_KEY,
            commandCount: normalizedCommandCount,
            aliasCount: normalizedAliasEntries.length
          })
          this.mainWindow?.webContents.send('command-aliases-changed')
          console.log('[Internal] 已通知主窗口按当前缓存刷新 alias 搜索索引')

          return { success: true }
        } catch (error) {
          console.error('[Internal] 更新指令别名失败:', error)
          throw error
        }
      }
    )

    // ==================== 插件管理 API ====================
    this.handleInternal('internal:get-plugins', async (event) => {
      this.requireApi(event, 'internal:get-plugins')
      return await pluginsAPI.getPlugins()
    })

    this.handleInternal('internal:get-disabled-plugins', async (event) => {
      this.requireApi(event, 'internal:get-disabled-plugins')
      return pluginsAPI.getDisabledPlugins()
    })

    this.handleInternal(
      'internal:set-plugin-disabled',
      async (event, pluginPath: string, disabled: boolean) => {
        this.requireApi(event, 'internal:set-plugin-disabled')
        return await pluginsAPI.setPluginDisabled(pluginPath, disabled)
      }
    )

    this.handleInternal('internal:get-all-plugins', async (event) => {
      this.requireApi(event, 'internal:get-all-plugins')
      return await pluginsAPI.getAllPlugins()
    })

    this.handleInternal(
      'internal:set-plugin-main-push-enabled',
      async (event, pluginName: string, enabled: boolean) => {
        this.requireApi(event, 'internal:set-plugin-main-push-enabled')
        return await pluginsAPI.setPluginMainPushEnabled(pluginName, enabled)
      }
    )

    this.handleInternal('internal:select-plugin-file', async (event) => {
      this.requireApi(event, 'internal:select-plugin-file')
      return await pluginsAPI.installer.selectPluginFile()
    })

    this.handleInternal('internal:import-plugin', async (event) => {
      this.requireApi(event, 'internal:import-plugin')
      return await pluginsAPI.installer.importPlugin()
    })

    this.handleInternal('internal:read-plugin-info-from-zpx', async (event, zpxPath: string) => {
      this.requireApi(event, 'internal:read-plugin-info-from-zpx')
      return await pluginsAPI.installer.readPluginInfoFromZpx(zpxPath)
    })

    this.handleInternal('internal:install-plugin-from-path', async (event, zpxPath: string) => {
      this.requireApi(event, 'internal:install-plugin-from-path')
      return await pluginsAPI.installer.installPluginFromPath(zpxPath)
    })

    this.handleInternal('internal:import-dev-plugin', async (event, pluginJsonPath?: string) => {
      this.requireApi(event, 'internal:import-dev-plugin')
      return await pluginsAPI.devProjects.importDevPlugin(pluginJsonPath)
    })

    this.handleInternal(
      'internal:update-dev-project-meta',
      async (
        event,
        projectName: string,
        meta: { title?: string; description?: string; platform?: string[]; author?: string }
      ) => {
        this.requireApi(event, 'internal:update-dev-project-meta')
        return await pluginsAPI.devProjects.updateDevProjectMeta(projectName, meta)
      }
    )

    this.handleInternal(
      'internal:upsert-dev-project-by-config-path',
      async (event, pluginJsonPath: string) => {
        this.requireApi(event, 'internal:upsert-dev-project-by-config-path')
        return await pluginsAPI.devProjects.upsertDevProjectByConfigPath(pluginJsonPath)
      }
    )

    this.handleInternal('internal:get-dev-projects', async (event) => {
      this.requireApi(event, 'internal:get-dev-projects')
      return await pluginsAPI.devProjects.getDevProjects()
    })

    this.handleInternal(
      'internal:update-dev-projects-order',
      async (event, pluginNames: string[]) => {
        this.requireApi(event, 'internal:update-dev-projects-order')
        return await pluginsAPI.devProjects.updateDevProjectsOrder(pluginNames)
      }
    )

    this.handleInternal('internal:remove-dev-project', async (event, pluginName: string) => {
      this.requireApi(event, 'internal:remove-dev-project')
      return await pluginsAPI.devProjects.removeDevProject(pluginName)
    })

    this.handleInternal('internal:install-dev-plugin', async (event, pluginName: string) => {
      this.requireApi(event, 'internal:install-dev-plugin')
      return await pluginsAPI.devProjects.installDevPlugin(pluginName)
    })

    this.handleInternal('internal:uninstall-dev-plugin', async (event, pluginName: string) => {
      this.requireApi(event, 'internal:uninstall-dev-plugin')
      return await pluginsAPI.devProjects.uninstallDevPlugin(pluginName)
    })

    this.handleInternal('internal:validate-dev-project', async (event, pluginName: string) => {
      this.requireApi(event, 'internal:validate-dev-project')
      return await pluginsAPI.devProjects.validateDevProject(pluginName)
    })

    this.handleInternal(
      'internal:select-dev-project-config',
      async (event, pluginName: string, configPath?: string) => {
        this.requireApi(event, 'internal:select-dev-project-config')
        return await pluginsAPI.devProjects.selectDevProjectConfig(pluginName, configPath)
      }
    )

    this.handleInternal(
      'internal:package-dev-project',
      async (
        event,
        pluginName: string,
        packagePath?: string,
        version?: string,
        outputMode?: 'save' | 'temporary'
      ) => {
        this.requireApi(event, 'internal:package-dev-project')
        return await pluginsAPI.devProjects.packageDevProject(
          pluginName,
          packagePath,
          version,
          outputMode
        )
      }
    )

    this.handleInternal(
      'internal:delete-plugin',
      async (event, pluginPath: string, options?: DeletePluginOptions) => {
        this.requireApi(event, 'internal:delete-plugin')
        return await pluginsAPI.deletePlugin(pluginPath, options)
      }
    )

    this.handleInternal('internal:get-running-plugins', async (event) => {
      this.requireApi(event, 'internal:get-running-plugins')
      return pluginsAPI.getRunningPlugins()
    })

    this.handleInternal('internal:kill-plugin', async (event, pluginPath: string) => {
      this.requireApi(event, 'internal:kill-plugin')
      return pluginsAPI.killPlugin(pluginPath)
    })

    this.handleInternal('internal:fetch-plugin-market', async (event) => {
      this.requireApi(event, 'internal:fetch-plugin-market')
      return await pluginsAPI.market.fetchPluginMarket()
    })

    this.handleInternal(
      'internal:fetch-plugin-market-recommendations',
      async (event, limit?: number) => {
        this.requireApi(event, 'internal:fetch-plugin-market-recommendations')
        return await pluginsAPI.market.fetchPluginMarketRecommendations(limit)
      }
    )

    this.handleInternal(
      'internal:fetch-plugin-market-comments',
      async (event, pluginName: string, page?: number, pageSize?: number, anchorId?: number) => {
        this.requireApi(event, 'internal:fetch-plugin-market-comments')
        return await pluginsAPI.market.fetchComments(pluginName, page, pageSize, anchorId)
      }
    )

    this.handleInternal(
      'internal:create-plugin-market-comment',
      async (event, input: { pluginName: string; content: string; parentId?: number | null }) => {
        this.requireApi(event, 'internal:create-plugin-market-comment')
        return await pluginsAPI.market.createComment(input)
      }
    )

    this.handleInternal(
      'internal:toggle-plugin-market-comment-like',
      async (event, commentId: number) => {
        this.requireApi(event, 'internal:toggle-plugin-market-comment-like')
        return await pluginsAPI.market.toggleCommentLike(commentId)
      }
    )

    this.handleInternal(
      'internal:delete-plugin-market-comment',
      async (event, commentId: number) => {
        this.requireApi(event, 'internal:delete-plugin-market-comment')
        return await pluginsAPI.market.deleteComment(commentId)
      }
    )

    this.handleInternal('internal:notification-summary', async (event) => {
      this.requireApi(event, 'internal:notification-summary')
      return await notificationsAPI.summary()
    })

    this.handleInternal(
      'internal:notification-list',
      async (event, beforeId?: number, limit?: number, unreadOnly?: boolean) => {
        this.requireApi(event, 'internal:notification-list')
        return await notificationsAPI.list(beforeId, limit, unreadOnly)
      }
    )

    this.handleInternal('internal:notification-mark-read', async (event, id: number) => {
      this.requireApi(event, 'internal:notification-mark-read')
      return await notificationsAPI.markRead(id)
    })

    this.handleInternal('internal:notification-mark-all-read', async (event) => {
      this.requireApi(event, 'internal:notification-mark-all-read')
      return await notificationsAPI.markAllRead()
    })

    this.handleInternal('internal:notification-archive', async (event, id: number) => {
      this.requireApi(event, 'internal:notification-archive')
      return await notificationsAPI.archive(id)
    })

    this.handleInternal('internal:install-plugin-from-market', async (event, plugin: any) => {
      this.requireApi(event, 'internal:install-plugin-from-market')
      return await pluginsAPI.installer.installPluginFromMarket(plugin, event.sender)
    })

    this.handleInternal(
      'internal:cancel-plugin-market-download',
      async (event, pluginNameOrTaskId: string) => {
        this.requireApi(event, 'internal:cancel-plugin-market-download')
        return pluginsAPI.installer.cancelPluginMarketDownload(pluginNameOrTaskId)
      }
    )

    this.handleInternal(
      'internal:install-plugin-from-npm',
      async (event, options: { packageName: string; useChinaMirror?: boolean }) => {
        this.requireApi(event, 'internal:install-plugin-from-npm')
        return await pluginsAPI.installer.installPluginFromNpm(
          options.packageName,
          options.useChinaMirror
        )
      }
    )

    this.handleInternal(
      'internal:get-plugin-readme',
      async (event, pluginPathOrName: string, pluginName?: string) => {
        this.requireApi(event, 'internal:get-plugin-readme')
        return await pluginsAPI.getPluginReadme(pluginPathOrName, pluginName)
      }
    )

    this.handleInternal(
      'internal:get-plugin-release-history',
      async (event, pluginName: string, offset?: number) => {
        this.requireApi(event, 'internal:get-plugin-release-history')
        return await pluginsAPI.market.fetchReleaseHistory(pluginName, offset)
      }
    )

    this.handleInternal('internal:get-plugin-doc-keys', async (event, pluginName: string) => {
      this.requireApi(event, 'internal:get-plugin-doc-keys')
      return await databaseAPI.getPluginDocKeys(pluginName)
    })

    this.handleInternal(
      'internal:get-plugin-doc',
      async (event, pluginName: string, docKey: string) => {
        this.requireApi(event, 'internal:get-plugin-doc')
        return await databaseAPI.getPluginDoc(pluginName, docKey)
      }
    )

    this.handleInternal(
      'internal:delete-plugin-doc',
      async (event, pluginName: string, docKey: string) => {
        this.requireApi(event, 'internal:delete-plugin-doc')
        return await databaseAPI.deletePluginDoc(pluginName, docKey)
      }
    )

    this.handleInternal(
      'internal:export-plugin-doc',
      async (event, pluginName: string, docKey: string) => {
        this.requireApi(event, 'internal:export-plugin-doc')

        const result = await databaseAPI.getPluginDoc(pluginName, docKey)
        if (!result.success) return result

        const targetWindow =
          detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow
        if (!targetWindow) {
          return { success: false, error: '未找到窗口' }
        }

        const safePluginName = pluginName.replace(/[\\/:*?"<>|]/g, '_')
        const safeDocKey = docKey.replace(/[\\/:*?"<>|]/g, '_')
        const saveResult = await windowManager.withBlurHideSuppressed(() =>
          dialog.showSaveDialog(targetWindow, {
            title: '导出文档',
            defaultPath: `${safePluginName}-${safeDocKey}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }]
          })
        )

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: false, canceled: true }
        }

        await fs.writeFile(saveResult.filePath, JSON.stringify(result.data, null, 2), 'utf-8')
        return { success: true, exportPath: saveResult.filePath }
      }
    )

    this.handleInternal('internal:get-plugin-data-stats', async (event) => {
      this.requireApi(event, 'internal:get-plugin-data-stats')
      return await databaseAPI.getPluginDataStats()
    })

    this.handleInternal('internal:clear-plugin-data', async (event, pluginName: string) => {
      this.requireApi(event, 'internal:clear-plugin-data')
      return await databaseAPI.clearPluginData(pluginName)
    })

    this.handleInternal('internal:export-all-plugins', async (event) => {
      this.requireApi(event, 'internal:export-all-plugins')
      return await pluginsAPI.installer.exportAllPlugins()
    })

    this.handleInternal('internal:get-plugin-memory-info', async (event, pluginPath: string) => {
      this.requireApi(event, 'internal:get-plugin-memory-info')
      try {
        const memoryInfo = await this.pluginManager?.getPluginMemoryInfo(pluginPath)
        return { success: true, data: memoryInfo }
      } catch (error: unknown) {
        console.error('[Internal API] 获取内存信息失败:', error)
        return { success: false, error: error instanceof Error ? error.message : '获取失败' }
      }
    })

    // ==================== AI 供应商管理 API ====================
    this.handleInternal('internal:ai-providers-get-all', async (event) => {
      this.requireApi(event, 'internal:ai-providers-get-all')
      try {
        const providers = aiModelsAPI.getAllProviders()
        return { success: true, data: providers }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    this.handleInternal('internal:ai-providers-get-official', async (event) => {
      this.requireApi(event, 'internal:ai-providers-get-official')
      try {
        return { success: true, data: await aiModelsAPI.getOfficialProvider() }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '获取官方模型失败'
        }
      }
    })

    this.handleInternal('internal:ai-providers-add', async (event, provider: any) => {
      this.requireApi(event, 'internal:ai-providers-add')
      return aiModelsAPI.addProvider(provider)
    })

    this.handleInternal(
      'internal:ai-providers-update',
      async (event, provider: any): Promise<any> => {
        this.requireApi(event, 'internal:ai-providers-update')
        return aiModelsAPI.updateProvider(provider)
      }
    )

    this.handleInternal('internal:ai-providers-delete', async (event, providerId: string) => {
      this.requireApi(event, 'internal:ai-providers-delete')
      return aiModelsAPI.deleteProvider(providerId)
    })

    this.handleInternal(
      'internal:ai-providers-set-enabled',
      async (event, providerId: string, enabled: boolean) => {
        this.requireApi(event, 'internal:ai-providers-set-enabled')
        return aiModelsAPI.setProviderEnabled(providerId, enabled)
      }
    )

    this.handleInternal(
      'internal:ai-providers-fetch-models',
      async (event, apiUrl: string, apiKey: string) => {
        this.requireApi(event, 'internal:ai-providers-fetch-models')
        try {
          const data = await aiModelsAPI.fetchModels(apiUrl, apiKey)
          return { success: true, data }
        } catch (error: unknown) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '获取模型列表失败'
          }
        }
      }
    )

    // ==================== Provider（翻译 / OCR 等）管理 API ====================
    this.handleInternal('internal:providers-get-all', async (event, type?: string) => {
      this.requireApi(event, 'internal:providers-get-all')
      try {
        const data = providerManager.getAllProviders(type as never)
        return { success: true, data }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    this.handleInternal('internal:providers-get-settings', async (event) => {
      this.requireApi(event, 'internal:providers-get-settings')
      try {
        return { success: true, data: providerManager.getSettings() }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    this.handleInternal(
      'internal:providers-set-enabled',
      async (event, providerId: string, enabled: boolean) => {
        this.requireApi(event, 'internal:providers-set-enabled')
        try {
          const data = providerManager.setEnabled(providerId, enabled)
          return { success: true, data }
        } catch (error: unknown) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '未知错误'
          }
        }
      }
    )

    this.handleInternal(
      'internal:providers-set-default',
      async (event, type: string, providerId: string) => {
        this.requireApi(event, 'internal:providers-set-default')
        try {
          const data = providerManager.setDefault(type as never, providerId)
          return { success: true, data }
        } catch (error: unknown) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '未知错误'
          }
        }
      }
    )

    this.handleInternal('internal:providers-get-params', async (event, providerId: string) => {
      this.requireApi(event, 'internal:providers-get-params')
      try {
        return { success: true, data: providerManager.getParams(providerId) }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    this.handleInternal(
      'internal:providers-set-params',
      async (event, providerId: string, params: Record<string, unknown>) => {
        this.requireApi(event, 'internal:providers-set-params')
        try {
          const data = providerManager.setParams(providerId, params)
          return { success: true, data }
        } catch (error: unknown) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '未知错误'
          }
        }
      }
    )

    // 超级面板翻译状态（供翻译 tab 展示内置 Bergamot 引擎状态）
    this.handleInternal('internal:providers-translation-status', async (event) => {
      this.requireApi(event, 'internal:providers-translation-status')
      return translationManager.getStatus()
    })

    this.handleInternal(
      'internal:providers-translation-set-enabled',
      async (event, enabled: boolean) => {
        this.requireApi(event, 'internal:providers-translation-set-enabled')
        translationManager.updateEnabled(enabled)
        return { success: true }
      }
    )

    // ==================== 全局快捷键 API ====================
    this.handleInternal(
      'internal:register-global-shortcut',
      async (
        event,
        shortcut: string,
        target: string,
        autoCopy?: boolean,
        preScreenshotOptimization?: boolean
      ) => {
        this.requireApi(event, 'internal:register-global-shortcut')
        return settingsAPI.registerGlobalShortcut(
          shortcut,
          target,
          autoCopy ?? false,
          preScreenshotOptimization ?? false
        )
      }
    )

    this.handleInternal('internal:unregister-global-shortcut', async (event, shortcut: string) => {
      this.requireApi(event, 'internal:unregister-global-shortcut')
      return settingsAPI.unregisterGlobalShortcut(shortcut)
    })

    this.handleInternal('internal:start-hotkey-recording', async (event) => {
      this.requireApi(event, 'internal:start-hotkey-recording')
      return await settingsAPI.startHotkeyRecording()
    })

    this.handleInternal('internal:get-current-shortcut', async (event) => {
      this.requireApi(event, 'internal:get-current-shortcut')
      return settingsAPI.getCurrentShortcutValue()
    })

    this.handleInternal('internal:update-shortcut', async (event, shortcut: string) => {
      this.requireApi(event, 'internal:update-shortcut')
      return await settingsAPI.updateShortcut(shortcut)
    })

    this.handleInternal(
      'internal:update-global-shortcut-config',
      async (
        event,
        shortcut: string,
        config: { autoCopy: boolean; preScreenshotOptimization: boolean }
      ) => {
        this.requireApi(event, 'internal:update-global-shortcut-config')
        return await settingsAPI.updateGlobalShortcutConfig(shortcut, config)
      }
    )

    // ==================== 应用快捷键 API ====================
    this.handleInternal(
      'internal:register-app-shortcut',
      async (event, shortcut: string, target: string) => {
        this.requireApi(event, 'internal:register-app-shortcut')
        return settingsAPI.registerAppShortcut(shortcut, target)
      }
    )

    this.handleInternal('internal:unregister-app-shortcut', async (event, shortcut: string) => {
      this.requireApi(event, 'internal:unregister-app-shortcut')
      return settingsAPI.unregisterAppShortcut(shortcut)
    })

    // ==================== 定时任务 API ====================
    this.handleInternal('internal:get-scheduled-tasks', async (event) => {
      this.requireApi(event, 'internal:get-scheduled-tasks')
      return getScheduledTaskService().list()
    })

    this.handleInternal(
      'internal:save-scheduled-task',
      async (event, draft: ScheduledTaskDraft) => {
        this.requireApi(event, 'internal:save-scheduled-task')
        return await getScheduledTaskService().save(draft)
      }
    )

    this.handleInternal('internal:delete-scheduled-task', async (event, id: string) => {
      this.requireApi(event, 'internal:delete-scheduled-task')
      return getScheduledTaskService().remove(id)
    })

    this.handleInternal('internal:run-scheduled-task', async (event, id: string) => {
      this.requireApi(event, 'internal:run-scheduled-task')
      return await getScheduledTaskService().runNow(id)
    })

    // ==================== 系统设置 API ====================
    this.handleInternal('internal:set-window-opacity', async (event, opacity: number) => {
      this.requireApi(event, 'internal:set-window-opacity')
      return await windowAPI.setWindowOpacity(opacity)
    })

    this.handleInternal('internal:set-window-default-height', async (event, height: number) => {
      this.requireApi(event, 'internal:set-window-default-height')
      return await settingsAPI.setWindowDefaultHeight(height)
    })

    this.handleInternal(
      'internal:set-compact-main-window-header',
      async (event, enabled: boolean) => {
        this.requireApi(event, 'internal:set-compact-main-window-header')
        return settingsAPI.setCompactMainWindowHeader(enabled)
      }
    )

    this.handleInternal('internal:select-avatar', async (event) => {
      this.requireApi(event, 'internal:select-avatar')
      return await systemAPI.selectAvatar()
    })

    this.handleInternal('internal:select-image-file', async (event) => {
      this.requireApi(event, 'internal:select-image-file')
      return await systemAPI.selectImageFile()
    })

    this.handleInternal('internal:select-search-wallpaper', async (event) => {
      this.requireApi(event, 'internal:select-search-wallpaper')
      return await systemAPI.selectSearchWallpaper()
    })

    this.handleInternal('internal:set-theme', async (event, theme: string) => {
      this.requireApi(event, 'internal:set-theme')
      return await settingsAPI.setTheme(theme)
    })

    this.handleInternal('internal:set-tray-icon-visible', async (event, visible: boolean) => {
      this.requireApi(event, 'internal:set-tray-icon-visible')
      return await windowAPI.setTrayIconVisible(visible)
    })

    this.handleInternal(
      'internal:set-window-material',
      async (event, material: 'mica' | 'acrylic' | 'none') => {
        this.requireApi(event, 'internal:set-window-material')
        return await windowAPI.setWindowMaterial(material)
      }
    )

    this.handleInternal('internal:get-window-material', async (event) => {
      this.requireApi(event, 'internal:get-window-material')
      return await windowAPI.getWindowMaterial()
    })

    this.handleInternal('internal:set-launch-at-login', async (event, enabled: boolean) => {
      this.requireApi(event, 'internal:set-launch-at-login')
      return await settingsAPI.setLaunchAtLogin(enabled)
    })

    this.handleInternal('internal:get-launch-at-login', async (event) => {
      this.requireApi(event, 'internal:get-launch-at-login')
      return await settingsAPI.getLaunchAtLogin()
    })

    // 设置代理配置
    this.handleInternal(
      'internal:set-proxy-config',
      async (event, config: { enabled: boolean; url: string }) => {
        this.requireApi(event, 'internal:set-proxy-config')
        return await settingsAPI.setProxyConfig(config)
      }
    )

    // 通知主渲染进程更新搜索框提示文字
    this.handleInternal('internal:update-placeholder', async (event, placeholder: string) => {
      this.requireApi(event, 'internal:update-placeholder')
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-placeholder', placeholder)
      return { success: true }
    })

    // 通知主渲染进程更新头像
    this.handleInternal('internal:update-avatar', async (event, avatar: string) => {
      this.requireApi(event, 'internal:update-avatar')
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-avatar', avatar)

      // 广播到超级面板窗口
      superPanelManager.broadcastToSuperPanel('update-avatar', avatar)

      return { success: true }
    })

    // 主搜索壁纸只属于宿主搜索视图，不向超级面板或分离窗口广播。
    this.handleInternal(
      'internal:update-search-wallpaper',
      async (event, wallpaper: SearchWallpaperConfig | null) => {
        this.requireApi(event, 'internal:update-search-wallpaper')

        // 在跨进程边界再次规范化，避免无效路径配置进入主渲染进程。
        const normalizedWallpaper = normalizeSearchWallpaperConfig(wallpaper)
        this.mainWindow?.webContents.send('update-search-wallpaper', normalizedWallpaper)
        return { success: true }
      }
    )

    // 通知主渲染进程更新自动粘贴配置
    this.handleInternal('internal:update-auto-paste', async (event, autoPaste: string) => {
      this.requireApi(event, 'internal:update-auto-paste')
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-auto-paste', autoPaste)
      return { success: true }
    })

    // 通知主渲染进程更新自动清空配置
    this.handleInternal('internal:update-auto-clear', async (event, autoClear: string) => {
      this.requireApi(event, 'internal:update-auto-clear')
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-auto-clear', autoClear)
      return { success: true }
    })

    // 更新自动返回搜索配置（直接通知主进程）
    this.handleInternal(
      'internal:update-auto-back-to-search',
      async (event, autoBackToSearch: string) => {
        this.requireApi(event, 'internal:update-auto-back-to-search')
        // 直接通知 windowManager 更新配置
        await windowAPI.updateAutoBackToSearch(autoBackToSearch)
        return { success: true }
      }
    )

    this.handleInternal(
      'internal:update-hide-main-window-on-plugin-esc',
      async (event, enabled: boolean) => {
        this.requireApi(event, 'internal:update-hide-main-window-on-plugin-esc')

        const hideMainWindowOnPluginEsc = enabled === true
        // 主渲染层处理顶部栏获得焦点时的 ESC，插件 WebContents 路径由主进程读取持久化配置。
        this.mainWindow?.webContents.send(
          'update-hide-main-window-on-plugin-esc',
          hideMainWindowOnPluginEsc
        )
        if (hideMainWindowOnPluginEsc) {
          // 直接隐藏后必须立即退出插件，保证下次呼出显示搜索页。
          await windowAPI.updateAutoBackToSearch('immediately')
        }
        return { success: true }
      }
    )

    // 更新窗口呼出位置策略（直接通知主进程）
    this.handleInternal(
      'internal:update-window-position-strategy',
      async (event, strategy: string) => {
        this.requireApi(event, 'internal:update-window-position-strategy')
        await windowAPI.updateWindowPositionStrategy(strategy)
        return { success: true }
      }
    )

    // 通知主渲染进程更新显示最近使用配置
    this.handleInternal(
      'internal:update-show-recent-in-search',
      async (event, showRecentInSearch: boolean) => {
        this.requireApi(event, 'internal:update-show-recent-in-search')
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-show-recent-in-search', showRecentInSearch)
        return { success: true }
      }
    )

    // 通知主渲染进程更新匹配推荐配置
    this.handleInternal(
      'internal:update-match-recommendation',
      async (event, showMatchRecommendation: boolean) => {
        this.requireApi(event, 'internal:update-match-recommendation')
        this.mainWindow?.webContents.send('update-match-recommendation', showMatchRecommendation)
        return { success: true }
      }
    )

    // 通知主渲染进程更新最近使用行数
    this.handleInternal('internal:update-recent-rows', async (event, rows: number) => {
      this.requireApi(event, 'internal:update-recent-rows')
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-recent-rows', rows)
      return { success: true }
    })

    // 更新搜索框大小并即时应用窗口宽度与设置页缩放
    ipcMain.handle('internal:update-search-box-scale', async (event, scale: number) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-search-box-scale')
      }
      windowManager.applySearchBoxScale(scale)
      return { success: true }
    })

    // 通知主渲染进程更新固定栏行数
    this.handleInternal('internal:update-pinned-rows', async (event, rows: number) => {
      this.requireApi(event, 'internal:update-pinned-rows')
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-pinned-rows', rows)
      return { success: true }
    })

    // 通知主渲染进程更新搜索框模式
    this.handleInternal('internal:update-search-mode', async (event, mode: string) => {
      this.requireApi(event, 'internal:update-search-mode')
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-search-mode', mode)
      return { success: true }
    })

    // 通知主渲染进程更新 Tab 键目标指令
    this.handleInternal('internal:update-tab-target', async (event, target: string) => {
      this.requireApi(event, 'internal:update-tab-target')
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-tab-target', target)
      return { success: true }
    })

    // 通知主渲染进程更新 Tab 键功能配置
    this.handleInternal(
      'internal:update-tab-key-function',
      async (event, mode: 'navigate' | 'target-command') => {
        this.requireApi(event, 'internal:update-tab-key-function')
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-tab-key-function', mode)
        return { success: true }
      }
    )

    // 通知主渲染进程更新空格打开指令配置
    this.handleInternal('internal:update-space-open-command', async (event, enabled: boolean) => {
      this.requireApi(event, 'internal:update-space-open-command')
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-space-open-command', enabled)
      return { success: true }
    })

    // 通知主渲染进程更新悬浮球双击目标指令
    this.handleInternal(
      'internal:update-floating-ball-double-click-command',
      async (event, command: string) => {
        this.requireApi(event, 'internal:update-floating-ball-double-click-command')
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-floating-ball-double-click-command', command)
        // 同步更新 floatingBallManager 的双击命令，使其立即生效
        floatingBallManager.setDoubleClickCommand(command)
        return { success: true }
      }
    )

    // 通知主渲染进程更新本地应用搜索配置
    this.handleInternal('internal:update-local-app-search', async (event, enabled: boolean) => {
      this.requireApi(event, 'internal:update-local-app-search')
      // 更新 commandsAPI 中的配置
      commandsAPI.setLocalAppSearch(enabled)
      return { success: true }
    })

    // 通知主渲染进程更新主题色
    this.handleInternal(
      'internal:update-primary-color',
      async (event, primaryColor: string, customColor?: string) => {
        this.requireApi(event, 'internal:update-primary-color')
        const data = { primaryColor, customColor }
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-primary-color', data)

        // 广播到所有分离窗口
        detachedWindowManager.broadcastToAllWindows('update-primary-color', data)

        // 通知插件主题信息变更
        windowManager.notifyThemeInfoChanged()

        return { success: true }
      }
    )

    // 通知主渲染进程更新亚克力透明度
    this.handleInternal(
      'internal:update-acrylic-opacity',
      async (event, lightOpacity: number, darkOpacity: number) => {
        this.requireApi(event, 'internal:update-acrylic-opacity')
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-acrylic-opacity', { lightOpacity, darkOpacity })

        // 广播到所有分离窗口
        detachedWindowManager.broadcastToAllWindows('update-acrylic-opacity', {
          lightOpacity,
          darkOpacity
        })

        return { success: true }
      }
    )

    // 同步通道同样登记到注册表，保持通道清单完整
    registerInternalApiChannel('internal:get-platform')
    ipcMain.on('internal:get-platform', (event) => {
      if (!requireInternalPlugin(this.pluginManager, event, 'internal:get-platform')) {
        event.returnValue = null
        return
      }
      event.returnValue = process.platform
    })

    // ==================== 应用更新 API ====================
    this.handleInternal('internal:updater-check-update', async (event) => {
      this.requireApi(event, 'internal:updater-check-update')
      return await updaterAPI.checkUpdate()
    })

    this.handleInternal('internal:updater-start-update', async (event) => {
      this.requireApi(event, 'internal:updater-start-update')
      return await updaterAPI.startUpdate()
    })

    this.handleInternal('internal:updater-set-auto-check', async (event, enabled: boolean) => {
      this.requireApi(event, 'internal:updater-set-auto-check')
      updaterAPI.setAutoCheck(enabled)
      return { success: true }
    })

    // ==================== 其他 API ====================
    this.handleInternal('internal:reveal-in-finder', async (event, path: string) => {
      this.requireApi(event, 'internal:reveal-in-finder')
      return await systemAPI.revealInFinder(path)
    })

    // 通知主渲染进程禁用指令列表已更改
    this.handleInternal('internal:notify-disabled-commands-changed', async (event) => {
      this.requireApi(event, 'internal:notify-disabled-commands-changed')
      this.mainWindow?.webContents.send('disabled-commands-changed')
      return { success: true }
    })

    // 通知主渲染进程插件列表已更改：失效指令缓存并刷新已安装列表与搜索索引
    this.handleInternal('internal:notify-plugins-changed', async (event) => {
      this.requireApi(event, 'internal:notify-plugins-changed')
      pluginsAPI.notifyPluginsChanged()
      return { success: true }
    })

    // 采纳已存在于插件目录的实体并登记到注册表（同名已注册时为 no-op）
    this.handleInternal('internal:adopt-plugin-entity', async (event, entityPath: string) => {
      this.requireApi(event, 'internal:adopt-plugin-entity')
      return await pluginsAPI.installer.adoptExistingEntity(entityPath)
    })

    // 固定指令到搜索窗口
    this.handleInternal('internal:pin-app', async (event, app: any) => {
      this.requireApi(event, 'internal:pin-app')
      return commandsAPI.pinApp(app)
    })

    // 取消固定指令
    this.handleInternal(
      'internal:unpin-app',
      async (event, appPath: string, featureCode?: string, name?: string) => {
        this.requireApi(event, 'internal:unpin-app')
        return commandsAPI.unpinApp(appPath, featureCode, name)
      }
    )

    // ==================== 超级面板 API ====================
    this.handleInternal(
      'internal:update-super-panel-config',
      async (event, config: { enabled: boolean; mouseButton: string; longPressMs: number }) => {
        this.requireApi(event, 'internal:update-super-panel-config')
        // 转发给 superPanelManager
        superPanelManager.updateConfig(config)
        return { success: true }
      }
    )

    this.handleInternal(
      'internal:update-super-panel-blocked-apps',
      async (event, blockedApps: Array<{ app: string; bundleId?: string; label?: string }>) => {
        this.requireApi(event, 'internal:update-super-panel-blocked-apps')
        superPanelManager.updateBlockedApps(blockedApps)
        return { success: true }
      }
    )

    this.handleInternal(
      'internal:update-wakeup-blacklist',
      async (event, blacklist: Array<{ app: string; bundleId?: string; label?: string }>) => {
        this.requireApi(event, 'internal:update-wakeup-blacklist')
        windowManager.updateWakeupBlacklist(blacklist)
        return { success: true }
      }
    )

    this.handleInternal('internal:set-game-mode', async (event, v: boolean) => {
      this.requireApi(event, 'internal:set-game-mode')
      dndManager.manualEnabled = v
      windowManager.refreshTrayMenu()
      return { success: true }
    })

    this.handleInternal('internal:set-ignore-hotkeys-on-fullscreen', async (event, v: boolean) => {
      this.requireApi(event, 'internal:set-ignore-hotkeys-on-fullscreen')
      dndManager.setIgnoreOnFullscreen(v)
      return { success: true }
    })

    this.handleInternal('internal:get-current-window-info', async (event) => {
      this.requireApi(event, 'internal:get-current-window-info')
      return clipboardManager.getCurrentWindow()
    })

    // ==================== 超级面板翻译 API ====================
    this.handleInternal(
      'internal:update-super-panel-translate',
      async (event, enabled: boolean) => {
        this.requireApi(event, 'internal:update-super-panel-translate')
        translationManager.updateEnabled(enabled)
        return { success: true }
      }
    )

    this.handleInternal('internal:get-translation-status', async (event) => {
      this.requireApi(event, 'internal:get-translation-status')
      return translationManager.getStatus()
    })

    // ==================== 图片分析 API ====================
    this.handleInternal('internal:analyze-image', async (event, imagePath: string) => {
      this.requireApi(event, 'internal:analyze-image')
      return await analyzeImage(imagePath)
    })

    // ==================== 调试日志 API ====================
    this.handleInternal('internal:log-enable', async (event) => {
      this.requireApi(event, 'internal:log-enable')
      logCollector.enable(event.sender)
      // 联动原生层日志：调试控制台开启后原生日志才写入临时目录
      NativeLogger.setEnabled(true)
      return { success: true }
    })

    this.handleInternal('internal:log-disable', async (event) => {
      this.requireApi(event, 'internal:log-disable')
      logCollector.disable(event.sender)
      // 联动原生层日志：调试控制台关闭后停止向临时目录写入
      NativeLogger.setEnabled(false)
      return { success: true }
    })

    this.handleInternal('internal:log-get-buffer', async (event) => {
      this.requireApi(event, 'internal:log-get-buffer')
      return logCollector.getBufferedLogs()
    })

    this.handleInternal('internal:log-is-enabled', async (event) => {
      this.requireApi(event, 'internal:log-is-enabled')
      return logCollector.isEnabled()
    })

    this.handleInternal('internal:log-subscribe', async (event) => {
      this.requireApi(event, 'internal:log-subscribe')
      logCollector.addSubscriber(event.sender)
      return { success: true }
    })

    // ==================== HTTP 服务 API ====================
    this.handleInternal('internal:http-server-get-config', async (event) => {
      this.requireApi(event, 'internal:http-server-get-config')
      try {
        const config = httpServer.getConfig()
        return { success: true, config }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '获取配置失败'
        }
      }
    })

    this.handleInternal(
      'internal:http-server-save-config',
      async (event, config: { enabled: boolean; port: number; apiKey: string }) => {
        this.requireApi(event, 'internal:http-server-save-config')
        try {
          const wasRunning = httpServer.isRunning()
          const savedConfig = await httpServer.saveConfig(config)

          if (savedConfig.enabled && !wasRunning) {
            httpServer.start()
          } else if (!savedConfig.enabled && wasRunning) {
            httpServer.stop()
          } else if (savedConfig.enabled && wasRunning) {
            httpServer.stop()
            httpServer.start()
          }

          return { success: true, config: savedConfig }
        } catch (error: unknown) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '保存配置失败'
          }
        }
      }
    )

    this.handleInternal('internal:http-server-regenerate-key', async (event) => {
      this.requireApi(event, 'internal:http-server-regenerate-key')
      try {
        const newKey = httpServer.generateApiKey()
        await httpServer.saveConfig({ apiKey: newKey })
        return { success: true, apiKey: newKey }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '重新生成密钥失败'
        }
      }
    })

    this.handleInternal('internal:http-server-status', async (event) => {
      this.requireApi(event, 'internal:http-server-status')
      return { success: true, running: httpServer.isRunning() }
    })

    // ==================== MCP 服务 API ====================
    this.handleInternal('internal:mcp-server-get-config', async (event) => {
      this.requireApi(event, 'internal:mcp-server-get-config')
      try {
        // 读取当前 MCP 服务配置；缺失 API Key 时会在 getConfig 内补齐。
        const config = mcpServer.getConfig()
        return { success: true, config }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '获取配置失败'
        }
      }
    })

    this.handleInternal(
      'internal:mcp-server-save-config',
      async (event, config: { enabled: boolean; port: number; apiKey: string }) => {
        this.requireApi(event, 'internal:mcp-server-save-config')
        try {
          const wasRunning = mcpServer.isRunning()
          const savedConfig = await mcpServer.saveConfig(config)

          // 配置变更后按运行状态决定启动、停止或重启服务。
          if (savedConfig.enabled && !wasRunning) {
            mcpServer.start()
          } else if (!savedConfig.enabled && wasRunning) {
            mcpServer.stop()
          } else if (savedConfig.enabled && wasRunning) {
            mcpServer.stop()
            mcpServer.start()
          }

          return { success: true, config: savedConfig }
        } catch (error: unknown) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '保存配置失败'
          }
        }
      }
    )

    this.handleInternal('internal:mcp-server-regenerate-key', async (event) => {
      this.requireApi(event, 'internal:mcp-server-regenerate-key')
      try {
        // 仅更新密钥，不直接改动启停状态，由现有服务继续使用新配置。
        const newKey = mcpServer.generateApiKey()
        await mcpServer.saveConfig({ apiKey: newKey })
        return { success: true, apiKey: newKey }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '重新生成密钥失败'
        }
      }
    })

    // 查询 MCP 服务运行状态
    this.handleInternal('internal:mcp-server-status', async (event) => {
      this.requireApi(event, 'internal:mcp-server-status')
      return { success: true, running: mcpServer.isRunning() }
    })

    // 获取所有已安装插件中声明的 MCP 工具列表
    this.handleInternal('internal:mcp-server-tools', async (event) => {
      this.requireApi(event, 'internal:mcp-server-tools')
      return {
        success: true,
        // 返回所有已安装插件声明的工具，供设置页展示与调试。
        data: pluginToolsAPI.getAllDeclaredToolEntries()
      }
    })
  }
}

export default new InternalPluginAPI()
