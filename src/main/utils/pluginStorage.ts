import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { physicalFs } from './physicalFs.js'

export type PluginStorageKind = 'asar' | 'directory'

/**
 * 解析插件记录使用的物理存储类型，并兼容缺少 storageKind 的历史记录。
 * @param plugin 插件记录中的存储类型和路径
 * @returns ASAR 或目录存储类型
 */
export function resolvePluginStorageKind(plugin: {
  storageKind?: unknown
  path?: string
}): PluginStorageKind {
  if (plugin.storageKind === 'asar' || plugin.storageKind === 'directory') {
    return plugin.storageKind
  }
  return plugin.path?.toLowerCase().endsWith('.asar') ? 'asar' : 'directory'
}

/**
 * 校验字符串可以安全作为插件实体文件名的一部分。
 * @param value 待校验值
 * @param field 错误信息中使用的字段名称
 * @returns 校验通过时无返回值
 */
export function assertSafePluginArtifactPart(
  value: unknown,
  field: string
): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\') ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw new Error(`${field} 不能用于生成插件文件名`)
  }
}

/**
 * 生成不会覆盖既有版本的 ASAR 安装路径。
 * @param pluginsDir 插件实体根目录
 * @param name 插件名称
 * @param version 插件版本
 * @param installId 本次安装的唯一标识
 * @returns 带版本和安装标识的 ASAR 绝对路径
 */
export function createAsarArtifactPath(
  pluginsDir: string,
  name: string,
  version: string,
  installId = randomUUID().slice(0, 8)
): string {
  // 所有文件名片段先独立校验，避免 path.join 接受越界输入。
  assertSafePluginArtifactPart(name, '插件名称')
  assertSafePluginArtifactPart(version, '插件版本')
  assertSafePluginArtifactPart(installId, '安装标识')
  return path.join(pluginsDir, `${name}-${version}-${installId}.asar`)
}

/**
 * 删除插件物理实体；ASAR 会同时删除同名 unpack 目录。
 * @param plugin 待删除插件的路径、存储类型和开发状态
 * @returns 删除完成后结束的 Promise
 */
export async function removePluginArtifact(plugin: {
  path: string
  storageKind?: unknown
  isDevelopment?: boolean
}): Promise<void> {
  // 开发插件引用用户项目目录，卸载时不能删除源文件。
  if (plugin.isDevelopment) return
  const fs = physicalFs.promises
  if (resolvePluginStorageKind(plugin) === 'asar') {
    // ASAR 与 sidecar 是同一个安装实体，必须一起清理。
    await Promise.all([
      fs.rm(plugin.path, { force: true }),
      fs.rm(`${plugin.path}.unpacked`, { recursive: true, force: true })
    ])
    return
  }
  await fs.rm(plugin.path, { recursive: true, force: true })
}

export type RemovePluginArtifactsByNameOptions = {
  /** 升级后需要保留的当前实体路径（及其 `.unpacked` sidecar） */
  keepPaths?: string[]
  /** 其它已安装插件名；更长前缀优先，避免误删名称前缀相关的插件 */
  reservedNames?: string[]
}

/**
 * 规范化路径后用于 keepPaths 比较（大小写与分隔符不敏感）。
 * @param value 绝对或相对路径
 * @returns 规范化后的比较键
 */
function normalizePathForCompare(value: string): string {
  return path.normalize(value).replace(/\\/g, '/').toLowerCase()
}

/**
 * 判断插件目录下的某个文件/目录名是否属于指定插件实体。
 * 匹配目录名、`name.asar`、以及 `name-version-installId.asar` / `.asar.unpacked`。
 * @param entryName 插件目录内的条目名
 * @param pluginName 目标插件名
 * @param reservedNames 需要避让的其它插件名
 * @returns 属于目标插件时返回 true
 */
export function isOwnedPluginArtifact(
  entryName: string,
  pluginName: string,
  reservedNames: string[] = []
): boolean {
  assertSafePluginArtifactPart(pluginName, '插件名称')

  let artifactBase = entryName
  if (artifactBase.endsWith('.asar.unpacked')) {
    artifactBase = artifactBase.slice(0, -'.unpacked'.length)
  }

  // 目录实体仅精确匹配插件名，避免误删无关目录。
  if (artifactBase === pluginName) return true

  if (!artifactBase.endsWith('.asar')) return false
  const base = artifactBase.slice(0, -'.asar'.length)

  // 兼容 `name.asar` 与版本化 `name-version-id.asar`。
  if (base !== pluginName && !base.startsWith(`${pluginName}-`)) return false

  // 更长的保留插件名优先，例如卸载 he-calendar 时保留 he-calendar-extra。
  for (const reserved of reservedNames) {
    if (!reserved || reserved === pluginName) continue
    try {
      assertSafePluginArtifactPart(reserved, '保留插件名称')
    } catch {
      continue
    }
    if (base === reserved || base.startsWith(`${reserved}-`)) return false
  }
  return true
}

/**
 * 清理插件目录下属于指定插件名的全部物理实体（含历史残留 ASAR）。
 * @param pluginsDir 插件实体根目录
 * @param pluginName 插件名称
 * @param options 保留路径与其它插件名避让选项
 * @returns 清理完成后结束的 Promise
 */
export async function removePluginArtifactsByName(
  pluginsDir: string,
  pluginName: string,
  options: RemovePluginArtifactsByNameOptions = {}
): Promise<void> {
  assertSafePluginArtifactPart(pluginName, '插件名称')
  const fs = physicalFs.promises
  const keep = new Set((options.keepPaths ?? []).map(normalizePathForCompare))
  const reservedNames = options.reservedNames ?? []

  let entries: string[]
  try {
    entries = await fs.readdir(pluginsDir)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
    throw error
  }

  const removals: Promise<void>[] = []
  for (const entry of entries) {
    if (!isOwnedPluginArtifact(entry, pluginName, reservedNames)) continue
    const fullPath = path.join(pluginsDir, entry)
    if (keep.has(normalizePathForCompare(fullPath))) continue
    // 保留 ASAR 时同步保留其 `.unpacked` sidecar。
    if (
      entry.endsWith('.asar.unpacked') &&
      keep.has(normalizePathForCompare(fullPath.slice(0, -'.unpacked'.length)))
    ) {
      continue
    }
    removals.push(fs.rm(fullPath, { recursive: true, force: true }))
  }
  await Promise.all(removals)
}
