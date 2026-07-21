import type { PluginManager } from '../../managers/pluginManager'
import { dialog, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { isBundledInternalPlugin } from '../../core/internalPlugins'
import providerManager from '../../core/provider/providerManager'
import { toDevPluginName } from '../../../shared/pluginRuntimeNamespace'
import { packZpx } from '../../utils/zpxArchive.js'
import databaseAPI from '../shared/database'
import {
  DEV_PROJECT_REGISTRY_DB_KEY,
  reorderProjects,
  buildInstalledDevelopmentPlugin,
  canPackageDevProject,
  insertDevProjectAtTop,
  readDevProjectRegistry,
  rebindByConfig,
  updateProjectMeta,
  upsertByConfig,
  validateRepairConfigSelection,
  type DevProjectRegistry,
  type DevProjectRecord
} from './pluginDevelopmentRegistry'
import { openDialog } from '../../utils/windowUtils'

// ============================================================
// Dependencies Interface
// ============================================================

/**
 * 开发项目 API 的外部依赖接口。
 * 通过依赖注入解耦与 PluginsAPI 主类，便于测试。
 */
export interface DevProjectDeps {
  /** 主窗口实例，用于弹出对话框和发送 IPC 事件 */
  readonly mainWindow: Electron.BrowserWindow | null
  /** 插件管理器实例，用于终止插件 */
  readonly pluginManager: PluginManager | null
  /** 读取当前已安装插件列表 */
  readInstalledPlugins(): any[]
  /** 写入已安装插件列表到数据库 */
  writeInstalledPlugins(plugins: any[]): void
  /** 通知渲染进程插件列表已变更 */
  notifyPluginsChanged(): void
  /** 校验插件配置的合法性（必填字段、名称冲突等） */
  validatePluginConfig(config: any, existing: any[]): { valid: boolean; error?: string }
  /** 将插件相对 logo 路径解析为 file:// URL */
  resolvePluginLogo(pluginPath: string, logo: unknown): string
  /** 获取当前正在运行的插件路径列表 */
  getRunningPlugins(): string[]
}

// ============================================================
// Utilities
// ============================================================

/**
 * 将错误对象转换为可读字符串
 * @param error - 捕获的错误对象
 * @param fallback - 非 Error 实例时的回退文案
 */
function formatError(error: unknown, fallback = '未知错误'): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * 从文件系统读取并解析 plugin.json
 * @param configPath - plugin.json 的绝对路径
 * @returns 解析后的 JSON 对象
 * @throws 文件不存在或 JSON 格式错误时抛出
 */
async function readPluginConfigFromFile(configPath: string): Promise<any> {
  const content = await fs.readFile(configPath, 'utf-8')
  return JSON.parse(content)
}

// ============================================================
// Dev Projects API
// ============================================================

/**
 * 开发项目管理 API。
 * 负责开发项目的注册、校验、安装/卸载/重载、打包等全生命周期管理。
 * 通过 DevProjectDeps 依赖注入与主 PluginsAPI 解耦。
 */
export class PluginDevProjectsAPI {
  constructor(private deps: DevProjectDeps) {}

  // ---- Registry persistence ----

  /** 从 LMDB 读取并反序列化开发项目注册表 */
  private readRegistry(): DevProjectRegistry {
    return readDevProjectRegistry(databaseAPI.dbGet(DEV_PROJECT_REGISTRY_DB_KEY))
  }

  /** 将注册表序列化并写入 LMDB */
  private writeRegistry(registry: DevProjectRegistry): void {
    databaseAPI.dbPut(DEV_PROJECT_REGISTRY_DB_KEY, registry)
  }

  // ---- Config validation & refresh ----

  /**
   * 校验开发项目状态并刷新注册表。
   * 尝试读取 plugin.json，更新 status / configSnapshot / lastError 等字段。
   * 当 configPath 不可读时自动回退到 projectPath/plugin.json。
   * @param projectName - 要校验的项目名称
   * @param registry - 可选的注册表文档，省略时从数据库读取
   * @returns 校验结果，包含更新后的注册表和解析出的配置
   */
  private async validateAndRefreshState(
    projectName: string,
    registry?: DevProjectRegistry
  ): Promise<{
    success: boolean
    error?: string
    registry: DevProjectRegistry
    entry?: DevProjectRecord
    pluginConfig?: any
  }> {
    const currentRegistry = registry ?? this.readRegistry()
    const registryEntry = currentRegistry.projects[projectName]
    if (!registryEntry) {
      return {
        success: false,
        error: `开发项目 "${projectName}" 不存在`,
        registry: currentRegistry
      }
    }

    if (!registryEntry.projectPath || !registryEntry.configPath) {
      const now = new Date().toISOString()
      const nextRegistry: DevProjectRegistry = {
        ...currentRegistry,
        projects: {
          ...currentRegistry.projects,
          [projectName]: {
            ...registryEntry,
            status: 'unbound',
            lastValidatedAt: now,
            lastError: '项目未绑定有效路径'
          }
        }
      }
      this.writeRegistry(nextRegistry)
      return {
        success: false,
        error: '项目未绑定有效路径',
        registry: nextRegistry,
        entry: nextRegistry.projects[projectName]
      }
    }

    const now = new Date().toISOString()
    const fallbackConfigPath = path.join(registryEntry.projectPath, 'plugin.json')
    const candidateConfigPaths = [
      registryEntry.configPath,
      ...(fallbackConfigPath !== registryEntry.configPath ? [fallbackConfigPath] : [])
    ]

    let usedConfigPath = registryEntry.configPath
    let pluginConfig: any | null = null
    let validationStatus: DevProjectRecord['status'] = 'config_missing'
    let lastError = 'plugin.json 文件不存在'

    for (const candidatePath of candidateConfigPaths) {
      try {
        const loaded = await readPluginConfigFromFile(candidatePath)
        if (!loaded?.name) {
          validationStatus = 'invalid_config'
          lastError = 'plugin.json 缺少 name 字段'
          usedConfigPath = candidatePath
          break
        }
        if (loaded.name !== projectName) {
          validationStatus = 'invalid_config'
          lastError = `plugin.json name 与项目不一致（期望: ${projectName}，实际: ${loaded.name}）`
          usedConfigPath = candidatePath
          break
        }
        if (isBundledInternalPlugin(loaded.name)) {
          validationStatus = 'invalid_config'
          lastError = '内置插件不能作为开发项目'
          usedConfigPath = candidatePath
          break
        }
        validationStatus = 'ready'
        lastError = ''
        usedConfigPath = candidatePath
        pluginConfig = loaded
        break
      } catch (error) {
        validationStatus = 'config_missing'
        lastError = formatError(error, 'plugin.json 不可读取')
        usedConfigPath = candidatePath
      }
    }

    const nextEntry: DevProjectRecord = {
      ...registryEntry,
      projectPath: usedConfigPath ? path.dirname(usedConfigPath) : registryEntry.projectPath,
      configPath: usedConfigPath,
      status: validationStatus,
      lastValidatedAt: now,
      ...(lastError ? { lastError } : {}),
      ...(pluginConfig ? { configSnapshot: { ...pluginConfig }, updatedAt: now } : {})
    }
    if (!lastError && 'lastError' in nextEntry) {
      delete nextEntry.lastError
    }

    const nextRegistry: DevProjectRegistry = {
      ...currentRegistry,
      projects: { ...currentRegistry.projects, [projectName]: nextEntry }
    }
    this.writeRegistry(nextRegistry)

    return {
      success: validationStatus === 'ready',
      ...(validationStatus !== 'ready' ? { error: lastError } : {}),
      registry: nextRegistry,
      entry: nextEntry,
      ...(pluginConfig ? { pluginConfig } : {})
    }
  }

  // ---- Usage data cleanup ----

  /**
   * 清理与指定插件名关联的历史、固定、自启动等持久化数据。
   * 包括：command-history、pinned-commands、autoStartPlugin、outKillPlugin、autoDetachPlugin。
   * @param effectiveName - 插件的实际名称（含 __dev 后缀）
   */
  public removePluginUsageData(effectiveName: string): void {
    const mainWindow = this.deps.mainWindow

    const filterDbArray = (key: string, pred: (item: any) => boolean, event?: string): void => {
      const arr: any[] = databaseAPI.dbGet(key) || []
      const filtered = arr.filter(pred)
      if (filtered.length !== arr.length) {
        databaseAPI.dbPut(key, filtered)
        if (event) mainWindow?.webContents.send(event)
      }
    }

    filterDbArray(
      'command-history',
      (item) => item?.pluginName !== effectiveName,
      'history-changed'
    )
    filterDbArray('pinned-commands', (item) => item?.pluginName !== effectiveName, 'pinned-changed')
    filterDbArray('auto-start-plugin', (n) => n !== effectiveName)
    filterDbArray('out-kill-plugin', (n) => n !== effectiveName)
    filterDbArray('auto-detach-plugin', (n) => n !== effectiveName)
  }

  // ---- Public API ----

  /**
   * 获取所有开发项目列表（按 sortOrder 排序）。
   * 合并注册表信息和实际安装/运行状态，返回渲染端可直接使用的视图数据。
   * @returns 开发项目视图对象数组，包含名称、状态、是否安装、是否运行等信息
   */
  public async getDevProjects(): Promise<any[]> {
    try {
      const registry = this.readRegistry()
      const installedPlugins = this.deps.readInstalledPlugins()
      const runningSet = new Set(this.deps.getRunningPlugins().map((p) => path.resolve(p)))

      const devInstalledByName = new Map<string, any>()
      for (const plugin of installedPlugins) {
        if (plugin?.isDevelopment && typeof plugin?.name === 'string') {
          devInstalledByName.set(plugin.name, plugin)
        }
      }

      const orderedProjects = Object.entries(registry.projects).sort(
        ([, a], [, b]) => a.sortOrder - b.sortOrder
      )

      return orderedProjects.map(([name, project]) => {
        const projectPath = project.projectPath ? path.resolve(project.projectPath) : null
        const installedDevPlugin =
          devInstalledByName.get(toDevPluginName(name)) || devInstalledByName.get(name)
        const installedPath =
          typeof installedDevPlugin?.path === 'string'
            ? path.resolve(installedDevPlugin.path)
            : null

        return {
          name,
          title: project.configSnapshot.title,
          version: project.configSnapshot.version,
          description: project.configSnapshot.description || '',
          author: project.configSnapshot.author || '',
          homepage: project.configSnapshot.homepage || '',
          logo: projectPath
            ? this.deps.resolvePluginLogo(projectPath, project.configSnapshot.logo)
            : project.configSnapshot.logo || '',
          preload: project.configSnapshot.preload,
          features: Array.isArray(project.configSnapshot.features)
            ? project.configSnapshot.features
            : [],
          platform: Array.isArray(project.configSnapshot.platform)
            ? project.configSnapshot.platform
            : [],
          developmentMain: project.configSnapshot.development?.main,
          path: projectPath,
          configPath: project.configPath || null,
          localStatus: project.status || 'unbound',
          lastValidatedAt: project.lastValidatedAt || null,
          lastError: project.lastError || null,
          isDevModeInstalled: !!installedDevPlugin,
          isRunning: !!(
            (projectPath && runningSet.has(projectPath)) ||
            (installedPath && runningSet.has(installedPath))
          ),
          addedAt: project.addedAt,
          sortOrder: project.sortOrder
        }
      })
    } catch (error) {
      console.error('[DevProjects] 获取列表失败:', error)
      return []
    }
  }

  /**
   * 更新开发项目的排序顺序。
   * @param pluginNames - 期望的顺序（项目名称数组）
   * @returns {success: boolean, error?: string}
   */
  public async updateDevProjectsOrder(pluginNames: string[]): Promise<any> {
    try {
      const registry = this.readRegistry()
      this.writeRegistry(reorderProjects(registry, pluginNames))
      this.deps.notifyPluginsChanged()
      return { success: true }
    } catch (error) {
      console.error('[DevProjects] 更新顺序失败:', error)
      return { success: false, error: formatError(error, '更新顺序失败') }
    }
  }

  /**
   * 导入开发插件（登记到注册表）。
   * 未提供路径时弹出文件选择对话框；新项目自动置顶。
   * @param pluginJsonPath - plugin.json 的路径（可选，省略时弹出文件选择器）
   * @returns {success: boolean, pluginName?: string, pluginPath?: string, error?: string}
   */
  public async importDevPlugin(pluginJsonPath?: string): Promise<any> {
    try {
      if (!pluginJsonPath) {
        const result = await openDialog(
          this.deps.mainWindow!,
          {
            title: '选择插件配置文件',
            properties: ['openFile'],
            filters: [{ name: '插件配置', extensions: ['json'] }],
            message: '请选择 plugin.json 文件'
          },
          '未选择文件'
        )
        if (!result.success) {
          return result
        }
        pluginJsonPath = result.data!.filePaths[0]
      }

      if (path.basename(pluginJsonPath) !== 'plugin.json') {
        return { success: false, error: '请选择 plugin.json 文件' }
      }

      const pluginPath = path.resolve(path.dirname(pluginJsonPath))
      let pluginConfig: any
      try {
        pluginConfig = await readPluginConfigFromFile(pluginJsonPath)
      } catch {
        return { success: false, error: 'plugin.json 格式错误' }
      }

      if (!pluginConfig.name) return { success: false, error: 'plugin.json 缺少 name 字段' }
      if (isBundledInternalPlugin(pluginConfig.name)) {
        return { success: false, error: '内置插件不能作为开发项目导入' }
      }

      const existingPlugins = this.deps.readInstalledPlugins()
      const devName = toDevPluginName(pluginConfig.name)
      const validation = this.deps.validatePluginConfig(
        pluginConfig,
        existingPlugins.filter((p) => p?.name !== pluginConfig.name && p?.name !== devName)
      )
      if (!validation.valid) return { success: false, error: validation.error }

      const registry = this.readRegistry()
      const projectName = pluginConfig.name
      const isNew = !registry.projects[projectName]
      const upserted = upsertByConfig({ registry, pluginPath, pluginConfig })
      if (!upserted.success) {
        return { success: false, error: upserted.reason || '开发项目登记失败' }
      }

      this.writeRegistry(
        isNew ? insertDevProjectAtTop(upserted.registry, projectName) : upserted.registry
      )

      console.log('[DevProjects] 项目已登记:', {
        pluginName: pluginConfig.name,
        projectPath: pluginPath,
        configPath: pluginJsonPath
      })

      this.deps.notifyPluginsChanged()
      this.deps.mainWindow?.webContents.send('super-panel-pinned-changed')
      return { success: true, pluginName: pluginConfig.name, pluginPath }
    } catch (error: unknown) {
      console.error('[DevProjects] 导入失败:', error)
      return { success: false, error: formatError(error) }
    }
  }

  /**
   * 通过 plugin.json 路径创建或更新开发项目。
   * 已存在的项目执行重绑（rebind），不存在的项目自动调用 importDevPlugin 新建。
   * @param pluginJsonPath - plugin.json 的绝对路径
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  public async upsertDevProjectByConfigPath(pluginJsonPath: string): Promise<any> {
    try {
      if (!pluginJsonPath) return { success: false, error: '未提供 plugin.json 路径' }

      const configPath = path.resolve(pluginJsonPath)
      if (path.basename(configPath) !== 'plugin.json') {
        return { success: false, error: '请选择 plugin.json 文件' }
      }

      let pluginConfig: any
      try {
        pluginConfig = await readPluginConfigFromFile(configPath)
      } catch {
        return { success: false, error: 'plugin.json 格式错误' }
      }

      if (!pluginConfig.name) return { success: false, error: 'plugin.json 缺少 name 字段' }
      if (isBundledInternalPlugin(pluginConfig.name)) {
        return { success: false, error: '内置插件不能作为开发项目导入' }
      }

      const existingPlugins = this.deps.readInstalledPlugins()
      const devName = toDevPluginName(pluginConfig.name)
      const validation = this.deps.validatePluginConfig(
        pluginConfig,
        existingPlugins.filter((p) => p?.name !== pluginConfig.name && p?.name !== devName)
      )
      if (!validation.valid) return { success: false, error: validation.error }

      const registry = this.readRegistry()
      const projectName = pluginConfig.name
      if (!registry.projects[projectName]) {
        return await this.importDevPlugin(configPath)
      }

      const rebound = rebindByConfig({
        registry,
        pluginJsonPath: configPath,
        pluginConfig
      })
      if (!rebound.success) {
        return { success: false, error: rebound.reason || '开发项目重绑失败' }
      }

      this.writeRegistry(rebound.registry)
      const validated = await this.validateAndRefreshState(projectName, rebound.registry)
      if (!validated.success) {
        return { success: false, error: validated.error || '开发项目校验失败' }
      }

      this.deps.notifyPluginsChanged()
      return { success: true, pluginName: projectName }
    } catch (error: unknown) {
      console.error('[DevProjects] upsert 失败:', error)
      return { success: false, error: formatError(error) }
    }
  }

  /**
   * 从注册表中移除开发项目，同时清理关联的使用数据（历史、固定等）。
   * @param projectName - 项目名称
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  public async removeDevProject(projectName: string): Promise<any> {
    try {
      const registry = this.readRegistry()
      if (!registry.projects[projectName]) return { success: false, error: '开发项目不存在' }

      const registryEntry = registry.projects[projectName]
      const devEffectiveName = toDevPluginName(projectName)
      const plugins = this.deps.readInstalledPlugins()
      const installedDevPlugin = plugins.find(
        (p) => p?.isDevelopment && p?.name === devEffectiveName
      )
      const killPath = installedDevPlugin?.path || registryEntry.projectPath

      if (killPath) {
        this.deps.pluginManager?.killPlugin(killPath)
      }

      if (installedDevPlugin) {
        this.deps.writeInstalledPlugins(
          plugins.filter((p) => !(p?.isDevelopment && p?.name === devEffectiveName))
        )
      }

      const { [projectName]: _, ...remainingProjects } = registry.projects
      this.writeRegistry({ ...registry, projects: remainingProjects })
      this.removePluginUsageData(devEffectiveName)
      // 同步清理该开发插件可能注册过的 provider 配置
      try {
        providerManager.cleanupForPlugin(devEffectiveName)
      } catch (error) {
        console.error('[DevProjects] 清理 provider 配置失败:', error)
      }
      this.deps.notifyPluginsChanged()
      console.log('[DevProjects] 项目已移除:', projectName)
      return { success: true, pluginName: projectName }
    } catch (error: unknown) {
      console.error('[DevProjects] 移除失败:', error)
      return { success: false, error: formatError(error) }
    }
  }

  /**
   * 将开发项目安装到已安装插件列表（开发模式）。
   * 会先校验项目状态，然后构建 PluginInstallRecord 并写入数据库。
   * @param projectName - 项目名称
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  public async installDevPlugin(projectName: string): Promise<any> {
    try {
      const registry = this.readRegistry()
      if (!registry.projects[projectName]) return { success: false, error: '开发项目不存在' }

      const validated = await this.validateAndRefreshState(projectName, registry)
      if (!validated.success || !validated.entry || !validated.pluginConfig) {
        return { success: false, error: validated.error || '开发项目校验失败' }
      }
      if (!validated.entry.projectPath) {
        return { success: false, error: '开发项目未绑定有效路径' }
      }

      const pluginConfig = validated.pluginConfig
      const plugins = this.deps.readInstalledPlugins()
      const devEffectiveName = toDevPluginName(projectName)
      const validation = this.deps.validatePluginConfig(
        pluginConfig,
        plugins.filter((p) => p?.name !== projectName && p?.name !== devEffectiveName)
      )
      if (!validation.valid) return { success: false, error: validation.error }

      const projectPath = path.resolve(validated.entry.projectPath)
      const installedPlugin = buildInstalledDevelopmentPlugin(projectPath, pluginConfig)
      installedPlugin.logo = this.deps.resolvePluginLogo(projectPath, pluginConfig.logo)

      const existingIndex = plugins.findIndex(
        (p) => p?.isDevelopment && p?.name === installedPlugin.name
      )
      if (existingIndex >= 0) {
        plugins[existingIndex] = installedPlugin
      } else {
        plugins.push(installedPlugin)
      }

      this.deps.writeInstalledPlugins(plugins)
      this.deps.notifyPluginsChanged()
      console.log('[DevProjects] 开发模式安装完成:', { projectName, projectPath })
      return { success: true, pluginName: projectName }
    } catch (error: unknown) {
      console.error('[DevProjects] 安装失败:', error)
      return { success: false, error: formatError(error) }
    }
  }

  /**
   * 卸载开发模式插件（从已安装列表中移除，不删除注册表记录）。
   * 会同时终止运行中的插件并清理使用数据。
   * @param projectName - 项目名称
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  public async uninstallDevPlugin(projectName: string): Promise<any> {
    try {
      const registry = this.readRegistry()
      const plugins = this.deps.readInstalledPlugins()
      if (!registry.projects[projectName]) return { success: true }

      const devEffectiveName = toDevPluginName(projectName)
      const pluginInfo = plugins.find((p) => p?.isDevelopment && p?.name === devEffectiveName)
      if (!pluginInfo?.isDevelopment) return { success: true }

      if (typeof pluginInfo.path === 'string' && pluginInfo.path) {
        this.deps.pluginManager?.killPlugin(pluginInfo.path)
      }
      this.deps.writeInstalledPlugins(
        plugins.filter((p) => !(p?.isDevelopment && p?.name === devEffectiveName))
      )
      this.removePluginUsageData(toDevPluginName(projectName))
      // 卸载开发模式插件时一并清理其 provider 配置
      try {
        providerManager.cleanupForPlugin(devEffectiveName)
      } catch (error) {
        console.error('[DevProjects] 清理 provider 配置失败:', error)
      }
      this.deps.notifyPluginsChanged()
      return { success: true, pluginName: projectName }
    } catch (error: unknown) {
      console.error('[DevProjects] 卸载失败:', error)
      return { success: false, error: formatError(error) }
    }
  }

  /**
   * 校验开发项目的 plugin.json 状态并刷新注册表。
   * @param projectName - 项目名称
   * @returns {success: boolean, pluginName?: string, binding?: DevProjectRecord, error?: string}
   */
  public async validateDevProject(projectName: string): Promise<any> {
    try {
      const registry = this.readRegistry()
      if (!registry.projects[projectName]) return { success: false, error: '开发项目不存在' }

      const validated = await this.validateAndRefreshState(projectName, registry)
      if (!validated.success) {
        return { success: false, error: validated.error || '开发项目校验失败' }
      }
      return { success: true, pluginName: projectName, binding: validated.entry }
    } catch (error: unknown) {
      console.error('[DevProjects] 校验失败:', error)
      return { success: false, error: formatError(error) }
    }
  }

  /**
   * 重新选择开发项目的 plugin.json 配置文件。
   * 用于项目目录变更或配置文件丢失后的修复场景。
   * @param projectName - 注册表中的项目名称
   * @param providedConfigPath - 可选的配置文件路径，省略时弹出文件选择器
   * @returns {success: boolean, pluginName?: string, error?: string}
   */
  public async selectDevProjectConfig(
    projectName: string,
    providedConfigPath?: string
  ): Promise<any> {
    try {
      const registry = this.readRegistry()
      const registryItem = registry.projects[projectName]
      if (!registryItem) return { success: false, error: '开发项目不存在' }

      let configPath = providedConfigPath ? path.resolve(providedConfigPath) : ''

      if (!configPath) {
        const result = await openDialog(
          this.deps.mainWindow!,
          {
            title: '选择 plugin.json',
            properties: ['openFile'],
            filters: [{ name: '插件配置', extensions: ['json'] }],
            message: `为 ${projectName} 选择 plugin.json`
          },
          '未选择文件'
        )
        if (!result.success) {
          return result
        }
        configPath = path.resolve(result.data!.filePaths[0])
      }

      if (path.basename(configPath) !== 'plugin.json') {
        return { success: false, error: '请选择 plugin.json 文件' }
      }

      let selectedConfig: any
      try {
        selectedConfig = await readPluginConfigFromFile(configPath)
      } catch {
        return { success: false, error: 'plugin.json 格式错误' }
      }

      if (!validateRepairConfigSelection(registryItem, selectedConfig)) {
        return {
          success: false,
          error: `选择的 plugin.json 与项目 "${projectName}" identity 不匹配`
        }
      }

      const now = new Date().toISOString()
      const nextRegistry: DevProjectRegistry = {
        ...registry,
        projects: {
          ...registry.projects,
          [projectName]: {
            ...registryItem,
            configSnapshot: { ...selectedConfig },
            configPath,
            projectPath: path.dirname(configPath),
            status: 'ready',
            lastValidatedAt: now,
            updatedAt: now
          }
        }
      }
      this.writeRegistry(nextRegistry)

      const validated = await this.validateAndRefreshState(projectName, nextRegistry)
      if (!validated.success) {
        return { success: false, error: validated.error || '开发项目校验失败' }
      }

      this.deps.notifyPluginsChanged()
      return { success: true, pluginName: projectName }
    } catch (error: unknown) {
      console.error('[DevProjects] 重绑配置失败:', error)
      return { success: false, error: formatError(error) }
    }
  }

  /**
   * 更新开发项目的元数据，同时同步写入磁盘 plugin.json。
   */
  public async updateDevProjectMeta(
    projectName: string,
    meta: { title?: string; description?: string; platform?: string[]; author?: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const registry = this.readRegistry()
      const result = updateProjectMeta({ registry, projectName, meta })
      if (!result.success) {
        return { success: false, error: result.reason || '更新失败' }
      }
      this.writeRegistry(result.registry)

      // 同步写入磁盘 plugin.json
      const entry = result.registry.projects[projectName]
      if (entry?.configPath) {
        try {
          const raw = await fs.readFile(entry.configPath, 'utf-8')
          const parsed = JSON.parse(raw)
          if (meta.title !== undefined) parsed.title = meta.title
          if (meta.description !== undefined) parsed.description = meta.description
          if (meta.author !== undefined) parsed.author = meta.author
          if (Array.isArray(meta.platform) && meta.platform.length > 0) {
            parsed.platform = meta.platform
          }
          await fs.writeFile(entry.configPath, JSON.stringify(parsed, null, 2), 'utf-8')
        } catch (err) {
          console.warn('[DevProjects] 同步 plugin.json 失败:', err)
        }
      }

      this.deps.notifyPluginsChanged()
      return { success: true }
    } catch (error: unknown) {
      console.error('[DevProjects] 更新元数据失败:', error)
      return { success: false, error: formatError(error) }
    }
  }

  /**
   * 从模板创建开发项目。
   * 将模板目录复制到目标路径，替换 plugin.json 和 package.json 中的占位符，
   * 然后自动导入为开发项目。
   */
  public async scaffoldDevProject(params: {
    template: 'vue-vite' | 'react-vite'
    projectPath: string
    name: string
    title: string
    description?: string
    platform?: string[]
    author?: string
  }): Promise<{ success: boolean; pluginName?: string; error?: string }> {
    try {
      const {
        template,
        projectPath: targetDir,
        name,
        title,
        description,
        platform,
        author
      } = params

      // 定位开发者插件的安装目录（优先使用开发版本，因为正式安装版可能不含模板）
      const installedPlugins = this.deps.readInstalledPlugins()
      const devVersionPlugin = installedPlugins.find(
        (p) => p?.name === 'ztools-developer-plugin__dev'
      )
      const prodVersionPlugin = installedPlugins.find((p) => p?.name === 'ztools-developer-plugin')
      const devPlugin = devVersionPlugin || prodVersionPlugin
      if (!devPlugin?.path) {
        return { success: false, error: '开发者工具插件未安装' }
      }

      const templateDir = path.join(devPlugin.path, template)
      try {
        await fs.access(templateDir)
      } catch {
        return { success: false, error: `模板 "${template}" 不存在（路径: ${templateDir}）` }
      }

      // 目标目录为 targetDir/name
      const projectDir = path.join(targetDir, name)
      try {
        const stat = await fs.stat(projectDir).catch(() => null)
        if (stat) {
          return { success: false, error: `目录 "${projectDir}" 已存在` }
        }
      } catch {
        /* 目录不存在，继续 */
      }

      // 递归复制模板
      await fs.cp(templateDir, projectDir, { recursive: true })

      // 替换 plugin.json 占位符
      const pluginJsonPath = path.join(projectDir, 'public', 'plugin.json')
      try {
        let pluginJson = await fs.readFile(pluginJsonPath, 'utf-8')
        pluginJson = pluginJson
          .replace(/\{\{PLUGIN_NAME\}\}/g, name)
          .replace(/\{\{PLUGIN_TITLE\}\}/g, title)
          .replace(/\{\{DESCRIPTION\}\}/g, description || '')
          .replace(/\{\{AUTHOR\}\}/g, author || '')
        // 注入 platform
        if (Array.isArray(platform) && platform.length > 0) {
          const parsed = JSON.parse(pluginJson)
          parsed.platform = platform
          pluginJson = JSON.stringify(parsed, null, 2)
        }
        await fs.writeFile(pluginJsonPath, pluginJson, 'utf-8')
      } catch (err) {
        console.warn('[DevProjects] 替换 plugin.json 占位符失败:', err)
      }

      // 替换 package.json 占位符
      const packageJsonPath = path.join(projectDir, 'package.json')
      try {
        let packageJson = await fs.readFile(packageJsonPath, 'utf-8')
        packageJson = packageJson
          .replace(/\{\{PROJECT_NAME\}\}/g, name)
          .replace(/\{\{DESCRIPTION\}\}/g, description || '')
        await fs.writeFile(packageJsonPath, packageJson, 'utf-8')
      } catch (err) {
        console.warn('[DevProjects] 替换 package.json 占位符失败:', err)
      }

      // 自动导入
      const result = await this.upsertDevProjectByConfigPath(pluginJsonPath)
      if (!result?.success) {
        return { success: false, error: result?.error || '导入创建的项目失败' }
      }

      console.log('[DevProjects] 项目已从模板创建:', { template, projectDir, name })
      return { success: true, pluginName: result.pluginName || name }
    } catch (error: unknown) {
      console.error('[DevProjects] 模板创建失败:', error)
      return { success: false, error: formatError(error) }
    }
  }

  /**
   * 将开发项目打包为 ZPX 文件。
   * 校验项目状态为 ready 后弹出保存对话框，将项目目录打包为 .zpx 文件。
   * @param projectName - 项目名称
   * @param packagePath - 可选，指定打包目录的绝对路径，省略时打包整个项目根目录
   * @param version - 可选，指定打包版本号，会临时覆盖 plugin.json 中的 version 字段
   * @returns {success: boolean, error?: string}
   */
  public async packageDevProject(
    projectName: string,
    packagePath?: string,
    version?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const registry = this.readRegistry()
      if (!registry.projects[projectName]) return { success: false, error: '开发项目不存在' }

      const validated = await this.validateAndRefreshState(projectName, registry)
      if (!validated.success || !validated.entry) {
        return { success: false, error: validated.error || '开发项目校验失败' }
      }
      if (!canPackageDevProject(validated.entry)) {
        return { success: false, error: '当前项目状态不可打包' }
      }
      if (!validated.entry.projectPath) {
        return { success: false, error: '开发项目未绑定有效路径' }
      }

      // 检查 main 入口文件是否存在
      const mainFile = validated.pluginConfig?.main
      if (mainFile) {
        const mainPath = path.resolve(validated.entry.projectPath, mainFile)
        try {
          await fs.access(mainPath)
        } catch {
          return { success: false, error: `main 入口文件不存在: ${mainFile}` }
        }
      }

      // 确定实际打包目录
      const rootPath = validated.entry.projectPath
      const targetPackagePath = packagePath ?? rootPath

      try {
        await fs.access(targetPackagePath)
      } catch {
        return { success: false, error: '插件目录不存在' }
      }

      const resolvedVersion =
        version ||
        validated.pluginConfig?.version ||
        registry.projects[projectName]?.configSnapshot?.version ||
        '0.0.0'

      // 如果指定了版本号，临时修改打包目录中的 plugin.json
      const pluginJsonPath = path.join(targetPackagePath, 'plugin.json')
      let originalPluginJsonContent = ''
      if (version) {
        try {
          originalPluginJsonContent = await fs.readFile(pluginJsonPath, 'utf-8')
          const config = JSON.parse(originalPluginJsonContent)
          config.version = version
          await fs.writeFile(pluginJsonPath, JSON.stringify(config, null, 2), 'utf-8')
        } catch {
          return { success: false, error: '修改 plugin.json 版本号失败' }
        }
      }

      const result = await dialog.showSaveDialog(this.deps.mainWindow!, {
        title: '保存插件包',
        defaultPath: `${projectName}-v${resolvedVersion}.zpx`,
        filters: [{ name: '插件包', extensions: ['zpx'] }]
      })

      if (result.canceled || !result.filePath) return { success: false, error: '已取消' }

      await packZpx(targetPackagePath, result.filePath)
      shell.showItemInFolder(result.filePath)
      return { success: true }
    } catch (error: unknown) {
      console.error('[DevProjects] 打包失败:', error)
      return { success: false, error: formatError(error, '打包失败') }
    }
  }
}
