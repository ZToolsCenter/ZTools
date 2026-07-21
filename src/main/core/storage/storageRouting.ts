export type StorageScope = 'device' | 'account' | 'both'

import { HOST_STORAGE_KEYS, toHostDocId } from '../../../shared/storageKeys'

export const ACCOUNT_SYNC_PREFIXES = [
  'ZTOOLS/user-settings',
  'ZTOOLS/ai-models',
  'ZTOOLS/web-search-engines',
  'ZTOOLS/avatar',
  'PLUGIN/'
]

const ACCOUNT_EXACT_KEYS = new Set([
  'ZTOOLS/user-settings',
  'ZTOOLS/ai-models',
  'ZTOOLS/web-search-engines',
  'ZTOOLS/avatar'
])

const DEVICE_EXACT_KEYS = new Set([
  'ZTOOLS/device-settings',
  'ZTOOLS/settings-general',
  'ZTOOLS/plugins',
  'ZTOOLS/disabled-plugins',
  toHostDocId(HOST_STORAGE_KEYS.pluginOrder),
  toHostDocId(HOST_STORAGE_KEYS.pluginCenterPinned),
  toHostDocId(HOST_STORAGE_KEYS.autoStartPlugin),
  toHostDocId(HOST_STORAGE_KEYS.autoDetachPlugin),
  toHostDocId(HOST_STORAGE_KEYS.outKillPlugin),
  toHostDocId(HOST_STORAGE_KEYS.enabledMainPushPlugin),
  toHostDocId(HOST_STORAGE_KEYS.detachedWindowSizes),
  'ZTOOLS/plugin-market-cache',
  'ZTOOLS/development-projects',
  'SYNC/accounts',
  'SYNC/current-account',
  'SYNC/config'
])

const DEVICE_PREFIXES = ['SYNC/']
const ACCOUNT_PREFIXES = ['PLUGIN/']

export function getStorageScopeForKey(key?: string | null): StorageScope {
  if (!key) return 'both'
  if (ACCOUNT_EXACT_KEYS.has(key)) return 'account'
  if (DEVICE_EXACT_KEYS.has(key)) return 'device'
  if (ACCOUNT_PREFIXES.some((prefix) => key.startsWith(prefix))) return 'account'
  if (DEVICE_PREFIXES.some((prefix) => key.startsWith(prefix))) return 'device'
  if (key === 'ZTOOLS/' || key === 'ZTOOLS') return 'both'
  if (key.startsWith('ZTOOLS/')) return 'device'
  return 'account'
}

export function isAccountSyncDoc(docId: string): boolean {
  return ACCOUNT_SYNC_PREFIXES.some((prefix) => docId.startsWith(prefix))
}
