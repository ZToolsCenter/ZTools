/**
 * ASAR 安装单元完整性校验。
 *
 * 安装、恢复、导出和启动扫描共用同一校验入口，确保归档配置与实体 unpack
 * 文件来自同一代次；该模块只读取文件，不决定事务应提交还是回滚。
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import { physicalFs } from '../../utils/physicalFs.js'
import {
  listAsarUnpackedFiles,
  readFileFromAsar,
  type AsarUnpackedFile
} from '../../utils/zpxArchive.js'
import type { PluginFileIntegrity, PluginUnitIntegrity, PluginUnpackedFileIntegrity } from './types'

const fs = physicalFs.promises

/** 事务恢复时校验指定 ASAR 代次所需的输入。 */
interface ValidateAsarUnitIntegrityOptions {
  /** 待校验的 ASAR 实体路径。 */
  asarPath: string
  /** 归档配置中预期的插件名。 */
  pluginName: string
  /** 事务准备或备份阶段记录的稳定清单。 */
  expected: PluginUnitIntegrity
  /** 恢复中断时可指定尚未移动的 unpack 目录。 */
  unpackedDir?: string
}

/**
 * 校验 ASAR 配置以及所有 unpack 文件属于同一完整代次。
 * @param asarPath 待校验的 ASAR 实体
 * @param pluginName 预期插件名
 * @param unpackedDir 恢复中断切换时可显式指定尚未移动的配套目录
 */
export async function validateAsarUnit(
  asarPath: string,
  pluginName: string,
  unpackedDir = `${asarPath}.unpacked`
): Promise<void> {
  validatePluginConfig(asarPath, pluginName)
  const unpackedFiles = listAsarUnpackedFiles(asarPath)
  const hasUnpackedDir = await pathExists(unpackedDir)
  if (unpackedFiles.length === 0 && hasUnpackedDir) {
    throw new Error('ASAR 不需要 unpack 文件，但存在未配对的 unpack 目录')
  }
  if (unpackedFiles.length > 0 && !hasUnpackedDir) {
    throw new Error('ASAR 声明了 unpack 文件，但配套目录不存在')
  }

  for (const unpackedFile of unpackedFiles) {
    await validateUnpackedFile(unpackedDir, unpackedFile)
  }
}

/**
 * 捕获完整 ASAR 安装单元的稳定代次清单。
 * 捕获前先校验配置和 unpack 配对，避免把不完整现场写入事务日志。
 */
export async function captureAsarUnitIntegrity(
  asarPath: string,
  pluginName: string,
  unpackedDir = `${asarPath}.unpacked`
): Promise<PluginUnitIntegrity> {
  await validateAsarUnit(asarPath, pluginName, unpackedDir)
  const asarStat = await fs.stat(asarPath)
  const unpacked = await captureUnpackedIntegrity(asarPath, unpackedDir)
  return {
    asar: {
      size: asarStat.size,
      sha256: await hashPhysicalFile(asarPath, 'sha256')
    },
    unpacked
  }
}

/** 按事务清单确认当前实体仍是准备或备份时记录的同一代次。 */
export async function validateAsarUnitIntegrity(
  options: ValidateAsarUnitIntegrityOptions
): Promise<void> {
  const unpackedDir = options.unpackedDir ?? `${options.asarPath}.unpacked`
  const actual = await captureAsarUnitIntegrity(options.asarPath, options.pluginName, unpackedDir)
  if (!isDeepStrictEqual(actual, options.expected)) {
    throw new Error('ASAR 安装单元与事务记录的代次不一致')
  }
}

/**
 * 仅校验 ASAR 实体归属，不要求已经清理掉的 unpack 内容仍然存在。
 * 该入口只用于首次安装回滚的可重入清理，不能替代完整安装单元校验。
 * @param asarPath 待确认归属的规范 ASAR
 * @param pluginName 事务声明的插件名
 * @param expected 事务准备阶段记录的 ASAR 实体摘要
 */
export async function validateAsarFileIntegrity(
  asarPath: string,
  pluginName: string,
  expected: PluginFileIntegrity
): Promise<void> {
  validatePluginConfig(asarPath, pluginName)
  const stat = await fs.stat(asarPath)
  const actual: PluginFileIntegrity = {
    size: stat.size,
    sha256: await hashPhysicalFile(asarPath, 'sha256')
  }
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error('ASAR 实体与事务记录的代次不一致')
  }
}

/** 捕获 ASAR 头声明的全部 unpack 文件，固定按相对路径排序。 */
async function captureUnpackedIntegrity(
  asarPath: string,
  unpackedDir: string
): Promise<PluginUnpackedFileIntegrity[]> {
  const files = listAsarUnpackedFiles(asarPath)
  const integrity = await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(unpackedDir, file.relativePath)
      const stat = await fs.stat(filePath)
      return {
        relativePath: file.relativePath,
        size: stat.size,
        sha256: await hashPhysicalFile(filePath, 'sha256')
      }
    })
  )
  return integrity.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

/** 确认归档内配置仍可读取且没有改变插件身份。 */
function validatePluginConfig(asarPath: string, pluginName: string): void {
  const content = readFileFromAsar(asarPath, 'plugin.json').toString('utf8')
  const config = JSON.parse(content) as { name?: unknown }
  if (config.name !== pluginName) {
    throw new Error('准备后的插件配置与安装目标不一致')
  }
}

/** 按 ASAR 头中的大小和摘要校验单个 unpack 文件。 */
async function validateUnpackedFile(
  unpackedDir: string,
  unpackedFile: AsarUnpackedFile
): Promise<void> {
  const filePath = path.resolve(unpackedDir, unpackedFile.relativePath)
  const unpackedRoot = `${path.resolve(unpackedDir)}${path.sep}`
  if (!filePath.startsWith(unpackedRoot)) {
    throw new Error(`ASAR unpack 文件路径越界：${unpackedFile.relativePath}`)
  }

  try {
    const stat = await fs.stat(filePath)
    const digest = await hashPhysicalFile(filePath, unpackedFile.algorithm)
    if (stat.size !== unpackedFile.size || digest !== unpackedFile.hash) {
      throw new Error(`unpack 文件完整性校验失败：${unpackedFile.relativePath}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`ASAR unpack 文件不存在：${unpackedFile.relativePath}`, { cause: error })
    }
    throw error
  }
}

/** 流式计算实体文件摘要，避免原生模块整体进入主进程内存。 */
async function hashPhysicalFile(filePath: string, algorithm: string): Promise<string> {
  const hash = createHash(algorithm.toLowerCase())
  for await (const chunk of physicalFs.createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

/** 判断实体路径是否存在，仅把 ENOENT 解释为不存在。 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
