/**
 * 插件安装事务的实体切换操作。
 *
 * 该模块只处理规范路径、暂存实体与备份实体，不读写插件注册表或事务阶段；
 * 调用方必须在同名锁和持久日志的保护下使用这些操作。
 */

import path from 'node:path'
import { physicalFs } from '../../utils/physicalFs.js'
import { validateInstalledDirectory, validatePreparedDirectory } from './directoryPreparation'
import { cleanFirstInstallCanonical, removeAsarPair, restoreAsarBackup } from './recoveryFiles'
import {
  getCanonicalAsarPath,
  getCanonicalDirectoryPath,
  resolveStorageKind,
  STAGED_ASAR_FILE,
  STAGED_DIRECTORY_NAME
} from './paths'
import type {
  CommitPreparedInstallOptions,
  InstalledPluginRecord,
  PluginTransactionJournal,
  PluginUnitIntegrity,
  PreparedDirectoryPluginUnit,
  PreparedPluginUnit
} from './types'

const fs = physicalFs.promises
const BACKUP_DIR = 'backup'

/** 安装恢复阶段处理旧实体时共享的路径与代次信息。 */
export interface RecoveryFileContext {
  /** 提交前的插件记录。 */
  previousPlugin: InstalledPluginRecord
  /** 事务内旧实体备份路径。 */
  backupPath: string
  /** 日志声明的完整新插件记录。 */
  nextPlugin: InstalledPluginRecord
  /** 旧 ASAR 的稳定代次；目录插件为空。 */
  previousIntegrity: PluginUnitIntegrity | null
}

/** 在安装事务内执行实体移动和确定性恢复。 */
export class PluginInstallMutationFiles {
  /** @param pluginsDir 正式插件物理根目录 */
  public constructor(private readonly pluginsDir: string) {}

  /** 返回记录对应的规范实体路径。 */
  public getExpectedPluginPath(plugin: InstalledPluginRecord): string {
    if (resolveStorageKind(plugin) === 'asar') {
      return getCanonicalAsarPath(this.pluginsDir, plugin.name)
    }
    return getCanonicalDirectoryPath(this.pluginsDir, plugin.name)
  }

  /** 返回旧实体在事务目录内的受控备份路径。 */
  public getBackupPath(plugin: InstalledPluginRecord, transactionDir: string): string {
    const fileName = resolveStorageKind(plugin) === 'asar' ? `${plugin.name}.asar` : plugin.name
    return path.join(transactionDir, BACKUP_DIR, fileName)
  }

  /** 确认所有同名规范位置只包含当前记录声明的旧代次。 */
  public async assertCanonicalTargetAvailable(
    previousPlugin: InstalledPluginRecord | null,
    prepared: PreparedPluginUnit | PreparedDirectoryPluginUnit
  ): Promise<void> {
    if (previousPlugin) this.assertPreviousPath(previousPlugin)
    const asarPath = getCanonicalAsarPath(this.pluginsDir, prepared.pluginName)
    const candidates = [
      getCanonicalDirectoryPath(this.pluginsDir, prepared.pluginName),
      asarPath,
      `${asarPath}.unpacked`
    ]
    const registeredPaths = this.getRegisteredPaths(previousPlugin)
    for (const candidate of candidates) {
      if (registeredPaths.has(path.resolve(candidate))) continue
      if (await this.pathExists(candidate)) {
        const message =
          candidate === getCanonicalDirectoryPath(this.pluginsDir, prepared.pluginName)
            ? '规范目录路径已存在未登记的安装单元'
            : '规范 ASAR 路径已存在未登记的安装单元'
        throw new Error(message)
      }
    }
  }

  /** 把旧目录或完整 ASAR 配对移动到事务备份。 */
  public async movePreviousToBackup(
    previousPlugin: InstalledPluginRecord | null,
    transactionDir: string
  ): Promise<void> {
    if (!previousPlugin) return
    this.assertPreviousPath(previousPlugin)
    if (!(await this.pathExists(previousPlugin.path))) {
      throw new Error('旧插件实体不存在，无法执行覆盖安装')
    }

    const backupPath = this.getBackupPath(previousPlugin, transactionDir)
    await fs.mkdir(path.dirname(backupPath), { recursive: true })
    await fs.rename(previousPlugin.path, backupPath)
    if (resolveStorageKind(previousPlugin) !== 'asar') return
    const previousUnpackedPath = `${previousPlugin.path}.unpacked`
    if (await this.pathExists(previousUnpackedPath)) {
      await fs.rename(previousUnpackedPath, `${backupPath}.unpacked`)
    }
  }

  /** 把暂存目录或 ASAR 配对切换到固定规范路径。 */
  public async moveStagedToCanonical(
    prepared: PreparedPluginUnit | PreparedDirectoryPluginUnit
  ): Promise<void> {
    if (isDirectoryPrepared(prepared)) {
      await fs.rename(prepared.stagedDirectoryPath, prepared.canonicalDirectoryPath)
      return
    }
    const actualUnpackedPath = `${prepared.stagedAsarPath}.unpacked`
    const hasActualUnpacked = await this.pathExists(actualUnpackedPath)
    if (hasActualUnpacked !== Boolean(prepared.stagedUnpackedPath)) {
      throw new Error('暂存 ASAR 与 unpack 配对状态不一致')
    }
    await fs.rename(prepared.stagedAsarPath, prepared.canonicalAsarPath)
    if (hasActualUnpacked) {
      await fs.rename(actualUnpackedPath, `${prepared.canonicalAsarPath}.unpacked`)
    }
  }

  /** 首次安装中断时只清理能够证明属于本事务的新实体。 */
  public async cleanFirstInstallEntity(
    transactionDir: string,
    journal: PluginTransactionJournal
  ): Promise<void> {
    const nextPlugin = requireNextPlugin(journal)
    if (resolveStorageKind(nextPlugin) === 'asar') {
      await this.cleanFirstAsarInstall(transactionDir, journal, nextPlugin)
      return
    }
    const stagedDirectoryPath = path.join(transactionDir, STAGED_DIRECTORY_NAME)
    if (await this.pathExists(stagedDirectoryPath)) return
    if (!(await this.pathExists(nextPlugin.path))) return
    await validateInstalledDirectory(nextPlugin.path, journal.pluginName)
    await fs.rm(nextPlugin.path, { recursive: true })
  }

  /** 从完整备份恢复目录或 ASAR 配对。 */
  public async restoreRecoveryBackup(options: RecoveryFileContext): Promise<void> {
    await this.removeNextEntityBeforeRestore(options.previousPlugin, options.nextPlugin)
    if (resolveStorageKind(options.previousPlugin) === 'asar') {
      if (!options.previousIntegrity) throw new Error('安装事务缺少旧 ASAR 代次清单')
      await restoreAsarBackup({
        plugin: options.previousPlugin,
        backupPath: options.backupPath,
        expectedIntegrity: options.previousIntegrity
      })
      return
    }
    await fs.rename(options.backupPath, options.previousPlugin.path)
  }

  /** 旧实体未移动时清理可能进入另一规范位置的新代次。 */
  public async cleanUncommittedCanonical(options: RecoveryFileContext): Promise<void> {
    if (resolveStorageKind(options.previousPlugin) === 'directory') {
      if (!sameDirectoryRecord(options.previousPlugin, options.nextPlugin)) {
        await this.removePluginEntity(options.nextPlugin)
      }
      return
    }
    if (!options.previousIntegrity) throw new Error('安装事务缺少旧 ASAR 代次清单')
    if (resolveStorageKind(options.nextPlugin) === 'directory') {
      await this.removePluginEntity(options.nextPlugin)
    }
    await restoreAsarBackup({
      plugin: options.previousPlugin,
      backupPath: options.backupPath,
      expectedIntegrity: options.previousIntegrity
    })
  }

  /** 根据备份存在性把旧实体恢复到唯一规范位置。 */
  public async restorePreviousFiles(
    options: CommitPreparedInstallOptions,
    previousIntegrity: PluginUnitIntegrity | null
  ): Promise<void> {
    if (!options.previousPlugin) {
      await this.cleanFirstCommit(options)
      return
    }
    const backupPath = this.getBackupPath(options.previousPlugin, options.prepared.transactionDir)
    const hasBackup = await this.pathExists(backupPath)
    const hasPreviousEntity = await this.pathExists(options.previousPlugin.path)
    if (!hasBackup && !hasPreviousEntity) {
      throw new Error('旧插件实体与事务备份均不存在，无法确定可恢复代次')
    }
    if (!hasBackup) {
      await this.restoreWithoutBackup(options, previousIntegrity, backupPath)
      return
    }
    await this.restoreWithBackup(options, previousIntegrity, backupPath)
  }

  /** 删除记录声明的完整目录或 ASAR 配对。 */
  public async removePluginEntity(plugin: InstalledPluginRecord): Promise<void> {
    if (resolveStorageKind(plugin) === 'asar') {
      await removeAsarPair(plugin.path)
      return
    }
    await fs.rm(plugin.path, { recursive: true, force: true })
  }

  /** 校验旧记录使用规范路径。 */
  private assertPreviousPath(plugin: InstalledPluginRecord): void {
    if (path.resolve(plugin.path) !== path.resolve(this.getExpectedPluginPath(plugin))) {
      throw new Error('旧插件记录没有指向规范安装路径')
    }
  }

  /** 返回旧记录允许占用的所有规范实体路径。 */
  private getRegisteredPaths(plugin: InstalledPluginRecord | null): Set<string> {
    const registeredPaths = new Set<string>()
    if (!plugin) return registeredPaths
    registeredPaths.add(path.resolve(plugin.path))
    if (resolveStorageKind(plugin) === 'asar') {
      registeredPaths.add(path.resolve(`${plugin.path}.unpacked`))
    }
    return registeredPaths
  }

  /** 首次 ASAR 安装按稳定清单判断规范实体是否属于本事务。 */
  private async cleanFirstAsarInstall(
    transactionDir: string,
    journal: PluginTransactionJournal,
    nextPlugin: InstalledPluginRecord
  ): Promise<void> {
    if (!journal.nextIntegrity) throw new Error('安装事务缺少新 ASAR 代次清单')
    await cleanFirstInstallCanonical({
      stagedAsarPath: path.join(transactionDir, STAGED_ASAR_FILE),
      canonicalAsarPath: nextPlugin.path,
      pluginName: journal.pluginName,
      expectedIntegrity: journal.nextIntegrity
    })
  }

  /** 首次提交失败时清理由当前准备结果接管的新实体。 */
  private async cleanFirstCommit(options: CommitPreparedInstallOptions): Promise<void> {
    if (!isDirectoryPrepared(options.prepared)) {
      await cleanFirstInstallCanonical({
        stagedAsarPath: options.prepared.stagedAsarPath,
        canonicalAsarPath: options.prepared.canonicalAsarPath,
        pluginName: options.prepared.pluginName,
        expectedIntegrity: options.prepared.integrity
      })
      return
    }
    const prepared = options.prepared
    if (await this.pathExists(prepared.stagedDirectoryPath)) return
    if (!(await this.pathExists(prepared.canonicalDirectoryPath))) return
    await validatePreparedDirectory({
      directoryPath: prepared.canonicalDirectoryPath,
      pluginName: prepared.pluginName,
      expectedConfig: prepared.pluginConfig
    })
    await fs.rm(prepared.canonicalDirectoryPath, { recursive: true })
  }

  /** 没有备份时证明旧实体仍在原位，并清理另一规范位置的新实体。 */
  private async restoreWithoutBackup(
    options: CommitPreparedInstallOptions,
    previousIntegrity: PluginUnitIntegrity | null,
    backupPath: string
  ): Promise<void> {
    const previousPlugin = options.previousPlugin
    if (!previousPlugin) return
    if (resolveStorageKind(previousPlugin) === 'directory') {
      if (!sameDirectoryRecord(previousPlugin, options.nextPlugin)) {
        await this.removePluginEntity(options.nextPlugin)
      }
      return
    }
    if (!previousIntegrity) throw new Error('安装事务缺少旧 ASAR 代次清单')
    if (resolveStorageKind(options.nextPlugin) === 'directory') {
      await this.removePluginEntity(options.nextPlugin)
    }
    await restoreAsarBackup({
      plugin: previousPlugin,
      backupPath,
      expectedIntegrity: previousIntegrity
    })
  }

  /** 有完整备份时删除新代次并恢复旧目录或 ASAR 配对。 */
  private async restoreWithBackup(
    options: CommitPreparedInstallOptions,
    previousIntegrity: PluginUnitIntegrity | null,
    backupPath: string
  ): Promise<void> {
    const previousPlugin = options.previousPlugin
    if (!previousPlugin) return
    if (resolveStorageKind(previousPlugin) === 'directory') {
      await this.removePluginEntity(options.nextPlugin)
      await fs.rename(backupPath, previousPlugin.path)
      return
    }
    if (!previousIntegrity) throw new Error('安装事务缺少旧 ASAR 代次清单')
    await this.removeNextEntityBeforeRestore(previousPlugin, options.nextPlugin)
    await restoreAsarBackup({
      plugin: previousPlugin,
      backupPath,
      expectedIntegrity: previousIntegrity
    })
  }

  /** 恢复前删除已进入另一规范位置的新代次。 */
  private async removeNextEntityBeforeRestore(
    previousPlugin: InstalledPluginRecord,
    nextPlugin: InstalledPluginRecord
  ): Promise<void> {
    const sameAsarPath =
      resolveStorageKind(previousPlugin) === 'asar' &&
      resolveStorageKind(nextPlugin) === 'asar' &&
      path.resolve(previousPlugin.path) === path.resolve(nextPlugin.path)
    if (!sameAsarPath) await this.removePluginEntity(nextPlugin)
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

/** 读取安装日志中已经持久化的新插件记录。 */
function requireNextPlugin(journal: PluginTransactionJournal): InstalledPluginRecord {
  if (!journal.nextPlugin) throw new Error('安装事务日志缺少提交后的插件记录')
  return journal.nextPlugin
}

/** 通过固定字段区分目录准备结果。 */
function isDirectoryPrepared(
  prepared: PreparedPluginUnit | PreparedDirectoryPluginUnit
): prepared is PreparedDirectoryPluginUnit {
  return 'stagedDirectoryPath' in prepared
}

/** 判断前后记录是否指向同一个规范目录。 */
function sameDirectoryRecord(
  previousPlugin: InstalledPluginRecord,
  nextPlugin: InstalledPluginRecord
): boolean {
  return (
    resolveStorageKind(previousPlugin) === 'directory' &&
    resolveStorageKind(nextPlugin) === 'directory' &&
    path.resolve(previousPlugin.path) === path.resolve(nextPlugin.path)
  )
}
