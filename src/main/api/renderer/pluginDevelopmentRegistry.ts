import path from 'path'
import { toDevPluginName } from '../../../shared/pluginRuntimeNamespace'

// ============================================================
// Types
// ============================================================

/**
 * 开发项目的绑定状态
 * - ready: 配置有效，可正常使用
 * - config_missing: plugin.json 文件缺失
 * - invalid_config: plugin.json 内容无效（缺少 name、name 不匹配等）
 * - unbound: 项目未绑定有效路径
 */
export type DevProjectBindingStatus = 'ready' | 'config_missing' | 'invalid_config' | 'unbound'

/** plugin.json 的快照副本，仅保留注册表需要的字段 */
export type PluginManifestSnapshot = {
  name?: string
  title?: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  logo?: string
  preload?: string
  features?: any[]
  /** 开发模式专用配置，如自定义 main 入口 */
  development?: { main?: string }
  /** 插件可运行平台列表，如 ["win32", "darwin"] */
  platform?: string[]
}

/** 已安装插件的快照记录，用于注册表与安装列表的交互 */
export type PluginInstallRecord = {
  name?: string
  title?: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  logo?: string
  main?: string
  preload?: string
  features?: any[]
  /** 插件的本地目录路径 */
  path?: string
  /** 是否为开发模式安装 */
  isDevelopment?: boolean
  installedAt?: string
}

/** 注册表中的单个开发项目记录 */
export type DevProjectRecord = {
  /** 项目名称（与 plugin.json 中的 name 一致） */
  name: string
  /** plugin.json 的快照副本，用于在配置文件不可用时提供基本信息 */
  configSnapshot: PluginManifestSnapshot
  /** 项目首次登记时间（ISO 格式） */
  addedAt: string
  /** 最近一次更新时间（ISO 格式） */
  updatedAt: string
  /** 排序序号，数值越小越靠前 */
  sortOrder: number
  /** 项目目录的绝对路径 */
  projectPath: string | null
  /** plugin.json 的绝对路径 */
  configPath: string | null
  /** 当前绑定状态 */
  status: DevProjectBindingStatus
  /** 最近一次校验时间（ISO 格式） */
  lastValidatedAt: string
  /** 最近一次校验的错误信息 */
  lastError?: string
}

/** 开发项目注册表的顶层结构（持久化到 LMDB） */
export type DevProjectRegistry = {
  /** 文档版本号，用于升级迁移 */
  version: typeof DEV_PROJECT_REGISTRY_VERSION
  /** 以项目名称为 key 的记录集合 */
  projects: Record<string, DevProjectRecord>
}

/** upsertDevProjectFromConfig 的入参 */
export type UpsertByConfigParams = {
  /** 当前注册表 */
  registry: DevProjectRegistry
  /** 插件项目目录路径 */
  pluginPath: string
  /** 从 plugin.json 解析的配置 */
  pluginConfig: PluginManifestSnapshot
  /** 可选的时间戳工厂函数（用于测试注入） */
  now?: () => string
}

/** rebindDevProjectFromConfig 的入参 */
export type RebindByConfigParams = {
  /** 当前注册表 */
  registry: DevProjectRegistry
  /** 新的 plugin.json 绝对路径 */
  pluginJsonPath: string
  /** 从 plugin.json 解析的配置 */
  pluginConfig: PluginManifestSnapshot
  /** 可选的时间戳工厂函数（用于测试注入） */
  now?: () => string
}

/** mutation 操作的通用返回结果 */
export type DevProjectMutationResult<T = object> = {
  success: boolean
  /** 失败原因描述 */
  reason?: string
  /** 操作后的注册表（无论成功与否均返回最新状态） */
  registry: DevProjectRegistry
} & T

/** updateProjectMeta 的入参 */
export type UpdateProjectMetaParams = {
  registry: DevProjectRegistry
  projectName: string
  meta: {
    title?: string
    description?: string
    platform?: string[]
    author?: string
  }
  now?: () => string
}

// ============================================================
// Constants
// ============================================================

/** 注册表在 LMDB 中的存储键名 */
export const DEV_PROJECT_REGISTRY_DB_KEY = 'dev-plugin-registry'
/** 当前注册表文档版本号，版本不匹配时重建空文档 */
const DEV_PROJECT_REGISTRY_VERSION = 3 as const
/** 内置插件名称集合，这些名称不允许作为开发项目注册 */
const BUILT_IN_NAMES = new Set(['setting', 'system'])
/** 合法的绑定状态枚举值，用于反序列化时校验 */
const VALID_BINDING_STATUSES = new Set<DevProjectBindingStatus>([
  'ready',
  'config_missing',
  'invalid_config',
  'unbound'
])

// ============================================================
// Internal Utilities
// ============================================================

/** 标准化路径为绝对路径 */
function resolvePath(p: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(p)) return p
  return path.resolve(p)
}

/** 获取当前时间的 ISO 字符串 */
function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 标准化时间戳值，无效值回退到 fallback
 * @param value - 待验证的时间戳
 * @param fallback - 无效时使用的默认值
 */
function normalizeTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

/**
 * 标准化绑定状态值，无效值回退到 'unbound'
 * @param value - 待验证的状态值
 */
function normalizeStatus(value: unknown): DevProjectBindingStatus {
  return typeof value === 'string' && VALID_BINDING_STATUSES.has(value as DevProjectBindingStatus)
    ? (value as DevProjectBindingStatus)
    : 'unbound'
}

/**
 * 标准化可选路径值，空值或非字符串返回 null
 * @param value - 待验证的路径值
 */
function normalizeOptionalPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return resolvePath(value)
}

/**
 * 获取按 sortOrder 排序的项目名称列表
 * sortOrder 相同时按 addedAt 倒序（最新优先）兜底
 * @param projects - 注册表中的所有项目记录
 */
function getOrderedProjectNames(projects: Record<string, DevProjectRecord>): string[] {
  return Object.values(projects)
    .sort((a, b) => {
      const orderA = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER
      const orderB = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      const timeA = a.addedAt ? new Date(a.addedAt).getTime() : 0
      const timeB = b.addedAt ? new Date(b.addedAt).getTime() : 0
      return timeB - timeA
    })
    .map((item) => item.name)
}

// ============================================================
// Registry Deserialization
// ============================================================

/** 创建一个空的注册表文档（当前版本） */
export function createEmptyDevProjectRegistry(): DevProjectRegistry {
  return { version: DEV_PROJECT_REGISTRY_VERSION, projects: {} }
}

/**
 * 解析单条持久化的项目记录，无效或内置插件返回 null。
 * 会自动尝试从 projectPath / configPath 互相恢复缺失路径。
 * @param name - 项目名称（作为 key 传入，用于校验与 raw.name 的一致性）
 * @param raw - 从 LMDB 读取的原始记录数据
 * @param fallbackTimestamp - 缺失时间戳时使用的回退值
 * @returns 解析后的条目和原始排序号，无效记录返回 null
 */
function parseRegistryEntry(
  name: string,
  raw: any,
  fallbackTimestamp: string
): { entry: DevProjectRecord; rawSortOrder: number | null } | null {
  if (!name || BUILT_IN_NAMES.has(name)) return null
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.name !== 'string' || raw.name !== name) return null
  if (
    !raw.configSnapshot ||
    typeof raw.configSnapshot !== 'object' ||
    Array.isArray(raw.configSnapshot)
  ) {
    return null
  }

  let projectPath = normalizeOptionalPath(raw.projectPath)
  let configPath = normalizeOptionalPath(raw.configPath)
  let status = normalizeStatus(raw.status)

  // 尝试从对方路径恢复缺失路径
  if (status !== 'unbound') {
    if (!projectPath && configPath) projectPath = resolvePath(path.dirname(configPath))
    if (!configPath && projectPath) configPath = resolvePath(path.join(projectPath, 'plugin.json'))
    if (!projectPath || !configPath) status = 'unbound'
  }

  return {
    entry: {
      name,
      configSnapshot: { ...(raw.configSnapshot as PluginManifestSnapshot) },
      addedAt: normalizeTimestamp(raw.addedAt, fallbackTimestamp),
      updatedAt: normalizeTimestamp(raw.updatedAt, fallbackTimestamp),
      sortOrder: -1,
      projectPath,
      configPath,
      status,
      lastValidatedAt: normalizeTimestamp(raw.lastValidatedAt, fallbackTimestamp),
      ...(typeof raw.lastError === 'string' && raw.lastError ? { lastError: raw.lastError } : {})
    },
    rawSortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : null
  }
}

/**
 * 反序列化并规范化开发项目主记录文档（v3）。
 * 无效或过时的文档会被替换为空注册表。
 */
export function readDevProjectRegistry(raw: unknown): DevProjectRegistry {
  const emptyDoc = createEmptyDevProjectRegistry()
  if (!raw || typeof raw !== 'object') return emptyDoc
  const doc = raw as { version?: unknown; projects?: unknown }
  if (doc.version !== DEV_PROJECT_REGISTRY_VERSION) return emptyDoc
  if (!doc.projects || typeof doc.projects !== 'object' || Array.isArray(doc.projects))
    return emptyDoc

  const projects: Record<string, DevProjectRecord> = {}
  const pendingSortOrders = new Map<string, number | null>()
  const fallbackTimestamp = nowIso()

  for (const [name, rawEntry] of Object.entries(doc.projects as Record<string, any>)) {
    const parsed = parseRegistryEntry(name, rawEntry, fallbackTimestamp)
    if (!parsed) continue
    projects[name] = parsed.entry
    pendingSortOrders.set(name, parsed.rawSortOrder)
  }

  // 排序：优先使用显式 sortOrder，否则按 addedAt 倒序兜底
  const fallbackOrder = new Map(
    Object.values(projects)
      .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
      .map((item, index) => [item.name, index])
  )
  for (const [name, project] of Object.entries(projects)) {
    project.sortOrder =
      pendingSortOrders.get(name) ?? fallbackOrder.get(name) ?? Number.MAX_SAFE_INTEGER
  }

  return { version: DEV_PROJECT_REGISTRY_VERSION, projects }
}

// ============================================================
// Registry Mutations
// ============================================================

/**
 * 登记或更新开发项目。
 * 同名项目必须来自同一目录路径，否则返回冲突错误。
 * 新项目 sortOrder 默认追加到末尾，已存在的项目保留原排序。
 * @param options - 包含注册表、插件路径和配置的选项对象
 * @returns 操作结果，包含成功标志和更新后的注册表
 */
export function upsertByConfig(options: UpsertByConfigParams): DevProjectMutationResult {
  const clock = options.now ?? nowIso
  const normalizedPath = resolvePath(options.pluginPath)
  const projectName = options.pluginConfig.name

  if (!projectName) {
    return { success: false, reason: 'Project config requires a name', registry: options.registry }
  }
  if (BUILT_IN_NAMES.has(projectName)) {
    return {
      success: false,
      reason: `Project name ${projectName} is not allowed`,
      registry: options.registry
    }
  }

  const existing = options.registry.projects[projectName]
  if (existing?.projectPath && resolvePath(existing.projectPath) !== normalizedPath) {
    return {
      success: false,
      reason: `Project name ${projectName} is already registered at ${existing.projectPath}`,
      registry: options.registry
    }
  }

  const ts = clock()
  return {
    success: true,
    registry: {
      version: DEV_PROJECT_REGISTRY_VERSION,
      projects: {
        ...options.registry.projects,
        [projectName]: {
          name: projectName,
          configSnapshot: { ...options.pluginConfig },
          addedAt: existing?.addedAt ?? ts,
          updatedAt: ts,
          sortOrder: existing?.sortOrder ?? Object.keys(options.registry.projects).length,
          projectPath: normalizedPath,
          configPath: path.join(normalizedPath, 'plugin.json'),
          status: 'ready',
          lastValidatedAt: ts
        }
      }
    }
  }
}

/**
 * 在保留项目 identity（name）和排序的前提下，重新绑定 plugin.json 路径。
 * 用于用户移动了项目目录后手动重新指定配置文件位置。
 * @param options - 包含注册表、新 plugin.json 路径和配置的选项对象
 * @returns 操作结果，项目不存在时返回失败
 */
export function rebindByConfig(options: RebindByConfigParams): DevProjectMutationResult {
  const clock = options.now ?? nowIso
  const projectName = options.pluginConfig.name

  if (!projectName) {
    return { success: false, reason: 'Project config requires a name', registry: options.registry }
  }
  if (BUILT_IN_NAMES.has(projectName)) {
    return {
      success: false,
      reason: `Project name ${projectName} is not allowed`,
      registry: options.registry
    }
  }

  const existing = options.registry.projects[projectName]
  if (!existing) {
    return {
      success: false,
      reason: `Project ${projectName} does not exist`,
      registry: options.registry
    }
  }

  const ts = clock()
  const normalizedConfigPath = resolvePath(options.pluginJsonPath)
  return {
    success: true,
    registry: {
      version: DEV_PROJECT_REGISTRY_VERSION,
      projects: {
        ...options.registry.projects,
        [projectName]: {
          ...existing,
          configSnapshot: { ...options.pluginConfig },
          updatedAt: ts,
          projectPath: resolvePath(path.dirname(normalizedConfigPath)),
          configPath: normalizedConfigPath,
          status: 'ready',
          lastValidatedAt: ts
        }
      }
    }
  }
}

/**
 * 根据传入名称列表重写所有项目的 sortOrder。
 * 未出现在 pluginNames 中的项目自动按当前顺序追加到末尾。
 * @param registry - 当前注册表文档
 * @param pluginNames - 期望的排序顺序（项目名称数组）
 * @returns 更新排序后的新注册表文档
 * @throws {Error} 当 pluginNames 包含不存在的项目名时抛出
 */
export function reorderProjects(
  registry: DevProjectRegistry,
  pluginNames: string[]
): DevProjectRegistry {
  const currentNames = getOrderedProjectNames(registry.projects)
  const currentNameSet = new Set(currentNames)

  for (const name of pluginNames) {
    if (!currentNameSet.has(name)) throw new Error(`Unknown dev project: ${name}`)
  }

  const merged = [...pluginNames, ...currentNames.filter((n) => !pluginNames.includes(n))]
  const nextProjects: Record<string, DevProjectRecord> = {}
  for (const [index, name] of merged.entries()) {
    const current = registry.projects[name]
    if (current) nextProjects[name] = { ...current, sortOrder: index }
  }

  return { version: registry.version, projects: nextProjects }
}

/**
 * 将指定项目提升到排序顶部，其余项目相对顺序不变。
 * 项目不存在时直接返回原注册表。
 * @param registry - 当前注册表文档
 * @param projectName - 需要置顶的项目名称
 * @returns 更新排序后的新注册表文档
 */
export function insertDevProjectAtTop(
  registry: DevProjectRegistry,
  projectName: string
): DevProjectRegistry {
  if (!registry.projects[projectName]) return registry

  const orderedNames = getOrderedProjectNames(registry.projects).filter((n) => n !== projectName)
  const nextProjects = { ...registry.projects }
  const nextOrder = [projectName, ...orderedNames]
  for (const [index, name] of nextOrder.entries()) {
    const current = nextProjects[name]
    if (current) nextProjects[name] = { ...current, sortOrder: index }
  }

  return { version: registry.version, projects: nextProjects }
}

// ============================================================
// Queries & Builders
// ============================================================

/**
 * 判断开发项目是否可以打包为 ZPX 文件。
 * 仅在状态为 'ready' 时允许打包。
 * @param entry - 注册表条目
 */
export function canPackageDevProject(entry?: DevProjectRecord): boolean {
  return entry?.status === 'ready'
}

/**
 * 验证用户选择的 plugin.json 是否与注册表条目匹配。
 * 用于「重选配置文件」场景，确保选到的配置和项目是同一个。
 * @param registryItem - 注册表中的项目记录
 * @param pluginConfig - 从用户选择的文件中解析出的配置
 * @returns 名称是否一致
 */
export function validateRepairConfigSelection(
  registryItem: DevProjectRecord,
  pluginConfig: PluginManifestSnapshot
): boolean {
  return !!pluginConfig.name && pluginConfig.name === registryItem.name
}

/**
 * 为开发模式项目构建「已安装插件」快照对象。
 * 内置插件（setting、system）保留原名；用户开发插件名称自动添加 __dev 后缀。
 * @param pluginPath - 插件项目的目录路径
 * @param pluginConfig - 从 plugin.json 解析的配置
 * @returns 可直接写入已安装插件列表的快照对象
 */
export function buildInstalledDevelopmentPlugin(
  pluginPath: string,
  pluginConfig: PluginManifestSnapshot
): PluginInstallRecord {
  const normalizedPath = resolvePath(pluginPath)
  const baseName = pluginConfig.name || path.basename(normalizedPath)
  // 内置插件（setting、system）在开发模式下仅设 isDevelopment: true 而不加 __dev 后缀
  const effectiveName = BUILT_IN_NAMES.has(baseName) ? baseName : toDevPluginName(baseName)
  return {
    name: effectiveName,
    title: pluginConfig.title,
    version: pluginConfig.version,
    description: pluginConfig.description || '',
    author: pluginConfig.author || '',
    homepage: pluginConfig.homepage || '',
    logo: pluginConfig.logo || '',
    main: pluginConfig.development?.main,
    preload: pluginConfig.preload,
    features: Array.isArray(pluginConfig.features) ? pluginConfig.features : [],
    path: normalizedPath,
    isDevelopment: true,
    installedAt: nowIso()
  }
}

// ============================================================
// Metadata Updates
// ============================================================

/**
 * 更新开发项目的元数据，直接写入 configSnapshot 对应字段。
 */
export function updateProjectMeta(options: UpdateProjectMetaParams): DevProjectMutationResult {
  const clock = options.now ?? nowIso
  const { projectName, meta } = options

  const existing = options.registry.projects[projectName]
  if (!existing) {
    return {
      success: false,
      reason: `开发项目 "${projectName}" 不存在`,
      registry: options.registry
    }
  }

  const ts = clock()
  const updatedEntry: DevProjectRecord = {
    ...existing,
    configSnapshot: {
      ...existing.configSnapshot,
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.description !== undefined ? { description: meta.description } : {}),
      ...(meta.author !== undefined ? { author: meta.author } : {}),
      ...(Array.isArray(meta.platform) && meta.platform.length > 0
        ? { platform: meta.platform }
        : {})
    },
    updatedAt: ts
  }

  return {
    success: true,
    registry: {
      version: options.registry.version,
      projects: {
        ...options.registry.projects,
        [projectName]: updatedEntry
      }
    }
  }
}
