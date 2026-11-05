import { HOST_STORAGE_KEYS } from '../../../shared/storageKeys'
import { isBundledInternalPlugin } from '../internalPlugins'
import databaseAPI from '../../api/shared/database'

/** 同步清单中的单条市场插件记录 */
export interface SyncedMarketPluginEntry {
  name: string
  version?: string
}

/** 账号侧可同步的市场已装插件清单 */
export interface SyncedMarketPluginsDoc {
  plugins: SyncedMarketPluginEntry[]
}

/** 对账时用于从市场安装缺失插件的回调 */
export type InstallMarketPluginFn = (plugin: {
  name: string
  version?: string
}) => Promise<{ success: boolean; error?: string }>

const STORAGE_KEY = HOST_STORAGE_KEYS.syncedMarketPlugins

let reconcileTimer: ReturnType<typeof setTimeout> | null = null
let reconcileInFlight: Promise<void> | null = null
let installMarketPlugin: InstallMarketPluginFn | null = null

/**
 * 注入市场安装回调，供同步对账补装缺失插件。
 * @param fn 按插件名从市场安装的异步函数
 * @returns 无返回值
 */
export function setSyncedMarketPluginInstaller(fn: InstallMarketPluginFn | null): void {
  installMarketPlugin = fn
}

/**
 * 判断本机插件记录是否应进入/保留在市场同步清单中。
 * @param plugin 本机已安装插件记录
 * @returns 属于市场同步候选时返回 true
 */
export function isMarketSyncCandidate(plugin: any): boolean {
  const name = typeof plugin?.name === 'string' ? plugin.name.trim() : ''
  if (!name || plugin?.isDevelopment || isBundledInternalPlugin(name)) {
    return false
  }
  const installedFrom = plugin?.installedFrom
  if (installedFrom === 'npm' || installedFrom === 'local') {
    return false
  }
  // 明确标记为市场，或遗留无来源字段的正式插件（best-effort）。
  return installedFrom === 'market' || installedFrom == null || installedFrom === ''
}

/**
 * 规范化清单条目列表：去空白、按 name 去重并稳定排序。
 * @param entries 原始条目
 * @returns 规范化后的条目数组
 */
export function normalizeSyncedMarketPluginEntries(
  entries: SyncedMarketPluginEntry[] | null | undefined
): SyncedMarketPluginEntry[] {
  const byName = new Map<string, SyncedMarketPluginEntry>()
  for (const entry of entries || []) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    if (!name) continue
    const version =
      typeof entry.version === 'string' && entry.version.trim() ? entry.version.trim() : undefined
    byName.set(name, version ? { name, version } : { name })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 判断两份清单在 name/version 集合上是否等价。
 * @param left 左侧清单
 * @param right 右侧清单
 * @returns 等价时返回 true
 */
function arePluginListsEqual(
  left: SyncedMarketPluginEntry[],
  right: SyncedMarketPluginEntry[]
): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i].name !== right[i].name || left[i].version !== right[i].version) {
      return false
    }
  }
  return true
}

/**
 * 读取账号侧市场插件同步清单。
 * @returns 规范化后的清单；不存在或无效时返回空 plugins
 */
export function readSyncedMarketPlugins(): SyncedMarketPluginsDoc {
  const raw = databaseAPI.dbGet(STORAGE_KEY)
  const plugins = normalizeSyncedMarketPluginEntries(
    Array.isArray(raw?.plugins) ? raw.plugins : Array.isArray(raw) ? raw : []
  )
  return { plugins }
}

/**
 * 在内容变化时覆盖写入市场插件同步清单。
 * @param plugins 完整条目列表
 * @returns 实际发生写入时返回 true
 */
export function writeSyncedMarketPlugins(plugins: SyncedMarketPluginEntry[]): boolean {
  const next = normalizeSyncedMarketPluginEntries(plugins)
  const current = readSyncedMarketPlugins().plugins
  if (arePluginListsEqual(current, next)) {
    return false
  }
  databaseAPI.dbPut(STORAGE_KEY, { plugins: next })
  return true
}

/**
 * 将市场插件 upsert 进同步清单；集合未变则跳过写入。
 * @param entry 要加入或更新的插件
 * @returns 发生写入时返回 true
 */
export function upsertSyncedMarketPlugin(entry: SyncedMarketPluginEntry): boolean {
  const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
  if (!name) return false
  const version =
    typeof entry.version === 'string' && entry.version.trim() ? entry.version.trim() : undefined
  const current = readSyncedMarketPlugins().plugins
  const without = current.filter((item) => item.name !== name)
  return writeSyncedMarketPlugins([...without, version ? { name, version } : { name }])
}

/**
 * 从同步清单移除指定市场插件名。
 * @param pluginName 稳定插件名
 * @returns 发生写入时返回 true
 */
export function removeSyncedMarketPlugin(pluginName: string): boolean {
  const name = typeof pluginName === 'string' ? pluginName.trim() : ''
  if (!name) return false
  const current = readSyncedMarketPlugins().plugins
  const next = current.filter((item) => item.name !== name)
  if (next.length === current.length) return false
  return writeSyncedMarketPlugins(next)
}

/**
 * 当同步清单文档尚不存在时，从本机已装插件播种一次。
 * @param installedPlugins 本机插件注册表
 * @returns 发生播种写入时返回 true
 */
export function seedSyncedMarketPluginsIfMissing(installedPlugins: any[]): boolean {
  const existing = databaseAPI.dbGet(STORAGE_KEY)
  if (existing != null) {
    return false
  }
  const entries = normalizeSyncedMarketPluginEntries(
    (Array.isArray(installedPlugins) ? installedPlugins : [])
      .filter((plugin) => isMarketSyncCandidate(plugin))
      .map((plugin) => ({
        name: String(plugin.name),
        version: typeof plugin.version === 'string' ? plugin.version : undefined
      }))
  )
  databaseAPI.dbPut(STORAGE_KEY, { plugins: entries })
  return true
}

/**
 * 对账市场同步清单：本机缺失的条目静默从市场补装；只增不减。
 * @returns 对账流程结束后的 Promise
 */
export async function reconcileSyncedMarketPlugins(): Promise<void> {
  if (reconcileInFlight) {
    return reconcileInFlight
  }

  reconcileInFlight = (async () => {
    const installer = installMarketPlugin
    if (!installer) {
      return
    }

    // 清单缺失时先从本机注册表播种，避免空清单覆盖远端意图前先有本地基线。
    const installedRaw = databaseAPI.dbGet(HOST_STORAGE_KEYS.plugins)
    const installedList = Array.isArray(installedRaw) ? installedRaw : []
    seedSyncedMarketPluginsIfMissing(installedList)

    const manifest = readSyncedMarketPlugins().plugins
    if (manifest.length === 0) {
      return
    }

    const installedNames = new Set(
      installedList
        .map((plugin) => (typeof plugin?.name === 'string' ? plugin.name.trim() : ''))
        .filter(Boolean)
    )

    for (const entry of manifest) {
      if (installedNames.has(entry.name)) {
        continue
      }
      try {
        const result = await installer({ name: entry.name, version: entry.version })
        if (!result?.success) {
          console.warn(
            '[SyncedMarketPlugins] 对账安装失败:',
            entry.name,
            result?.error || 'unknown'
          )
          continue
        }
        installedNames.add(entry.name)
        // 安装成功后清单通常已含该 name；内容不变则不会 put。
        upsertSyncedMarketPlugin({
          name: entry.name,
          version: entry.version
        })
      } catch (error) {
        console.warn('[SyncedMarketPlugins] 对账安装异常:', entry.name, error)
      }
    }
  })()
    .catch((error) => {
      console.error('[SyncedMarketPlugins] 对账失败:', error)
    })
    .finally(() => {
      reconcileInFlight = null
    })

  return reconcileInFlight
}

/**
 * 防抖调度市场插件对账，合并短时间内的多次 pull/live 触发。
 * @param delayMs 防抖延迟毫秒数
 * @returns 无返回值
 */
export function scheduleReconcileSyncedMarketPlugins(delayMs = 800): void {
  if (reconcileTimer) {
    clearTimeout(reconcileTimer)
  }
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null
    void reconcileSyncedMarketPlugins()
  }, delayMs)
}
