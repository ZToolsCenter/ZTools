import { app } from 'electron'
import path from 'path'

/**
 * 随包内置插件名称列表
 * 这些插件存在于 internal-plugins 目录，并由宿主在启动时自动装载。
 */
export const BUNDLED_INTERNAL_PLUGIN_NAMES = ['setting', 'system'] as const

/**
 * 内部 API 特权插件名称列表
 * 这些插件允许调用 window.ztools.internal，但不一定是随包内置插件。
 */
export const INTERNAL_API_PLUGIN_NAMES = [
  ...BUNDLED_INTERNAL_PLUGIN_NAMES,
  'ztools-developer-plugin__dev',
  'ztools-developer-plugin'
] as const

export type BundledInternalPluginName = (typeof BUNDLED_INTERNAL_PLUGIN_NAMES)[number]
export type InternalApiPluginName = (typeof INTERNAL_API_PLUGIN_NAMES)[number]

/**
 * 判断插件是否为硬编码可信插件（随宿主发布或开发者工具，始终完全授权）。
 * 这类插件不参与授权管理，也不在设置页的高级权限列表中展示。
 * @param pluginName 插件名称
 * @returns 是否为硬编码可信插件
 */
export function isTrustedInternalApiPlugin(pluginName: string): boolean {
  return INTERNAL_API_PLUGIN_NAMES.includes(pluginName as InternalApiPluginName)
}

export const CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY = 'customInternalApiPluginNames'

/**
 * settings-general 中被整体停用高级 API 授权的插件名称列表。
 * 停用仅挂起授权（保留按通道授权与完全授权配置），重新开启后恢复。
 */
export const CUSTOM_INTERNAL_API_DISABLED_KEY = 'customInternalApiDisabledPlugins'

/**
 * settings-general 中按插件细分的高级 API 授权字段名。
 * 值为「插件名 -> 已授权 internal 通道名列表」的对象。
 */
export const CUSTOM_INTERNAL_API_PERMISSIONS_KEY = 'customInternalApiPermissions'

/**
 * settings-general 中等待用户处理的插件高级 API 申请字段名。
 * 值为「插件名 -> 申请条目」的对象。
 */
export const INTERNAL_API_REQUESTS_KEY = 'internalApiPendingRequests'

/**
 * 单个插件提交的高级 API 申请条目。
 */
export interface InternalApiRequestEntry {
  apis: string[]
  reason?: string
  requestedAt: number
}

/**
 * internal 通道名的合法格式（internal:xxx，小写字母数字与中划线）。
 */
const INTERNAL_API_CHANNEL_PATTERN = /^internal:[a-z0-9][a-z0-9-]*$/

/**
 * 单个插件授权列表允许的最大通道数量，防止异常插件写入超长列表。
 * 上限需大于主进程注册的 internal 通道总数（当前约 150 个），
 * 保证「完全授权插件移除单个通道」降级写入全量列表时不被截断。
 */
const MAX_INTERNAL_API_CHANNEL_COUNT = 256

/**
 * 主进程已注册的 internal IPC 通道注册表。
 * 用于校验插件申请的 API 名真实存在，并向设置页提供可选 API 清单。
 */
const registeredInternalApiChannels = new Set<string>()

/**
 * 登记一个主进程实际存在的 internal IPC 通道名。
 * @param channel 通道名（形如 internal:db-get）
 * @returns 无返回值
 */
export function registerInternalApiChannel(channel: string): void {
  if (INTERNAL_API_CHANNEL_PATTERN.test(channel)) {
    registeredInternalApiChannels.add(channel)
  }
}

/**
 * 获取全部已注册的 internal 通道名（排序后返回，便于 UI 展示）。
 * @returns 通道名数组
 */
export function getRegisteredInternalApiChannels(): string[] {
  return Array.from(registeredInternalApiChannels).sort()
}

/**
 * 判断通道名是否为主进程已注册的 internal 通道。
 * @param channel 通道名
 * @returns 是否已注册
 */
export function isRegisteredInternalApiChannel(channel: string): boolean {
  return registeredInternalApiChannels.has(channel)
}

/**
 * 归一化 internal 通道名列表：仅保留合法格式且已注册的通道，去重并限制数量。
 * @param value 任意输入值
 * @returns 归一化后的通道名数组
 */
export function normalizeInternalApiChannelList(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(
      value
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter((name) => isRegisteredInternalApiChannel(name))
    )
  ).slice(0, MAX_INTERNAL_API_CHANNEL_COUNT)
}

/**
 * 归一化插件名（作为授权对象的键）：去除空白、过滤非法值。
 * @param name 待校验的插件名
 * @returns 合法时返回去除首尾空白后的名称，否则返回空字符串
 */
export function normalizeInternalApiPluginKey(name: unknown): string {
  if (typeof name !== 'string') return ''
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 200 || trimmed.includes('\0')) return ''
  return trimmed
}

/**
 * 归一化「插件名 -> 通道列表」的授权映射，丢弃空条目与非法键。
 * @param value 任意输入值
 * @returns 归一化后的授权映射
 */
export function normalizeInternalApiPermissionsMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const result: Record<string, string[]> = {}
  for (const [rawName, rawApis] of Object.entries(value as Record<string, unknown>)) {
    const pluginName = normalizeInternalApiPluginKey(rawName)
    if (!pluginName) continue
    const apis = normalizeInternalApiChannelList(rawApis)
    if (apis.length === 0) continue
    result[pluginName] = apis
  }
  return result
}

/**
 * 归一化「插件名 -> 申请条目」的待审申请映射，丢弃结构非法的条目。
 * @param value 任意输入值
 * @returns 归一化后的申请映射
 */
export function normalizeInternalApiRequestsMap(
  value: unknown
): Record<string, InternalApiRequestEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const result: Record<string, InternalApiRequestEntry> = {}
  for (const [rawName, rawEntry] of Object.entries(value as Record<string, unknown>)) {
    const pluginName = normalizeInternalApiPluginKey(rawName)
    if (!pluginName || !rawEntry || typeof rawEntry !== 'object') continue
    const entry = rawEntry as Record<string, unknown>
    const apis = normalizeInternalApiChannelList(entry.apis)
    if (apis.length === 0) continue
    result[pluginName] = {
      apis,
      reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 500) : undefined,
      requestedAt:
        typeof entry.requestedAt === 'number' && Number.isFinite(entry.requestedAt)
          ? entry.requestedAt
          : Date.now()
    }
  }
  return result
}

export function normalizeCustomInternalApiPluginNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter((name) => name.length > 0)
    )
  )
}

/**
 * 归一化被停用高级 API 授权的插件名称列表（复用名单类字段的清洗规则）。
 * @param value 任意输入值
 * @returns 去重后的插件名数组
 */
export function normalizeInternalApiDisabledPluginList(value: unknown): string[] {
  return normalizeCustomInternalApiPluginNames(value)
}

/**
 * 判断是否为随包内置插件
 * @param pluginName 插件名称
 * @returns 是否为随包内置插件
 */
export function isBundledInternalPlugin(pluginName: string): boolean {
  return BUNDLED_INTERNAL_PLUGIN_NAMES.includes(pluginName as BundledInternalPluginName)
}

/**
 * 判断插件是否允许调用内部 API
 * @param pluginName 插件名称
 * @returns 是否拥有内部 API 权限
 */
export function canPluginUseInternalApi(
  pluginName: string,
  customPluginNames: string[] = []
): boolean {
  if (INTERNAL_API_PLUGIN_NAMES.includes(pluginName as InternalApiPluginName)) {
    return true
  }

  return customPluginNames.includes(pluginName)
}

/**
 * 获取内置插件路径
 * @param pluginName 插件名称
 * @returns 插件路径
 */
export function getInternalPluginPath(pluginName: BundledInternalPluginName): string {
  const isDev = !app.isPackaged

  if (isDev) {
    // 开发环境：使用源码目录
    return path.resolve(process.cwd(), 'internal-plugins', pluginName)
  } else {
    // 生产环境：从 resources 加载
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'internal-plugins', pluginName)
  }
}
