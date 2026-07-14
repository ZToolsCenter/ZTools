/**
 * ZPX 安装单元准备流程。
 *
 * 该模块只把外部 ZPX 转换为经过配置复核和 unpack 处理的暂存 ASAR，
 * 不读取当前插件注册表，也不接触规范安装路径中的已有版本。
 */

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { physicalFs } from '../../utils/physicalFs.js'
import {
  createAsarWithOptions,
  extractAsar,
  listAsarFiles,
  materializeZpxAsar,
  readFileFromAsar
} from '../../utils/zpxArchive.js'
import { cleanupTransactionDirectory } from './cleanup'
import { captureAsarUnitIntegrity } from './integrity'
import { writeTransactionJournal } from './journal'
import { PLUGIN_TRANSACTION_VERSION } from './types'
import {
  assertSafePluginName,
  buildUnpackGlob,
  getCanonicalAsarPath,
  getTransactionDir,
  normalizeUnpackGlob,
  STAGED_ASAR_FILE
} from './paths'
import type {
  PluginTransactionJournal,
  PluginUnitIntegrity,
  PreparedPluginUnit,
  PrepareZpxOptions
} from './types'

const fs = physicalFs.promises
const EXTRACTED_DIR = 'extracted'

/** 准备流程所需的插件根目录和外部包信息。 */
interface PreparePluginUnitOptions extends PrepareZpxOptions {
  /** 正式插件的物理根目录。 */
  pluginsDir: string
}

/**
 * 将 ZPX 准备为尚未提交的完整 ASAR 安装单元。
 * 暂存归档中的 plugin.json 是安装阶段的权威配置，必须与预览结果一致。
 * @param options 插件根目录、ZPX 路径与预览配置
 */
export async function preparePluginUnit(
  options: PreparePluginUnitOptions
): Promise<PreparedPluginUnit> {
  const pluginName = readPluginName(options.pluginConfig)
  assertSafePluginName(pluginName)
  const transactionId = randomUUID()
  const transactionDir = getTransactionDir(options.pluginsDir, transactionId)
  const stagedAsarPath = path.join(transactionDir, STAGED_ASAR_FILE)

  try {
    await materializeZpxAsar(options.zpxPath, stagedAsarPath)
    const pluginConfig = readAuthoritativePluginConfig(stagedAsarPath)
    if (!isDeepStrictEqual(pluginConfig, options.pluginConfig)) {
      throw new Error('ZPX 内容在预览与安装之间发生变化')
    }
    await applyUnpackRules(stagedAsarPath, transactionDir, pluginConfig.unpack)
    const integrity = await captureAsarUnitIntegrity(stagedAsarPath, pluginName)
    await writeTransactionJournal(
      transactionDir,
      createPreparedJournal(transactionId, pluginName, integrity)
    )
    return await createPreparedResult({
      pluginsDir: options.pluginsDir,
      transactionId,
      pluginName,
      transactionDir,
      stagedAsarPath,
      pluginConfig,
      integrity
    })
  } catch (error) {
    await cleanupTransactionDirectory(transactionDir)
    throw error
  }
}

/** 从插件配置读取必需的安全名称。 */
function readPluginName(pluginConfig: Record<string, unknown>): string {
  if (typeof pluginConfig.name !== 'string') {
    throw new Error('无效的插件文件：缺少 name 字段')
  }
  return pluginConfig.name
}

/** 从暂存 ASAR 读取安装阶段唯一可信的 plugin.json。 */
function readAuthoritativePluginConfig(stagedAsarPath: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileFromAsar(stagedAsarPath, 'plugin.json').toString())
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('无效的插件文件：plugin.json 必须是对象')
  }
  return value as Record<string, unknown>
}

/** 根据原生扩展和显式 glob 重建需要 unpack 的归档。 */
async function applyUnpackRules(
  stagedAsarPath: string,
  transactionDir: string,
  unpackValue: unknown
): Promise<void> {
  const files = listAsarFiles(stagedAsarPath)
  const explicitGlob = normalizeUnpackGlob(unpackValue)
  const hasNativeModule = files.some((filePath) => filePath.endsWith('.node'))
  if (!hasNativeModule && !explicitGlob) return

  const extractedDir = path.join(transactionDir, EXTRACTED_DIR)
  const unpack = buildUnpackGlob({ hasNativeModule, explicitGlob, sourceDir: extractedDir })
  await extractAsar(stagedAsarPath, extractedDir)
  await fs.rm(stagedAsarPath, { force: true })
  await createAsarWithOptions({ sourceDir: extractedDir, destinationPath: stagedAsarPath, unpack })
  await fs.rm(extractedDir, { recursive: true, force: true })
}

/** 创建准备阶段事务日志。 */
function createPreparedJournal(
  transactionId: string,
  pluginName: string,
  integrity: PluginUnitIntegrity
): PluginTransactionJournal {
  return {
    version: PLUGIN_TRANSACTION_VERSION,
    transactionId,
    operation: 'install',
    phase: 'prepared',
    pluginName,
    previousPlugin: null,
    nextPlugin: null,
    previousDisabled: false,
    previousIntegrity: null,
    nextIntegrity: integrity,
    previousApplicationState: null
  }
}

/** 构建准备结果时使用的受控路径与权威配置。 */
interface PreparedResultOptions {
  /** 正式插件的物理根目录。 */
  pluginsDir: string
  /** 唯一事务标识。 */
  transactionId: string
  /** 已通过安全校验的插件名。 */
  pluginName: string
  /** 事务工作目录。 */
  transactionDir: string
  /** 暂存 ASAR 路径。 */
  stagedAsarPath: string
  /** 从归档读取的权威配置。 */
  pluginConfig: Record<string, unknown>
  /** 暂存安装单元的完整性清单。 */
  integrity: PluginUnitIntegrity
}

/** 构建只暴露受控路径的准备结果。 */
async function createPreparedResult(options: PreparedResultOptions): Promise<PreparedPluginUnit> {
  const stagedUnpackedPath = `${options.stagedAsarPath}.unpacked`
  const hasUnpacked = await pathExists(stagedUnpackedPath)
  return {
    transactionId: options.transactionId,
    pluginName: options.pluginName,
    transactionDir: options.transactionDir,
    stagedAsarPath: options.stagedAsarPath,
    pluginConfig: options.pluginConfig,
    integrity: options.integrity,
    stagedUnpackedPath: hasUnpacked ? stagedUnpackedPath : undefined,
    canonicalAsarPath: getCanonicalAsarPath(options.pluginsDir, options.pluginName)
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
