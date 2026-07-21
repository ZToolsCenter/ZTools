/**
 * Provider（提供商）抽象的统一契约。
 *
 * 翻译、OCR 等能力不再由主程序硬编码实现，而是统一抽象为 Provider：
 * - 插件在 plugin.json 的 providers 字段声明它提供哪些 type；
 * - 运行时通过 ztools.registerProvider(key, handler) 注册实现；
 * - 主程序经 providerManager 聚合后供设置页展示与调用。
 *
 * 注意：AI 不纳入本抽象，AI 模型继续走 aiModels 独立链路。
 */

/**
 * 提供商类型。预留扩展位，未来可在此追加新类型。
 */
export type ProviderType = 'translation' | 'ocr'

/**
 * 插件在 plugin.json 中声明的单个 provider。
 *
 * providers 字段的 key 为插件内唯一标识（不必等于 type），
 * 因此同一插件可对同一 type 声明多条（如 baidu / google 都为 translation）。
 * `registerProvider` 的首参即该 key，运行时按 key 派发。
 */
export interface ProviderDeclaration {
  /** provider 类型 */
  type: ProviderType
  /** 展示名称（可空，缺省回退到插件名） */
  label?: string
  /** 描述文案 */
  description?: string
}

/**
 * plugin.json 中 providers 字段的合法结构：
 * key 为插件内唯一标识（任意字符串），value 为声明详情。
 * 同一插件可对同一 type 声明多条，只要 key 不同即可。
 */
export type PluginProvidersField = Record<string, ProviderDeclaration>

// ==================== 翻译契约 ====================

export interface TranslationInput {
  /** 待翻译文本 */
  text: string
  /** 源语言（可空表示自动检测） */
  from?: string
  /** 目标语言（可空表示使用默认目标，如中文） */
  to?: string
}

export interface TranslationOutput {
  /** 翻译结果文本 */
  text: string
  /** 实际识别到的源语言（可选） */
  detectedFrom?: string
}

// ==================== OCR 契约 ====================

export interface OcrInput {
  /** 图片：本地路径 / data URI / http(s) URL */
  image: string
  /** 识别语言（可空） */
  lang?: string
}

export interface OcrOutput {
  /** 识别到的完整文本 */
  text: string
  /** 按行或块的文本（可选） */
  blocks?: string[]
  /** 置信度 0~1（可选） */
  confidence?: number
}

/**
 * 每种 type 对应的输入/输出类型映射，便于在 providerManager 中做类型收口。
 */
export interface ProviderContractMap {
  translation: { input: TranslationInput; output: TranslationOutput }
  ocr: { input: OcrInput; output: OcrOutput }
}

/**
 * 运行时 handler 的函数签名（由插件通过 registerProvider 注册）。
 *
 * 注意：handler 按「声明 key」存取，而非按 type。一个 key 对应一个 handler，
 * 同一 type 下可有多个 key（如 baidu / google），由 providerManager 按 id 路由。
 */
export type ProviderHandler<T extends ProviderType> = (
  input: ProviderContractMap[T]['input']
) => Promise<ProviderContractMap[T]['output']>

/**
 * 内置 provider 标识（不可删除、不可由插件占用）。
 */
export const BUILTIN_PROVIDER_PREFIX = 'builtin-'

/**
 * 提供商在数据库中的存储 key（ZTOOLS/ 命名空间，由 databaseAPI 自动加前缀）。
 */
export const PROVIDER_SETTINGS_KEY = 'provider-settings'

/**
 * 提供商来源枚举：内置 或 插件。
 */
export type ProviderSource = 'builtin' | 'plugin'

/**
 * 供设置页与主进程消费的扁平化 provider 描述。
 */
export interface ProviderEntry {
  /** 全局唯一 id。内置为 `builtin-xxx`，插件为 `plugin:<pluginName>:<key>` */
  id: string
  /** provider 类型 */
  type: ProviderType
  /** 展示名称 */
  label: string
  /** 描述文案 */
  description: string
  /** 来源 */
  source: ProviderSource
  /** 来源插件名（仅插件 provider） */
  pluginName?: string
  /** 来源插件路径（仅插件 provider） */
  pluginPath?: string
  /** 插件 logo（仅插件 provider） */
  pluginLogo?: string
  /** 插件内声明 key（仅插件 provider，用于运行时按 key 派发到 handler） */
  key?: string
}

/**
 * 用户层 provider 配置，持久化在 PROVIDER_SETTINGS_KEY 下。
 */
export interface ProviderSettings {
  /** 每个 type 启用的 provider id 列表 */
  enabled: Partial<Record<ProviderType, string[]>>
  /** 每个 type 的默认 provider id */
  defaultId: Partial<Record<ProviderType, string>>
  /** 各 provider 的自定义参数（providerId -> 参数对象） */
  params: Record<string, Record<string, unknown>>
}

/**
 * 生成插件 provider 的稳定 id。
 *
 * 第二参数为插件内声明 key（plugin.json providers 字段的 key），
 * 旧插件 key===type，故此处兼容历史用法：传 type 仍得到 `plugin:<name>:<type>`。
 */
export function buildPluginProviderId(pluginName: string, key: string): string {
  return `plugin:${pluginName}:${key}`
}

/**
 * 生成内置 provider 的稳定 id。
 */
export function buildBuiltinProviderId(name: string): string {
  return `${BUILTIN_PROVIDER_PREFIX}${name}`
}

/**
 * 归一化 provider 配置，补齐缺失字段，返回安全可用的副本。
 */
export function normalizeProviderSettings(raw: unknown): ProviderSettings {
  const empty: ProviderSettings = { enabled: {}, defaultId: {}, params: {} }
  if (!raw || typeof raw !== 'object') return empty
  const data = raw as Partial<ProviderSettings>
  // 深拷贝数组层，避免主进程对 enabled 列表的就地修改污染原始数据
  const enabled: ProviderSettings['enabled'] = {}
  if (data.enabled && typeof data.enabled === 'object') {
    for (const [type, list] of Object.entries(data.enabled)) {
      if (Array.isArray(list)) {
        enabled[type as ProviderType] = list.filter((id): id is string => typeof id === 'string')
      }
    }
  }
  return {
    enabled,
    defaultId: data.defaultId && typeof data.defaultId === 'object' ? { ...data.defaultId } : {},
    params:
      data.params && typeof data.params === 'object'
        ? Object.fromEntries(
            Object.entries(data.params).map(([k, v]) => [
              k,
              v && typeof v === 'object' ? { ...v } : v
            ])
          )
        : {}
  }
}

/**
 * 全部受支持的 type 列表（用于设置页 tab 渲染顺序）。
 */
export const ALL_PROVIDER_TYPES: ProviderType[] = ['translation', 'ocr']
