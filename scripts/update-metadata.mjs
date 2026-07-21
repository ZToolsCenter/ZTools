import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import yaml from 'yaml'

/* eslint-disable @typescript-eslint/explicit-function-return-type */

/**
 * 读取并解析 electron-builder 生成的更新元数据。
 * @param {string} metadataPath 更新元数据文件路径。
 * @returns {Record<string, any>} 解析后的更新元数据。
 * @throws {Error} 文件不存在或内容不是有效对象时抛出错误。
 */
export function readUpdateMetadata(metadataPath) {
  if (!existsSync(metadataPath)) throw new Error(`找不到更新元数据: ${metadataPath}`)
  const metadata = yaml.parse(readFileSync(metadataPath, 'utf8'))
  if (!metadata || typeof metadata !== 'object') {
    throw new Error(`更新元数据格式无效: ${metadataPath}`)
  }
  return metadata
}

/**
 * 从单架构 macOS 元数据中选择标准完整应用 ZIP。
 * @param {Record<string, any>} metadata 单架构 macOS 更新元数据。
 * @param {'x64' | 'arm64'} arch 目标架构。
 * @returns {Record<string, any>} 对应架构的完整应用 ZIP 文件信息。
 * @throws {Error} 找不到唯一且带 SHA-512 的标准 ZIP 时抛出错误。
 */
export function selectMacUpdateZip(metadata, arch) {
  const files = Array.isArray(metadata.files) ? metadata.files : []
  const suffix = `-${arch}.zip`
  const matches = files.filter((file) => {
    const fileName = String(file?.url || '')
    return fileName.endsWith(suffix) && !path.basename(fileName).startsWith('update-darwin-')
  })

  if (matches.length !== 1) {
    throw new Error(`macOS ${arch} 元数据必须包含且仅包含一个标准完整应用 ZIP`)
  }
  if (!matches[0].sha512) throw new Error(`macOS ${arch} 标准 ZIP 缺少 SHA-512`)
  return { ...matches[0] }
}

/**
 * 合并两个架构的 macOS 元数据，供 electron-updater 自动选择 ZIP。
 * @param {Record<string, any>} x64Metadata Intel macOS 更新元数据。
 * @param {Record<string, any>} arm64Metadata Apple Silicon macOS 更新元数据。
 * @param {string} releaseNotes 发布说明。
 * @returns {Record<string, any>} 合并后的 latest-mac 元数据。
 * @throws {Error} 版本不一致或任一架构标准 ZIP 无效时抛出错误。
 */
export function mergeMacUpdateMetadata(x64Metadata, arm64Metadata, releaseNotes) {
  if (!x64Metadata.version || x64Metadata.version !== arm64Metadata.version) {
    throw new Error('macOS x64 与 arm64 更新元数据版本不一致')
  }

  // 仅把完整应用 ZIP 暴露给 Squirrel.Mac，legacy ASAR ZIP 继续由旧客户端拼接地址。
  const x64Zip = selectMacUpdateZip(x64Metadata, 'x64')
  const arm64Zip = selectMacUpdateZip(arm64Metadata, 'arm64')

  return {
    ...x64Metadata,
    files: [x64Zip, arm64Zip],
    path: x64Zip.url,
    sha512: x64Zip.sha512,
    releaseNotes,
    changelog: releaseNotes
  }
}

/**
 * 为平台更新元数据补充统一发布说明。
 * @param {Record<string, any>} metadata 原始更新元数据。
 * @param {string} releaseNotes 发布说明。
 * @returns {Record<string, any>} 补充发布说明后的新对象。
 */
export function withReleaseNotes(metadata, releaseNotes) {
  return {
    ...metadata,
    releaseNotes,
    changelog: releaseNotes
  }
}

/**
 * 校验元数据引用的更新文件存在于其构建产物目录。
 * @param {string} metadataPath 单架构元数据文件路径。
 * @param {Record<string, any>} fileInfo 元数据中的文件信息。
 * @returns {void} 校验通过时无返回值。
 * @throws {Error} 引用文件不存在时抛出错误。
 */
export function validateReferencedAsset(metadataPath, fileInfo) {
  const assetPath = path.join(path.dirname(metadataPath), path.basename(String(fileInfo.url || '')))
  if (!existsSync(assetPath)) throw new Error(`更新元数据引用的文件不存在: ${assetPath}`)
}

/**
 * 将更新元数据写入指定 YAML 文件。
 * @param {string} metadataPath 输出文件路径。
 * @param {Record<string, any>} metadata 待写入的更新元数据。
 * @returns {void} 写入完成后无返回值。
 */
export function writeUpdateMetadata(metadataPath, metadata) {
  mkdirSync(path.dirname(metadataPath), { recursive: true })
  writeFileSync(metadataPath, yaml.stringify(metadata))
}
