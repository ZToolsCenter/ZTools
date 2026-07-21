import { HOST_STORAGE_KEYS } from './storageKeys'

export const ENABLED_MAIN_PUSH_PLUGINS_KEY = HOST_STORAGE_KEYS.enabledMainPushPlugin

/** 解析插件配置列表，并兼容 2.x 的 { pluginName }[] 结构。 */
export function normalizeConfigList(data: unknown): string[] {
  if (!Array.isArray(data)) return []
  return data
    .map((item) =>
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && 'pluginName' in item
          ? String((item as { pluginName?: unknown }).pluginName || '')
          : ''
    )
    .filter(Boolean)
}

export function isMainPushPluginEnabled(pluginName: string, enabledPluginNames: string[]): boolean {
  return enabledPluginNames.includes(pluginName)
}

export function removePluginNameFromSettingList(data: string[], pluginName: string): string[] {
  return data.filter((name) => name !== pluginName)
}
