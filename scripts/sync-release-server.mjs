import { readFileSync } from 'fs'
import path from 'path'
import { readUpdateMetadata, selectWindowsInstaller } from './update-metadata.mjs'

/* eslint-disable @typescript-eslint/explicit-function-return-type */

/**
 * 读取发布同步所需的必填环境变量。
 * @param {string} name 环境变量名称。
 * @returns {string} 去除首尾空白后的环境变量值。
 * @throws {Error} 环境变量未配置时抛出错误。
 */
function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`缺少环境变量: ${name}`)
  return value
}

/**
 * 调用 GitHub API 读取已经发布且完成资源上传的 Release。
 * @param {string} repository owner/repo 格式的仓库名称。
 * @param {string} tag Release 对应的 Git tag。
 * @param {string} token GitHub Actions 访问令牌。
 * @returns {Promise<Record<string, any>>} GitHub Release API 数据。
 * @throws {Error} GitHub API 请求失败时抛出错误。
 */
async function fetchGitHubRelease(repository, tag, token) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  )
  if (!response.ok) throw new Error(`读取 GitHub Release 失败: ${response.status}`)
  return response.json()
}

/**
 * 从 Release assets 中查找与更新元数据文件名完全匹配的资源。
 * @param {Record<string, any>} release GitHub Release API 数据。
 * @param {string} fileName 更新元数据引用的文件名。
 * @returns {Record<string, any>} 对应的 GitHub Release asset。
 * @throws {Error} 找不到资源时抛出错误。
 */
function requireReleaseAsset(release, fileName) {
  const asset = release.assets?.find((item) => item.name === fileName)
  if (!asset?.browser_download_url) throw new Error(`GitHub Release 缺少资源: ${fileName}`)
  return asset
}

/**
 * 将 electron-updater 文件记录转换为服务端发布资源。
 * @param {Record<string, any>} release GitHub Release API 数据。
 * @param {Record<string, any>} file 更新元数据中的文件记录。
 * @param {string} systemType 服务端使用的系统类型。
 * @returns {Record<string, any>} 发布同步接口接收的资源记录。
 */
function toArtifact(release, file, systemType) {
  const fileName = path.basename(String(file.url || ''))
  const asset = requireReleaseAsset(release, fileName)
  const blockmap = release.assets?.find((item) => item.name === `${fileName}.blockmap`)
  return {
    systemType,
    fileName,
    downloadUrl: asset.browser_download_url,
    sha512: String(file.sha512 || ''),
    fileSize: Number(file.size || asset.size || 0),
    blockmapUrl: blockmap?.browser_download_url || ''
  }
}

/**
 * 选择元数据中唯一匹配指定文件名后缀的资源。
 * @param {Record<string, any>} metadata electron-updater 元数据。
 * @param {string} suffix 目标文件名后缀。
 * @returns {Record<string, any>} 匹配的文件记录。
 * @throws {Error} 资源数量不是一个时抛出错误。
 */
function selectMetadataFile(metadata, suffix) {
  const matches = (Array.isArray(metadata.files) ? metadata.files : []).filter((file) =>
    String(file?.url || '').endsWith(suffix)
  )
  if (matches.length !== 1) throw new Error(`更新元数据必须包含一个 ${suffix} 文件`)
  return matches[0]
}

/**
 * 将当前 GitHub Release 和更新元数据同步到 ZTools 服务端。
 * @returns {Promise<void>} 同步完成后结束的 Promise。
 * @throws {Error} 元数据、GitHub Release 或服务端请求无效时抛出错误。
 */
async function main() {
  const version = requiredEnv('RELEASE_VERSION').replace(/^v/, '')
  const tag = requiredEnv('RELEASE_TAG')
  const repository = requiredEnv('GITHUB_REPOSITORY')
  const githubToken = requiredEnv('GITHUB_TOKEN')
  const syncToken = requiredEnv('ZTOOLS_RELEASE_SYNC_TOKEN')
  const serverURL = requiredEnv('ZTOOLS_RELEASE_SYNC_URL').replace(/\/$/, '')
  const windowsMetadata = readUpdateMetadata(
    process.env.WINDOWS_UPDATE_METADATA || 'dist/release/latest.yml'
  )
  const macMetadata = readUpdateMetadata(
    process.env.MAC_UPDATE_METADATA || 'dist/release/latest-mac.yml'
  )
  const release = await fetchGitHubRelease(repository, tag, githubToken)
  const windowsX64Installer = selectWindowsInstaller(windowsMetadata, 'x64')
  const windowsArm64Installer = selectWindowsInstaller(windowsMetadata, 'arm64')

  const payload = {
    providerReleaseId: release.id,
    tagName: tag,
    version,
    releaseNotes: readFileSync('changelog.md', 'utf8'),
    releaseUrl: release.html_url,
    publishedAt: release.published_at,
    prerelease: Boolean(release.prerelease),
    artifacts: [
      toArtifact(release, windowsX64Installer, 'windows-x64-installer'),
      toArtifact(release, windowsArm64Installer, 'windows-arm64-installer'),
      toArtifact(release, selectMetadataFile(macMetadata, '-x64.zip'), 'macos-x64'),
      toArtifact(release, selectMetadataFile(macMetadata, '-arm64.zip'), 'macos-arm64')
    ]
  }

  const response = await fetch(`${serverURL}/api/third-party/app-releases`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${syncToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`同步版本到服务端失败: ${response.status} ${body}`)
  process.stdout.write(`${body}\n`)
}

await main()
