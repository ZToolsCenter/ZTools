import type { PluginManager } from '../../managers/pluginManager'
import { ipcMain } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { removePluginArtifact } from '../../utils/pluginStorage.js'
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
import {
  getPluginDataPrefix,
  isDevelopmentPluginName
} from '../../../shared/pluginRuntimeNamespace'
import {
  ENABLED_MAIN_PUSH_PLUGINS_KEY,
  normalizeConfigList,
  removePluginNameFromSettingList
} from '../../../shared/pluginSettings'

// 插件目录
const DISABLED_PLUGINS_KEY = 'disabled-plugins'
const PLUGIN_NAME_SETTING_KEYS = [
  'out-kill-plugin',
  'auto-detach-plugin',
  'auto-start-plugin',
  ENABLED_MAIN_PUSH_PLUGINS_KEY
]

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
  public devProjects!: PluginDevProjectsAPI
  public installer!: PluginInstallerAPI
  public market!: PluginMarketAPI

  /**
   * 初始化插件 API 及其依赖，并注册 IPC 处理器。
   * @param mainWindow 主窗口
   * @param pluginManager 插件运行管理器
   * @returns 无返回值
   */
  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
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
      getPlugins: () => this.getPlugins(),
      readInstalledPlugins: () => this.readInstalledPlugins(),
      writeInstalledPlugins: (plugins) => this.writeInstalledPlugins(plugins),
      notifyPluginsChanged: () => this.notifyPluginsChanged(),
      replacePluginPathReferences: (name, oldPath, newPath) =>
        this.replacePluginPathReferences(name, oldPath, newPath),
      validatePluginConfig: (config, existing) => this.validatePluginConfig(config, existing)
    })
    this.setupIPC()
  }

  /**
   * 设置插件变化时使用的命令缓存失效回调。
   * @param invalidator 命令缓存失效函数
   * @returns 无返回值
   */
  public setCommandsCacheInvalidator(invalidator: () => void): void {
    this.commandsCacheInvalidator = invalidator
  }

  /**
   * 注册插件管理相关的主进程 IPC 处理器。
   * @returns 无返回值
   */
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

  /**
   * 获取插件中心展示的正式和开发插件列表。
   * @returns 已过滤内置插件的列表
   */
  public async getPlugins(): Promise<any[]> {
    const allPlugins = await this.getAllPlugins()
    // 过滤掉所有内置插件（system、setting 等）
    return allPlugins.filter((plugin: any) => !isBundledInternalPlugin(plugin.name))
  }

  /**
   * 获取禁用插件的当前物理路径，并迁移历史路径标识为稳定插件名。
   * @returns 禁用插件的当前物理路径列表
   */
  public getDisabledPlugins(): string[] {
    if (this.disabledPluginPathSet) {
      return [...this.disabledPluginPathSet]
    }

    const data = databaseAPI.dbGet(DISABLED_PLUGINS_KEY)
    const disabledIdentifiers = Array.isArray(data)
      ? data.filter((item): item is string => typeof item === 'string')
      : []
    const installedPlugins = this.readInstalledPlugins()
    // 对外仍返回路径，兼容现有的运行时过滤逻辑。
    const disabledPaths = disabledIdentifiers.map((identifier) => {
      const plugin = installedPlugins.find(
        (item: any) => item.name === identifier || item.path === identifier
      )
      return plugin?.path || identifier
    })

    this.disabledPluginPathSet = new Set(disabledPaths)
    // 持久化数据统一改为插件名，版本化 ASAR 升级后无需迁移禁用标识。
    const normalizedNames = disabledIdentifiers.map((identifier) => {
      const plugin = installedPlugins.find(
        (item: any) => item.name === identifier || item.path === identifier
      )
      return plugin?.name || identifier
    })
    if (normalizedNames.some((value, index) => value !== disabledIdentifiers[index])) {
      databaseAPI.dbPut(DISABLED_PLUGINS_KEY, normalizedNames)
    }
    return disabledPaths
  }

  /**
   * 获取禁用插件路径集合的进程内缓存。
   * @returns 可用于快速路径判断的集合
   */
  public getDisabledPluginSet(): Set<string> {
    if (!this.disabledPluginPathSet) {
      this.getDisabledPlugins()
    }
    // getDisabledPlugins() 确保 disabledPluginPathSet 被初始化
    return this.disabledPluginPathSet!
  }

  /**
   * 判断指定插件路径是否处于禁用状态。
   * @param pluginPath 插件当前物理路径
   * @returns 插件是否禁用
   */
  public isPluginDisabled(pluginPath: string): boolean {
    return this.getDisabledPluginSet().has(pluginPath)
  }

  /**
   * 启用或禁用正式插件。
   * @param pluginPath 插件当前物理路径
   * @param disabled 是否禁用
   * @returns 更新结果
   */
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
      this.writeDisabledPluginPaths([...disabledPlugins])

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

  /**
   * 获取包括内置插件在内的全部插件，并解析动态功能和图标。
   * @returns 完整插件列表
   */
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

  /**
   * 读取当前插件注册表。
   * @returns 插件记录列表；存储值无效时返回空数组
   */
  private readInstalledPlugins(): any[] {
    const plugins = databaseAPI.dbGet('plugins')
    return Array.isArray(plugins) ? plugins : []
  }

  /**
   * 覆盖写入插件注册表。
   * @param plugins 完整插件记录列表
   * @returns 无返回值
   */
  private writeInstalledPlugins(plugins: any[]): void {
    databaseAPI.dbPut('plugins', plugins)
  }

  /**
   * 更新禁用插件路径缓存，并按稳定插件名持久化。
   * @param paths 禁用插件的当前物理路径列表
   * @returns 无返回值
   */
  private writeDisabledPluginPaths(paths: string[]): void {
    this.disabledPluginPathSet = new Set(paths)
    const plugins = this.readInstalledPlugins()
    const identifiers = paths.map((pluginPath) => {
      const plugin = plugins.find((item: any) => item.path === pluginPath)
      return plugin?.name || pluginPath
    })
    databaseAPI.dbPut(DISABLED_PLUGINS_KEY, identifiers)
  }

  /**
   * 更新升级后仍携带旧物理路径的插件状态。
   * @param pluginName 稳定插件名
   * @param oldPath 升级前物理路径
   * @param newPath 升级后物理路径
   * @returns 无返回值
   */
  private replacePluginPathReferences(pluginName: string, oldPath: string, newPath: string): void {
    // 先刷新禁用状态的运行时路径缓存。
    const disabledPaths = this.getDisabledPluginSet()
    if (disabledPaths.delete(oldPath)) {
      disabledPaths.add(newPath)
      this.writeDisabledPluginPaths([...disabledPaths])
    }

    // 命令历史和普通置顶都是扁平数组，可按 pluginName 统一更新。
    const updateFlatList = (key: string): void => {
      const value = databaseAPI.dbGet(key)
      if (!Array.isArray(value)) return
      let changed = false
      const next = value.map((item: any) => {
        const belongsToPlugin =
          item?.pluginName === pluginName ||
          (item?.type === 'plugin' && item?.name === pluginName && item?.path === oldPath)
        if (!belongsToPlugin || item.path === newPath) return item
        changed = true
        return { ...item, path: newPath }
      })
      if (changed) databaseAPI.dbPut(key, next)
    }

    updateFlatList('command-history')
    updateFlatList('pinned-commands')
    updateFlatList('command-usage-stats')

    // 超级面板允许文件夹嵌套，需要递归更新其中的插件项。
    const pinned = databaseAPI.dbGet('super-panel-pinned')
    if (Array.isArray(pinned)) {
      let changed = false
      const updateItem = (item: any): any => {
        if (item?.isFolder && Array.isArray(item.items)) {
          const items = item.items.map(updateItem)
          if (items.some((child: any, index: number) => child !== item.items[index])) {
            changed = true
            return { ...item, items }
          }
          return item
        }
        if (item?.type === 'plugin' && item?.pluginName === pluginName && item.path !== newPath) {
          changed = true
          return { ...item, path: newPath }
        }
        return item
      }
      const nextPinned = pinned.map(updateItem)
      if (changed) databaseAPI.dbPut('super-panel-pinned', nextPinned)
    }
  }

  /**
   * 使插件相关缓存失效并通知渲染进程刷新。
   * @returns 无返回值
   */
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
  ): { valid: boolean; error?: string } {
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

  /**
   * 将插件 logo 配置解析为可加载 URL。
   * @param pluginPath 插件根路径
   * @param logo plugin.json 中的 logo 值
   * @returns 可加载 URL；配置无效时返回空字符串
   */
  private resolvePluginLogo(pluginPath: string, logo: unknown): string {
    if (typeof logo !== 'string' || !logo) return ''
    if (/^(https?:|file:)/.test(logo)) return logo
    return pathToFileURL(path.join(pluginPath, logo)).href
  }

  /**
   * 删除插件
   * @param pluginPath 插件路径
   * @param options 删除选项 当 options.deleteData 显式设置为 false 时，保留插件数据
   * @returns 删除结果
   */
  public async deletePlugin(pluginPath: string, options: DeletePluginOptions = {}): Promise<any> {
    try {
      const plugins: any = databaseAPI.dbGet('plugins')
      if (!plugins || !Array.isArray(plugins)) {
        return { success: false, error: '插件列表不存在' }
      }

      const pluginIndex = plugins.findIndex((p: any) => p.path === pluginPath)
      if (pluginIndex === -1) {
        return { success: false, error: '插件不存在' }
      }

      const pluginInfo = plugins[pluginIndex]

      // 内置插件不允许通过正式插件卸载入口删除。
      if (isBundledInternalPlugin(pluginInfo.name)) {
        return {
          success: false,
          error: '内置插件不能卸载'
        }
      }

      // 先停止运行实例，再移除注册记录和关联状态。
      this.pluginManager?.killPlugin(pluginPath)

      plugins.splice(pluginIndex, 1)
      databaseAPI.dbPut('plugins', plugins)

      this.devProjects.removePluginUsageData(pluginInfo.name)

      // 清理该插件的 provider 配置（启用 / 默认 / 自定义参数）
      // 与插件数据无关，卸载即应移除，避免残留指向已卸载插件的 provider 引用。
      try {
        providerManager.cleanupForPlugin(pluginInfo.name)
      } catch (error) {
        console.error('[Plugins] 清理 provider 配置失败:', error)
      }

      if (options.deleteData !== false) {
        await databaseAPI.clearPluginData(pluginInfo.name)
        this.removePluginNameConfigs(PLUGIN_NAME_SETTING_KEYS, pluginInfo.name)
      }

      // 删除禁用插件标识
      const disabledPlugins = this.getDisabledPluginSet()
      if (disabledPlugins.delete(pluginPath)) this.writeDisabledPluginPaths([...disabledPlugins])

      this.notifyPluginsChanged()

      if (!pluginInfo.isDevelopment) {
        try {
          // ASAR 实体会连同 `.asar.unpacked` 一起删除。
          await removePluginArtifact(pluginInfo)
          console.log('[Plugins] 已删除插件实体:', pluginPath)
        } catch (error) {
          console.error('[Plugins] 删除插件目录失败:', error)
        }
      } else {
        console.log('[Plugins] 开发中插件，保留目录:', pluginPath)
      }

      return { success: true }
    } catch (error: unknown) {
      console.error('[Plugins] 删除插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 从插件名配置列表中移除指定插件。
   * @param keys 需要处理的数据库键
   * @param pluginName 待移除插件名
   * @returns 无返回值
   */
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

  /**
   * 更新插件 mainPush 功能的启用状态。
   * @param pluginName 插件名
   * @param enabled 是否启用
   * @returns 更新结果
   */
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

  /**
   * 获取当前运行中的插件路径。
   * @returns 运行中的插件路径列表
   */
  public getRunningPlugins(): string[] {
    if (this.pluginManager) {
      return this.pluginManager.getRunningPlugins()
    }
    return []
  }

  /**
   * 终止指定路径对应的插件实例。
   * @param pluginPath 插件物理路径
   * @returns 终止结果
   */
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

  /**
   * 终止插件实例并通知窗口返回搜索页面。
   * @param pluginPath 插件物理路径
   * @returns 终止结果
   */
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

  /**
   * 获取插件 README 内容。
   * @param pluginPathOrName 兼容旧调用的插件路径或插件名
   * @param pluginName 显式插件名
   * @returns README 查询结果
   */
  public async getPluginReadme(
    pluginPathOrName: string,
    pluginName?: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      const name = pluginName || pluginPathOrName
      if (!name || name.includes('/') || name.includes('\\')) {
        return { success: false, error: '插件名称不存在' }
      }
      return await this.getRemotePluginReadme(name)
    } catch (error: unknown) {
      console.error('[Plugins] 读取插件 README 失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '读取失败' }
    }
  }

  /**
   * 从插件市场加载 README 内容。
   * @param pluginName 插件名
   * @returns README 查询结果
   */
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

  /**
   * 获取指定插件命名空间中的数据库数据。
   * @param pluginName 插件名或宿主标识 ZTOOLS
   * @returns 数据查询结果
   */
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
