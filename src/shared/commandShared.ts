/**
 * 可参与 commandId 计算的最小指令字段集合
 */
export interface CommandIdLike {
  name: string
  pluginName?: string
  featureCode?: string
  cmdType?: string
  type?: string
  subType?: string
  path?: string
}

/**
 * 单条指令别名配置
 * icon 用于在别名命中时覆盖结果图标，未提供时回退到原指令图标
 */
export type CommandAliasEntry = {
  alias: string
  icon?: string
}

/**
 * 指令别名存储结构
 * key 为 getCommandId 生成的 commandId，value 为该指令下的别名列表
 */
export type CommandAliasStore = Record<string, CommandAliasEntry[]>

/**
 * 指令别名在主程序数据库中的存储 key
 * 设置插件和主窗口渲染进程都会通过该 key 读取同一份映射
 */
export const COMMAND_ALIASES_KEY = 'command-aliases'
export const DIRECT_APP_ALIAS_GROUP_KEY = '__direct_app__'
export const DIRECT_APP_ALIAS_GROUP_TITLE = '系统应用'

function normalizeDirectAppPath(path?: string): string {
  return (path || '').replace(/\\/g, '/')
}

/**
 * 生成指令唯一标识
 * - 插件指令保持现有规则：pluginName:featureCode:name:cmdType
 * - direct/app 改为基于 path 的稳定 ID，避免同名应用冲突
 * - 其它类型继续沿用旧规则
 */
export function getCommandId(cmd: CommandIdLike): string {
  const cmdType = cmd.cmdType || 'text'

  if (cmd.type === 'direct' && cmd.subType === 'app') {
    const normalizedPath = normalizeDirectAppPath(cmd.path)
    if (normalizedPath) {
      return `direct:app:${normalizedPath}`
    }
  }

  return `${cmd.pluginName || ''}:${cmd.featureCode || ''}:${cmd.name}:${cmdType}`
}

/**
 * direct/app 兼容旧版 name-based 禁用键。
 * 旧版本按应用名称持久化禁用状态，因此 alias 生效后仍需回退到原名命中旧记录。
 */
export function getLegacyDirectAppCommandId(name: string, cmdType = 'text'): string {
  return getCommandId({ name, cmdType })
}

/**
 * 归一化指令别名存储，兼容旧版 string[] 结构
 * 规则：
 * 1. 同时兼容 string[] 与 { alias, icon }[] 两种输入
 * 2. 去除 alias 首尾空白并过滤空值
 * 3. 按 alias 文本去重，重复项以后写为准并保留 icon
 * 4. 移除归一化后为空的 commandId bucket
 */
export function normalizeCommandAliases(
  store: CommandAliasStore | null | undefined
): CommandAliasStore {
  const normalized: CommandAliasStore = {}

  for (const [commandId, aliases] of Object.entries(store || {})) {
    const nextAliases = Array.from(
      new Map(
        ((aliases || []) as Array<string | CommandAliasEntry>)
          .map((aliasEntry) => {
            if (typeof aliasEntry === 'string') {
              return { alias: aliasEntry.trim(), icon: undefined }
            }

            return {
              alias: (aliasEntry?.alias || '').trim(),
              icon: aliasEntry?.icon || undefined
            }
          })
          .filter((aliasEntry) => Boolean(aliasEntry.alias))
          .map((aliasEntry) => [aliasEntry.alias, aliasEntry] as const)
      ).values()
    )

    if (nextAliases.length > 0) {
      normalized[commandId] = nextAliases
    }
  }

  return normalized
}
