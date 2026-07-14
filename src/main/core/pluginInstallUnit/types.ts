/**
 * 插件安装单元领域类型。
 *
 * 这些类型定义正式插件的物理存储、事务阶段和数据库适配边界，
 * 使安装器与 ASAR 文件布局互不依赖。
 */

/** 正式插件支持的物理存储形态。 */
export type PluginStorageKind = 'directory' | 'asar'

/** 当前安装单元事务日志结构版本。 */
export const PLUGIN_TRANSACTION_VERSION = 1

/** 单个物理文件的稳定完整性信息。 */
export interface PluginFileIntegrity {
  /** 文件字节数。 */
  size: number
  /** 文件内容的 SHA-256。 */
  sha256: string
}

/** unpack 文件相对于配套目录的完整性信息。 */
export interface PluginUnpackedFileIntegrity extends PluginFileIntegrity {
  /** 使用正斜杠表示的归档相对路径。 */
  relativePath: string
}

/** 可用于区分不同安装代次的完整 ASAR 安装单元清单。 */
export interface PluginUnitIntegrity {
  /** ASAR 实体文件的完整性。 */
  asar: PluginFileIntegrity
  /** 按相对路径排序的 unpack 文件完整性。 */
  unpacked: PluginUnpackedFileIntegrity[]
}

/** 插件数据库记录在安装单元边界所需的最小结构。 */
export interface InstalledPluginRecord {
  /** 插件稳定名称。 */
  name: string
  /** Electron 可访问的插件虚拟根路径。 */
  path: string
  /** 插件实体存储形态；缺失仅表示历史目录插件。 */
  storageKind?: PluginStorageKind
  /** 是否为开发插件。 */
  isDevelopment?: boolean
  /** 保留现有数据库记录中的业务字段。 */
  [key: string]: unknown
}

/** 安装单元服务访问插件状态的持久化适配器。 */
export interface PluginInstallRegistry {
  /** 读取当前插件记录快照。 */
  readPlugins(): InstalledPluginRecord[]
  /** 原子写入完整插件记录快照。 */
  writePlugins(plugins: InstalledPluginRecord[]): void
  /** 读取当前禁用插件路径。 */
  readDisabledPluginPaths(): string[]
  /** 写入完整禁用插件路径快照。 */
  writeDisabledPluginPaths(paths: string[]): void
  /** 捕获正式插件卸载前需要跨进程恢复的应用状态。 */
  capturePluginRemovalState(): PluginRemovalStateSnapshot
  /** 幂等清理已卸载插件的引用、Provider 与设置状态。 */
  commitPluginRemovalState(pluginName: string): void
  /** 从事务日志恢复正式插件卸载前的应用状态。 */
  restorePluginRemovalState(snapshot: PluginRemovalStateSnapshot): void
}

/** 正式插件卸载前持久化到事务日志的应用状态快照。 */
export interface PluginRemovalStateSnapshot {
  /** 数据库键到卸载前原始值的映射。 */
  values: Record<string, unknown>
}

/** 安装事务持久化阶段。 */
export type PluginTransactionPhase =
  | 'prepared'
  | 'swapping'
  | 'files-committed'
  | 'record-committed'

/** 安装单元事务日志。 */
export interface PluginTransactionJournal {
  /** 日志结构版本。 */
  version: typeof PLUGIN_TRANSACTION_VERSION
  /** 唯一事务标识。 */
  transactionId: string
  /** 事务操作类型。 */
  operation: 'install' | 'remove'
  /** 最后完成持久化的阶段。 */
  phase: PluginTransactionPhase
  /** 事务所属插件名。 */
  pluginName: string
  /** 提交前的插件记录。 */
  previousPlugin: InstalledPluginRecord | null
  /** 提交后的插件记录。 */
  nextPlugin: InstalledPluginRecord | null
  /** 提交前是否禁用该插件。 */
  previousDisabled: boolean
  /** 提交前 ASAR 代次；目录或首次安装时为空。 */
  previousIntegrity: PluginUnitIntegrity | null
  /** 提交后 ASAR 代次；卸载事务时为空。 */
  nextIntegrity: PluginUnitIntegrity | null
  /** 卸载前应用状态；安装事务必须为空。 */
  previousApplicationState: PluginRemovalStateSnapshot | null
}

/** 已准备但尚未提交的 ASAR 安装单元。 */
export interface PreparedPluginUnit {
  /** 唯一事务标识。 */
  transactionId: string
  /** 插件稳定名称。 */
  pluginName: string
  /** 事务工作目录。 */
  transactionDir: string
  /** 暂存 ASAR 实体路径。 */
  stagedAsarPath: string
  /** 存在真实路径资源时的暂存 unpack 目录。 */
  stagedUnpackedPath?: string
  /** 提交后的规范 ASAR 路径。 */
  canonicalAsarPath: string
  /** 暂存归档中解析出的权威插件配置。 */
  pluginConfig: Record<string, unknown>
  /** 暂存 ASAR 安装单元的完整代次清单。 */
  integrity: PluginUnitIntegrity
}

/** 已准备但尚未提交的目录安装单元。 */
export interface PreparedDirectoryPluginUnit {
  /** 唯一事务标识。 */
  transactionId: string
  /** 插件稳定名称。 */
  pluginName: string
  /** 事务工作目录。 */
  transactionDir: string
  /** 事务目录内等待切换的完整插件目录。 */
  stagedDirectoryPath: string
  /** 提交后的规范插件目录。 */
  canonicalDirectoryPath: string
  /** 暂存目录中复核后的权威插件配置。 */
  pluginConfig: Record<string, unknown>
}

/** 安装单元服务构造选项。 */
export interface PluginInstallUnitServiceOptions {
  /** 正式插件物理根目录。 */
  pluginsDir: string
  /** 插件状态持久化适配器。 */
  registry: PluginInstallRegistry
}

/** ZPX 准备请求。 */
export interface PrepareZpxOptions {
  /** 待安装 ZPX 文件路径。 */
  zpxPath: string
  /** 已解析且将在准备阶段复核的插件配置。 */
  pluginConfig: Record<string, unknown>
}

/** 目录安装单元准备请求。 */
export interface PrepareDirectoryOptions {
  /** 已由来源边界校验并解压的完整插件目录。 */
  sourceDir: string
  /** 来源边界解析出的配置，准备阶段会再次逐字段复核。 */
  pluginConfig: Record<string, unknown>
}

/** 已准备安装单元的提交请求。 */
export interface CommitPreparedPluginOptions {
  /** 准备阶段产生且尚未提交的安装单元。 */
  prepared: PreparedPluginUnit
  /** 当前已安装记录；首次安装时为空。 */
  previousPlugin: InstalledPluginRecord | null
  /** 提交后写入数据库的 ASAR 插件记录。 */
  nextPlugin: InstalledPluginRecord
  /** 在实体切换前停止旧插件运行实例。 */
  stopPrevious(): Promise<void> | void
}

/** 已准备目录安装单元的提交请求。 */
export interface CommitPreparedDirectoryOptions {
  /** 准备阶段产生且尚未提交的目录安装单元。 */
  prepared: PreparedDirectoryPluginUnit
  /** 当前已安装记录；首次安装时为空。 */
  previousPlugin: InstalledPluginRecord | null
  /** 提交后写入数据库的目录插件记录。 */
  nextPlugin: InstalledPluginRecord
  /** 在实体切换前停止旧插件运行实例。 */
  stopPrevious(): Promise<void> | void
}

/** 安装事务可提交的两种规范存储形态。 */
export type CommitPreparedInstallOptions =
  | CommitPreparedPluginOptions
  | CommitPreparedDirectoryOptions

/** 安装单元变更的用户可见结果。 */
export interface PluginUnitMutationResult {
  /** 只有实体与数据库状态均提交后才为 true。 */
  committed: true
  /** 提交完成但非关键清理需要启动恢复继续处理时返回。 */
  warning?: string
}

/** 单个启动恢复失败明细。 */
export interface PluginRecoveryFailure {
  /** 事务目录名称。 */
  transactionId: string
  /** 日志可安全解析时返回插件名。 */
  pluginName?: string
  /** 保留原始异常信息的失败原因。 */
  error: string
}

/** 启动恢复汇总。 */
export interface PluginRecoverySummary {
  /** 已解决并清理的事务标识。 */
  recovered: string[]
  /** 未能确定唯一代次且已保留现场的事务。 */
  failed: PluginRecoveryFailure[]
}

/** 正式插件卸载请求。 */
export interface RemovePluginOptions {
  /** 当前数据库中的完整插件记录。 */
  plugin: InstalledPluginRecord
  /** 在实体切换前停止当前插件运行实例。 */
  stopPrevious(): Promise<void> | void
  /** 在实体和核心注册表切换后提交插件引用、Provider 与设置状态。 */
  commitApplicationState(): Promise<void> | void
  /** 卸载事务失败时恢复调用方在提交前捕获的应用状态。 */
  rollbackApplicationState(): Promise<void> | void
}

/** 插件可读目录导出请求。 */
export interface ExportPluginOptions {
  /** 待导出的正式插件记录。 */
  plugin: InstalledPluginRecord
  /** 调用方为该插件分配的目标目录。 */
  destinationDir: string
}
