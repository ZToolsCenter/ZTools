import { ipcMain, type WebContents } from 'electron'
import fsSync from 'fs'
import path from 'path'
import type { PluginManager } from '../../managers/pluginManager'
import databaseAPI from '../../api/shared/database'
import {
  ALL_PROVIDER_TYPES,
  BUILTIN_PROVIDER_PREFIX,
  buildBuiltinProviderId,
  buildPluginProviderId,
  normalizeProviderSettings,
  PROVIDER_SETTINGS_KEY,
  type PluginProvidersField,
  type ProviderContractMap,
  type ProviderDeclaration,
  type ProviderEntry,
  type ProviderSettings,
  type ProviderType
} from '@shared/providerShared'

/** 内置 provider 的本地实现（主进程内直接提供，不经插件）。 */
interface BuiltinProviderDefinition {
  /** 内置 provider 名称，用于拼装 id（builtin-<name>） */
  name: string
  type: ProviderType
  label: string
  description: string
  /** 实际调用实现；为空表示该 provider 仅有声明、暂不可调用（如尚未就绪的引擎） */
  invoke?: (input: never) => Promise<unknown>
  /** 是否就绪（影响 UI 提示与是否可被设为默认） */
  isReady?: () => boolean
}

/** 等待插件 provider 注册完成的超时时间 */
const PROVIDER_REGISTER_TIMEOUT_MS = 5000

/**
 * Provider 管理器。
 *
 * 聚合内置 provider 与插件 provider（来自 plugin.json 的 providers 字段），
 * 负责声明扫描、运行时注册跟踪、按需预加载、统一调用，以及用户配置持久化。
 * 设计上对齐 PluginToolsAPI（tools.ts）。
 */
class ProviderManager {
  private pluginManager: PluginManager | null = null
  /** 已注册的内置 provider 定义（id -> definition） */
  private builtinProviders = new Map<string, BuiltinProviderDefinition>()
  /** webContents.id => 已通过 ztools.registerProvider 注册的 key 集合 */
  private registeredProviders = new Map<number, Set<string>>()
  /** webContents.id:key => 等待注册完成的回调 */
  private waiters = new Map<string, Array<() => void>>()

  public init(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  // ==================== IPC ====================

  private setupIPC(): void {
    // 插件 preload 通过 ztools.registerProvider 注册
    // payload 为插件内声明 key（plugin.json providers 字段的 key），不再限制为 type。
    ipcMain.on('plugin:provider-register', (event, key: string) => {
      try {
        this.registerProvider(event.sender, key)
        event.returnValue = { success: true }
      } catch (error: unknown) {
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : 'provider 注册失败'
        }
      }
    })
  }

  // ==================== 内置 provider 注册 ====================

  /**
   * 注册一个内置 provider（主进程本地实现）。
   * 内置 provider 不可删除，仅供 invoke / 展示。
   */
  public registerBuiltinProvider(def: BuiltinProviderDefinition): void {
    if (!def?.name || !def.type) {
      throw new Error('内置 provider 缺少 name 或 type')
    }
    const id = buildBuiltinProviderId(def.name)
    if (!id.startsWith(BUILTIN_PROVIDER_PREFIX)) {
      throw new Error(`内置 provider id 必须以 ${BUILTIN_PROVIDER_PREFIX} 开头`)
    }
    this.builtinProviders.set(id, def)
  }

  // ==================== 聚合查询 ====================

  /**
   * 读取某个插件的 providers 声明。
   */
  public getDeclaredProvidersByPath(pluginPath: string): PluginProvidersField {
    try {
      const pluginJsonPath = path.join(pluginPath, 'plugin.json')
      const pluginConfig = JSON.parse(fsSync.readFileSync(pluginJsonPath, 'utf-8')) as {
        providers?: PluginProvidersField
      }
      const providers = pluginConfig.providers
      if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
        return {}
      }
      return this.sanitizeDeclaredProviders(providers)
    } catch {
      return {}
    }
  }

  /**
   * 仅保留合法 type 且结构正确的声明，丢弃其余。
   *
   * 返回的 key 集合与插件 plugin.json providers 字段的 key 一致；
   * 同一 type 可出现多条（key 不同），由调用方各自生成一条 entry。
   */
  private sanitizeDeclaredProviders(raw: PluginProvidersField): PluginProvidersField {
    const result: PluginProvidersField = {}
    if (!raw || typeof raw !== 'object') return result
    for (const [key, decl] of Object.entries(raw)) {
      if (!decl || typeof decl !== 'object') continue
      const type = (decl as ProviderDeclaration).type
      if (!type || !ALL_PROVIDER_TYPES.includes(type)) continue
      result[key] = {
        type,
        label: typeof decl.label === 'string' ? decl.label : undefined,
        description: typeof decl.description === 'string' ? decl.description : undefined
      }
    }
    return result
  }

  /**
   * 汇总所有 provider（内置 + 插件），可按 type 过滤。
   */
  public getAllProviders(filterType?: ProviderType): ProviderEntry[] {
    const entries: ProviderEntry[] = []

    // 内置
    for (const [id, def] of this.builtinProviders) {
      if (filterType && def.type !== filterType) continue
      entries.push({
        id,
        type: def.type,
        label: def.label,
        description: def.description,
        source: 'builtin'
      })
    }

    // 插件
    const plugins = databaseAPI.dbGet('plugins')
    if (!Array.isArray(plugins)) return entries

    for (const plugin of plugins as Array<Record<string, unknown>>) {
      const pluginPath = plugin?.path
      const pluginName = plugin?.name
      if (typeof pluginPath !== 'string' || typeof pluginName !== 'string') continue

      const declared = this.getDeclaredProvidersByPath(pluginPath)
      // 声明 key 为插件内唯一标识，同一 type 可有多条（key 不同）
      for (const [key, decl] of Object.entries(declared)) {
        if (filterType && decl.type !== filterType) continue
        entries.push({
          id: buildPluginProviderId(pluginName, key),
          type: decl.type,
          key,
          label: decl.label || String(plugin.title || pluginName),
          description: decl.description || '',
          source: 'plugin',
          pluginName,
          pluginPath,
          pluginLogo: typeof plugin.logo === 'string' ? plugin.logo : undefined
        })
      }
    }
    return entries
  }

  // ==================== 调用 ====================

  /**
   * 解析某 type 下最终使用的 provider id：
   * 优先显式传入 → 其次默认 → 最后回退到第一个启用项（或第一个可用项）。
   * 仅做选择，不做加载/校验，供 invoke / 查询默认项等场景复用。
   */
  public resolveProviderId(type: ProviderType, providerId?: string): string | undefined {
    const settings = this.getSettings()
    return providerId || settings.defaultId[type] || this.firstEnabledId(type, settings)
  }

  /**
   * 取某 type 的默认 provider id（显式默认 → 首个启用 → 首个可用）。
   * 无可用项时返回 undefined。
   */
  public getDefaultProviderId(type: ProviderType): string | undefined {
    return this.resolveProviderId(type)
  }

  /**
   * 按 type 调用默认 provider（或显式指定 providerId）。
   */
  public async invoke<T extends ProviderType>(
    type: T,
    input: ProviderContractMap[T]['input'],
    options?: { providerId?: string }
  ): Promise<ProviderContractMap[T]['output']> {
    const targetId = this.resolveProviderId(type, options?.providerId)

    if (!targetId) {
      throw new Error(`没有可用的 ${type} 提供商，请在设置中安装或启用对应插件`)
    }

    // 内置 provider
    if (targetId.startsWith(BUILTIN_PROVIDER_PREFIX)) {
      const def = this.builtinProviders.get(targetId)
      if (!def) throw new Error(`未找到内置 provider: ${targetId}`)
      if (typeof def.invoke !== 'function') {
        throw new Error(`内置 provider "${def.label}" 暂不可用`)
      }
      return (await def.invoke(input as never)) as ProviderContractMap[T]['output']
    }

    // 插件 provider
    const entry = this.getAllProviders(type).find((p) => p.id === targetId)
    if (!entry || entry.source !== 'plugin' || !entry.pluginPath || !entry.key) {
      throw new Error(`未找到 provider: ${targetId}`)
    }
    const webContents = await this.ensurePluginProviderReady(entry.pluginPath, entry.key)
    if (!webContents) {
      throw new Error(`provider 所在插件无法加载: ${entry.pluginName}`)
    }

    const result = await webContents.executeJavaScript(`
      (async () => {
        if (!window.ztools || typeof window.ztools.__invokeRegisteredProvider !== 'function') {
          throw new Error('插件运行时缺少 provider 调用入口')
        }
        return await window.ztools.__invokeRegisteredProvider(
          ${JSON.stringify(entry.key)},
          ${JSON.stringify(input ?? {})}
        )
      })()
    `)
    return result as ProviderContractMap[T]['output']
  }

  /**
   * 取某 type 下第一个启用的 provider id（兜底逻辑）。
   */
  private firstEnabledId(type: ProviderType, settings: ProviderSettings): string | undefined {
    const enabled = settings.enabled[type]
    if (enabled && enabled.length > 0) return enabled[0]
    // 没有显式启用项时，回退到该类型的第一个可用 provider
    const all = this.getAllProviders(type)
    return all[0]?.id
  }

  /**
   * 确保目标插件已加载且对应 key 的 provider 已注册。
   */
  public async ensurePluginProviderReady(
    pluginPath: string,
    key: string
  ): Promise<WebContents | null> {
    let webContents = this.pluginManager?.getPluginWebContentsByPath(pluginPath) ?? null
    if (!webContents) {
      await this.pluginManager?.preloadPlugin(pluginPath)
      webContents = this.pluginManager?.getPluginWebContentsByPath(pluginPath) ?? null
    }
    if (!webContents) return null

    if (this.isProviderRegistered(webContents, key)) {
      return webContents
    }
    await this.waitForProviderRegistration(webContents, key)
    return this.isProviderRegistered(webContents, key) ? webContents : null
  }

  // ==================== 运行时注册跟踪 ====================

  private registerProvider(webContents: WebContents, key: string): void {
    if (!key || typeof key !== 'string') {
      throw new Error('provider key 不能为空')
    }
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(webContents)
    if (!pluginInfo) {
      throw new Error('无法获取插件信息')
    }
    // 必须在 plugin.json 声明了对应 key 才允许注册
    const declared = this.getDeclaredProvidersByPath(pluginInfo.path)
    if (!declared[key]) {
      throw new Error(`插件未在 plugin.json 声明 "${key}" provider`)
    }

    let set = this.registeredProviders.get(webContents.id)
    if (!set) {
      set = new Set<string>()
      this.registeredProviders.set(webContents.id, set)
      webContents.once('destroyed', () => {
        this.registeredProviders.delete(webContents.id)
      })
    }
    set.add(key)
    this.resolveWaiters(webContents.id, key)
  }

  private isProviderRegistered(webContents: WebContents, key: string): boolean {
    return this.registeredProviders.get(webContents.id)?.has(key) ?? false
  }

  private async waitForProviderRegistration(webContents: WebContents, key: string): Promise<void> {
    if (this.isProviderRegistered(webContents, key)) return
    const waiterKey = `${webContents.id}:${key}`
    await new Promise<void>((resolve, reject) => {
      let wrappedResolve: (() => void) | null = null
      const timeout = setTimeout(() => {
        if (wrappedResolve) this.removeWaiter(waiterKey, wrappedResolve)
        reject(new Error(`等待 ${key} provider 注册超时`))
      }, PROVIDER_REGISTER_TIMEOUT_MS)

      wrappedResolve = (): void => {
        clearTimeout(timeout)
        resolve()
      }
      const list = this.waiters.get(waiterKey) || []
      list.push(wrappedResolve)
      this.waiters.set(waiterKey, list)
    }).catch(() => undefined)
  }

  private resolveWaiters(webContentsId: number, key: string): void {
    const waiterKey = `${webContentsId}:${key}`
    const list = this.waiters.get(waiterKey)
    if (!list?.length) return
    this.waiters.delete(waiterKey)
    for (const resolve of list) resolve()
  }

  private removeWaiter(waiterKey: string, target: () => void): void {
    const list = this.waiters.get(waiterKey)
    if (!list?.length) return
    const next = list.filter((w) => w !== target)
    if (next.length > 0) this.waiters.set(waiterKey, next)
    else this.waiters.delete(waiterKey)
  }

  // ==================== 配置持久化 ====================

  public getSettings(): ProviderSettings {
    return normalizeProviderSettings(databaseAPI.dbGet(PROVIDER_SETTINGS_KEY))
  }

  private saveSettings(settings: ProviderSettings): void {
    databaseAPI.dbPut(PROVIDER_SETTINGS_KEY, settings)
  }

  /** 设置某个 provider 的启用状态 */
  public setEnabled(providerId: string, enabled: boolean): ProviderSettings {
    const entry = this.getAllProviders().find((p) => p.id === providerId)
    if (!entry) throw new Error(`未找到 provider: ${providerId}`)
    const settings = this.getSettings()
    const list = new Set(settings.enabled[entry.type] || [])
    if (enabled) list.add(providerId)
    else list.delete(providerId)
    settings.enabled[entry.type] = Array.from(list)

    // 关闭默认 provider 时需要重新选一个默认
    if (!enabled && settings.defaultId[entry.type] === providerId) {
      settings.defaultId[entry.type] = list.size > 0 ? Array.from(list)[0] : undefined
    }
    this.saveSettings(settings)
    return settings
  }

  /** 设置某个 type 的默认 provider */
  public setDefault(type: ProviderType, providerId: string): ProviderSettings {
    const entry = this.getAllProviders(type).find((p) => p.id === providerId)
    if (!entry) throw new Error(`未找到 ${type} provider: ${providerId}`)
    const settings = this.getSettings()
    // 设为默认时自动加入启用列表
    const list = new Set(settings.enabled[type] || [])
    list.add(providerId)
    settings.enabled[type] = Array.from(list)
    settings.defaultId[type] = providerId
    this.saveSettings(settings)
    return settings
  }

  /** 读取某 provider 的自定义参数 */
  public getParams(providerId: string): Record<string, unknown> {
    return this.getSettings().params[providerId] || {}
  }

  /** 保存某 provider 的自定义参数 */
  public setParams(providerId: string, params: Record<string, unknown>): ProviderSettings {
    const settings = this.getSettings()
    settings.params[providerId] = params
    this.saveSettings(settings)
    return settings
  }

  /**
   * 当插件被卸载时清理其相关配置（启用/默认/参数）。
   */
  public cleanupForPlugin(pluginName: string): void {
    const targetPrefix = `plugin:${pluginName}:`
    const settings = this.getSettings()
    let changed = false
    for (const type of ALL_PROVIDER_TYPES) {
      const enabled = settings.enabled[type]
      if (Array.isArray(enabled)) {
        const next = enabled.filter((id) => !id.startsWith(targetPrefix))
        if (next.length !== enabled.length) {
          settings.enabled[type] = next
          changed = true
        }
      }
      const def = settings.defaultId[type]
      if (typeof def === 'string' && def.startsWith(targetPrefix)) {
        delete settings.defaultId[type]
        changed = true
      }
    }
    for (const id of Object.keys(settings.params)) {
      if (id.startsWith(targetPrefix)) {
        delete settings.params[id]
        changed = true
      }
    }
    if (changed) this.saveSettings(settings)
  }
}

export default new ProviderManager()
