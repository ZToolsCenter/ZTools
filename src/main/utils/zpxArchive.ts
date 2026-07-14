/**
 * ZPX 归档工具模块
 *
 * ZPX 格式：compressed( asar archive )
 * 打包流程：目录 → asar.createPackage() → brotli 压缩 → .zpx 文件
 * 解压流程：.zpx 文件 → gzip/brotli 自动解压 → asar.extractAll() → 目标目录
 * 预览流程：.zpx 文件 → 自动解压到临时 .asar → asar.extractFile() 读取指定文件 → 清理临时文件
 * 实体操作：使用 original-fs，不修改进程级 process.noAsar
 */

import * as asar from '@electron/asar'
import {
  constants as zlibConstants,
  createBrotliCompress,
  createBrotliDecompress,
  createGunzip
} from 'zlib'
import path from 'path'
import os from 'os'
import { pipeline } from 'stream/promises'
import { physicalFs } from './physicalFs.js'

const fs = physicalFs.promises

/** gzip 文件的 magic bytes：0x1f 0x8b */
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])
/** zip 文件的 magic bytes：0x50 0x4b 0x03 0x04 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

/**
 * 生成唯一的临时文件路径（基于时间戳和随机数）
 * @param ext 文件扩展名
 * @returns 临时文件的绝对路径
 */
function getTempPath(ext: string): string {
  const name = `zpx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  return path.join(os.tmpdir(), name)
}

/**
 * 使用指定算法将 ZPX 解压到目标 ASAR 实体文件。
 * @param zpxPath .zpx 文件路径
 * @param destinationPath 目标 .asar 文件路径
 * @param decompressorFactory 解压流工厂
 */
async function decompressToPath(
  zpxPath: string,
  destinationPath: string,
  decompressorFactory: () => NodeJS.ReadWriteStream
): Promise<void> {
  try {
    await pipeline(
      physicalFs.createReadStream(zpxPath),
      decompressorFactory(),
      physicalFs.createWriteStream(destinationPath)
    )
  } catch (error) {
    await fs.rm(destinationPath, { force: true })
    throw error
  }
}

/**
 * 将 ZPX 解压到调用方指定的 ASAR 实体路径。
 * 先兼容历史 gzip 包，再尝试当前 Brotli 包；失败时不保留不完整实体。
 * @param zpxPath .zpx 文件路径
 * @param destinationPath 目标 .asar 文件路径
 */
export async function materializeZpxAsar(zpxPath: string, destinationPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  try {
    await decompressToPath(zpxPath, destinationPath, () => createGunzip())
  } catch {
    await decompressToPath(zpxPath, destinationPath, () => createBrotliDecompress())
  }
}

/**
 * 自动解压 .zpx 到临时 .asar（优先兼容历史 gzip，再尝试 brotli）
 * @param zpxPath .zpx 文件路径
 * @returns 临时 .asar 文件路径（调用者负责清理）
 */
async function decompressZpxToTemp(zpxPath: string): Promise<string> {
  const tempAsarPath = getTempPath('.asar')
  await materializeZpxAsar(zpxPath, tempAsarPath)
  return tempAsarPath
}

/**
 * 清理临时 .asar 文件
 * @param tempAsarPath 临时文件路径
 */
async function cleanupTemp(tempAsarPath: string): Promise<void> {
  await fs.rm(tempAsarPath, { force: true })
}

/**
 * 列出 ASAR 内部的规范路径。
 * @param archivePath ASAR 实体路径
 * @returns 归档内以正斜杠表示的路径列表
 */
export function listAsarFiles(archivePath: string): string[] {
  asar.uncache(archivePath)
  return asar
    .listPackage(archivePath, { isPack: false })
    .map((filePath) => filePath.replace(/\\/g, '/'))
}

/** ASAR 头中记录的 unpack 文件完整性信息。 */
export interface AsarUnpackedFile {
  /** 相对于同名 `.asar.unpacked` 目录的规范路径。 */
  relativePath: string
  /** 打包时记录的文件字节数。 */
  size: number
  /** 摘要算法名称。 */
  algorithm: string
  /** 打包时记录的完整文件摘要。 */
  hash: string
}

/**
 * 列出 ASAR 头中声明为 unpack 的实体文件及其完整性摘要。
 * @param archivePath ASAR 实体路径
 */
export function listAsarUnpackedFiles(archivePath: string): AsarUnpackedFile[] {
  asar.uncache(archivePath)
  const files: AsarUnpackedFile[] = []
  for (const packagePath of asar.listPackage(archivePath, { isPack: false })) {
    const relativePath = packagePath.replace(/^[/\\]+/, '').replace(/\\/g, '/')
    const entry = asar.statFile(archivePath, relativePath)
    if (!('size' in entry) || entry.unpacked !== true) continue
    if (!entry.integrity?.algorithm || !entry.integrity.hash) {
      throw new Error(`ASAR unpack 文件缺少完整性信息：${relativePath}`)
    }
    files.push({
      relativePath,
      size: entry.size,
      algorithm: entry.integrity.algorithm,
      hash: entry.integrity.hash
    })
  }
  return files
}

/**
 * 从 ASAR 实体读取归档内文件。
 * @param archivePath ASAR 实体路径
 * @param filePath 归档内相对路径
 */
export function readFileFromAsar(archivePath: string, filePath: string): Buffer {
  asar.uncache(archivePath)
  return asar.extractFile(archivePath, filePath)
}

/**
 * 从目录创建 ASAR，并按可选 glob 生成同名 unpack 目录。
 * 目标始终作为新安装单元生成，失败时同时清理归档与配套目录。
 * @param options 创建选项
 */
export async function createAsarWithOptions(options: {
  sourceDir: string
  destinationPath: string
  unpack?: string
}): Promise<void> {
  const unpackedPath = `${options.destinationPath}.unpacked`
  await fs.mkdir(path.dirname(options.destinationPath), { recursive: true })
  await Promise.all([
    fs.rm(options.destinationPath, { force: true }),
    fs.rm(unpackedPath, { recursive: true, force: true })
  ])

  try {
    await asar.createPackageWithOptions(options.sourceDir, options.destinationPath, {
      unpack: options.unpack
    })
  } catch (error) {
    await Promise.all([
      fs.rm(options.destinationPath, { force: true }),
      fs.rm(unpackedPath, { recursive: true, force: true })
    ])
    throw error
  }
}

/**
 * 将 ASAR 与配套 unpack 内容完整提取到可读目录。
 * @param archivePath ASAR 实体路径
 * @param destinationDir 导出目录
 */
export async function extractAsar(archivePath: string, destinationDir: string): Promise<void> {
  await fs.mkdir(destinationDir, { recursive: true })
  asar.uncache(archivePath)
  asar.extractAll(archivePath, destinationDir)
}

/**
 * 打包目录为 .zpx 文件
 * 流程：目录 → asar.createPackage() → brotli 压缩 → .zpx 文件
 *
 * @param sourceDir 源目录路径
 * @param outputPath 输出的 .zpx 文件路径
 */
export async function packZpx(sourceDir: string, outputPath: string): Promise<void> {
  const tempAsarPath = getTempPath('.asar')

  try {
    console.log('[ZPX] 打包目录:', sourceDir, '→', outputPath)

    // 目录 → asar 归档
    await asar.createPackage(sourceDir, tempAsarPath)

    // asar → brotli → .zpx
    await pipeline(
      physicalFs.createReadStream(tempAsarPath),
      createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 5
        }
      }),
      physicalFs.createWriteStream(outputPath)
    )

    console.log('[ZPX] 打包完成:', outputPath)
  } finally {
    await cleanupTemp(tempAsarPath)
  }
}

/**
 * 解压 .zpx 文件到目标目录
 * 流程：.zpx → 自动解压 → 临时 .asar → asar.extractAll() → 目标目录
 *
 * @param zpxPath .zpx 文件路径
 * @param targetDir 目标目录路径（如不存在会自动创建）
 */
export async function extractZpx(zpxPath: string, targetDir: string): Promise<void> {
  console.log('[ZPX] 解压:', zpxPath, '→', targetDir)

  // .zpx → 自动解压 → 临时 .asar
  const tempAsarPath = await decompressZpxToTemp(zpxPath)

  try {
    // 确保目标目录存在
    await fs.mkdir(targetDir, { recursive: true })

    // asar → 解压到目标目录（同步操作）
    asar.extractAll(tempAsarPath, targetDir)

    console.log('[ZPX] 解压完成:', targetDir)
  } finally {
    await cleanupTemp(tempAsarPath)
  }
}

/**
 * 从 .zpx 文件中读取指定文件内容
 * 流程：自动解压到临时 .asar → asar.extractFile() 读取目标文件 → 清理临时文件
 *
 * @param zpxPath .zpx 文件路径
 * @param filePath 归档内的文件相对路径（如 'plugin.json'）
 * @returns 文件内容的 Buffer
 */
export async function readFileFromZpx(zpxPath: string, filePath: string): Promise<Buffer> {
  const tempAsarPath = await decompressZpxToTemp(zpxPath)

  try {
    // 从临时 asar 中提取指定文件（同步操作，返回 Buffer）
    return asar.extractFile(tempAsarPath, filePath)
  } finally {
    await cleanupTemp(tempAsarPath)
  }
}

/**
 * 从 .zpx 文件中读取指定文件为 UTF-8 文本
 * 流程：同 readFileFromZpx，结果转为 utf-8 字符串
 *
 * @param zpxPath .zpx 文件路径
 * @param filePath 归档内的文件相对路径
 * @returns 文件内容的 UTF-8 字符串
 */
export async function readTextFromZpx(zpxPath: string, filePath: string): Promise<string> {
  const buffer = await readFileFromZpx(zpxPath, filePath)
  return buffer.toString('utf-8')
}

/**
 * 检查 .zpx 文件中是否存在指定文件
 * 流程：自动解压到临时 .asar → asar.listPackage() 检查 → 清理临时文件
 *
 * @param zpxPath .zpx 文件路径
 * @param filePath 归档内的文件相对路径
 * @returns 文件是否存在
 */
export async function existsInZpx(zpxPath: string, filePath: string): Promise<boolean> {
  const tempAsarPath = await decompressZpxToTemp(zpxPath)

  try {
    const files = listAsarFiles(tempAsarPath)
    // 规范化路径分隔符后比较
    const normalized = filePath.replace(/\\/g, '/')
    return files.some(
      (f) => f.replace(/\\/g, '/') === `/${normalized}` || f.replace(/\\/g, '/') === normalized
    )
  } finally {
    await cleanupTemp(tempAsarPath)
  }
}

/**
 * 验证文件是否为有效的 ZPX 格式（兼容 gzip + brotli）
 * 优先通过 magic bytes 快速识别 gzip/zip，再尝试解压验证 asar 结构
 *
 * @param filePath 文件路径
 * @returns 是否为有效的 ZPX 格式
 */
export async function isValidZpx(filePath: string): Promise<boolean> {
  let tempAsarPath = ''
  try {
    // 读取文件前 4 字节：兼容 gzip/zip 的快速判断
    const fd = await fs.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(4)
      await fd.read(buf, 0, 4, 0)

      const isGzip = buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1]
      if (isGzip) {
        return true
      }

      const isZip =
        buf[0] === ZIP_MAGIC[0] &&
        buf[1] === ZIP_MAGIC[1] &&
        buf[2] === ZIP_MAGIC[2] &&
        buf[3] === ZIP_MAGIC[3]
      if (isZip) {
        return false
      }
    } finally {
      await fd.close()
    }

    // brotli 等非 gzip 情况：尝试解压并验证 asar 结构
    tempAsarPath = await decompressZpxToTemp(filePath)
    listAsarFiles(tempAsarPath)
    return true
  } catch {
    return false
  } finally {
    if (tempAsarPath) {
      await cleanupTemp(tempAsarPath)
    }
  }
}
