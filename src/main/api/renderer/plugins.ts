/**
 * 主进程插件管理入口。
 *
 * 本模块协调插件列表、禁用状态、开发项目和正式插件安装单元；正式插件的实体变更必须
 * 经过共享事务服务，确保安装、升级、卸载与启动恢复观察到同一份状态。
 */

import type { PluginManager } from '../../managers/pluginManager'
import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { normalizeIconPath } from '../../common/iconUtils'
import { isBundledInternalPlugin } from '../../core/internalPlugins'
import lmdbInstance from '../../core/lmdb/lmdbInstance'
import providerManager from '../../core/provider/providerManager'
import windowManager from '../../managers/windowManager'
import { pluginFeatureAPI } from '../plugin/feature'
import databaseAPI from '../shared/database'
import { PluginDevProjectsAPI } from './pluginDevProjects'
import { PluginInstallerAPI } from './pluginInstaller'
import { PluginMarketAPI } from './pluginMarket'
import { requestPluginMarket } from './pluginMarketConfig'
import { PluginInstallUnitService } from '../../core/pluginInstallUnit/service'
import type {
  InstalledPluginRecord,
  PluginRemovalStateSnapshot
} from '../../core/pluginInstallUnit/types'
import { getPluginsPath } from '../../core/appData/appDataPaths'
import {
  getPluginDataPrefix,
  isDevelopmentPluginName
} from '../../../shared/pluginRuntimeNamespace'
import {
  ENABLED_MAIN_PUSH_PLUGINS_KEY,
  normalizeConfigList,
  removePluginNameFromSettingList
} from '../../../shared/pluginSettings'
import { PROVIDER_SETTINGS_KEY } from '@shared/providerShared'

// 插件目录
const DISABLED_PLUGINS_KEY = 'disabled-plugins'
const PLUGIN_NAME_SETTING_KEYS = [
  'out-kill-plugin',
  'auto-detach-plugin',
  'auto-start-plugin',
  ENABLED_MAIN_PUSH_PLUGINS_KEY
]
const PLUGIN_USAGE_STATE_KEYS = ['command-history', 'pinned-commands', ...PLUGIN_NAME_SETTING_KEYS]
const PLUGIN_REMOVAL_STATE_KEYS = [...new Set([...PLUGIN_USAGE_STATE_KEYS, PROVIDER_SETTINGS_KEY])]

export interface DeletePluginOptions {
  deleteData?: boolean
}

/**
 * 插件管理API - 主程序专用
 */
export class PluginsAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: PluginManager | null = null
  private disabledPluginPathSet: Set<string> | null = null
  private commandsCacheInvalidator: (() => void) | null = null
  /** 正式插件实体、注册记录和禁用路径的唯一事务边界。 */
  private pluginInstallUnits!: PluginInstallUnitService
  public devProjects!: PluginDevProjectsAPI
  public installer!: PluginInstallerAPI
  public market!: PluginMarketAPI

  /**
   * 初始化插件 API，并在任何插件 IPC 可用前完成事务恢复。
   * @param mainWindow 主窗口
   * @param pluginManager 插件运行期管理器
   */
  public async init(
    mainWindow: Electron.BrowserWindow,
    pluginManager: PluginManager
  ): Promise<void> {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.devProjects = new PluginDevProjectsAPI({
      get mainWindow() {
        return mainWindow
      },
      get pluginManager() {
        return pluginManager
      },
      readInstalledPlugins: () => this.readInstalledPlugins(),
      writeInstalledPlugins: (plugins) => this.writeInstalledPlugins(plugins),
      notifyPluginsChanged: () => this.notifyPluginsChanged(),
      validatePluginConfig: (config, existing) => this.validatePluginConfig(config, existing),
      resolvePluginLogo: (p, logo) => this.resolvePluginLogo(p, logo),
      getRunningPlugins: () => this.getRunningPlugins()
    })
    this.market = new PluginMarketAPI()
    this.pluginInstallUnits = new PluginInstallUnitService({
      pluginsDir: getPluginsPath(),
      registry: {
        readPlugins: () => this.readInstalledPlugins(),
        writePlugins: (plugins) => this.writeInstalledPlugins(plugins),
        readDisabledPluginPaths: () => this.getDisabledPlugins(),
        writeDisabledPluginPaths: (paths) => this.writeDisabledPluginPaths(paths),
        capturePluginRemovalState: () => this.capturePluginRemovalState(),
        commitPluginRemovalState: (pluginName) => this.commitPluginRemovalState(pluginName),
        restorePluginRemovalState: (snapshot) => this.restorePluginRemovalState(snapshot)
      }
    })
    const recovery = await this.pluginInstallUnits.recoverPendingTransactions()
    if (recovery.failed.length > 0) {
      const details = recovery.failed
        .map((failure) => `${failure.pluginName || failure.transactionId}: ${failure.error}`)
        .join('；')
      throw new Error(`插件事务恢复失败：${details}`)
    }
    this.installer = new PluginInstallerAPI({
      get mainWindow() {
        return mainWindow
      },
      get pluginManager() {
        return pluginManager
      },
      get devProjects() {
        return pluginsAPI.devProjects
      },
      get pluginInstallUnits() {
        return pluginsAPI.pluginInstallUnits
      },
      getPlugins: () => this.getPlugins(),
      readInstalledPlugins: () => this.readInstalledPlugins(),
      notifyPluginsChanged: () => this.notifyPluginsChanged(),
      validatePluginConfig: (config, existing) => this.validatePluginConfig(config, existing)
    })
    this.setupIPC()
  }

  public setCommandsCacheInvalidator(invalidator: () => void): void {
    this.commandsCacheInvalidator = invalidator
  }

  private setupIPC(): void {
    ipcMain.handle('get-plugins', () => this.getPlugins())
    ipcMain.handle('get-all-plugins', () => this.getAllPlugins())
    ipcMain.handle('get-disabled-plugins', () => this.getDisabledPlugins())
    ipcMain.handle('set-plugin-disabled', (_event, pluginPath: string, disabled: boolean) =>
      this.setPluginDisabled(pluginPath, disabled)
    )
    ipcMain.handle('import-plugin', () => this.installer.importPlugin())
    ipcMain.handle('import-dev-plugin', (_event, pluginJsonPath?: string) =>
      this.devProjects.importDevPlugin(pluginJsonPath)
    )
    ipcMain.handle('upsert-dev-project-by-config-path', (_event, pluginJsonPath: string) =>
      this.devProjects.upsertDevProjectByConfigPath(pluginJsonPath)
    )
    ipcMain.handle('get-dev-projects', () => this.devProjects.getDevProjects())
    ipcMain.handle('update-dev-projects-order', (_event, pluginNames: string[]) =>
      this.devProjects.updateDevProjectsOrder(pluginNames)
    )
    ipcMain.handle('remove-dev-project', (_event, pluginName: string) =>
      this.devProjects.removeDevProject(pluginName)
    )
    ipcMain.handle('install-dev-plugin', (_event, pluginName: string) =>
      this.devProjects.installDevPlugin(pluginName)
    )
    ipcMain.handle('uninstall-dev-plugin', (_event, pluginName: string) =>
      this.devProjects.uninstallDevPlugin(pluginName)
    )
    ipcMain.handle('validate-dev-project', (_event, pluginName: string) =>
      this.devProjects.validateDevProject(pluginName)
    )
    ipcMain.handle('select-dev-project-config', (_event, pluginName: string) =>
      this.devProjects.selectDevProjectConfig(pluginName)
    )
    ipcMain.handle(
      'package-dev-project',
      (_event, pluginName: string, packagePath?: string, version?: string) =>
        this.devProjects.packageDevProject(pluginName, packagePath, version)
    )
    ipcMain.handle('delete-plugin', (_event, pluginPath: string, options?: DeletePluginOptions) =>
      this.deletePlugin(pluginPath, options)
    )
    ipcMain.handle('get-running-plugins', () => this.getRunningPlugins())
    ipcMain.handle('kill-plugin', (_event, pluginPath: string) => this.killPlugin(pluginPath))
    ipcMain.handle('kill-plugin-and-return', (_event, pluginPath: string) =>
      this.killPluginAndReturn(pluginPath)
    )
    ipcMain.handle('fetch-plugin-market', () => this.market.fetchPluginMarket())
    ipcMain.handle('fetch-plugin-market-recommendations', (_event, limit?: number) =>
      this.market.fetchPluginMarketRecommendations(limit)
    )
    ipcMain.handle(
      'fetch-plugin-market-comments',
      (_event, pluginName: string, page?: number, pageSize?: number) =>
        this.market.fetchComments(pluginName, page, pageSize)
    )
    ipcMain.handle(
      'create-plugin-market-comment',
      (_event, input: { pluginName: string; content: string; parentId?: number | null }) =>
        this.market.createComment(input)
    )
    ipcMain.handle('toggle-plugin-market-comment-like', (_event, commentId: number) =>
      this.market.toggleCommentLike(commentId)
    )
    ipcMain.handle('delete-plugin-market-comment', (_event, commentId: number) =>
      this.market.deleteComment(commentId)
    )
    ipcMain.handle('install-plugin-from-market', (event, plugin: any) =>
      this.installer.installPluginFromMarket(plugin, event.sender)
    )
    ipcMain.handle('cancel-plugin-market-download', (_event, pluginNameOrTaskId: string) =>
      this.installer.cancelPluginMarketDownload(pluginNameOrTaskId)
    )
    ipcMain.handle('get-plugin-readme', (_event, pluginPathOrName: string, pluginName?: string) =>
      this.getPluginReadme(pluginPathOrName, pluginName)
    )
    ipcMain.handle('get-plugin-db-data', (_event, pluginName: string) =>
      this.getPluginDbData(pluginName)
    )
    ipcMain.handle('read-plugin-info-from-zpx', (_event, zpxPath: string) =>
      this.installer.readPluginInfoFromZpx(zpxPath)
    )
    ipcMain.handle('install-plugin-from-path', (_event, zpxPath: string) =>
      this.installer.installPluginFromPath(zpxPath)
    )
    // mainPush 功能：查询插件的动态搜索结果
    ipcMain.handle(
      'query-main-push',
      async (_event, pluginPath: string, featureCode: string, queryData: any) => {
        try {
          if (this.isPluginDisabled(pluginPath)) {
            return []
          }
          return await this.pluginManager?.queryMainPush(pluginPath, featureCode, queryData)
        } catch (error: unknown) {
          console.error('[Plugins] mainPush 查询失败:', error)
          return []
        }
      }
    )

    // mainPush 功能：通知插件用户选择了搜索结果
    ipcMain.handle(
      'select-main-push',
      async (_event, pluginPath: string, featureCode: string, selectData: any) => {
        try {
          if (this.isPluginDisabled(pluginPath)) {
            return false
          }
          return await this.pluginManager?.selectMainPush(pluginPath, featureCode, selectData)
        } catch (error: unknown) {
          console.error('[Plugins] mainPush 选择失败:', error)
          return false
        }
      }
    )

    ipcMain.handle(
      'call-headless-plugin',
      async (_event, pluginPath: string, featureCode: string, action: any) => {
        try {
          if (this.isPluginDisabled(pluginPath)) {
            return { success: false, error: '插件已禁用' }
          }
          const result = await this.pluginManager?.callHeadlessPluginMethod(
            pluginPath,
            featureCode,
            action
          )
          return { success: true, result }
        } catch (error: unknown) {
          console.error('[Plugins] 调用无界面插件失败:', error)
          return { success: false, error: error instanceof Error ? error.message : '未知错误' }
        }
      }
    )

    ipcMain.handle('get-plugin-memory-info', async (_event, pluginPath: string) => {
      try {
        const memoryInfo = await this.pluginManager?.getPluginMemoryInfo(pluginPath)
        return { success: true, data: memoryInfo }
      } catch (error: unknown) {
        console.error('[Plugins] 获取插件内存信息失败:', error)
        return { success: false, error: error instanceof Error ? error.message : '获取失败' }
      }
    })

    ipcMain.handle(
      'install-plugin-from-npm',
      (_event, options: { packageName: string; useChinaMirror?: boolean }) =>
        this.installer.installPluginFromNpm(options.packageName, options.useChinaMirror)
    )

    ipcMain.handle('export-all-plugins', () => this.installer.exportAllPlugins())
  }

  // 获取插件列表（过滤掉内置插件，用于插件中心显示）
  public async getPlugins(): Promise<any[]> {
    const allPlugins = await this.getAllPlugins()
    // 过滤掉所有内置插件（system、setting 等）
    return allPlugins.filter((plugin: any) => !isBundledInternalPlugin(plugin.name))
  }

  public getDisabledPlugins(): string[] {
    if (this.disabledPluginPathSet) {
      return [...this.disabledPluginPathSet]
    }

    const data = databaseAPI.dbGet(DISABLED_PLUGINS_KEY)
    const disabledPlugins = Array.isArray(data)
      ? data.filter((item): item is string => typeof item === 'string')
      : []

    this.disabledPluginPathSet = new Set(disabledPlugins)
    return disabledPlugins
  }

  public getDisabledPluginSet(): Set<string> {
    if (!this.disabledPluginPathSet) {
      this.getDisabledPlugins()
    }
    // getDisabledPlugins() 确保 disabledPluginPathSet 被初始化
    return this.disabledPluginPathSet!
  }

  public isPluginDisabled(pluginPath: string): boolean {
    return this.getDisabledPluginSet().has(pluginPath)
  }

  public async setPluginDisabled(
    pluginPath: string,
    disabled: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const plugins = databaseAPI.dbGet('plugins')
      if (!Array.isArray(plugins)) {
        return { success: false, error: '插件列表不存在' }
      }

      const plugin = plugins.find((item: any) => item.path === pluginPath)
      if (!plugin) {
        return { success: false, error: '插件不存在' }
      }
      if (isBundledInternalPlugin(plugin.name)) {
        return { success: false, error: '内置插件不能禁用' }
      }

      const disabledPlugins = this.getDisabledPluginSet()
      const isCurrentlyDisabled = disabledPlugins.has(pluginPath)
      if (isCurrentlyDisabled === disabled) {
        return { success: true }
      }

      if (disabled) {
        disabledPlugins.add(pluginPath)
      } else {
        disabledPlugins.delete(pluginPath)
      }
      this.disabledPluginPathSet = disabledPlugins
      databaseAPI.dbPut(DISABLED_PLUGINS_KEY, [...disabledPlugins])

      if (disabled && this.pluginManager) {
        this.pluginManager.killPlugin(pluginPath)
      }

      this.commandsCacheInvalidator?.()
      this.mainWindow?.webContents.send('plugins-changed')
      this.mainWindow?.webContents.send('super-panel-pinned-changed')
      return { success: true }
    } catch (error: unknown) {
      console.error('[Plugins] 更新插件禁用状态失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 获取所有插件列表（包括 system 插件，用于生成搜索指令）
  public async getAllPlugins(): Promise<any[]> {
    try {
      const data = databaseAPI.dbGet('plugins')
      const plugins = data || []

      // 合并动态 features
      for (const plugin of plugins) {
        const dynamicFeatures = pluginFeatureAPI.loadDynamicFeatures(plugin.name)
        plugin.features = [...(plugin.features || []), ...dynamicFeatures]

        // 处理插件 logo 路径
        if (plugin.logo) {
          plugin.logo = normalizeIconPath(plugin.logo, plugin.path)
        }

        // 处理每个 feature 的 icon 路径
        if (plugin.features && Array.isArray(plugin.features)) {
          for (const feature of plugin.features) {
            if (feature.icon) {
              feature.icon = normalizeIconPath(feature.icon, plugin.path)
            }
          }
        }
      }

      return plugins
    } catch (error) {
      console.error('[Plugins] 获取插件列表失败:', error)
      return []
    }
  }

  private readInstalledPlugins(): any[] {
    const plugins = databaseAPI.dbGet('plugins')
    return Array.isArray(plugins) ? plugins : []
  }

  private writeInstalledPlugins(plugins: any[]): void {
    databaseAPI.dbPut('plugins', plugins)
  }

  /** 同步更新禁用路径内存索引与持久化状态。 */
  private writeDisabledPluginPaths(paths: string[]): void {
    this.disabledPluginPathSet = new Set(paths)
    databaseAPI.dbPut(DISABLED_PLUGINS_KEY, paths)
  }

  private notifyPluginsChanged(): void {
    this.commandsCacheInvalidator?.()
    this.mainWindow?.webContents.send('plugins-changed')
  }

  /**
   * 验证插件配置
   * @param pluginConfig 插件配置对象
   * @param existingPlugins 已存在的插件列表
   * @returns 验证结果 { valid: boolean, error?: string }
   */
  private validatePluginConfig(
    pluginConfig: any,
    existingPlugins: any[]
  ): { valid: true } | { valid: false; error: string } {
    // 检查 title 是否冲突（如果有 title 字段）
    // 排除开发版插件（name 以 __dev 结尾），因为开发版和安装版可以共存，title 相同是合理的
    if (pluginConfig.title) {
      const titleConflict = existingPlugins.find(
        (p: any) => p.title === pluginConfig.title && !isDevelopmentPluginName(p.name)
      )
      if (titleConflict) {
        return {
          valid: false,
          error: `插件标题 "${pluginConfig.title}" 已被插件 "${titleConflict.name}" 使用，请使用不同的标题`
        }
      }
    }

    // 校验必填字段
    const requiredFields = ['name', 'version']
    for (const field of requiredFields) {
      if (!pluginConfig[field]) {
        return { valid: false, error: `缺少必填字段: ${field}` }
      }
    }

    // 检查插件是否声明了 features 或 tools（至少需要一个）
    const hasFeatures = Array.isArray(pluginConfig.features) && pluginConfig.features.length > 0
    const hasTools =
      pluginConfig.tools &&
      typeof pluginConfig.tools === 'object' &&
      !Array.isArray(pluginConfig.tools) &&
      Object.keys(pluginConfig.tools).length > 0

    // features 和 tools 不能同时为空
    if (!hasFeatures && !hasTools) {
      return { valid: false, error: 'features 和 tools 不能同时为空' }
    }

    // 校验 features 字段（传统插件功能）
    if (hasFeatures) {
      for (const feature of pluginConfig.features) {
        if (!feature.code || !Array.isArray(feature.cmds)) {
          return { valid: false, error: 'feature 缺少必填字段 (code, cmds)' }
        }
      }
    }

    // 校验 tools 字段（MCP 工具声明）
    if (hasTools) {
      for (const [toolName, tool] of Object.entries(pluginConfig.tools)) {
        // 工具名必须使用小写 snake_case 命名（符合 MCP 规范）
        if (!/^[a-z][a-z0-9_]*$/.test(toolName)) {
          return { valid: false, error: `tools.${toolName} 必须使用小写 snake_case 命名` }
        }
        if (!tool || typeof tool !== 'object') {
          return { valid: false, error: `tools.${toolName} 配置无效` }
        }
        // 必须提供工具描述
        if (typeof (tool as any).description !== 'string' || !(tool as any).description.trim()) {
          return { valid: false, error: `tools.${toolName}.description 必须是非空字符串` }
        }
        // 必须提供 JSON Schema 格式的输入参数定义
        if (
          !(tool as any).inputSchema ||
          typeof (tool as any).inputSchema !== 'object' ||
          Array.isArray((tool as any).inputSchema)
        ) {
          return { valid: false, error: `tools.${toolName}.inputSchema 必须是对象` }
        }
      }
    }

    // 无界面插件（仅声明 tools，没有 main）的额外校验
    if (!pluginConfig.main && hasTools) {
      if (!pluginConfig.preload) {
        return { valid: false, error: '声明 tools 的插件必须提供 preload' }
      }
      if (!pluginConfig.logo) {
        return { valid: false, error: '声明 tools 的插件必须提供 logo' }
      }
    }

    return { valid: true }
  }

  private resolvePluginLogo(pluginPath: string, logo: unknown): string {
    if (typeof logo !== 'string' || !logo) return ''
    if (/^(https?:|file:)/.test(logo)) return logo
    return pathToFileURL(path.join(pluginPath, logo)).href
  }

  /**
   * 删除插件
   * @param pluginPath 插件路径
   * @param options 删除选项 当 options.deleteData 显式设置为 false 时，保留插件数据
   */
  public async deletePlugin(pluginPath: string, options: DeletePluginOptions = {}): Promise<any> {
    try {
      const plugins: InstalledPluginRecord[] = databaseAPI.dbGet('plugins')
      if (!plugins || !Array.isArray(plugins)) {
        return { success: false, error: '插件列表不存在' }
      }

      const pluginIndex = plugins.findIndex((plugin) => plugin.path === pluginPath)
      if (pluginIndex === -1) {
        return { success: false, error: '插件不存在' }
      }

      const pluginInfo = plugins[pluginIndex]

      // ✅ 检查是否为内置插件
      if (isBundledInternalPlugin(pluginInfo.name)) {
        return {
          success: false,
          error: '内置插件不能卸载'
        }
      }

      return await this.deleteInstalledPlugin({
        plugins,
        pluginIndex,
        pluginInfo,
        deleteData: options.deleteData !== false
      })
    } catch (error: unknown) {
      console.error('[Plugins] 删除插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /** 执行实体提交，并在成功提交后清理非实体引用与可选数据。 */
  private async deleteInstalledPlugin(options: {
    plugins: InstalledPluginRecord[]
    pluginIndex: number
    pluginInfo: InstalledPluginRecord
    deleteData: boolean
  }): Promise<{ success: true; warning?: string }> {
    const warnings: string[] = []
    if (options.pluginInfo.isDevelopment) {
      this.removeDevelopmentPluginRecord(options)
      this.collectCleanupWarning(warnings, this.cleanupPluginUsage(options.pluginInfo.name))
      this.collectCleanupWarning(warnings, this.cleanupProviderUsage(options.pluginInfo.name))
      if (options.deleteData) {
        this.removePluginNameConfigs(PLUGIN_NAME_SETTING_KEYS, options.pluginInfo.name)
      }
    } else {
      const applicationState = this.capturePluginRemovalState()
      const mutation = await this.pluginInstallUnits.removePlugin({
        plugin: options.pluginInfo,
        stopPrevious: async () => {
          await this.pluginManager?.stopPluginByName(options.pluginInfo.name)
        },
        commitApplicationState: () => this.commitPluginRemovalState(options.pluginInfo.name),
        rollbackApplicationState: () => this.restorePluginRemovalState(applicationState)
      })
      if (mutation.warning) warnings.push(mutation.warning)
    }

    if (options.deleteData) {
      this.collectCleanupWarning(warnings, await this.cleanupPluginData(options.pluginInfo.name))
    }
    this.notifyPluginsChanged()
    return warnings.length > 0 ? { success: true, warning: warnings.join('；') } : { success: true }
  }

  /** 开发插件只移除安装记录和禁用状态，源码目录继续由开发者管理。 */
  private removeDevelopmentPluginRecord(options: {
    plugins: InstalledPluginRecord[]
    pluginIndex: number
    pluginInfo: InstalledPluginRecord
  }): void {
    this.pluginManager?.killPlugin(options.pluginInfo.path)
    options.plugins.splice(options.pluginIndex, 1)
    this.writeInstalledPlugins(options.plugins)
    this.removeDisabledPluginPath(options.pluginInfo.path)
    console.log('[Plugins] 开发中插件，保留目录:', options.pluginInfo.path)
  }

  /** 清理开发项目对插件身份的使用记录。 */
  private cleanupPluginUsage(pluginName: string): string | undefined {
    try {
      this.devProjects.removePluginUsageData(pluginName)
      return undefined
    } catch (error) {
      return `插件引用清理失败：${this.errorMessage(error)}`
    }
  }

  /** 清理 provider 中指向已卸载插件的配置引用。 */
  private cleanupProviderUsage(pluginName: string): string | undefined {
    try {
      providerManager.cleanupForPlugin(pluginName)
      return undefined
    } catch (error) {
      return `Provider 配置清理失败：${this.errorMessage(error)}`
    }
  }

  /** 捕获正式卸载会修改的主程序状态，供实体事务失败时逐键恢复。 */
  private capturePluginRemovalState(): PluginRemovalStateSnapshot {
    const values: Record<string, unknown> = {}
    for (const key of PLUGIN_REMOVAL_STATE_KEYS) {
      values[key] = structuredClone(databaseAPI.dbGet(key))
    }
    return { values }
  }

  /** 提交正式插件卸载涉及的引用、Provider 与设置清理。 */
  private commitPluginRemovalState(pluginName: string): void {
    this.devProjects.removePluginUsageData(pluginName)
    providerManager.cleanupForPlugin(pluginName)
    this.removePluginNameConfigs(PLUGIN_NAME_SETTING_KEYS, pluginName)
  }

  /** 恢复卸载开始前捕获的应用状态；任何写入失败都会继续阻止成功结果。 */
  private restorePluginRemovalState(snapshot: PluginRemovalStateSnapshot): void {
    for (const [key, value] of Object.entries(snapshot.values)) {
      if (value === null) {
        databaseAPI.dbRemove(key)
      } else {
        databaseAPI.dbPut(key, value)
      }
    }
    this.mainWindow?.webContents.send('history-changed')
    this.mainWindow?.webContents.send('pinned-changed')
  }

  /** 清理插件持久数据，并把提交后的失败转换为明确警告。 */
  private async cleanupPluginData(pluginName: string): Promise<string | undefined> {
    try {
      const result = await databaseAPI.clearPluginData(pluginName)
      return result?.success === false
        ? `插件数据清理失败：${result.error || '未知错误'}`
        : undefined
    } catch (error) {
      return `插件数据清理失败：${this.errorMessage(error)}`
    }
  }

  /** 删除开发插件记录对应的禁用路径。 */
  private removeDisabledPluginPath(pluginPath: string): void {
    const disabledPlugins = this.getDisabledPluginSet()
    if (!disabledPlugins.delete(pluginPath)) return
    this.writeDisabledPluginPaths([...disabledPlugins])
  }

  /** 只收集真实存在的清理警告。 */
  private collectCleanupWarning(warnings: string[], warning: string | undefined): void {
    if (warning) warnings.push(warning)
  }

  /** 保留未知异常中的原始错误信息。 */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private removePluginNameConfigs(keys: string[], pluginName: string): void {
    for (const key of keys) {
      const current = databaseAPI.dbGet(key)
      const normalized = normalizeConfigList(current)
      const next = removePluginNameFromSettingList(normalized, pluginName)
      if (next.length !== normalized.length) {
        databaseAPI.dbPut(key, next)
      }
    }
  }

  public async setPluginMainPushEnabled(
    pluginName: string,
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const enabledPluginNames = new Set(
        normalizeConfigList(databaseAPI.dbGet(ENABLED_MAIN_PUSH_PLUGINS_KEY))
      )
      const isCurrentlyEnabled = enabledPluginNames.has(pluginName)
      if (isCurrentlyEnabled === enabled) {
        return { success: true }
      }

      if (enabled) {
        enabledPluginNames.add(pluginName)
      } else {
        enabledPluginNames.delete(pluginName)
      }

      databaseAPI.dbPut(ENABLED_MAIN_PUSH_PLUGINS_KEY, [...enabledPluginNames])
      this.notifyPluginsChanged()
      return { success: true }
    } catch (error: unknown) {
      console.error('[Plugins] 更新插件 mainPush 状态失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 获取运行中的插件
  public getRunningPlugins(): string[] {
    if (this.pluginManager) {
      return this.pluginManager.getRunningPlugins()
    }
    return []
  }

  // 终止插件
  public killPlugin(pluginPath: string): { success: boolean; error?: string } {
    try {
      console.log('[Plugins] 终止插件:', pluginPath)
      if (this.pluginManager) {
        const result = this.pluginManager.killPlugin(pluginPath)
        if (result) {
          return { success: true }
        } else {
          return { success: false, error: '插件未运行' }
        }
      }
      return { success: false, error: '功能不可用' }
    } catch (error: unknown) {
      console.error('[Plugins] 终止插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 终止插件并返回搜索页面
  private killPluginAndReturn(pluginPath: string): { success: boolean; error?: string } {
    try {
      console.log('[Plugins] 终止插件并返回搜索页面:', pluginPath)
      if (this.pluginManager) {
        const result = this.pluginManager.killPlugin(pluginPath)
        if (result) {
          windowManager.notifyBackToSearch()
          this.mainWindow?.webContents.focus()
          return { success: true }
        } else {
          return { success: false, error: '插件未运行' }
        }
      }
      return { success: false, error: '功能不可用' }
    } catch (error: unknown) {
      console.error('[Plugins] 终止插件并返回搜索页面失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 获取插件 README.md 内容
  public async getPluginReadme(
    pluginPathOrName: string,
    pluginName?: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      const name = pluginName || pluginPathOrName
      if (!name || name.includes('/') || name.includes('\\')) {
        return { success: false, error: '插件名称不存在' }
      }
      const installedPlugin = this.readInstalledPlugins().find((plugin) => plugin.name === name)
      if (installedPlugin) {
        return await this.getInstalledPluginReadme(installedPlugin)
      }
      return await this.getRemotePluginReadme(name)
    } catch (error: unknown) {
      console.error('[Plugins] 读取插件 README 失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '读取失败' }
    }
  }

  /** 从目录或 ASAR 虚拟根路径读取已安装插件的 README。 */
  private async getInstalledPluginReadme(
    plugin: InstalledPluginRecord
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      const content = await fs.readFile(path.join(plugin.path, 'README.md'), 'utf8')
      return { success: true, content }
    } catch (error) {
      return { success: false, error: this.errorMessage(error) }
    }
  }

  // 从远程加载插件 README
  private async getRemotePluginReadme(
    pluginName: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      const response = await requestPluginMarket(
        `/plugins/readme?name=${encodeURIComponent(pluginName)}`
      )
      const data = response.data as { content?: string; error?: string }
      if (!data.content) {
        return { success: false, error: data.error || '暂无详情' }
      }
      return { success: true, content: data.content }
    } catch (error: unknown) {
      console.error('[Plugins] 从服务端加载插件 README 失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '加载失败' }
    }
  }

  // 获取插件存储的数据库数据
  private getPluginDbData(pluginName: string): {
    success: boolean
    data?: any
    error?: string
  } {
    try {
      if (pluginName === 'ZTOOLS') {
        const allData = lmdbInstance.allDocs('ZTOOLS/')
        return {
          success: true,
          data: allData.map((item: any) => ({
            id: item._id.substring('ZTOOLS/'.length),
            data: item.data,
            rev: item._rev,
            updatedAt: item.updatedAt || item._updatedAt
          }))
        }
      }

      if (!pluginName) {
        return { success: false, error: '插件标识无效' }
      }

      const prefix = getPluginDataPrefix(pluginName)
      const allData = lmdbInstance.allDocs(prefix)

      if (!allData || allData.length === 0) {
        return { success: true, data: [] }
      }

      const formattedData = allData.map((item: any) => ({
        id: item._id.substring(prefix.length),
        data: item.data,
        rev: item._rev,
        updatedAt: item.updatedAt || item._updatedAt
      }))

      return { success: true, data: formattedData }
    } catch (error: unknown) {
      console.error('[Plugins] 获取插件数据失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '获取失败' }
    }
  }
}

const pluginsAPI = new PluginsAPI()
export default pluginsAPI
