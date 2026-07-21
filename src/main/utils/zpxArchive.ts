/** ZPX（gzip/brotli 压缩的 ASAR）读写与安装准备工具。 */
import * as asar from '@electron/asar'
import { minimatch } from 'minimatch'
import {
  constants as zlibConstants,
  createBrotliCompress,
  createBrotliDecompress,
  createGunzip
} from 'node:zlib'
import path from 'node:path'
import os from 'node:os'
import { pipeline } from 'node:stream/promises'
import { physicalFs } from './physicalFs.js'

const fs = physicalFs.promises
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

export interface PreparedZpxAsar {
  /** 准备完成、可发布的 ASAR 实体路径。 */
  asarPath: string
  /** 存在 unpack 文件时生成的配套目录。 */
  unpackedPath?: string
  /** 从 ASAR 内部读取的权威插件配置。 */
  pluginConfig: Record<string, unknown>
  /** 实际命中 unpack 规则的相对文件路径。 */
  unpackedFiles: string[]
}

/**
 * 生成位于系统临时目录中的唯一文件路径。
 * @param ext 临时文件扩展名，包含开头的点
 * @returns 尚未创建的临时文件绝对路径
 */
function getTempPath(ext: string): string {
  const name = `zpx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  return path.join(os.tmpdir(), name)
}

/**
 * 使用指定解压流将 ZPX 写为实体 ASAR。
 * @param zpxPath ZPX 文件路径
 * @param destinationPath 目标 ASAR 实体路径
 * @param decompressorFactory 解压流工厂
 * @returns 解压流完成后结束的 Promise
 */
async function decompressZpxToPath(
  zpxPath: string,
  destinationPath: string,
  decompressorFactory: () => NodeJS.ReadWriteStream
): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  try {
    // 使用物理文件系统写入，避免 Electron 把目标 `.asar` 当作虚拟目录。
    await pipeline(
      physicalFs.createReadStream(zpxPath),
      decompressorFactory(),
      physicalFs.createWriteStream(destinationPath)
    )
  } catch (error) {
    // 流失败时删除不完整目标，调用方可以安全尝试其他压缩格式。
    await fs.rm(destinationPath, { force: true })
    throw error
  }
}

/**
 * 将 ZPX 解压为指定的实体 ASAR，兼容历史 gzip 和当前 brotli。
 * @param zpxPath ZPX 文件路径
 * @param destinationPath 目标 ASAR 实体路径
 * @returns ASAR 写入完成后结束的 Promise
 */
export async function materializeZpxAsar(zpxPath: string, destinationPath: string): Promise<void> {
  try {
    // 历史包优先按 gzip 处理。
    await decompressZpxToPath(zpxPath, destinationPath, () => createGunzip())
  } catch {
    // gzip 解压失败后回退到当前使用的 brotli 格式。
    await decompressZpxToPath(zpxPath, destinationPath, () => createBrotliDecompress())
  }
}

/**
 * 将 ZPX 解压到系统临时 ASAR，供只读操作使用。
 * @param zpxPath ZPX 文件路径
 * @returns 临时 ASAR 实体路径，调用方负责清理
 */
async function decompressZpxToTemp(zpxPath: string): Promise<string> {
  const tempAsarPath = getTempPath('.asar')
  await materializeZpxAsar(zpxPath, tempAsarPath)
  return tempAsarPath
}

/**
 * 删除临时 ASAR 及其可能存在的 unpack 目录。
 * @param tempAsarPath 临时 ASAR 实体路径
 * @returns 清理完成后结束的 Promise
 */
async function cleanupTemp(tempAsarPath: string): Promise<void> {
  await fs.rm(tempAsarPath, { force: true })
  await fs.rm(`${tempAsarPath}.unpacked`, { recursive: true, force: true })
}

/**
 * 列出 ASAR 中的规范相对路径。
 * @param asarPath ASAR 实体路径
 * @returns 不带开头斜杠且统一使用正斜杠的路径列表
 */
export function listAsarFiles(asarPath: string): string[] {
  // 清除 ASAR 头缓存，确保读取刚生成或刚替换的归档。
  asar.uncache(asarPath)
  return asar
    .listPackage(asarPath, { isPack: false })
    .map((filePath) => filePath.replace(/\\/g, '/').replace(/^\/+/, ''))
}

/**
 * 从 ASAR 中读取指定文件。
 * @param asarPath ASAR 实体路径
 * @param filePath ASAR 内部相对路径
 * @returns 文件内容
 */
export function readFileFromAsar(asarPath: string, filePath: string): Buffer {
  asar.uncache(asarPath)
  return asar.extractFile(asarPath, filePath)
}

/**
 * 校验并规范 plugin.json.unpack。
 * @param value plugin.json.unpack 原始值
 * @returns 可交给 minimatch 的规则；未声明时返回 undefined
 */
export function normalizeUnpackPattern(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw new Error('plugin.json.unpack 必须是字符串')

  const normalized = value.replace(/\\/g, '/')
  if (
    value.includes('\0') ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error('plugin.json.unpack 不能指向插件归档之外')
  }
  return normalized
}

/**
 * 计算自动原生模块规则和显式规则实际命中的文件。
 * @param files ASAR 内部规范相对路径列表
 * @param unpackValue plugin.json.unpack 原始值
 * @returns 生效规则和实际命中的文件列表
 */
export function findUnpackMatches(
  files: string[],
  unpackValue: unknown
): { patterns: string[]; matchedFiles: string[] } {
  const explicitPattern = normalizeUnpackPattern(unpackValue)
  // `.node` 始终自动 unpack，其他实体完全遵循插件显式规则。
  const patterns = [
    files.some((filePath) => filePath.endsWith('.node')) ? '*.node' : undefined,
    explicitPattern
  ].filter((pattern): pattern is string => Boolean(pattern))

  // matchBase 保证不带目录的规则可以匹配任意目录深度的文件名。
  const matchedFiles = files.filter((filePath) =>
    patterns.some((pattern) => minimatch(filePath, pattern, { matchBase: true }))
  )
  return { patterns, matchedFiles }
}

/**
 * 构造 ASAR 打包器使用的单个 unpack 规则。
 * @param patterns 已确认存在匹配项的 unpack 规则
 * @param sourceDir ASAR 重新打包时的源目录
 * @returns 可传给 createPackageWithOptions 的组合规则
 */
function buildAsarUnpackPattern(patterns: string[], sourceDir: string): string {
  // ASAR 对含目录的规则匹配绝对文件名，因此需要补齐源目录。
  const absolutePatterns = patterns.map((pattern) =>
    pattern.includes('/') ? path.join(sourceDir, pattern).replace(/\\/g, '/') : pattern
  )
  return absolutePatterns.length === 1 ? absolutePatterns[0] : `@(${absolutePatterns.join('|')})`
}

/**
 * 把 ZPX 准备为可直接发布的 ASAR。只有实际命中 unpack 文件时才完整提取并重打包。
 * @param zpxPath 待安装的 ZPX 文件路径
 * @param workDir 本次安装使用的临时工作目录
 * @returns 准备完成的 ASAR、配置和 unpack 信息
 */
export async function prepareZpxAsar(zpxPath: string, workDir: string): Promise<PreparedZpxAsar> {
  const asarPath = path.join(workDir, 'plugin.asar')
  const extractedDir = path.join(workDir, 'extracted')
  await fs.mkdir(workDir, { recursive: true })
  // 首先只物化原始 ASAR，未命中 unpack 时可以直接发布该文件。
  await materializeZpxAsar(zpxPath, asarPath)

  try {
    // 安装阶段以归档内部的 plugin.json 为权威配置。
    const parsed: unknown = JSON.parse(readFileFromAsar(asarPath, 'plugin.json').toString('utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('无效的插件文件：plugin.json 必须是对象')
    }
    const pluginConfig = parsed as Record<string, unknown>
    const files = listAsarFiles(asarPath)
    const { patterns, matchedFiles } = findUnpackMatches(files, pluginConfig.unpack)
    if (matchedFiles.length === 0) {
      // 没有实际匹配项时保留原 ASAR，避免无意义的完整提取和重打包。
      return { asarPath, pluginConfig, unpackedFiles: [] }
    }

    // 只有确实需要 unpack 时才完整提取，并让 ASAR 打包器生成配套目录。
    await fs.mkdir(extractedDir, { recursive: true })
    asar.extractAll(asarPath, extractedDir)
    await fs.rm(asarPath, { force: true })
    const unpack = buildAsarUnpackPattern(patterns, extractedDir)
    await asar.createPackageWithOptions(extractedDir, asarPath, { unpack })
    await fs.rm(extractedDir, { recursive: true, force: true })

    const unpackedPath = `${asarPath}.unpacked`
    await fs.access(unpackedPath)
    return { asarPath, unpackedPath, pluginConfig, unpackedFiles: matchedFiles }
  } catch (error) {
    // 准备失败时只清理本次工作实体，不接触已安装版本。
    await Promise.all([
      fs.rm(asarPath, { force: true }),
      fs.rm(`${asarPath}.unpacked`, { recursive: true, force: true }),
      fs.rm(extractedDir, { recursive: true, force: true })
    ])
    throw error
  }
}

/**
 * 将插件目录打包为 brotli 压缩的 ZPX。
 * @param sourceDir 插件源目录
 * @param outputPath ZPX 输出路径
 * @returns 打包完成后结束的 Promise
 */
export async function packZpx(sourceDir: string, outputPath: string): Promise<void> {
  const tempAsarPath = getTempPath('.asar')
  try {
    console.log('[ZPX] 打包目录:', sourceDir, '→', outputPath)
    // 先生成标准 ASAR，再对整个归档执行 brotli 压缩。
    await asar.createPackage(sourceDir, tempAsarPath)
    await pipeline(
      physicalFs.createReadStream(tempAsarPath),
      createBrotliCompress({
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 }
      }),
      physicalFs.createWriteStream(outputPath)
    )
    console.log('[ZPX] 打包完成:', outputPath)
  } finally {
    await cleanupTemp(tempAsarPath)
  }
}

/**
 * 将 ASAR 及其配套 unpack 内容完整提取到目录。
 * @param asarPath ASAR 实体路径
 * @param targetDir 目标目录
 * @returns 提取完成后结束的 Promise
 */
export async function extractAsar(asarPath: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true })
  asar.uncache(asarPath)
  asar.extractAll(asarPath, targetDir)
}

/**
 * 将 ZPX 完整提取到目录。
 * @param zpxPath ZPX 文件路径
 * @param targetDir 目标目录
 * @returns 提取完成后结束的 Promise
 */
export async function extractZpx(zpxPath: string, targetDir: string): Promise<void> {
  const tempAsarPath = await decompressZpxToTemp(zpxPath)
  try {
    await extractAsar(tempAsarPath, targetDir)
  } finally {
    await cleanupTemp(tempAsarPath)
  }
}

/**
 * 从 ZPX 内部读取指定文件。
 * @param zpxPath ZPX 文件路径
 * @param filePath ASAR 内部相对路径
 * @returns 文件内容
 */
export async function readFileFromZpx(zpxPath: string, filePath: string): Promise<Buffer> {
  const tempAsarPath = await decompressZpxToTemp(zpxPath)
  try {
    return readFileFromAsar(tempAsarPath, filePath)
  } finally {
    await cleanupTemp(tempAsarPath)
  }
}

/**
 * 从 ZPX 内部读取 UTF-8 文本文件。
 * @param zpxPath ZPX 文件路径
 * @param filePath ASAR 内部相对路径
 * @returns UTF-8 文本内容
 */
export async function readTextFromZpx(zpxPath: string, filePath: string): Promise<string> {
  return (await readFileFromZpx(zpxPath, filePath)).toString('utf-8')
}

/**
 * 判断 ZPX 内部是否存在指定路径。
 * @param zpxPath ZPX 文件路径
 * @param filePath ASAR 内部相对路径
 * @returns 文件是否存在
 */
export async function existsInZpx(zpxPath: string, filePath: string): Promise<boolean> {
  const tempAsarPath = await decompressZpxToTemp(zpxPath)
  try {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
    return listAsarFiles(tempAsarPath).includes(normalized)
  } finally {
    await cleanupTemp(tempAsarPath)
  }
}

/**
 * 判断文件是否为可读取的 ZPX，而不是 ZIP 或其他格式。
 * @param filePath 待检测文件路径
 * @returns 文件是否为有效 ZPX
 */
export async function isValidZpx(filePath: string): Promise<boolean> {
  let tempAsarPath = ''
  try {
    // gzip 和 ZIP 使用固定 magic bytes，可直接完成快速分类。
    const fd = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(4)
      await fd.read(buffer, 0, 4, 0)
      if (buffer[0] === GZIP_MAGIC[0] && buffer[1] === GZIP_MAGIC[1]) return true
      if (ZIP_MAGIC.every((byte, index) => buffer[index] === byte)) return false
    } finally {
      await fd.close()
    }

    // brotli 没有稳定 magic bytes，需要实际解压并读取 ASAR 头验证。
    tempAsarPath = await decompressZpxToTemp(filePath)
    listAsarFiles(tempAsarPath)
    return true
  } catch {
    return false
  } finally {
    if (tempAsarPath) await cleanupTemp(tempAsarPath)
  }
}
