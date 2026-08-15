import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import {
  getProcessedVersion,
  isDevBuild,
  getDownloadUrl,
  generateDownloadLinksMarkdown
} from './version-utils.mjs'
import {
  mergeMacUpdateMetadata,
  mergeWindowsUpdateMetadata,
  readUpdateMetadata,
  selectMacUpdateZip,
  selectWindowsInstaller,
  validateReferencedAsset,
  withReleaseNotes,
  writeUpdateMetadata
} from './update-metadata.mjs'

// 读取 changelog.md
let changelog = readFileSync('changelog.md', 'utf-8')

// 获取处理后的版本号
const version = getProcessedVersion()
const isDev = isDevBuild()
const downloadUrl = getDownloadUrl(isDev, version)

console.log(`📦 生成更新信息...`)
console.log(`版本号: ${version}`)
console.log(`构建类型: ${isDev ? 'dev' : 'release'}`)
console.log(`下载地址: ${downloadUrl}`)

// 生成下载链接并追加到 changelog
const downloadLinks = generateDownloadLinksMarkdown(downloadUrl, version)
const updatedChangelog = changelog + downloadLinks

// CI 使用独立目录避免不同架构 job 的同名更新元数据相互覆盖。
const windowsX64MetadataPath = process.env.WINDOWS_X64_UPDATE_METADATA
const windowsArm64MetadataPath = process.env.WINDOWS_ARM64_UPDATE_METADATA
const fallbackWindowsMetadataPath = process.env.WINDOWS_UPDATE_METADATA || 'dist/latest.yml'
const macX64MetadataPath = process.env.MAC_X64_UPDATE_METADATA
const macArm64MetadataPath = process.env.MAC_ARM64_UPDATE_METADATA
const metadataOutputDir =
  process.env.UPDATE_METADATA_OUTPUT_DIR ||
  path.dirname(windowsX64MetadataPath || fallbackWindowsMetadataPath)
const requireUpdateMetadata = process.env.REQUIRE_UPDATE_METADATA === 'true'

if (windowsX64MetadataPath || windowsArm64MetadataPath) {
  if (!windowsX64MetadataPath || !windowsArm64MetadataPath) {
    throw new Error('必须同时提供 WINDOWS_X64_UPDATE_METADATA 和 WINDOWS_ARM64_UPDATE_METADATA')
  }

  const x64Metadata = readUpdateMetadata(windowsX64MetadataPath)
  const arm64Metadata = readUpdateMetadata(windowsArm64MetadataPath)
  const x64Installer = selectWindowsInstaller(x64Metadata, 'x64')
  const arm64Installer = selectWindowsInstaller(arm64Metadata, 'arm64')

  // 发布前确认两个架构的安装包都实际存在于各自构建产物目录。
  validateReferencedAsset(windowsX64MetadataPath, x64Installer)
  validateReferencedAsset(windowsArm64MetadataPath, arm64Installer)

  const windowsMetadata = mergeWindowsUpdateMetadata(x64Metadata, arm64Metadata, changelog)
  const windowsOutputPath = path.join(metadataOutputDir, 'latest.yml')
  writeUpdateMetadata(windowsOutputPath, windowsMetadata)
  console.log(`✅ 已生成 ${windowsOutputPath}`)
} else if (existsSync(fallbackWindowsMetadataPath)) {
  // 保留单架构调用方式，供本地或旧版发布脚本继续规范化已有 latest.yml。
  const windowsMetadata = withReleaseNotes(
    readUpdateMetadata(fallbackWindowsMetadataPath),
    changelog
  )
  const windowsOutputPath = path.join(metadataOutputDir, 'latest.yml')
  writeUpdateMetadata(windowsOutputPath, windowsMetadata)
  console.log(`✅ 已生成 ${windowsOutputPath}`)
} else {
  const message = `未找到 Windows 更新元数据: ${fallbackWindowsMetadataPath}`
  if (requireUpdateMetadata) throw new Error(message)
  console.warn(`⚠️ ${message}`)
}

if (macX64MetadataPath || macArm64MetadataPath) {
  if (!macX64MetadataPath || !macArm64MetadataPath) {
    throw new Error('必须同时提供 MAC_X64_UPDATE_METADATA 和 MAC_ARM64_UPDATE_METADATA')
  }

  const x64Metadata = readUpdateMetadata(macX64MetadataPath)
  const arm64Metadata = readUpdateMetadata(macArm64MetadataPath)
  const x64Zip = selectMacUpdateZip(x64Metadata, 'x64')
  const arm64Zip = selectMacUpdateZip(arm64Metadata, 'arm64')

  // 发布前确认 YAML 中的两个完整 ZIP 确实随构建产物存在。
  validateReferencedAsset(macX64MetadataPath, x64Zip)
  validateReferencedAsset(macArm64MetadataPath, arm64Zip)

  const macMetadata = mergeMacUpdateMetadata(x64Metadata, arm64Metadata, changelog)
  const macOutputPath = path.join(metadataOutputDir, 'latest-mac.yml')
  writeUpdateMetadata(macOutputPath, macMetadata)
  console.log(`✅ 已生成 ${macOutputPath}`)
} else if (requireUpdateMetadata) {
  throw new Error('缺少 macOS 双架构更新元数据路径')
}

writeFileSync('changelog.md', updatedChangelog)

console.log(`✅ 标准更新元数据已保留 files 中 electron-builder 生成的 SHA-512`)
console.log(`✅ 已更新 changelog.md（添加下载链接）`)
