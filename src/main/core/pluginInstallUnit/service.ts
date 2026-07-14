/**
 * 正式插件安装单元服务。
 *
 * 该深模块统一管理 ZPX 到 ASAR 的准备、事务提交、恢复、卸载和导出；
 * 调用方只处理插件来源与用户可见结果，不接触实体配对规则。
 */

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { physicalFs } from '../../utils/physicalFs.js'
import { extractAsar } from '../../utils/zpxArchive.js'
import {
  readTransactionJournal,
  TRANSACTION_JOURNAL_FILE,
  writeTransactionJournal
} from './journal'
import { inspectPluginStorage } from './inspection'
import { cleanupTransactionDirectory } from './cleanup'
import { listPendingPluginTransactions } from './pending'
import { preparePluginUnit } from './preparation'
import {
  prepareDirectoryUnit,
  validateInstalledDirectory,
  validatePreparedDirectory
} from './directoryPreparation'
import { restoreAsarBackup } from './recoveryFiles'
import { captureAsarUnitIntegrity, validateAsarUnit, validateAsarUnitIntegrity } from './integrity'
import { PluginInstallMutationFiles } from './mutationFiles'
import { PLUGIN_TRANSACTION_VERSION } from './types'
import {
  assertSafePluginName,
  assertPreparedDirectoryCommitOptions,
  assertPreparedCommitOptions,
  getTransactionDir,
  PLUGIN_TRANSACTIONS_DIR,
  resolveStorageKind,
  STAGED_ASAR_FILE,
  STAGED_DIRECTORY_NAME
} from './paths'
import type {
  CommitPreparedDirectoryOptions,
  CommitPreparedInstallOptions,
  CommitPreparedPluginOptions,
  ExportPluginOptions,
  InstalledPluginRecord,
  PluginInstallRegistry,
  PluginInstallUnitServiceOptions,
  PluginRecoverySummary,
  PluginTransactionJournal,
  PluginUnitMutationResult,
  PreparedDirectoryPluginUnit,
  PreparedPluginUnit,
  PrepareDirectoryOptions,
  PrepareZpxOptions,
  RemovePluginOptions
} from './types'

const fs = physicalFs.promises
const EXTRACTED_DIR = 'extracted'
const COMMITTED_CLEANUP_WARNING = '插件已安装，但旧版本清理未完成，将在下次启动继续清理'
const REMOVAL_CLEANUP_WARNING = '插件已卸载，但实体清理未完成，将在下次启动继续清理'
const UUID_TRANSACTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** 提交失败时恢复旧代次所需的进程内快照。 */
interface CommitRollbackContext {
  /** 提交前的完整插件记录。 */
  plugins: InstalledPluginRecord[]
  /** 提交前的完整禁用路径。 */
  disabledPluginPaths: string[]
  /** 旧 ASAR 的稳定代次清单；目录或首次安装时为空。 */
  previousIntegrity: import('./types').PluginUnitIntegrity | null
}

/** 卸载失败后恢复目标实体与注册表状态所需的上下文。 */
interface RemovalRollbackContext {
  /** 正在卸载的插件记录。 */
  plugin: InstalledPluginRecord
  /** 保存卸载日志和实体备份的事务目录。 */
  transactionDir: string
  /** 卸载前 ASAR 代次；目录插件为空。 */
  previousIntegrity: import('./types').PluginUnitIntegrity | null
  /** 记录实际完成阶段和目标禁用状态的事务日志。 */
  journal: PluginTransactionJournal
  /** 应用状态提交是否已经开始，开始后任何失败都必须调用恢复。 */
  applicationStateStarted: boolean
  /** 恢复插件引用、Provider 与设置状态的调用方事务。 */
  rollbackApplicationState: RemovePluginOptions['rollbackApplicationState']
}

/** 安装提交失败后执行回滚所需的状态。 */
interface CommitRollbackFailureContext {
  /** 提交前捕获的旧状态。 */
  rollbackContext: CommitRollbackContext
  /** 已持久化到当前阶段的事务日志。 */
  journal: PluginTransactionJournal
  /** 触发回滚的原始提交错误。 */
  commitError: unknown
}

/** swapping 恢复旧代次时的受控实体路径。 */
interface SwappingRecoveryContext {
  /** 日志中的旧插件记录。 */
  previousPlugin: InstalledPluginRecord
  /** 日志中的新插件记录。 */
  nextPlugin: InstalledPluginRecord
  /** 事务内旧实体备份路径。 */
  backupPath: string
  /** 旧 ASAR 的稳定代次；目录插件为空。 */
  previousIntegrity: import('./types').PluginUnitIntegrity | null
}

/** 正式插件安装单元服务。 */
export class PluginInstallUnitService {
  /** 正式插件物理根目录。 */
  private readonly pluginsDir: string

  /** 插件状态持久化适配器。 */
  private readonly registry: PluginInstallRegistry

  /** 防止同一进程并发切换同名插件的锁集合。 */
  private readonly activePluginMutations = new Set<string>()

  /** 串行化会读写完整插件注册表快照的提交，防止不同插件相互覆盖状态。 */
  private mutationQueue: Promise<void> = Promise.resolve()

  /** 在事务日志保护下执行规范实体移动和恢复。 */
  private readonly mutationFiles: PluginInstallMutationFiles

  /**
   * 创建服务实例。
   * @param options 插件根目录与持久化适配器
   */
  constructor(options: PluginInstallUnitServiceOptions) {
    this.pluginsDir = options.pluginsDir
    this.registry = options.registry
    this.mutationFiles = new PluginInstallMutationFiles(options.pluginsDir)
  }

  /**
   * 将 ZPX 准备为尚未提交的完整 ASAR 安装单元。
   * 准备阶段不读取或修改当前插件记录，旧版本可继续运行。
   * @param options ZPX 路径与已解析配置
   */
  public async prepareZpx(options: PrepareZpxOptions): Promise<PreparedPluginUnit> {
    return await preparePluginUnit({ ...options, pluginsDir: this.pluginsDir })
  }

  /**
   * 将已校验来源目录复制到持久事务中准备提交。
   * @param options 来源目录与已解析配置
   */
  public async prepareDirectory(
    options: PrepareDirectoryOptions
  ): Promise<PreparedDirectoryPluginUnit> {
    return await prepareDirectoryUnit({ ...options, pluginsDir: this.pluginsDir })
  }

  /**
   * 提交已准备的 ASAR 安装单元。
   * 实体切换和数据库写入共享事务日志；任一提交步骤失败都会恢复旧代次。
   * @param options 准备结果、前后记录与停止旧实例回调
   */
  public async commitPrepared(
    options: CommitPreparedPluginOptions
  ): Promise<PluginUnitMutationResult> {
    await this.acquirePreparedMutation(options.prepared)
    try {
      return await this.runMutationExclusive(() => this.commitPreparedLocked(options))
    } finally {
      this.activePluginMutations.delete(options.prepared.pluginName)
    }
  }

  /**
   * 提交已准备的目录安装单元，并与 ASAR 提交共享锁和恢复日志。
   * @param options 准备结果、前后记录与停止旧实例回调
   */
  public async commitPreparedDirectory(
    options: CommitPreparedDirectoryOptions
  ): Promise<PluginUnitMutationResult> {
    await this.acquirePreparedMutation(options.prepared)
    try {
      return await this.runMutationExclusive(() => this.commitPreparedLocked(options))
    } finally {
      this.activePluginMutations.delete(options.prepared.pluginName)
    }
  }

  /**
   * 把正式插件实体和应用状态作为一个事务卸载。
   * @param options 当前插件记录
   */
  public async removePlugin(options: RemovePluginOptions): Promise<PluginUnitMutationResult> {
    const { plugin } = options
    assertSafePluginName(plugin.name)
    this.acquirePluginMutation(plugin.name)
    try {
      return await this.runMutationExclusive(() => this.removePluginLocked(options))
    } finally {
      this.activePluginMutations.delete(plugin.name)
    }
  }

  /**
   * 把正式插件导出为可读目录。
   * 目录插件直接复制，ASAR 插件完整提取配套 unpack 内容。
   * @param options 插件记录与目标目录
   */
  public async exportPlugin(options: ExportPluginOptions): Promise<void> {
    this.assertPluginUsesExpectedPath(options.plugin)
    if (resolveStorageKind(options.plugin) === 'directory') {
      await fs.cp(options.plugin.path, options.destinationDir, { recursive: true })
      return
    }
    await validateAsarUnit(options.plugin.path, options.plugin.name)
    await extractAsar(options.plugin.path, options.destinationDir)
  }

  /** 在持有同名锁时执行完整卸载事务。 */
  private async removePluginLocked(
    options: RemovePluginOptions
  ): Promise<PluginUnitMutationResult> {
    const { plugin } = options
    await this.resolveOlderPluginTransactions(plugin.name)
    this.assertPluginUsesExpectedPath(plugin)
    const initialPlugins = this.registry.readPlugins()
    this.assertCurrentPlugin(plugin.name, plugin, initialPlugins)
    const previousIntegrity =
      resolveStorageKind(plugin) === 'asar'
        ? await captureAsarUnitIntegrity(plugin.path, plugin.name)
        : null
    const transactionId = randomUUID()
    const transactionDir = getTransactionDir(this.pluginsDir, transactionId)
    const previousApplicationState = this.registry.capturePluginRemovalState()
    const journal: PluginTransactionJournal = {
      version: PLUGIN_TRANSACTION_VERSION,
      transactionId,
      operation: 'remove',
      phase: 'prepared',
      pluginName: plugin.name,
      previousPlugin: plugin,
      nextPlugin: null,
      previousDisabled: this.registry.readDisabledPluginPaths().includes(plugin.path),
      previousIntegrity,
      nextIntegrity: null,
      previousApplicationState
    }
    let applicationStateStarted = false

    try {
      await writeTransactionJournal(transactionDir, journal)
      await options.stopPrevious()
      this.assertCurrentPlugin(plugin.name, plugin, this.registry.readPlugins())
      await this.writeJournalPhase(transactionDir, journal, 'swapping')
      await this.mutationFiles.movePreviousToBackup(plugin, transactionDir)
      journal.previousDisabled = this.registry.readDisabledPluginPaths().includes(plugin.path)
      await this.writeJournalPhase(transactionDir, journal, 'files-committed')
      const currentPlugins = this.registry.readPlugins()
      this.assertCurrentPlugin(plugin.name, plugin, currentPlugins)
      this.registry.writePlugins(currentPlugins.filter((item) => item.name !== plugin.name))
      const currentDisabledPluginPaths = this.registry.readDisabledPluginPaths()
      this.registry.writeDisabledPluginPaths(
        currentDisabledPluginPaths.filter((pluginPath) => pluginPath !== plugin.path)
      )
      applicationStateStarted = true
      await options.commitApplicationState()
      await this.writeJournalPhase(transactionDir, journal, 'record-committed')
    } catch (error) {
      await this.rollbackRemovalOrThrow(
        {
          plugin,
          transactionDir,
          previousIntegrity,
          journal,
          applicationStateStarted,
          rollbackApplicationState: options.rollbackApplicationState
        },
        error
      )
      throw error
    }

    return await this.finishRemovalTransaction(transactionDir)
  }

  /** 卸载失败时只恢复目标插件，保留并发产生的其他注册表变更。 */
  private async rollbackRemovalOrThrow(
    options: RemovalRollbackContext,
    removalError: unknown
  ): Promise<void> {
    const rollbackErrors: string[] = []
    try {
      await this.restoreRemovedPlugin(
        options.plugin,
        options.transactionDir,
        options.previousIntegrity
      )
      if (options.journal.phase !== 'prepared') {
        this.writeRollbackRegistryState(options.journal)
      }
    } catch (rollbackError) {
      rollbackErrors.push(`安装单元回滚失败：${this.errorMessage(rollbackError)}`)
    }
    if (options.applicationStateStarted) {
      try {
        await options.rollbackApplicationState()
      } catch (rollbackError) {
        rollbackErrors.push(`应用状态回滚失败：${this.errorMessage(rollbackError)}`)
      }
    }
    if (rollbackErrors.length === 0) {
      try {
        await cleanupTransactionDirectory(options.transactionDir)
      } catch (rollbackError) {
        rollbackErrors.push(`事务清理失败：${this.errorMessage(rollbackError)}`)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `插件卸载失败：${this.errorMessage(removalError)}；${rollbackErrors.join('；')}`,
        {
          cause: removalError
        }
      )
    }
  }

  /** 从事务备份恢复刚刚移出的卸载实体。 */
  private async restoreRemovedPlugin(
    plugin: InstalledPluginRecord,
    transactionDir: string,
    previousIntegrity: import('./types').PluginUnitIntegrity | null
  ): Promise<void> {
    const backupPath = this.mutationFiles.getBackupPath(plugin, transactionDir)
    if (resolveStorageKind(plugin) === 'asar') {
      if (!previousIntegrity) throw new Error('卸载事务缺少旧 ASAR 代次清单')
      await restoreAsarBackup({ plugin, backupPath, expectedIntegrity: previousIntegrity })
      return
    }
    const hasBackup = await this.pathExists(backupPath)
    const hasInstalledEntity = await this.pathExists(plugin.path)
    if (!hasBackup && hasInstalledEntity) return
    if (!hasBackup) throw new Error('卸载备份与插件实体均不存在')
    if (hasInstalledEntity) throw new Error('卸载备份与插件实体同时存在')
    await fs.rename(backupPath, plugin.path)
  }

  /** 校验正式插件记录只指向由名称推导的规范实体。 */
  private assertPluginUsesExpectedPath(plugin: InstalledPluginRecord): void {
    const expectedPath = this.mutationFiles.getExpectedPluginPath(plugin)
    if (path.resolve(plugin.path) !== path.resolve(expectedPath)) {
      throw new Error('插件记录没有指向规范安装路径')
    }
  }

  /** 清理已提交卸载事务，并把非关键清理失败映射为警告。 */
  private async finishRemovalTransaction(
    transactionDir: string
  ): Promise<PluginUnitMutationResult> {
    try {
      await cleanupTransactionDirectory(transactionDir)
      return { committed: true }
    } catch {
      return { committed: true, warning: REMOVAL_CLEANUP_WARNING }
    }
  }

  /**
   * 恢复所有未完成的安装单元事务。
   * 单个事务无法确定唯一代次时保留现场并继续检查其他事务。
   */
  public async recoverPendingTransactions(): Promise<PluginRecoverySummary> {
    const summary: PluginRecoverySummary = { recovered: [], failed: [] }
    const transactionsDir = path.join(this.pluginsDir, PLUGIN_TRANSACTIONS_DIR)
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await fs.readdir(transactionsDir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        entries = []
      } else {
        throw error
      }
    }

    for (const entry of entries) {
      await this.recoverTransactionEntry(transactionsDir, entry, summary)
    }
    const storageFailures = await inspectPluginStorage({
      pluginsDir: this.pluginsDir,
      plugins: this.registry.readPlugins(),
      ignoredPluginNames: new Set(
        summary.failed
          .map((failure) => failure.pluginName)
          .filter((pluginName): pluginName is string => Boolean(pluginName))
      )
    })
    summary.failed.push(
      ...storageFailures.map((failure) => ({
        transactionId: `storage:${failure.pluginName ?? 'unknown'}`,
        ...failure
      }))
    )
    return summary
  }

  /** 恢复单个事务目录，并把结果写入汇总。 */
  private async recoverTransactionEntry(
    transactionsDir: string,
    entry: import('node:fs').Dirent,
    summary: PluginRecoverySummary
  ): Promise<void> {
    const transactionId = entry.name
    let pluginName: string | undefined
    try {
      if (!entry.isDirectory()) throw new Error('事务根目录包含非目录项')
      const transactionDir = path.join(transactionsDir, transactionId)
      if (await this.cleanUnjournaledPreparation(transactionId, transactionDir)) {
        summary.recovered.push(transactionId)
        return
      }
      const journal = await readTransactionJournal(transactionDir)
      pluginName = journal.pluginName
      this.validateRecoveryJournal(transactionId, journal)
      await this.recoverTransaction(transactionDir, journal)
      summary.recovered.push(transactionId)
    } catch (error) {
      summary.failed.push({
        transactionId,
        pluginName,
        error: this.errorMessage(error)
      })
    }
  }

  /**
   * 清理首次日志原子发布前中断的准备目录。
   * 只有 UUID 目录且内容完全属于准备阶段时才能确定性删除，出现备份或未知文件仍报错。
   */
  private async cleanUnjournaledPreparation(
    transactionId: string,
    transactionDir: string
  ): Promise<boolean> {
    if (await this.pathExists(path.join(transactionDir, TRANSACTION_JOURNAL_FILE))) return false
    if (!UUID_TRANSACTION_ID_PATTERN.test(transactionId)) return false

    const entries = await fs.readdir(transactionDir, { withFileTypes: true })
    const containsOnlyPreparationArtifacts = entries.every((entry) =>
      this.isPreparationArtifact(entry.name)
    )
    if (!containsOnlyPreparationArtifacts) return false
    await fs.rm(transactionDir, { recursive: true, force: true })
    return true
  }

  /** 判断无日志事务目录中的条目是否只能由准备阶段产生。 */
  private isPreparationArtifact(entryName: string): boolean {
    if (entryName === STAGED_ASAR_FILE) return true
    if (entryName === `${STAGED_ASAR_FILE}.unpacked`) return true
    if (entryName === EXTRACTED_DIR) return true
    if (entryName === STAGED_DIRECTORY_NAME) return true
    return entryName.startsWith(`${TRANSACTION_JOURNAL_FILE}.`) && entryName.endsWith('.tmp')
  }

  /** 校验日志身份和记录路径全部可由插件根目录重新推导。 */
  private validateRecoveryJournal(transactionId: string, journal: PluginTransactionJournal): void {
    if (journal.transactionId !== transactionId) throw new Error('事务日志标识与目录不一致')
    assertSafePluginName(journal.pluginName)
    if (journal.previousPlugin) {
      this.assertJournalRecordPath(journal.previousPlugin, journal.pluginName)
    }
    if (journal.operation === 'remove') {
      if (!journal.previousPlugin || journal.nextPlugin) {
        throw new Error('卸载事务日志的前后记录无效')
      }
      return
    }
    if (journal.nextPlugin) this.assertJournalRecordPath(journal.nextPlugin, journal.pluginName)
    if (journal.phase !== 'prepared' && !journal.nextPlugin) {
      throw new Error('安装事务日志缺少提交后的插件记录')
    }
  }

  /** 校验日志记录只能指向插件的规范目录或规范 ASAR。 */
  private assertJournalRecordPath(plugin: InstalledPluginRecord, pluginName: string): void {
    if (plugin.name !== pluginName) throw new Error('事务日志中的插件身份不一致')
    const expectedPath = this.mutationFiles.getExpectedPluginPath(plugin)
    if (path.resolve(plugin.path) !== path.resolve(expectedPath)) {
      throw new Error('事务日志中的插件记录没有指向规范安装路径')
    }
  }

  /** 在同名插件锁内按持久化阶段恢复一个安装事务。 */
  private async recoverTransaction(
    transactionDir: string,
    journal: PluginTransactionJournal
  ): Promise<void> {
    this.acquirePluginMutation(journal.pluginName)
    try {
      await this.recoverTransactionState(transactionDir, journal)
    } finally {
      this.activePluginMutations.delete(journal.pluginName)
    }
  }

  /** 在调用方已经持有同名锁时恢复一个事务。 */
  private async recoverTransactionState(
    transactionDir: string,
    journal: PluginTransactionJournal
  ): Promise<void> {
    if (journal.phase === 'prepared') {
      await cleanupTransactionDirectory(transactionDir)
      return
    }
    if (journal.operation === 'remove') {
      await this.recoverRemoval(transactionDir, journal)
      return
    }
    if (journal.phase === 'swapping') {
      await this.recoverSwappingInstall(transactionDir, journal)
      return
    }
    await this.recoverCommittedInstall(transactionDir, journal)
  }

  /** 根据持久化记录判断卸载事务应恢复旧插件还是完成删除。 */
  private async recoverRemoval(
    transactionDir: string,
    journal: PluginTransactionJournal
  ): Promise<void> {
    const previousPlugin = journal.previousPlugin
    if (!previousPlugin) throw new Error('卸载事务日志缺少旧插件记录')
    const currentPlugin = this.registry
      .readPlugins()
      .find((plugin) => plugin.name === journal.pluginName)
    if (currentPlugin && !isDeepStrictEqual(currentPlugin, previousPlugin)) {
      throw new Error('卸载恢复时发现同名插件记录已被其他状态替换')
    }

    const shouldRestore =
      journal.phase === 'swapping' ||
      (journal.phase === 'files-committed' && Boolean(currentPlugin))
    if (shouldRestore) {
      await this.restoreRemovedPlugin(previousPlugin, transactionDir, journal.previousIntegrity)
      if (resolveStorageKind(previousPlugin) === 'asar') {
        if (!journal.previousIntegrity) throw new Error('卸载事务缺少旧 ASAR 代次清单')
        await validateAsarUnitIntegrity({
          asarPath: previousPlugin.path,
          pluginName: previousPlugin.name,
          expected: journal.previousIntegrity
        })
      }
      this.writeRecoveredRegistryState(journal, previousPlugin)
      this.registry.restorePluginRemovalState(
        this.requirePreviousApplicationState(journal.previousApplicationState)
      )
      await cleanupTransactionDirectory(transactionDir)
      return
    }

    if (await this.pathExists(previousPlugin.path)) {
      throw new Error('卸载记录已提交，但规范插件实体仍存在')
    }
    this.writeRecoveredRegistryState(journal, null)
    this.registry.commitPluginRemovalState(journal.pluginName)
    await cleanupTransactionDirectory(transactionDir)
  }

  /** 把 swapping 阶段恢复为日志记录的旧代次。 */
  private async recoverSwappingInstall(
    transactionDir: string,
    journal: PluginTransactionJournal
  ): Promise<void> {
    const nextPlugin = journal.nextPlugin
    if (!nextPlugin) throw new Error('安装事务日志缺少提交后的插件记录')
    const previousPlugin = journal.previousPlugin
    if (!previousPlugin) {
      await this.mutationFiles.cleanFirstInstallEntity(transactionDir, journal)
      this.writeRecoveredRegistryState(journal, null)
      await cleanupTransactionDirectory(transactionDir)
      return
    }

    await this.recoverSwappingPrevious({
      previousPlugin,
      nextPlugin,
      backupPath: this.mutationFiles.getBackupPath(previousPlugin, transactionDir),
      previousIntegrity: journal.previousIntegrity
    })
    this.writeRecoveredRegistryState(journal, previousPlugin)
    await cleanupTransactionDirectory(transactionDir)
  }

  /** 根据备份和规范实体的存在性恢复 swapping 阶段的旧代次。 */
  private async recoverSwappingPrevious(options: SwappingRecoveryContext): Promise<void> {
    const hasBackup = await this.pathExists(options.backupPath)
    const hasPrevious = await this.pathExists(options.previousPlugin.path)
    this.assertSwappingFileState(options, { hasBackup, hasPrevious })
    if (hasBackup) {
      await this.mutationFiles.restoreRecoveryBackup(options)
      return
    }
    await this.mutationFiles.cleanUncommittedCanonical(options)
  }

  /** 拒绝无法唯一判断旧目录代次的 swapping 文件组合。 */
  private assertSwappingFileState(
    options: SwappingRecoveryContext,
    state: { hasBackup: boolean; hasPrevious: boolean }
  ): void {
    if (!state.hasBackup && !state.hasPrevious) {
      throw new Error('旧插件实体与事务备份均不存在，无法确定可恢复代次')
    }
    const replacesSameDirectory =
      resolveStorageKind(options.previousPlugin) === 'directory' &&
      resolveStorageKind(options.nextPlugin) === 'directory' &&
      path.resolve(options.previousPlugin.path) === path.resolve(options.nextPlugin.path)
    const hasAmbiguousDirectory =
      state.hasBackup &&
      state.hasPrevious &&
      resolveStorageKind(options.previousPlugin) === 'directory' &&
      !replacesSameDirectory
    if (hasAmbiguousDirectory) {
      throw new Error('旧插件实体与事务备份同时存在，无法确定可恢复代次')
    }
  }

  /** 校验文件已提交阶段的规范新代次。 */
  private async validateCommittedEntity(
    nextPlugin: InstalledPluginRecord,
    journal: PluginTransactionJournal
  ): Promise<void> {
    if (resolveStorageKind(nextPlugin) === 'directory') {
      await validateInstalledDirectory(nextPlugin.path, journal.pluginName)
      return
    }
    if (!journal.nextIntegrity) throw new Error('安装事务缺少新 ASAR 代次清单')
    await validateAsarUnitIntegrity({
      asarPath: nextPlugin.path,
      pluginName: journal.pluginName,
      expected: journal.nextIntegrity
    })
  }

  /** 校验新代次并完成或重放数据库记录提交。 */
  private async recoverCommittedInstall(
    transactionDir: string,
    journal: PluginTransactionJournal
  ): Promise<void> {
    const nextPlugin = journal.nextPlugin
    if (!nextPlugin) throw new Error('安装事务日志缺少提交后的插件记录')
    await this.validateCommittedEntity(nextPlugin, journal)
    this.writeRecoveredRegistryState(journal, nextPlugin)
    if (journal.phase === 'files-committed') {
      await this.writeJournalPhase(transactionDir, journal, 'record-committed')
    }
    await cleanupTransactionDirectory(transactionDir)
  }

  /** 以当前数据库为基础幂等写入恢复目标记录和禁用状态。 */
  private writeRecoveredRegistryState(
    journal: PluginTransactionJournal,
    targetPlugin: InstalledPluginRecord | null
  ): void {
    const plugins = this.registry
      .readPlugins()
      .filter((plugin) => plugin.name !== journal.pluginName)
    if (targetPlugin) plugins.push(targetPlugin)

    const statePaths = [journal.previousPlugin?.path, journal.nextPlugin?.path].filter(
      (pluginPath): pluginPath is string => Boolean(pluginPath)
    )
    const disabledPluginPaths = this.registry
      .readDisabledPluginPaths()
      .filter((pluginPath) => !statePaths.includes(pluginPath))
    if (targetPlugin && journal.previousDisabled) disabledPluginPaths.push(targetPlugin.path)

    this.registry.writePlugins(plugins)
    this.registry.writeDisabledPluginPaths(disabledPluginPaths)
  }

  /** 在持有同名插件锁时执行完整提交。 */
  private async commitPreparedLocked(
    options: CommitPreparedInstallOptions
  ): Promise<PluginUnitMutationResult> {
    this.assertCommitOptions(options)
    await this.resolveOlderPluginTransactions(
      options.prepared.pluginName,
      options.prepared.transactionId
    )
    const rollbackContext = await this.createRollbackContext(options.previousPlugin)
    try {
      this.assertCurrentPlugin(
        options.prepared.pluginName,
        options.previousPlugin,
        rollbackContext.plugins
      )
    } catch (error) {
      await cleanupTransactionDirectory(options.prepared.transactionDir)
      throw error
    }
    const journal = this.createCommitJournal(options, rollbackContext)

    try {
      await this.validatePreparedEntity(options)
      await options.stopPrevious()
      await this.validatePreparedEntity(options)
      await this.writeJournalPhase(options.prepared.transactionDir, journal, 'swapping')
      await this.mutationFiles.assertCanonicalTargetAvailable(
        options.previousPlugin,
        options.prepared
      )
      await this.mutationFiles.movePreviousToBackup(
        options.previousPlugin,
        options.prepared.transactionDir
      )
      await this.mutationFiles.moveStagedToCanonical(options.prepared)
      await this.validateCommittedEntity(options.nextPlugin, journal)
      await this.writeJournalPhase(options.prepared.transactionDir, journal, 'files-committed')
      await this.refreshJournalDisabledState(options, journal)
      this.writeNextRegistryState(options, journal)
      await this.writeJournalPhase(options.prepared.transactionDir, journal, 'record-committed')
    } catch (error) {
      await this.rollbackCommitOrThrow(options, {
        rollbackContext,
        journal,
        commitError: error
      })
      throw error
    }

    return await this.finishCommittedTransaction(options.prepared.transactionDir)
  }

  /** 拒绝同一服务实例内的同名并发变更。 */
  private acquirePluginMutation(pluginName: string): void {
    if (this.activePluginMutations.has(pluginName)) {
      throw new Error(`插件正在安装：${pluginName}`)
    }
    this.activePluginMutations.add(pluginName)
  }

  /**
   * 获取提交锁；冲突时销毁当前尚未提交的准备结果，避免无人接管的事务残留。
   * @param prepared 当前调用方独占的准备结果
   */
  private async acquirePreparedMutation(
    prepared: PreparedPluginUnit | PreparedDirectoryPluginUnit
  ): Promise<void> {
    try {
      this.acquirePluginMutation(prepared.pluginName)
    } catch (mutationError) {
      try {
        await cleanupTransactionDirectory(prepared.transactionDir)
      } catch (cleanupError) {
        throw new Error(
          `${this.errorMessage(mutationError)}；暂存事务清理失败：${this.errorMessage(cleanupError)}`,
          { cause: mutationError }
        )
      }
      throw mutationError
    }
  }

  /** 完成同名旧事务；任何无法恢复的现场都会阻止新变更。 */
  private async resolveOlderPluginTransactions(
    pluginName: string,
    excludedTransactionId?: string
  ): Promise<void> {
    const pending = await listPendingPluginTransactions({
      pluginsDir: this.pluginsDir,
      pluginName,
      excludedTransactionId
    })
    for (const transaction of pending) {
      this.validateRecoveryJournal(transaction.transactionId, transaction.journal)
      await this.recoverTransactionState(transaction.transactionDir, transaction.journal)
    }
  }

  /**
   * 串行执行依赖完整注册表快照的文件与状态提交。
   * 每个队列节点只负责释放后继，不把当前任务的异常传播到队列本身。
   */
  private async runMutationExclusive<T>(mutation: () => Promise<T>): Promise<T> {
    const previousMutation = this.mutationQueue
    let releaseMutation!: () => void
    this.mutationQueue = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    await previousMutation
    try {
      return await mutation()
    } finally {
      releaseMutation()
    }
  }

  /** 捕获数据库与旧 ASAR 配对状态，供失败回滚使用。 */
  private async createRollbackContext(
    previousPlugin: InstalledPluginRecord | null
  ): Promise<CommitRollbackContext> {
    const previousIntegrity =
      previousPlugin !== null && resolveStorageKind(previousPlugin) === 'asar'
        ? await captureAsarUnitIntegrity(previousPlugin.path, previousPlugin.name)
        : null
    return {
      plugins: this.registry.readPlugins(),
      disabledPluginPaths: this.registry.readDisabledPluginPaths(),
      previousIntegrity
    }
  }

  /** 阻止用过期记录覆盖其他调用方已经写入的新状态。 */
  private assertCurrentPlugin(
    pluginName: string,
    previousPlugin: InstalledPluginRecord | null,
    plugins: InstalledPluginRecord[]
  ): void {
    const currentPlugin = plugins.find((plugin) => plugin.name === pluginName)
    if (previousPlugin === null && !currentPlugin) return
    if (previousPlugin !== null && isDeepStrictEqual(currentPlugin, previousPlugin)) return
    throw new Error('插件记录已发生变化，无法提交准备结果')
  }

  /** 根据准备结果形态执行对应的受控路径校验。 */
  private assertCommitOptions(options: CommitPreparedInstallOptions): void {
    if (this.isDirectoryCommitOptions(options)) {
      assertPreparedDirectoryCommitOptions(this.pluginsDir, options)
      return
    }
    assertPreparedCommitOptions(this.pluginsDir, options)
  }

  /** 在停止旧实例前后复核暂存实体未被替换。 */
  private async validatePreparedEntity(options: CommitPreparedInstallOptions): Promise<void> {
    if (this.isDirectoryCommitOptions(options)) {
      await validatePreparedDirectory({
        directoryPath: options.prepared.stagedDirectoryPath,
        pluginName: options.prepared.pluginName,
        expectedConfig: options.prepared.pluginConfig
      })
      return
    }
    await validateAsarUnitIntegrity({
      asarPath: options.prepared.stagedAsarPath,
      pluginName: options.prepared.pluginName,
      expected: options.prepared.integrity
    })
  }

  /** 通过固定字段区分目录提交请求。 */
  private isDirectoryCommitOptions(
    options: CommitPreparedInstallOptions
  ): options is CommitPreparedDirectoryOptions {
    return this.isDirectoryPrepared(options.prepared)
  }

  /** 通过固定字段区分目录准备结果。 */
  private isDirectoryPrepared(
    prepared: PreparedPluginUnit | PreparedDirectoryPluginUnit
  ): prepared is PreparedDirectoryPluginUnit {
    return 'stagedDirectoryPath' in prepared
  }

  /** 生成带有提交前后快照的安装事务日志。 */
  private createCommitJournal(
    options: CommitPreparedInstallOptions,
    rollbackContext: CommitRollbackContext
  ): PluginTransactionJournal {
    return {
      version: PLUGIN_TRANSACTION_VERSION,
      transactionId: options.prepared.transactionId,
      operation: 'install',
      phase: 'prepared',
      pluginName: options.prepared.pluginName,
      previousPlugin: options.previousPlugin,
      nextPlugin: options.nextPlugin,
      previousDisabled: Boolean(
        options.previousPlugin &&
        rollbackContext.disabledPluginPaths.includes(options.previousPlugin.path)
      ),
      previousIntegrity: rollbackContext.previousIntegrity,
      nextIntegrity: this.isDirectoryPrepared(options.prepared) ? null : options.prepared.integrity,
      previousApplicationState: null
    }
  }

  /** 读取已由日志边界校验的卸载应用状态快照。 */
  private requirePreviousApplicationState(
    snapshot: PluginTransactionJournal['previousApplicationState']
  ): NonNullable<PluginTransactionJournal['previousApplicationState']> {
    if (!snapshot) throw new Error('卸载事务日志缺少应用状态快照')
    return snapshot
  }

  /** 持久化事务阶段，确保恢复流程只观察到已完成步骤。 */
  private async writeJournalPhase(
    transactionDir: string,
    journal: PluginTransactionJournal,
    phase: PluginTransactionJournal['phase']
  ): Promise<void> {
    journal.phase = phase
    await writeTransactionJournal(transactionDir, journal)
  }

  /** 写入新插件记录并迁移旧记录对应的禁用路径。 */
  private writeNextRegistryState(
    options: CommitPreparedInstallOptions,
    journal: PluginTransactionJournal
  ): void {
    const currentPlugins = this.registry.readPlugins()
    this.assertCurrentPlugin(options.prepared.pluginName, options.previousPlugin, currentPlugins)
    const remainingPlugins = currentPlugins.filter(
      (plugin) => plugin.name !== options.prepared.pluginName
    )
    const nextPlugins = [...remainingPlugins, options.nextPlugin]
    const previousPath = options.previousPlugin?.path
    const currentDisabledPaths = this.registry.readDisabledPluginPaths()
    const nextDisabledPaths = currentDisabledPaths.filter(
      (pluginPath) => pluginPath !== previousPath && pluginPath !== options.nextPlugin.path
    )
    if (journal.previousDisabled) nextDisabledPaths.push(options.nextPlugin.path)

    this.registry.writePlugins(nextPlugins)
    this.registry.writeDisabledPluginPaths(nextDisabledPaths)
  }

  /** 在修改注册表前持久化当前目标插件的禁用状态。 */
  private async refreshJournalDisabledState(
    options: CommitPreparedInstallOptions,
    journal: PluginTransactionJournal
  ): Promise<void> {
    const previousPath = options.previousPlugin?.path
    journal.previousDisabled = Boolean(
      previousPath && this.registry.readDisabledPluginPaths().includes(previousPath)
    )
    await writeTransactionJournal(options.prepared.transactionDir, journal)
  }

  /** 提交失败时恢复实体、数据库快照并清理未提交事务。 */
  private async rollbackCommitOrThrow(
    options: CommitPreparedInstallOptions,
    failure: CommitRollbackFailureContext
  ): Promise<void> {
    try {
      await this.mutationFiles.restorePreviousFiles(
        options,
        failure.rollbackContext.previousIntegrity
      )
      if (failure.journal.phase !== 'prepared') {
        this.writeRollbackRegistryState(failure.journal)
      }
      await cleanupTransactionDirectory(options.prepared.transactionDir)
    } catch (rollbackError) {
      throw new Error(
        `插件提交失败：${this.errorMessage(failure.commitError)}；回滚失败：${this.errorMessage(rollbackError)}`,
        { cause: failure.commitError }
      )
    }
  }

  /** 只恢复目标插件记录和禁用路径，保留事务期间产生的其他注册表变更。 */
  private writeRollbackRegistryState(journal: PluginTransactionJournal): void {
    const currentPlugins = this.registry.readPlugins()
    const currentTarget = currentPlugins.find((plugin) => plugin.name === journal.pluginName)
    const targetIsExpected =
      currentTarget === undefined ||
      isDeepStrictEqual(currentTarget, journal.previousPlugin) ||
      isDeepStrictEqual(currentTarget, journal.nextPlugin)
    if (!targetIsExpected) throw new Error('回滚时发现同名插件记录已被其他状态替换')

    const restoredPlugins = currentPlugins.filter((plugin) => plugin.name !== journal.pluginName)
    if (journal.previousPlugin) restoredPlugins.push(journal.previousPlugin)
    const statePaths = [journal.previousPlugin?.path, journal.nextPlugin?.path].filter(
      (pluginPath): pluginPath is string => Boolean(pluginPath)
    )
    const restoredDisabledPaths = this.registry
      .readDisabledPluginPaths()
      .filter((pluginPath) => !statePaths.includes(pluginPath))
    if (journal.previousPlugin && journal.previousDisabled) {
      restoredDisabledPaths.push(journal.previousPlugin.path)
    }
    this.registry.writePlugins(restoredPlugins)
    this.registry.writeDisabledPluginPaths(restoredDisabledPaths)
  }

  /** 清理已提交事务；清理失败不会把成功提交误报为失败。 */
  private async finishCommittedTransaction(
    transactionDir: string
  ): Promise<PluginUnitMutationResult> {
    try {
      await cleanupTransactionDirectory(transactionDir)
      return { committed: true }
    } catch {
      return { committed: true, warning: COMMITTED_CLEANUP_WARNING }
    }
  }

  /** 将未知异常转换为保留原始信息的文本。 */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  /** 判断物理路径是否存在，不吞掉非缺失错误。 */
  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
}
