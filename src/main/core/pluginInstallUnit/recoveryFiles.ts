/**
 * 插件事务的 ASAR 实体恢复操作。
 *
 * 该模块根据持久化完整性清单选择唯一可信代次，并按可重复执行的顺序恢复
 * `.asar.unpacked` 与 `.asar`，避免恢复再次中断时混合不同版本。
 */

import path from 'node:path'
import { physicalFs } from '../../utils/physicalFs.js'
import { validateAsarFileIntegrity, validateAsarUnitIntegrity } from './integrity'
import type { InstalledPluginRecord, PluginUnitIntegrity } from './types'

const fs = physicalFs.promises

/** 恢复旧 ASAR 代次所需的规范路径、备份路径和清单。 */
interface RestoreAsarBackupOptions {
  /** 指向规范 ASAR 路径的旧插件记录。 */
  plugin: InstalledPluginRecord
  /** 事务目录内的 ASAR 备份路径。 */
  backupPath: string
  /** 能唯一识别旧代次的完整性清单。 */
  expectedIntegrity: PluginUnitIntegrity
}

/**
 * 从可验证的规范侧或备份侧恢复旧 ASAR 配对。
 * unpack 先于 ASAR 移动，使恢复再次中断后仍能识别剩余文件。
 * @param options 旧插件记录、备份路径和稳定清单
 */
export async function restoreAsarBackup(options: RestoreAsarBackupOptions): Promise<void> {
  const canonicalPath = options.plugin.path
  const canonicalUnpackedPath = `${canonicalPath}.unpacked`
  const backupUnpackedPath = `${options.backupPath}.unpacked`
  const hasBackupAsar = await pathExists(options.backupPath)
  const hasCanonicalAsar = await pathExists(canonicalPath)
  if (!hasBackupAsar && !hasCanonicalAsar) {
    throw new Error('旧 ASAR 实体与事务备份均不存在')
  }

  const hasBackupUnpacked = await pathExists(backupUnpackedPath)
  const hasCanonicalUnpacked = await pathExists(canonicalUnpackedPath)
  const expectsUnpacked = options.expectedIntegrity.unpacked.length > 0
  const asarSourcePath = hasBackupAsar ? options.backupPath : canonicalPath
  const validationUnpackedPath = selectRecoveryUnpackedPath({
    expectsUnpacked,
    hasBackupUnpacked,
    hasCanonicalUnpacked,
    backupUnpackedPath,
    canonicalUnpackedPath
  })
  await validateAsarUnitIntegrity({
    asarPath: asarSourcePath,
    pluginName: options.plugin.name,
    expected: options.expectedIntegrity,
    unpackedDir: validationUnpackedPath
  })

  if (hasBackupUnpacked) {
    await fs.rm(canonicalUnpackedPath, { recursive: true, force: true })
    await fs.rename(backupUnpackedPath, canonicalUnpackedPath)
  } else if (!expectsUnpacked) {
    await fs.rm(canonicalUnpackedPath, { recursive: true, force: true })
  }
  if (hasBackupAsar) {
    await fs.rm(canonicalPath, { force: true })
    await fs.rename(options.backupPath, canonicalPath)
  }
  await validateAsarUnitIntegrity({
    asarPath: canonicalPath,
    pluginName: options.plugin.name,
    expected: options.expectedIntegrity
  })
}

/** 选择完整包含旧代次 unpack 文件的一侧用于清单校验。 */
function selectRecoveryUnpackedPath(options: {
  expectsUnpacked: boolean
  hasBackupUnpacked: boolean
  hasCanonicalUnpacked: boolean
  backupUnpackedPath: string
  canonicalUnpackedPath: string
}): string {
  if (options.hasBackupUnpacked) return options.backupUnpackedPath
  if (options.expectsUnpacked && options.hasCanonicalUnpacked) {
    return options.canonicalUnpackedPath
  }
  return options.backupUnpackedPath
}

/** 删除规范 ASAR 配对，但可保留与旧目录相同的路径。 */
export async function removeAsarPair(asarPath: string, preservedPath?: string): Promise<void> {
  if (!preservedPath || path.resolve(asarPath) !== path.resolve(preservedPath)) {
    await fs.rm(asarPath, { force: true })
  }
  await fs.rm(`${asarPath}.unpacked`, { recursive: true, force: true })
}

/** 首次安装回滚时可被清理的规范实体范围。 */
interface CleanFirstInstallOptions {
  /** 事务暂存 ASAR 路径。 */
  stagedAsarPath: string
  /** 插件规范 ASAR 路径。 */
  canonicalAsarPath: string
  /** 已通过安全校验的插件名。 */
  pluginName: string
  /** 本次准备代次的完整性清单。 */
  expectedIntegrity: PluginUnitIntegrity
}

/**
 * 清理首次安装已接管的规范实体，不删除事务开始前就存在的未知代次。
 * 暂存文件仍存在时说明 rename 尚未发生，规范路径不属于本事务。
 * @param options 暂存路径、规范路径和本次代次清单
 */
export async function cleanFirstInstallCanonical(options: CleanFirstInstallOptions): Promise<void> {
  if (await pathExists(options.stagedAsarPath)) return
  const stagedUnpackedPath = `${options.stagedAsarPath}.unpacked`
  const canonicalUnpackedPath = `${options.canonicalAsarPath}.unpacked`
  if (await pathExists(options.canonicalAsarPath)) {
    const selection = await selectFirstInstallUnpackedPath({
      expectsUnpacked: options.expectedIntegrity.unpacked.length > 0,
      stagedUnpackedPath,
      canonicalUnpackedPath
    })
    if (selection.asarOnly) {
      await validateAsarFileIntegrity(
        options.canonicalAsarPath,
        options.pluginName,
        options.expectedIntegrity.asar
      )
      await fs.rm(options.canonicalAsarPath, { force: true })
      return
    }
    await validateAsarUnitIntegrity({
      asarPath: options.canonicalAsarPath,
      pluginName: options.pluginName,
      expected: options.expectedIntegrity,
      unpackedDir: selection.validationPath
    })
    await fs.rm(stagedUnpackedPath, { recursive: true, force: true })
    await fs.rm(canonicalUnpackedPath, { recursive: true, force: true })
    await fs.rm(options.canonicalAsarPath, { force: true })
    return
  }
  await fs.rm(stagedUnpackedPath, { recursive: true, force: true })
  await fs.rm(canonicalUnpackedPath, { recursive: true, force: true })
}

/**
 * 首次安装拆分状态只能从规范侧或事务暂存侧选择唯一一份 unpack 内容。
 * 两侧同时存在无法证明单一代次；两侧均已清理则进入 ASAR 单文件续清理。
 */
async function selectFirstInstallUnpackedPath(options: {
  expectsUnpacked: boolean
  stagedUnpackedPath: string
  canonicalUnpackedPath: string
}): Promise<{ validationPath?: string; asarOnly: boolean }> {
  const hasStagedUnpacked = await pathExists(options.stagedUnpackedPath)
  const hasCanonicalUnpacked = await pathExists(options.canonicalUnpackedPath)
  if (!options.expectsUnpacked) {
    if (hasStagedUnpacked || hasCanonicalUnpacked) {
      throw new Error('首次安装出现未声明的 unpack 内容')
    }
    return { asarOnly: false }
  }
  if (hasStagedUnpacked && hasCanonicalUnpacked) {
    throw new Error('首次安装无法确定唯一 unpack 代次')
  }
  if (!hasStagedUnpacked && !hasCanonicalUnpacked) return { asarOnly: true }
  return {
    validationPath: hasStagedUnpacked ? options.stagedUnpackedPath : options.canonicalUnpackedPath,
    asarOnly: false
  }
}

/** 判断物理路径是否存在，不吞掉非缺失错误。 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
