import { app, IpcMainInvokeEvent, ipcMain } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import windowManager from '../../managers/windowManager.js'
import logCollector from '../../core/logCollector.js'
import clipboardManager from '../../managers/clipboardManager.js'
import detachedWindowManager from '../../core/detachedWindowManager.js'
import floatingBallManager from '../../core/floatingBallManager.js'
import httpServer from '../../core/httpServer.js'
import mcpServer from '../../core/mcpServer.js'
import superPanelManager from '../../core/superPanelManager.js'
import translationManager from '../../core/translationManager.js'
import aiModelsAPI from '../renderer/aiModels.js'
import commandsAPI from '../renderer/commands.js'
import pluginsAPI from '../renderer/plugins.js'
import settingsAPI from '../renderer/settings.js'
import systemAPI from '../renderer/system.js'
import webSearchAPI from '../renderer/webSearch.js'
import windowAPI from '../renderer/window.js'
import pluginToolsAPI from './tools'
import databaseAPI from '../shared/database'
import { analyzeImage } from '../shared/imageAnalysis'
import updaterAPI from '../updater.js'
import {
  COMMAND_ALIASES_KEY,
  normalizeCommandAliases,
  type CommandAliasStore
} from '@shared/commandShared'

/**
 * 权限错误类
 */
class PermissionDeniedError extends Error {
  constructor(apiName: string) {
    super(`API "${apiName}" 仅限内置插件调用`)
    this.name = 'PermissionDeniedError'
  }
}

/**
 * 检查是否为内置插件调用
 * @param pluginManager 插件管理器实例
 * @param event IPC 事件对象
 * @returns 是否允许调用（内置插件或主渲染进程）
 */
export function requireInternalPlugin(
  pluginManager: PluginManager | null,
  event: IpcMainInvokeEvent
): boolean {
  if (!pluginManager) return true // 没有 pluginManager，允许通过
  const pluginInfo = pluginManager.getPluginInfoByWebContents(event.sender)

  if (!pluginInfo) {
    // 不是插件调用（可能是主渲染进程），允许通过
    return true
  }

  // 检查是否拥有内部 API 权限
  return pluginInfo.canUseInternalApi
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
   * 注册仅允许内置插件访问的 IPC 能力。
   */
  private setupIPC(): void {
    // ==================== 数据库 API (ZTOOLS/ 命名空间) ====================
    ipcMain.handle('internal:db-put', (event, key: string, value: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:db-put')
      }
      return databaseAPI.dbPut(key, value)
    })

    ipcMain.handle('internal:db-get', (event, key: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:db-get')
      }
      return databaseAPI.dbGet(key)
    })

    // ==================== 应用启动 API ====================
    ipcMain.handle('internal:launch', async (event, options: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:launch')
      }
      console.log('[Internal] 启动应用', options)
      return await commandsAPI.launch(options)
    })

    ipcMain.handle('internal:quit-app', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:quit-app')
      }
      // 与托盘「退出」一致：设置退出标志后再 quit，否则 before-quit 会阻止并只隐藏窗口
      windowManager.setQuitting(true)
      app.quit()
      return { success: true }
    })

    // ==================== 指令管理 API ====================
    ipcMain.handle('internal:get-commands', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-commands')
      }

      // 设置页使用这份 canonical commands 构建 alias 目标列表，不在这里展开 alias 搜索字段。
      console.log('[Internal] 收到获取指令列表请求（设置页 alias 目标）')
      const result = await commandsAPI.getCommands()
      console.log('[Internal] 返回指令列表摘要:', {
        commands: result.commands?.length || 0,
        regexCommands: result.regexCommands?.length || 0,
        plugins: result.plugins?.length || 0
      })
      return result
    })

    ipcMain.handle('internal:update-command-aliases', async (event, aliases: CommandAliasStore) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-command-aliases')
      }

      const inputCommandCount = Object.keys(aliases || {}).length
      const inputAliasCount = Object.values(aliases || {}).reduce(
        (count, entries) => count + (Array.isArray(entries) ? entries.length : 0),
        0
      )
      console.log('[Internal] 收到更新指令别名请求:', {
        commandCount: inputCommandCount,
        aliasCount: inputAliasCount
      })

      // alias 保存链路：归一化 -> 持久化 -> 失效 commands cache -> 通知主窗口刷新搜索索引。
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
        commandsAPI.invalidateCommandsCache(false)
        // 只通知渲染进程刷新别名搜索索引，不触发系统应用扫描
        this.mainWindow?.webContents.send('command-aliases-changed')
        console.log('[Internal] 指令缓存已失效并通知主窗口刷新 alias 搜索索引')

        return { success: true }
      } catch (error) {
        console.error('[Internal] 更新指令别名失败:', error)
        throw error
      }
    })

    // ==================== 插件管理 API ====================
    ipcMain.handle('internal:get-plugins', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugins')
      }
      return await pluginsAPI.getPlugins()
    })

    ipcMain.handle('internal:get-disabled-plugins', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-disabled-plugins')
      }
      return pluginsAPI.getDisabledPlugins()
    })

    ipcMain.handle(
      'internal:set-plugin-disabled',
      async (event, pluginPath: string, disabled: boolean) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:set-plugin-disabled')
        }
        return await pluginsAPI.setPluginDisabled(pluginPath, disabled)
      }
    )

    ipcMain.handle('internal:get-all-plugins', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-all-plugins')
      }
      return await pluginsAPI.getAllPlugins()
    })

    ipcMain.handle('internal:select-plugin-file', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:select-plugin-file')
      }
      return await pluginsAPI.installer.selectPluginFile()
    })

    ipcMain.handle('internal:import-plugin', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:import-plugin')
      }
      return await pluginsAPI.installer.importPlugin()
    })

    ipcMain.handle('internal:read-plugin-info-from-zpx', async (event, zpxPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:read-plugin-info-from-zpx')
      }
      return await pluginsAPI.installer.readPluginInfoFromZpx(zpxPath)
    })

    ipcMain.handle('internal:install-plugin-from-path', async (event, zpxPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:install-plugin-from-path')
      }
      return await pluginsAPI.installer.installPluginFromPath(zpxPath)
    })

    ipcMain.handle('internal:import-dev-plugin', async (event, pluginJsonPath?: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:import-dev-plugin')
      }
      return await pluginsAPI.devProjects.importDevPlugin(pluginJsonPath)
    })

    ipcMain.handle(
      'internal:scaffold-dev-project',
      async (
        event,
        params: {
          template: 'vue-vite' | 'react-vite'
          projectPath: string
          name: string
          title: string
          description?: string
          platform?: string[]
          author?: string
        }
      ) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:scaffold-dev-project')
        }
        return await pluginsAPI.devProjects.scaffoldDevProject(params)
      }
    )

    ipcMain.handle(
      'internal:update-dev-project-meta',
      async (
        event,
        projectName: string,
        meta: { title?: string; description?: string; platform?: string[]; author?: string }
      ) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-dev-project-meta')
        }
        return await pluginsAPI.devProjects.updateDevProjectMeta(projectName, meta)
      }
    )

    ipcMain.handle(
      'internal:upsert-dev-project-by-config-path',
      async (event, pluginJsonPath: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:upsert-dev-project-by-config-path')
        }
        return await pluginsAPI.devProjects.upsertDevProjectByConfigPath(pluginJsonPath)
      }
    )

    ipcMain.handle('internal:get-dev-projects', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-dev-projects')
      }
      return await pluginsAPI.devProjects.getDevProjects()
    })

    ipcMain.handle('internal:update-dev-projects-order', async (event, pluginNames: string[]) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-dev-projects-order')
      }
      return await pluginsAPI.devProjects.updateDevProjectsOrder(pluginNames)
    })

    ipcMain.handle('internal:remove-dev-project', async (event, pluginName: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:remove-dev-project')
      }
      return await pluginsAPI.devProjects.removeDevProject(pluginName)
    })

    ipcMain.handle('internal:install-dev-plugin', async (event, pluginName: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:install-dev-plugin')
      }
      return await pluginsAPI.devProjects.installDevPlugin(pluginName)
    })

    ipcMain.handle('internal:uninstall-dev-plugin', async (event, pluginName: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:uninstall-dev-plugin')
      }
      return await pluginsAPI.devProjects.uninstallDevPlugin(pluginName)
    })

    ipcMain.handle('internal:validate-dev-project', async (event, pluginName: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:validate-dev-project')
      }
      return await pluginsAPI.devProjects.validateDevProject(pluginName)
    })

    ipcMain.handle(
      'internal:select-dev-project-config',
      async (event, pluginName: string, configPath?: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:select-dev-project-config')
        }
        return await pluginsAPI.devProjects.selectDevProjectConfig(pluginName, configPath)
      }
    )

    ipcMain.handle(
      'internal:package-dev-project',
      async (event, pluginName: string, packagePath?: string, version?: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:package-dev-project')
        }
        return await pluginsAPI.devProjects.packageDevProject(pluginName, packagePath, version)
      }
    )

    ipcMain.handle('internal:delete-plugin', async (event, pluginPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:delete-plugin')
      }
      return await pluginsAPI.deletePlugin(pluginPath)
    })

    ipcMain.handle('internal:get-running-plugins', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-running-plugins')
      }
      return pluginsAPI.getRunningPlugins()
    })

    ipcMain.handle('internal:kill-plugin', async (event, pluginPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:kill-plugin')
      }
      return pluginsAPI.killPlugin(pluginPath)
    })

    ipcMain.handle('internal:fetch-plugin-market', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:fetch-plugin-market')
      }
      return await pluginsAPI.market.fetchPluginMarket()
    })

    ipcMain.handle('internal:install-plugin-from-market', async (event, plugin: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:install-plugin-from-market')
      }
      return await pluginsAPI.installer.installPluginFromMarket(plugin)
    })

    ipcMain.handle(
      'internal:install-plugin-from-npm',
      async (event, options: { packageName: string; useChinaMirror?: boolean }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:install-plugin-from-npm')
        }
        return await pluginsAPI.installer.installPluginFromNpm(
          options.packageName,
          options.useChinaMirror
        )
      }
    )

    ipcMain.handle(
      'internal:get-plugin-readme',
      async (event, pluginPathOrName: string, pluginName?: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:get-plugin-readme')
        }
        return await pluginsAPI.getPluginReadme(pluginPathOrName, pluginName)
      }
    )

    ipcMain.handle('internal:get-plugin-doc-keys', async (event, pluginName: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugin-doc-keys')
      }
      return await databaseAPI.getPluginDocKeys(pluginName)
    })

    ipcMain.handle('internal:get-plugin-doc', async (event, pluginName: string, docKey: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugin-doc')
      }
      return await databaseAPI.getPluginDoc(pluginName, docKey)
    })

    ipcMain.handle('internal:get-plugin-data-stats', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugin-data-stats')
      }
      return await databaseAPI.getPluginDataStats()
    })

    ipcMain.handle('internal:clear-plugin-data', async (event, pluginName: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:clear-plugin-data')
      }
      return await databaseAPI.clearPluginData(pluginName)
    })

    ipcMain.handle('internal:export-all-plugins', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:export-all-plugins')
      }
      return await pluginsAPI.installer.exportAllPlugins()
    })

    ipcMain.handle('internal:get-plugin-memory-info', async (event, pluginPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugin-memory-info')
      }
      try {
        const memoryInfo = await this.pluginManager?.getPluginMemoryInfo(pluginPath)
        return { success: true, data: memoryInfo }
      } catch (error: unknown) {
        console.error('[Internal API] 获取内存信息失败:', error)
        return { success: false, error: error instanceof Error ? error.message : '获取失败' }
      }
    })

    // ==================== AI 模型管理 API ====================
    ipcMain.handle('internal:ai-models-get-all', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:ai-models-get-all')
      }
      try {
        const models = aiModelsAPI.getAllModels()
        return { success: true, data: models }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    ipcMain.handle('internal:ai-models-add', async (event, model: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:ai-models-add')
      }
      return await aiModelsAPI.addModel(model)
    })

    ipcMain.handle('internal:ai-models-update', async (event, model: any): Promise<any> => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:ai-models-update')
      }
      return await aiModelsAPI.updateModel(model)
    })

    ipcMain.handle('internal:ai-models-delete', async (event, modelId: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:ai-models-delete')
      }
      return await aiModelsAPI.deleteModel(modelId)
    })

    // ==================== 全局快捷键 API ====================
    ipcMain.handle(
      'internal:register-global-shortcut',
      async (event, shortcut: string, target: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:register-global-shortcut')
        }
        return settingsAPI.registerGlobalShortcut(shortcut, target)
      }
    )

    ipcMain.handle('internal:unregister-global-shortcut', async (event, shortcut: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:unregister-global-shortcut')
      }
      return settingsAPI.unregisterGlobalShortcut(shortcut)
    })

    ipcMain.handle('internal:start-hotkey-recording', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:start-hotkey-recording')
      }
      return await settingsAPI.startHotkeyRecording()
    })

    ipcMain.handle('internal:update-shortcut', async (event, shortcut: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-shortcut')
      }
      return await settingsAPI.updateShortcut(shortcut)
    })

    // ==================== 应用快捷键 API ====================
    ipcMain.handle(
      'internal:register-app-shortcut',
      async (event, shortcut: string, target: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:register-app-shortcut')
        }
        return settingsAPI.registerAppShortcut(shortcut, target)
      }
    )

    ipcMain.handle('internal:unregister-app-shortcut', async (event, shortcut: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:unregister-app-shortcut')
      }
      return settingsAPI.unregisterAppShortcut(shortcut)
    })

    // ==================== 系统设置 API ====================
    ipcMain.handle('internal:set-window-opacity', async (event, opacity: number) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-window-opacity')
      }
      return await windowAPI.setWindowOpacity(opacity)
    })

    ipcMain.handle('internal:set-window-default-height', async (event, height: number) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-window-default-height')
      }
      return await settingsAPI.setWindowDefaultHeight(height)
    })

    ipcMain.handle('internal:select-avatar', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:select-avatar')
      }
      return await systemAPI.selectAvatar()
    })

    ipcMain.handle('internal:set-theme', async (event, theme: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-theme')
      }
      return await settingsAPI.setTheme(theme)
    })

    ipcMain.handle('internal:set-tray-icon-visible', async (event, visible: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-tray-icon-visible')
      }
      return await windowAPI.setTrayIconVisible(visible)
    })

    ipcMain.handle(
      'internal:set-window-material',
      async (event, material: 'mica' | 'acrylic' | 'none') => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:set-window-material')
        }
        return await windowAPI.setWindowMaterial(material)
      }
    )

    ipcMain.handle('internal:get-window-material', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-window-material')
      }
      return await windowAPI.getWindowMaterial()
    })

    ipcMain.handle('internal:set-launch-at-login', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-launch-at-login')
      }
      return await settingsAPI.setLaunchAtLogin(enabled)
    })

    ipcMain.handle('internal:get-launch-at-login', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-launch-at-login')
      }
      return await settingsAPI.getLaunchAtLogin()
    })

    // 设置代理配置
    ipcMain.handle(
      'internal:set-proxy-config',
      async (event, config: { enabled: boolean; url: string }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:set-proxy-config')
        }
        return await settingsAPI.setProxyConfig(config)
      }
    )

    // 通知主渲染进程更新搜索框提示文字
    ipcMain.handle('internal:update-placeholder', async (event, placeholder: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-placeholder')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-placeholder', placeholder)
      return { success: true }
    })

    // 通知主渲染进程更新头像
    ipcMain.handle('internal:update-avatar', async (event, avatar: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-avatar')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-avatar', avatar)

      // 广播到超级面板窗口
      superPanelManager.broadcastToSuperPanel('update-avatar', avatar)

      return { success: true }
    })

    // 通知主渲染进程更新自动粘贴配置
    ipcMain.handle('internal:update-auto-paste', async (event, autoPaste: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-auto-paste')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-auto-paste', autoPaste)
      return { success: true }
    })

    // 通知主渲染进程更新自动清空配置
    ipcMain.handle('internal:update-auto-clear', async (event, autoClear: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-auto-clear')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-auto-clear', autoClear)
      return { success: true }
    })

    // 更新自动返回搜索配置（直接通知主进程）
    ipcMain.handle(
      'internal:update-auto-back-to-search',
      async (event, autoBackToSearch: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-auto-back-to-search')
        }
        // 直接通知 windowManager 更新配置
        await windowAPI.updateAutoBackToSearch(autoBackToSearch)
        return { success: true }
      }
    )

    // 通知主渲染进程更新显示最近使用配置
    ipcMain.handle(
      'internal:update-show-recent-in-search',
      async (event, showRecentInSearch: boolean) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-show-recent-in-search')
        }
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-show-recent-in-search', showRecentInSearch)
        return { success: true }
      }
    )

    // 通知主渲染进程更新匹配推荐配置
    ipcMain.handle(
      'internal:update-match-recommendation',
      async (event, showMatchRecommendation: boolean) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-match-recommendation')
        }
        this.mainWindow?.webContents.send('update-match-recommendation', showMatchRecommendation)
        return { success: true }
      }
    )

    // 通知主渲染进程更新最近使用行数
    ipcMain.handle('internal:update-recent-rows', async (event, rows: number) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-recent-rows')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-recent-rows', rows)
      return { success: true }
    })

    // 通知主渲染进程更新固定栏行数
    ipcMain.handle('internal:update-pinned-rows', async (event, rows: number) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-pinned-rows')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-pinned-rows', rows)
      return { success: true }
    })

    // 通知主渲染进程更新搜索框模式
    ipcMain.handle('internal:update-search-mode', async (event, mode: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-search-mode')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-search-mode', mode)
      return { success: true }
    })

    // 通知主渲染进程更新 Tab 键目标指令
    ipcMain.handle('internal:update-tab-target', async (event, target: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-tab-target')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-tab-target', target)
      return { success: true }
    })

    // 通知主渲染进程更新 Tab 键功能配置
    ipcMain.handle(
      'internal:update-tab-key-function',
      async (event, mode: 'navigate' | 'target-command') => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-tab-key-function')
        }
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-tab-key-function', mode)
        return { success: true }
      }
    )

    // 通知主渲染进程更新空格打开指令配置
    ipcMain.handle('internal:update-space-open-command', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-space-open-command')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-space-open-command', enabled)
      return { success: true }
    })

    // 通知主渲染进程更新悬浮球双击目标指令
    ipcMain.handle(
      'internal:update-floating-ball-double-click-command',
      async (event, command: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-floating-ball-double-click-command')
        }
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-floating-ball-double-click-command', command)
        // 同步更新 floatingBallManager 的双击命令，使其立即生效
        floatingBallManager.setDoubleClickCommand(command)
        return { success: true }
      }
    )

    // 通知主渲染进程更新本地应用搜索配置
    ipcMain.handle('internal:update-local-app-search', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-local-app-search')
      }
      // 更新 commandsAPI 中的配置
      commandsAPI.setLocalAppSearch(enabled)
      return { success: true }
    })

    // 通知主渲染进程更新主题色
    ipcMain.handle(
      'internal:update-primary-color',
      async (event, primaryColor: string, customColor?: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-primary-color')
        }
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
    ipcMain.handle(
      'internal:update-acrylic-opacity',
      async (event, lightOpacity: number, darkOpacity: number) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-acrylic-opacity')
        }
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

    ipcMain.on('internal:get-platform', (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        event.returnValue = null
        return
      }
      event.returnValue = process.platform
    })

    // ==================== 应用更新 API ====================
    ipcMain.handle('internal:updater-check-update', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:updater-check-update')
      }
      return await updaterAPI.checkUpdate()
    })

    ipcMain.handle('internal:updater-start-update', async (event, updateInfo: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:updater-start-update')
      }
      return await updaterAPI.startUpdate(updateInfo)
    })

    ipcMain.handle('internal:updater-set-auto-check', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:updater-set-auto-check')
      }
      updaterAPI.setAutoCheck(enabled)
      return { success: true }
    })

    // ==================== 其他 API ====================
    ipcMain.handle('internal:reveal-in-finder', async (event, path: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:reveal-in-finder')
      }
      return await systemAPI.revealInFinder(path)
    })

    // 通知主渲染进程禁用指令列表已更改
    ipcMain.handle('internal:notify-disabled-commands-changed', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:notify-disabled-commands-changed')
      }
      this.mainWindow?.webContents.send('disabled-commands-changed')
      return { success: true }
    })

    // 固定指令到搜索窗口
    ipcMain.handle('internal:pin-app', async (event, app: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:pin-app')
      }
      return commandsAPI.pinApp(app)
    })

    // 取消固定指令
    ipcMain.handle(
      'internal:unpin-app',
      async (event, appPath: string, featureCode?: string, name?: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:unpin-app')
        }
        return commandsAPI.unpinApp(appPath, featureCode, name)
      }
    )

    // ==================== 超级面板 API ====================
    ipcMain.handle(
      'internal:update-super-panel-config',
      async (event, config: { enabled: boolean; mouseButton: string; longPressMs: number }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-super-panel-config')
        }
        // 转发给 superPanelManager
        superPanelManager.updateConfig(config)
        return { success: true }
      }
    )

    ipcMain.handle(
      'internal:update-super-panel-blocked-apps',
      async (event, blockedApps: Array<{ app: string; bundleId?: string; label?: string }>) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-super-panel-blocked-apps')
        }
        superPanelManager.updateBlockedApps(blockedApps)
        return { success: true }
      }
    )

    ipcMain.handle(
      'internal:update-wakeup-blacklist',
      async (event, blacklist: Array<{ app: string; bundleId?: string; label?: string }>) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-wakeup-blacklist')
        }
        windowManager.updateWakeupBlacklist(blacklist)
        return { success: true }
      }
    )

    ipcMain.handle('internal:get-current-window-info', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-current-window-info')
      }
      return clipboardManager.getCurrentWindow()
    })

    // ==================== 超级面板翻译 API ====================
    ipcMain.handle('internal:update-super-panel-translate', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-super-panel-translate')
      }
      translationManager.updateEnabled(enabled)
      return { success: true }
    })

    ipcMain.handle('internal:get-translation-status', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-translation-status')
      }
      return translationManager.getStatus()
    })

    // ==================== 图片分析 API ====================
    ipcMain.handle('internal:analyze-image', async (event, imagePath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:analyze-image')
      }
      return await analyzeImage(imagePath)
    })

    // ==================== 网页快开 API ====================
    ipcMain.handle('internal:web-search-get-all', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-get-all')
      }
      try {
        const engines = webSearchAPI.getAllEngines()
        return { success: true, data: engines }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    ipcMain.handle('internal:web-search-add', async (event, engine: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-add')
      }
      return await webSearchAPI.addEngine(engine)
    })

    ipcMain.handle('internal:web-search-update', async (event, engine: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-update')
      }
      return await webSearchAPI.updateEngine(engine)
    })

    ipcMain.handle('internal:web-search-delete', async (event, engineId: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-delete')
      }
      return await webSearchAPI.deleteEngine(engineId)
    })

    ipcMain.handle('internal:web-search-fetch-favicon', async (event, url: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-fetch-favicon')
      }
      try {
        const icon = await webSearchAPI.fetchFavicon(url)
        return { success: true, data: icon }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // ==================== 调试日志 API ====================
    ipcMain.handle('internal:log-enable', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-enable')
      }
      logCollector.enable(event.sender)
      return { success: true }
    })

    ipcMain.handle('internal:log-disable', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-disable')
      }
      logCollector.disable(event.sender)
      return { success: true }
    })

    ipcMain.handle('internal:log-get-buffer', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-get-buffer')
      }
      return logCollector.getBufferedLogs()
    })

    ipcMain.handle('internal:log-is-enabled', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-is-enabled')
      }
      return logCollector.isEnabled()
    })

    ipcMain.handle('internal:log-subscribe', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-subscribe')
      }
      logCollector.addSubscriber(event.sender)
      return { success: true }
    })

    // ==================== HTTP 服务 API ====================
    ipcMain.handle('internal:http-server-get-config', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:http-server-get-config')
      }
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

    ipcMain.handle(
      'internal:http-server-save-config',
      async (event, config: { enabled: boolean; port: number; apiKey: string }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:http-server-save-config')
        }
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

    ipcMain.handle('internal:http-server-regenerate-key', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:http-server-regenerate-key')
      }
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

    ipcMain.handle('internal:http-server-status', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:http-server-status')
      }
      return { success: true, running: httpServer.isRunning() }
    })

    // ==================== MCP 服务 API ====================
    ipcMain.handle('internal:mcp-server-get-config', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:mcp-server-get-config')
      }
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

    ipcMain.handle(
      'internal:mcp-server-save-config',
      async (event, config: { enabled: boolean; port: number; apiKey: string }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:mcp-server-save-config')
        }
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

    ipcMain.handle('internal:mcp-server-regenerate-key', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:mcp-server-regenerate-key')
      }
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
    ipcMain.handle('internal:mcp-server-status', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:mcp-server-status')
      }
      return { success: true, running: mcpServer.isRunning() }
    })

    // 获取所有已安装插件中声明的 MCP 工具列表
    ipcMain.handle('internal:mcp-server-tools', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:mcp-server-tools')
      }
      return {
        success: true,
        // 返回所有已安装插件声明的工具，供设置页展示与调试。
        data: pluginToolsAPI.getAllDeclaredToolEntries()
      }
    })
  }
}

export default new InternalPluginAPI()
