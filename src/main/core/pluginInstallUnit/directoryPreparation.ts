/**
 * 目录插件安装单元准备与校验。
 *
 * 同步 ZIP 在网络边界完成路径和摘要校验后，通过本模块复制到正式插件事务目录；
 * 后续提交与启动恢复因此只依赖持久事务内的受控路径。
 */

import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import { physicalFs } from '../../utils/physicalFs.js'
import { cleanupTransactionDirectory } from './cleanup'
import { writeTransactionJournal } from './journal'
import { PLUGIN_TRANSACTION_VERSION } from './types'
import {
  assertSafePluginName,
  getCanonicalDirectoryPath,
  getTransactionDir,
  STAGED_DIRECTORY_NAME
} from './paths'
import type { PreparedDirectoryPluginUnit, PrepareDirectoryOptions } from './types'

const fs = physicalFs.promises

/**
 * 将已校验来源目录复制到持久事务并复核配置。
 * @param options 插件根目录、来源目录与来源配置
 */
export async function prepareDirectoryUnit(
  options: PrepareDirectoryOptions & { pluginsDir: string }
): Promise<PreparedDirectoryPluginUnit> {
  const pluginName = readPluginName(options.pluginConfig)
  assertSafePluginName(pluginName)
  const transactionId = randomUUID()
  const transactionDir = getTransactionDir(options.pluginsDir, transactionId)
  const stagedDirectoryPath = path.join(transactionDir, STAGED_DIRECTORY_NAME)
  const canonicalDirectoryPath = getCanonicalDirectoryPath(options.pluginsDir, pluginName)

  try {
    await assertSourceDirectory(options.sourceDir)
    await fs.mkdir(transactionDir, { recursive: true })
    await fs.cp(options.sourceDir, stagedDirectoryPath, { recursive: true })
    await validatePreparedDirectory({
      directoryPath: stagedDirectoryPath,
      pluginName,
      expectedConfig: options.pluginConfig
    })
    await writeTransactionJournal(transactionDir, {
      version: PLUGIN_TRANSACTION_VERSION,
      transactionId,
      operation: 'install',
      phase: 'prepared',
      pluginName,
      previousPlugin: null,
      nextPlugin: null,
      previousDisabled: false,
      previousIntegrity: null,
      nextIntegrity: null,
      previousApplicationState: null
    })
    return {
      transactionId,
      pluginName,
      transactionDir,
      stagedDirectoryPath,
      canonicalDirectoryPath,
      pluginConfig: structuredClone(options.pluginConfig)
    }
  } catch (error) {
    await cleanupTransactionDirectory(transactionDir)
    throw error
  }
}

/**
 * 复核暂存目录仍是准备阶段确认的同一插件配置。
 * @param options 目录路径、插件身份与期望配置
 */
export async function validatePreparedDirectory(options: {
  directoryPath: string
  pluginName: string
  expectedConfig: Record<string, unknown>
}): Promise<void> {
  const config = await readPluginConfig(options.directoryPath)
  if (config.name !== options.pluginName) throw new Error('目录安装单元的插件身份不一致')
  if (!isDeepStrictEqual(config, options.expectedConfig)) {
    throw new Error('目录安装单元在准备与提交之间发生变化')
  }
}

/**
 * 启动恢复时只接受根配置声明的目标插件目录。
 * @param directoryPath 规范目录路径
 * @param pluginName 事务日志中的插件名
 */
export async function validateInstalledDirectory(
  directoryPath: string,
  pluginName: string
): Promise<void> {
  const config = await readPluginConfig(directoryPath)
  if (config.name !== pluginName) throw new Error('目录安装单元的插件身份不一致')
}

/** 确保复制来源是实体目录。 */
async function assertSourceDirectory(sourceDir: string): Promise<void> {
  const stat = await fs.stat(sourceDir)
  if (!stat.isDirectory()) throw new Error('目录安装来源不是目录')
}

/** 从配置对象读取安全校验前的插件名。 */
function readPluginName(config: Record<string, unknown>): string {
  if (typeof config.name !== 'string') throw new Error('目录插件配置缺少名称')
  return config.name
}

/** 读取根 plugin.json，并拒绝数组或基础值。 */
async function readPluginConfig(directoryPath: string): Promise<Record<string, unknown>> {
  const content = await fs.readFile(path.join(directoryPath, 'plugin.json'), 'utf8')
  const config = JSON.parse(content) as unknown
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('目录插件的 plugin.json 必须是对象')
  }
  return config as Record<string, unknown>
}
