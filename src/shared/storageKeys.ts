export const HOST_STORAGE_KEYS = {
  settingsGeneral: 'settings-general',
  plugins: 'plugins',
  disabledPlugins: 'disabled-plugins',
  pluginOrder: 'plugin-order',
  aiModels: 'ai-models',
  pinnedCommands: 'pinned-commands',
  superPanelPinned: 'super-panel-pinned',
  localShortcuts: 'local-shortcuts',
  globalShortcuts: 'global-shortcuts',
  appShortcuts: 'app-shortcuts',
  commandAliases: 'command-aliases',
  disabledCommands: 'disable-commands',
  pluginCenterPinned: 'plugin-center-pinned',
  commandHistory: 'command-history',
  commandUsageStats: 'command-usage-stats',
  searchPreference: 'search-preference',
  lastMatchState: 'last-match-state',
  autoStartPlugin: 'auto-start-plugin',
  autoDetachPlugin: 'auto-detach-plugin',
  outKillPlugin: 'out-kill-plugin',
  enabledMainPushPlugin: 'enabled-main-push-plugin',
  detachedWindowSizes: 'detached-window-sizes',
  devPluginRegistry: 'dev-plugin-registry',
  mcpDisabledPlugins: 'settings-mcp-disabled-plugins',
  // [ZT-Enhance] 插件批量管理全局开关（通用设置页 → 插件批量管理）
  batchPluginManage: 'batch-plugin-manage'
} as const

export const LEGACY_CAMEL_CASE_STORAGE_KEYS = {
  autoStartPlugin: 'autoStartPlugin',
  autoDetachPlugin: 'autoDetachPlugin',
  outKillPlugin: 'outKillPlugin',
  disabledMainPushPlugin: 'disabledMainPushPlugin',
  detachedWindowSizes: 'detachedWindowSizes'
} as const

export function toHostDocId(key: string): string {
  return `ZTOOLS/${key}`
}
