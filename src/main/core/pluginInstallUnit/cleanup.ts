/**
 * 插件事务目录清理协议。
 *
 * 所有暂存和备份实体必须先于事务日志删除；只要实体清理失败，日志就保持原位，
 * 供下次启动继续恢复。日志删除后只允许留下可安全清理的空目录。
 */

import path from 'node:path'
import { physicalFs } from '../../utils/physicalFs.js'
import { TRANSACTION_JOURNAL_FILE } from './journal'

const fs = physicalFs.promises

/** 清理协议允许替换的物理删除边界。 */
export interface TransactionCleanupOperations {
  /** 删除单个受控事务条目。 */
  remove(targetPath: string, options: { recursive?: boolean; force?: boolean }): Promise<void>
}

/**
 * 按“实体在前、日志在后”的顺序清理一个事务目录。
 * @param transactionDir 事务工作目录
 * @param operations 测试故障注入所需的删除边界
 */
export async function cleanupTransactionDirectory(
  transactionDir: string,
  operations: Partial<TransactionCleanupOperations> = {}
): Promise<void> {
  const entries = await readTransactionEntries(transactionDir)
  if (!entries) return
  const remove = operations.remove ?? ((targetPath, options) => fs.rm(targetPath, options))
  const artifactNames = entries
    .map((entry) => entry.name)
    .filter((name) => name !== TRANSACTION_JOURNAL_FILE)
    .sort()

  for (const artifactName of artifactNames) {
    await remove(path.join(transactionDir, artifactName), { recursive: true, force: true })
  }
  await remove(path.join(transactionDir, TRANSACTION_JOURNAL_FILE), { force: true })
  await removeEmptyTransactionDirectory(transactionDir)
}

/** 读取事务条目，仅把目录已经消失视为清理完成。 */
async function readTransactionEntries(
  transactionDir: string
): Promise<import('node:fs').Dirent[] | null> {
  try {
    return await fs.readdir(transactionDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** 删除日志发布后留下的空目录。 */
async function removeEmptyTransactionDirectory(transactionDir: string): Promise<void> {
  try {
    await fs.rmdir(transactionDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}
