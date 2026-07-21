import databaseAPI from '../api/shared/database.js'
import { isDevelopmentPluginName, toDevPluginName } from '../../shared/pluginRuntimeNamespace.js'
import { isBundledInternalPlugin } from './internalPlugins.js'
import { HOST_STORAGE_KEYS, LEGACY_CAMEL_CASE_STORAGE_KEYS } from '../../shared/storageKeys.js'

const LEGACY_WEB_SEARCH_FEATURE_PREFIX = 'web-search-'

/**
 * 将单个旧版 macOS .icns 图标 URL 迁移为直接使用 .app 路径的 ztools-icon URL
 */
function migrateLegacyMacAppIcon(item: { path?: string; icon?: string }): boolean {
  if (process.platform !== 'darwin') return false
  if (!item || typeof item.path !== 'string' || typeof item.icon !== 'string') return false
  if (!item.path.endsWith('.app') || !item.icon.startsWith('ztools-icon://')) return false

  const encodedPath = item.icon.replace('ztools-icon://', '')
  let decodedPath = ''
  try {
    decodedPath = decodeURIComponent(encodedPath)
  } catch {
    return false
  }

  if (!decodedPath.endsWith('.icns')) return false

  const nextIcon = `ztools-icon://${encodeURIComponent(item.path)}`
  if (item.icon === nextIcon) return false

  item.icon = nextIcon
  return true
}

/**
 * 递归迁移数组中的旧版 macOS 应用图标 URL
 */
function migrateLegacyMacAppIcons(items: any[]): boolean {
  if (process.platform !== 'darwin' || !Array.isArray(items)) return false

  let changed = false

  for (const item of items) {
    if (!item || typeof item !== 'object') continue

    if (migrateLegacyMacAppIcon(item)) {
      changed = true
    }

    if (Array.isArray(item.items) && migrateLegacyMacAppIcons(item.items)) {
      changed = true
    }
  }

  return changed
}

/**
 * 启动时统一迁移历史遗留数据
 * 当前仅处理旧版 macOS .icns 图标 URL 到 .app 路径图标 URL 的转换
 */
export function runStartupDataMigrations(): void {
  migrateHostStorageKeys()
  migrateDevPluginNames()
  cleanupLegacyWebSearchReferences()

  if (process.platform !== 'darwin') return

  const migrationKeys = [
    'command-history',
    'pinned-commands',
    'cached-commands',
    'local-shortcuts',
    'super-panel-pinned'
  ]

  for (const key of migrationKeys) {
    try {
      const data = databaseAPI.dbGet(key)
      if (!Array.isArray(data)) continue

      if (migrateLegacyMacAppIcons(data)) {
        databaseAPI.dbPut(key, data)
        console.log(`[StartupMigration] 已迁移旧版 macOS 图标数据: ${key}`)
      }
    } catch (error) {
      console.error(`[StartupMigration] 迁移失败: ${key}`, error)
    }
  }
}

export function migrateHostStorageKeys(): void {
  const simpleMappings = [
    [LEGACY_CAMEL_CASE_STORAGE_KEYS.autoStartPlugin, HOST_STORAGE_KEYS.autoStartPlugin],
    [LEGACY_CAMEL_CASE_STORAGE_KEYS.autoDetachPlugin, HOST_STORAGE_KEYS.autoDetachPlugin],
    [LEGACY_CAMEL_CASE_STORAGE_KEYS.outKillPlugin, HOST_STORAGE_KEYS.outKillPlugin],
    [LEGACY_CAMEL_CASE_STORAGE_KEYS.detachedWindowSizes, HOST_STORAGE_KEYS.detachedWindowSizes]
  ] as const

  for (const [legacyKey, targetKey] of simpleMappings) {
    const legacyValue = databaseAPI.dbGet(legacyKey)
    if (legacyValue === null || legacyValue === undefined) continue

    const targetValue = databaseAPI.dbGet(targetKey)
    databaseAPI.dbPut(targetKey, mergeStorageValues(legacyValue, targetValue))
    databaseAPI.dbRemove(legacyKey)
    console.log(`[StartupMigration] 已迁移存储键: ${legacyKey} -> ${targetKey}`)
  }

  const legacyDisabled = databaseAPI.dbGet(LEGACY_CAMEL_CASE_STORAGE_KEYS.disabledMainPushPlugin)
  if (legacyDisabled !== null && legacyDisabled !== undefined) {
    const existingEnabled = databaseAPI.dbGet(HOST_STORAGE_KEYS.enabledMainPushPlugin)
    if (existingEnabled === null || existingEnabled === undefined) {
      const disabledNames = normalizePluginNameList(legacyDisabled)
      const installedPlugins = databaseAPI.dbGet(HOST_STORAGE_KEYS.plugins)
      const enabledNames = Array.isArray(installedPlugins)
        ? installedPlugins
            .map((plugin: any) => (typeof plugin?.name === 'string' ? plugin.name : ''))
            .filter((name: string) => name && !disabledNames.includes(name))
        : []
      databaseAPI.dbPut(HOST_STORAGE_KEYS.enabledMainPushPlugin, enabledNames)
    }
    databaseAPI.dbRemove(LEGACY_CAMEL_CASE_STORAGE_KEYS.disabledMainPushPlugin)
    console.log('[StartupMigration] 已迁移 mainPush 插件启用配置')
  }
}

function mergeStorageValues(legacyValue: any, targetValue: any): any {
  if (targetValue === null || targetValue === undefined) return legacyValue
  if (Array.isArray(legacyValue) && Array.isArray(targetValue)) {
    return Array.from(new Set([...targetValue, ...legacyValue]))
  }
  if (
    legacyValue &&
    targetValue &&
    typeof legacyValue === 'object' &&
    typeof targetValue === 'object'
  ) {
    return { ...legacyValue, ...targetValue }
  }
  return targetValue
}

function normalizePluginNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item: any) =>
      typeof item === 'string' ? item : typeof item?.pluginName === 'string' ? item.pluginName : ''
    )
    .filter(Boolean)
}

/**
 * 将历史记录和固定列表中旧式开发版插件记录迁移为新格式。
 *
 * 旧格式：{ pluginName: 'demo', pluginSource: 'development' }
 * 新格式：{ pluginName: 'demo__dev' }  (移除 pluginSource 字段)
 *
 * 迁移策略：
 * - 若 pluginSource === 'development'，将 pluginName 加上 __dev 后缀
 * - 否则保持不变，仅移除 pluginSource 字段
 */
function migrateDevPluginNames(): void {
  const targetKeys = ['command-history', 'pinned-commands', 'super-panel-pinned']

  for (const key of targetKeys) {
    try {
      const data: any[] = databaseAPI.dbGet(key) || []
      if (!Array.isArray(data)) continue

      let changed = false
      for (const item of data) {
        if (item?.type !== 'plugin') continue

        // 将旧式 { pluginName, pluginSource: 'development' } 迁移为 __dev 后缀
        // 内置插件（setting、system）在开发模式下以 isDevelopment: true 存储但不加后缀，迁移时跳过
        // 仅当 pluginName 尚未含 __dev 后缀时才追加，避免新格式数据被重复迁移
        if (item.pluginSource === 'development' && typeof item.pluginName === 'string') {
          if (
            !isBundledInternalPlugin(item.pluginName) &&
            !isDevelopmentPluginName(item.pluginName)
          ) {
            item.pluginName = toDevPluginName(item.pluginName)
          }
          changed = true
        }
        // 移除 pluginSource 字段（已不再需要）
        if ('pluginSource' in item) {
          delete item.pluginSource
          changed = true
        }
      }

      if (changed) {
        databaseAPI.dbPut(key, data)
        console.log(`[StartupMigration] 已迁移开发版插件名称: ${key}`)
      }
    } catch (error) {
      console.error(`[StartupMigration] 开发版插件名称迁移失败: ${key}`, error)
    }
  }
}

function isLegacyWebSearchCommand(item: any): boolean {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.featureCode === 'string' &&
    item.featureCode.startsWith(LEGACY_WEB_SEARCH_FEATURE_PREFIX)
  )
}

function filterLegacyWebSearchCommandList(items: any[]): { items: any[]; changed: boolean } {
  const filtered = items.filter((item) => !isLegacyWebSearchCommand(item))
  return {
    items: filtered,
    changed: filtered.length !== items.length
  }
}

function filterLegacyWebSearchSuperPanelPinned(items: any[]): { items: any[]; changed: boolean } {
  let changed = false
  const nextItems: any[] = []

  for (const item of items) {
    if (isLegacyWebSearchCommand(item)) {
      changed = true
      continue
    }

    if (item?.isFolder && Array.isArray(item.items)) {
      const filtered = filterLegacyWebSearchSuperPanelPinned(item.items)
      if (filtered.changed) changed = true

      if (filtered.items.length === 0) {
        changed = true
        continue
      }

      if (filtered.items.length === 1) {
        changed = true
        nextItems.push(filtered.items[0])
        continue
      }

      nextItems.push(filtered.changed ? { ...item, items: filtered.items } : item)
      continue
    }

    nextItems.push(item)
  }

  return { items: nextItems, changed }
}

/**
 * 清理已移除的旧内置网页快开功能引用。
 *
 * 网页快开已迁移为插件实现，旧 system 插件动态 featureCode 形如 web-search-{id}。
 * 这里仅清理历史、固定、使用统计和缓存里的旧引用，不删除 web-search-engines 原始配置数据。
 */
export function cleanupLegacyWebSearchReferences(): void {
  const commandListKeys = [
    'command-history',
    'pinned-commands',
    'command-usage-stats',
    'cached-commands'
  ]

  for (const key of commandListKeys) {
    try {
      const data: any[] = databaseAPI.dbGet(key) || []
      if (!Array.isArray(data)) continue

      const result = filterLegacyWebSearchCommandList(data)
      if (!result.changed) continue

      databaseAPI.dbPut(key, result.items)
      console.log(`[StartupMigration] 已清理旧网页快开引用: ${key}`)
    } catch (error) {
      console.error(`[StartupMigration] 清理旧网页快开引用失败: ${key}`, error)
    }
  }

  try {
    const data: any[] = databaseAPI.dbGet('super-panel-pinned') || []
    if (!Array.isArray(data)) return

    const result = filterLegacyWebSearchSuperPanelPinned(data)
    if (!result.changed) return

    databaseAPI.dbPut('super-panel-pinned', result.items)
    console.log('[StartupMigration] 已清理旧网页快开引用: super-panel-pinned')
  } catch (error) {
    console.error('[StartupMigration] 清理旧网页快开引用失败: super-panel-pinned', error)
  }
}
