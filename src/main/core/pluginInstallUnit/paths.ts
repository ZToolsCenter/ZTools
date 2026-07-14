/**
 * 插件安装单元安全路径规则。
 *
 * 所有规范路径均由受校验的插件名推导；事务日志不得提供任意实体路径。
 */

import path from 'node:path'
import type {
  CommitPreparedDirectoryOptions,
  CommitPreparedPluginOptions,
  InstalledPluginRecord,
  PluginStorageKind
} from './types'
/** 插件根目录内保存未完成事务的目录名。 */
export const PLUGIN_TRANSACTIONS_DIR = '.transactions'
/** 事务目录内固定的暂存 ASAR 文件名。 */
export const STAGED_ASAR_FILE = 'staged.asar'
/** 事务目录内固定的暂存插件目录名。 */
export const STAGED_DIRECTORY_NAME = 'staged-directory'

/**
 * 校验插件名能够安全映射为单个文件名。
 * @param pluginName 插件名
 */
export function assertSafePluginName(pluginName: string): void {
  const isInvalid =
    !pluginName ||
    pluginName === '.' ||
    pluginName === '..' ||
    pluginName.includes('\0') ||
    pluginName.includes('/') ||
    pluginName.includes('\\') ||
    path.isAbsolute(pluginName) ||
    path.win32.isAbsolute(pluginName)

  if (isInvalid) {
    throw new Error('插件名无法安全映射为安装路径')
  }
}

/**
 * 校验并规范显式 unpack glob。
 * @param value plugin.json.unpack 原始值
 * @returns 可交给 ASAR 打包器的 glob；空字符串表示未声明
 */
export function normalizeUnpackGlob(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') {
    throw new Error('plugin.json.unpack 必须是字符串')
  }

  const normalized = value.replace(/\\/g, '/')
  const containsParentSegment = normalized.split('/').includes('..')
  const isUnsafe =
    value.includes('\0') ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    value.startsWith('\\\\') ||
    containsParentSegment

  if (isUnsafe) {
    throw new Error('plugin.json.unpack 不能指向插件归档之外')
  }
  return normalized
}

/**
 * 合并自动原生模块规则与插件显式规则。
 * @param options 合并选项
 * @returns 单个兼容 ASAR minimatch 的 glob
 */
export function buildUnpackGlob(options: {
  hasNativeModule: boolean
  explicitGlob?: string
  sourceDir: string
}): string | undefined {
  const explicitGlob = options.explicitGlob?.includes('/')
    ? path.join(options.sourceDir, options.explicitGlob).replace(/\\/g, '/')
    : options.explicitGlob
  const patterns = [options.hasNativeModule ? '*.node' : undefined, explicitGlob].filter(
    (pattern): pattern is string => Boolean(pattern)
  )
  if (patterns.length === 0) return undefined
  if (patterns.length === 1) return patterns[0]
  return `{${patterns.join(',')}}`
}

/**
 * 解析插件存储类型。
 * 缺失字段只用于 PRD 明确要求保留的历史目录插件。
 * @param plugin 插件记录
 */
export function resolveStorageKind(plugin: InstalledPluginRecord): PluginStorageKind {
  return plugin.storageKind ?? 'directory'
}

/**
 * 生成插件规范 ASAR 路径。
 * @param pluginsDir 插件根目录
 * @param pluginName 已校验插件名
 */
export function getCanonicalAsarPath(pluginsDir: string, pluginName: string): string {
  assertSafePluginName(pluginName)
  return path.join(pluginsDir, `${pluginName}.asar`)
}

/**
 * 生成插件规范目录路径。
 * @param pluginsDir 插件根目录
 * @param pluginName 已校验插件名
 */
export function getCanonicalDirectoryPath(pluginsDir: string, pluginName: string): string {
  assertSafePluginName(pluginName)
  return path.join(pluginsDir, pluginName)
}

/**
 * 生成事务工作目录。
 * @param pluginsDir 插件根目录
 * @param transactionId 随机事务标识
 */
export function getTransactionDir(pluginsDir: string, transactionId: string): string {
  return path.join(pluginsDir, PLUGIN_TRANSACTIONS_DIR, transactionId)
}

/**
 * 校验提交对象只能指向准备阶段生成的受控路径与 ASAR 记录。
 * @param pluginsDir 正式插件根目录
 * @param options 准备结果与提交前后记录
 */
export function assertPreparedCommitOptions(
  pluginsDir: string,
  options: CommitPreparedPluginOptions
): void {
  const { prepared, previousPlugin, nextPlugin } = options
  assertSafePluginName(prepared.pluginName)
  const expectedTransactionDir = getTransactionDir(pluginsDir, prepared.transactionId)
  const expectedCanonicalPath = getCanonicalAsarPath(pluginsDir, prepared.pluginName)
  if (!hasExpectedPreparedPaths(prepared, expectedTransactionDir, expectedCanonicalPath)) {
    throw new Error('准备结果包含无效的事务路径')
  }
  if (!hasExpectedNextPlugin(nextPlugin, prepared.pluginName, expectedCanonicalPath)) {
    throw new Error('待提交插件记录与准备结果不一致')
  }
  if (previousPlugin && previousPlugin.name !== prepared.pluginName) {
    throw new Error('旧插件记录与准备结果不一致')
  }
}

/**
 * 校验目录提交对象只能指向准备阶段生成的受控路径与目录记录。
 * @param pluginsDir 正式插件根目录
 * @param options 准备结果与提交前后记录
 */
export function assertPreparedDirectoryCommitOptions(
  pluginsDir: string,
  options: CommitPreparedDirectoryOptions
): void {
  const { prepared, previousPlugin, nextPlugin } = options
  assertSafePluginName(prepared.pluginName)
  const expectedTransactionDir = getTransactionDir(pluginsDir, prepared.transactionId)
  const expectedCanonicalPath = getCanonicalDirectoryPath(pluginsDir, prepared.pluginName)
  if (!hasExpectedDirectoryPreparedPaths(prepared, expectedTransactionDir, expectedCanonicalPath)) {
    throw new Error('目录准备结果包含无效的事务路径')
  }
  if (!hasExpectedDirectoryNextPlugin(nextPlugin, prepared.pluginName, expectedCanonicalPath)) {
    throw new Error('待提交目录插件记录与准备结果不一致')
  }
  if (previousPlugin && previousPlugin.name !== prepared.pluginName) {
    throw new Error('旧插件记录与目录准备结果不一致')
  }
}

/** 判断目录准备结果是否完全位于随机事务目录和规范目标路径。 */
function hasExpectedDirectoryPreparedPaths(
  prepared: CommitPreparedDirectoryOptions['prepared'],
  expectedTransactionDir: string,
  expectedCanonicalPath: string
): boolean {
  const expectedStagedPath = path.join(expectedTransactionDir, STAGED_DIRECTORY_NAME)
  return (
    prepared.transactionId.length > 0 &&
    path.basename(prepared.transactionId) === prepared.transactionId &&
    path.resolve(prepared.transactionDir) === path.resolve(expectedTransactionDir) &&
    path.resolve(prepared.stagedDirectoryPath) === path.resolve(expectedStagedPath) &&
    path.resolve(prepared.canonicalDirectoryPath) === path.resolve(expectedCanonicalPath)
  )
}

/** 判断目录新记录是否保持准备阶段确定的身份和规范路径。 */
function hasExpectedDirectoryNextPlugin(
  nextPlugin: InstalledPluginRecord,
  pluginName: string,
  expectedCanonicalPath: string
): boolean {
  return (
    nextPlugin.name === pluginName &&
    resolveStorageKind(nextPlugin) === 'directory' &&
    path.resolve(nextPlugin.path) === path.resolve(expectedCanonicalPath)
  )
}

/** 判断准备结果是否完全位于随机事务目录和规范目标路径。 */
function hasExpectedPreparedPaths(
  prepared: CommitPreparedPluginOptions['prepared'],
  expectedTransactionDir: string,
  expectedCanonicalPath: string
): boolean {
  const transactionIdIsSafe =
    prepared.transactionId.length > 0 &&
    path.basename(prepared.transactionId) === prepared.transactionId
  const expectedStagedAsarPath = path.join(expectedTransactionDir, STAGED_ASAR_FILE)
  return (
    transactionIdIsSafe &&
    path.resolve(prepared.transactionDir) === path.resolve(expectedTransactionDir) &&
    path.resolve(prepared.stagedAsarPath) === path.resolve(expectedStagedAsarPath) &&
    path.resolve(prepared.canonicalAsarPath) === path.resolve(expectedCanonicalPath)
  )
}

/** 判断新记录是否保持准备阶段确定的插件身份和规范 ASAR 路径。 */
function hasExpectedNextPlugin(
  nextPlugin: InstalledPluginRecord,
  pluginName: string,
  expectedCanonicalPath: string
): boolean {
  return (
    nextPlugin.name === pluginName &&
    resolveStorageKind(nextPlugin) === 'asar' &&
    path.resolve(nextPlugin.path) === path.resolve(expectedCanonicalPath)
  )
}
