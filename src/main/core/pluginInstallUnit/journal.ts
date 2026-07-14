/**
 * 插件安装单元事务日志读写。
 *
 * 日志使用同目录临时文件加 rename 发布，确保恢复流程只读取完整 JSON。
 */

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { physicalFs } from '../../utils/physicalFs.js'
import { PLUGIN_TRANSACTION_VERSION } from './types'
import type { PluginTransactionJournal, PluginUnitIntegrity } from './types'

const fs = physicalFs.promises
/** 事务目录内原子发布的正式日志文件名。 */
export const TRANSACTION_JOURNAL_FILE = 'transaction.json'
const TRANSACTION_PHASES = new Set(['prepared', 'swapping', 'files-committed', 'record-committed'])
const SHA_256_PATTERN = /^[0-9a-f]{64}$/

/**
 * 原子写入事务日志。
 * @param transactionDir 事务目录
 * @param journal 完整事务状态
 */
export async function writeTransactionJournal(
  transactionDir: string,
  journal: PluginTransactionJournal
): Promise<void> {
  const journalPath = path.join(transactionDir, TRANSACTION_JOURNAL_FILE)
  const temporaryPath = `${journalPath}.${randomUUID()}.tmp`
  await fs.mkdir(transactionDir, { recursive: true })
  await fs.writeFile(temporaryPath, JSON.stringify(journal, null, 2), 'utf8')
  await fs.rename(temporaryPath, journalPath)
}

/**
 * 读取并校验完整事务日志。
 * 这里只接受领域字段的结构，不把 JSON 中的路径直接用于实体操作。
 * @param transactionDir 事务目录
 */
export async function readTransactionJournal(
  transactionDir: string
): Promise<PluginTransactionJournal> {
  const journalPath = path.join(transactionDir, TRANSACTION_JOURNAL_FILE)
  const content = await fs.readFile(journalPath, 'utf8')
  const value: unknown = JSON.parse(content)
  if (!isValidJournal(value)) throw new Error('事务日志格式无效')
  return value
}

/** 判断未知值是否满足事务日志的最小领域结构。 */
function isValidJournal(value: unknown): value is PluginTransactionJournal {
  if (!value || typeof value !== 'object') return false
  const journal = value as Record<string, unknown>
  return (
    hasValidJournalIdentity(journal) &&
    hasValidJournalState(journal) &&
    hasValidJournalPayload(journal) &&
    hasConsistentApplicationState(journal) &&
    hasConsistentIntegrityState(journal)
  )
}

/** 校验事务前后记录、完整性清单与应用状态快照的独立结构。 */
function hasValidJournalPayload(journal: Record<string, unknown>): boolean {
  return (
    isValidPluginRecord(journal.previousPlugin) &&
    isValidPluginRecord(journal.nextPlugin) &&
    isValidNullableIntegrity(journal.previousIntegrity) &&
    isValidNullableIntegrity(journal.nextIntegrity) &&
    isValidNullableApplicationState(journal.previousApplicationState)
  )
}

/** 校验应用状态快照只能是明确的 null 或带 values 对象的结构。 */
function isValidNullableApplicationState(value: unknown): boolean {
  if (value === null) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Record<string, unknown>
  return Boolean(
    snapshot.values && typeof snapshot.values === 'object' && !Array.isArray(snapshot.values)
  )
}

/** 安装事务不携带应用状态，卸载事务必须携带可恢复快照。 */
function hasConsistentApplicationState(journal: Record<string, unknown>): boolean {
  return journal.operation === 'remove'
    ? journal.previousApplicationState !== null
    : journal.previousApplicationState === null
}

/** 校验事务版本、标识和操作类型。 */
function hasValidJournalIdentity(journal: Record<string, unknown>): boolean {
  return (
    journal.version === PLUGIN_TRANSACTION_VERSION &&
    typeof journal.transactionId === 'string' &&
    (journal.operation === 'install' || journal.operation === 'remove')
  )
}

/** 校验恢复分支所依赖的阶段、插件名和禁用状态。 */
function hasValidJournalState(journal: Record<string, unknown>): boolean {
  return (
    typeof journal.phase === 'string' &&
    TRANSACTION_PHASES.has(journal.phase) &&
    typeof journal.pluginName === 'string' &&
    typeof journal.previousDisabled === 'boolean'
  )
}

/** 校验日志内插件记录的结构，不在此处信任其路径。 */
function isValidPluginRecord(value: unknown): boolean {
  if (value === null) return true
  if (!value || typeof value !== 'object') return false
  const plugin = value as Record<string, unknown>
  const storageKindIsValid =
    plugin.storageKind === undefined ||
    plugin.storageKind === 'directory' ||
    plugin.storageKind === 'asar'
  return typeof plugin.name === 'string' && typeof plugin.path === 'string' && storageKindIsValid
}

/** 校验完整性字段必须显式为 null 或完整清单。 */
function isValidNullableIntegrity(value: unknown): value is PluginUnitIntegrity | null {
  return value === null || isValidPluginUnitIntegrity(value)
}

/** 校验代次清单的摘要、文件大小和稳定排序。 */
function isValidPluginUnitIntegrity(value: unknown): value is PluginUnitIntegrity {
  if (!value || typeof value !== 'object') return false
  const integrity = value as Record<string, unknown>
  if (!isValidFileIntegrity(integrity.asar) || !Array.isArray(integrity.unpacked)) return false

  let previousPath = ''
  for (const entry of integrity.unpacked) {
    if (!isValidUnpackedFileIntegrity(entry)) return false
    const relativePath = (entry as Record<string, unknown>).relativePath as string
    if (relativePath <= previousPath) return false
    previousPath = relativePath
  }
  return true
}

/** 校验单个文件清单只接受非负安全整数与规范 SHA-256。 */
function isValidFileIntegrity(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const file = value as Record<string, unknown>
  return (
    typeof file.size === 'number' &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    typeof file.sha256 === 'string' &&
    SHA_256_PATTERN.test(file.sha256)
  )
}

/** 校验 unpack 清单的相对路径，拒绝路径越界和非规范分隔符。 */
function isValidUnpackedFileIntegrity(value: unknown): boolean {
  if (!isValidFileIntegrity(value)) return false
  const relativePath = (value as Record<string, unknown>).relativePath
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\')) return false
  return !relativePath.startsWith('/') && !relativePath.split('/').includes('..')
}

/** 约束前后 ASAR 记录与代次清单一一对应，避免恢复时凭同名文件猜测。 */
function hasConsistentIntegrityState(journal: Record<string, unknown>): boolean {
  const previousPlugin = journal.previousPlugin as Record<string, unknown> | null
  const previousIsAsar = previousPlugin?.storageKind === 'asar'
  if (previousIsAsar !== (journal.previousIntegrity !== null)) return false
  return hasConsistentNextIntegrity(journal)
}

/** 按操作和阶段约束新记录与新代次清单的组合。 */
function hasConsistentNextIntegrity(journal: Record<string, unknown>): boolean {
  const nextPlugin = journal.nextPlugin as Record<string, unknown> | null
  const nextIsAsar = nextPlugin?.storageKind === 'asar'
  if (nextPlugin && nextIsAsar !== (journal.nextIntegrity !== null)) return false
  if (journal.operation === 'remove' && journal.nextIntegrity !== null) return false
  if (journal.operation === 'install' && journal.phase !== 'prepared') {
    return nextPlugin !== null
  }
  return true
}
