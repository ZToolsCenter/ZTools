import yaml from 'yaml'
import { readFileSync, writeFileSync } from 'fs'
import {
  getProcessedVersion,
  isDevBuild,
  getDownloadUrl,
  generateDownloadLinksMarkdown
} from './version-utils.mjs'

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

// 创建 latest.yml 内容
const latest = {
  version,
  changelog
}

// 生成下载链接并追加到 changelog
const downloadLinks = generateDownloadLinksMarkdown(downloadUrl, version)
const updatedChangelog = changelog + downloadLinks

// 写入文件
writeFileSync('latest.yml', yaml.stringify(latest))
writeFileSync('changelog.md', updatedChangelog)

console.log(`✅ 已生成 latest.yml`)
console.log(`✅ 已更新 changelog.md（添加下载链接）`)
