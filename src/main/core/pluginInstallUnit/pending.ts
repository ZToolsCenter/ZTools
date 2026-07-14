/**
 * 同名插件未完成事务扫描。
 *
 * 新安装或卸载只能在旧事务完成后开始，避免多个日志依次解释同一个规范 ASAR。
 * 本模块只识别事务归属，不执行恢复或信任日志内的实体路径。
 */

import path from 'node:path'
import { physicalFs } from '../../utils/physicalFs.js'
import { readTransactionJournal, TRANSACTION_JOURNAL_FILE } from './journal'
import { PLUGIN_TRANSACTIONS_DIR } from './paths'
import type { PluginTransactionJournal } from './types'

const fs = physicalFs.promises

/** 可交给安装单元服务恢复的同名事务。 */
export interface PendingPluginTransaction {
  /** 事务目录名。 */
  transactionId: string
  /** 事务物理目录。 */
  transactionDir: string
  /** 已通过结构校验的事务日志。 */
  journal: PluginTransactionJournal
}

/** 列出指定插件除当前准备事务外的全部有效事务。 */
export async function listPendingPluginTransactions(options: {
  pluginsDir: string
  pluginName: string
  excludedTransactionId?: string
}): Promise<PendingPluginTransaction[]> {
  const transactionsDir = path.join(options.pluginsDir, PLUGIN_TRANSACTIONS_DIR)
  const entries = await readTransactionDirectories(transactionsDir)
  const pending: PendingPluginTransaction[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name === options.excludedTransactionId) continue
    const transactionDir = path.join(transactionsDir, entry.name)
    const journal = await readCandidateJournal(transactionDir, options.pluginName)
    if (!journal || journal.pluginName !== options.pluginName) continue
    pending.push({ transactionId: entry.name, transactionDir, journal })
  }
  return pending
}

/** 读取事务根目录，仅把尚未创建解释为没有待处理事务。 */
async function readTransactionDirectories(
  transactionsDir: string
): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(transactionsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** 无效日志若仍能识别为同名插件，则必须阻止后续变更。 */
async function readCandidateJournal(
  transactionDir: string,
  pluginName: string
): Promise<PluginTransactionJournal | null> {
  try {
    return await readTransactionJournal(transactionDir)
  } catch (error) {
    if ((await readRawPluginName(transactionDir)) === pluginName) {
      throw new Error('同名插件存在无效的未完成事务日志', { cause: error })
    }
    return null
  }
}

/** 仅为错误归属读取未受信任的 pluginName，不使用其他字段。 */
async function readRawPluginName(transactionDir: string): Promise<string | null> {
  try {
    const content = await fs.readFile(path.join(transactionDir, TRANSACTION_JOURNAL_FILE), 'utf8')
    const value: unknown = JSON.parse(content)
    if (!value || typeof value !== 'object') return null
    const pluginName = (value as Record<string, unknown>).pluginName
    return typeof pluginName === 'string' ? pluginName : null
  } catch {
    return null
  }
}
