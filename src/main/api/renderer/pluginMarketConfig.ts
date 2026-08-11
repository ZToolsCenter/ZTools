import {
  loadOfficialAccountSession,
  refreshOfficialAccountTokens,
  saveOfficialAccountSession
} from '../../core/account/officialAccountService'
import type { HttpRequestOptions, HttpResponse } from '../../utils/httpRequest'
import { httpRequest } from '../../utils/httpRequest.js'
import databaseAPI from '../shared/database'
import { DEFAULT_MARKET_SOURCE, type MarketSourceConfig } from './marketSourceAdapter'
import { HOST_STORAGE_KEYS } from '../../../shared/storageKeys'

export const DEFAULT_PLUGIN_MARKET_API_BASE = 'https://z-tools.top/api/market'
export const DEFAULT_SYNC_SERVER_URL = 'wss://z-tools.top'

export class PluginMarketAuthRequiredError extends Error {
  constructor(message = '需要登录后操作') {
    super(message)
    this.name = 'PluginMarketAuthRequiredError'
  }
}

export const PluginMarketAuthMode = {
  OPTIONAL: 'optional',
  REQUIRED: 'required'
} as const

export type PluginMarketAuthMode = (typeof PluginMarketAuthMode)[keyof typeof PluginMarketAuthMode]

/**
 * 获取当前市场源配置。
 * 从 LMDB 读取用户配置，未配置时返回默认官方源。
 * @returns 当前生效的市场源配置
 */
export function getMarketSourceConfig(): MarketSourceConfig {
  try {
    const stored = databaseAPI.dbGet(HOST_STORAGE_KEYS.pluginMarketSource)
    if (stored && typeof stored === 'object' && typeof stored.type === 'string') {
      return stored as MarketSourceConfig
    }
  } catch {
    // ignore read errors, fall back to default
  }
  return { ...DEFAULT_MARKET_SOURCE }
}

/**
 * 获取当前市场的 API 基础地址。
 * 仅当使用官方源时返回官方 API 地址；其他源类型返回空字符串。
 * @returns 官方 API 基础地址或空字符串
 */
export function getPluginMarketApiBase(): string {
  const source = getMarketSourceConfig()
  if (source.type === 'official') {
    return DEFAULT_PLUGIN_MARKET_API_BASE
  }
  // 非官方源不使用官方 API，返回空字符串
  return ''
}

export async function getPluginMarketAuthHeaders(
  marketApiBase = getPluginMarketApiBase()
): Promise<Record<string, string>> {
  void marketApiBase
  try {
    const config = await loadOfficialAccountSession()
    if (!config?.token) {
      return {}
    }
    return { Authorization: `Bearer ${config.token}` }
  } catch {
    return {}
  }
}

export async function requestPluginMarket(
  path: string,
  options: HttpRequestOptions = {},
  authMode: PluginMarketAuthMode = PluginMarketAuthMode.OPTIONAL
): Promise<HttpResponse> {
  const marketApiBase = getPluginMarketApiBase()
  const url = path.startsWith('http') ? path : `${marketApiBase}${path}`
  const response = await requestPluginMarketOnce(url, marketApiBase, options)
  if (response.status !== 401) {
    assertOK(response)
    return response
  }

  let refreshed = false
  try {
    refreshed = await refreshPluginMarketToken(marketApiBase)
  } catch {
    refreshed = false
  }

  if (refreshed) {
    const retry = await requestPluginMarketOnce(url, marketApiBase, options)
    if (retry.status !== 401) {
      assertOK(retry)
      return retry
    }
  }

  if (authMode === PluginMarketAuthMode.OPTIONAL) {
    const anonymousRetry = await requestPluginMarketOnce(url, marketApiBase, options, false)
    assertOK(anonymousRetry)
    return anonymousRetry
  }

  throw new PluginMarketAuthRequiredError()
}

export async function savePluginMarketTokens(input: {
  serverUrl?: string
  token: string
  refreshToken?: string
  username?: string
}): Promise<void> {
  if (!input.username) throw new Error('官方账号用户名不能为空')
  await saveOfficialAccountSession({
    username: input.username,
    token: input.token,
    refreshToken: input.refreshToken || ''
  })
}

async function requestPluginMarketOnce(
  url: string,
  marketApiBase: string,
  options: HttpRequestOptions,
  includeAuth = true
): Promise<HttpResponse> {
  const authHeaders = includeAuth ? await getPluginMarketAuthHeaders(marketApiBase) : {}
  const optionHeaders = includeAuth
    ? options.headers || {}
    : Object.fromEntries(
        Object.entries(options.headers || {}).filter(
          ([key]) => key.toLowerCase() !== 'authorization'
        )
      )
  return httpRequest(url, {
    ...options,
    headers: {
      ...optionHeaders,
      ...authHeaders
    },
    validateStatus: (status) => (status >= 200 && status < 300) || status === 401
  })
}

/**
 * 通过统一设备级刷新服务更新插件市场使用的官方账号 token。
 * @param marketApiBase 插件市场 API 地址；保留参数以兼容现有调用边界。
 * @returns 获得可用访问令牌时返回 true。
 */
async function refreshPluginMarketToken(marketApiBase: string): Promise<boolean> {
  void marketApiBase
  const config = await loadOfficialAccountSession()
  if (!config?.refreshToken) {
    return false
  }
  const result = await refreshOfficialAccountTokens(config.refreshToken)
  return (
    (result.status === 'refreshed' || result.status === 'reused') && Boolean(result.session.token)
  )
}

function assertOK(response: HttpResponse): void {
  if (response.status >= 200 && response.status < 300) return
  const data = typeof response.data === 'string' ? safeParseJSON(response.data) : response.data
  throw new Error(data?.error || `Request failed with status code ${response.status}`)
}

function safeParseJSON(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

export function syncServerUrlToHttp(serverUrl: string): string {
  return serverUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')
}
