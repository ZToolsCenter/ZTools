import { existsSync } from 'fs'

const ZTOOLS_ICON_PREFIX = 'ztools-icon://'

interface CachedAppCommand {
  path?: unknown
  icon?: unknown
}

/**
 * 从 ZTools 图标协议 URL 中还原本地文件路径。
 *
 * @param iconUrl 待解析的图标 URL。
 * @returns 解码后的本地路径；协议或编码无效时返回 null。
 */
export function decodeZToolsIconPath(iconUrl: string): string | null {
  if (!iconUrl.startsWith(ZTOOLS_ICON_PREFIX)) return null

  try {
    return decodeURIComponent(iconUrl.slice(ZTOOLS_ICON_PREFIX.length))
  } catch {
    return null
  }
}

/**
 * 判断持久化应用缓存中是否存在已经失效的 UWP 图标路径。
 *
 * @param commands 待检查的应用缓存列表。
 * @param fileExists 文件存在性检查函数，测试可注入替身。
 * @returns 任一 UWP 图标缺失、协议损坏或文件不存在时返回 true。
 */
export function hasStaleUwpIconCache(
  commands: CachedAppCommand[],
  fileExists: (filePath: string) => boolean = existsSync
): boolean {
  return commands.some((command) => {
    if (typeof command.path !== 'string' || !command.path.startsWith('uwp:')) return false
    if (typeof command.icon !== 'string') return true

    // UWP 缓存应指向扫描时解析出的本地图标，其他格式无法保证更新后仍有效。
    const iconPath = decodeZToolsIconPath(command.icon)
    return iconPath === null || !fileExists(iconPath)
  })
}

/**
 * 判断当前用户包注册快照是否相对持久化快照发生变化。
 *
 * @param cachedSnapshot 上次成功扫描后保存的包完整名列表。
 * @param currentSnapshot 当前启动时读取的包完整名列表。
 * @returns 快照缺失、格式无效或内容不一致时返回 true。
 */
export function hasUwpPackageSnapshotChanged(
  cachedSnapshot: unknown,
  currentSnapshot: string[]
): boolean {
  if (
    !Array.isArray(cachedSnapshot) ||
    cachedSnapshot.some((packageName) => typeof packageName !== 'string')
  ) {
    return true
  }
  if (cachedSnapshot.length !== currentSnapshot.length) return true

  // 两侧都排序后比较，避免注册表枚举顺序变化造成无意义的全量重扫。
  const previous = [...cachedSnapshot].sort()
  const current = [...currentSnapshot].sort()
  return previous.some((packageName, index) => packageName !== current[index])
}
