import { execSync } from 'child_process'
import { readFileSync } from 'fs'

// 获取Git commit hash
export function getGitCommitHash(short = true) {
  try {
    const command = short ? 'git rev-parse --short HEAD' : 'git rev-parse HEAD'
    return execSync(command, { encoding: 'utf-8' }).trim()
  } catch (error) {
    console.warn('Failed to get git commit hash:', error.message)
    return 'unknown'
  }
}

// 获取当前月份日期
export function getCurrentMonthDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${month}${day}`
}

// 从package.json读取基础版本号
export function getBaseVersion() {
  try {
    const pkg = readFileSync('package.json', 'utf-8')
    const { version } = JSON.parse(pkg)
    // 移除dev版本格式后缀
    return version.replace(/-d\d{2,4}\.[a-f0-9]{7}$/, '')
  } catch (error) {
    console.error('Failed to read package.json:', error.message)
    return '1.0.0'
  }
}

// 生成dev版本号
export function getDevVersion() {
  const baseVersion = getBaseVersion()
  const monthDate = getCurrentMonthDate()
  const commitHash = getGitCommitHash(true)

  return `${baseVersion}-d${monthDate}.${commitHash}`
}

// 检查当前环境是否为dev构建
export function isDevBuild() {
  return (
    process.env.NODE_ENV === 'development' ||
    process.argv.includes('--dev') ||
    process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
  )
}

// 获取处理后的版本号
export function getProcessedVersion() {
  if (isDevBuild()) {
    return getDevVersion()
  } else {
    return getBaseVersion()
  }
}

// 生成下载URL
export function getDownloadUrl(isDev, version) {
  if (isDev) {
    return 'https://github.com/ZToolsCenter/ZTools/releases/download/dev'
  } else {
    return `https://github.com/ZToolsCenter/ZTools/releases/download/v${version}`
  }
}

// 生成下载链接的 Markdown
export function generateDownloadLinksMarkdown(downloadUrl, version) {
  let links = '\n\n---\n\n### 下载地址：\n\n'

  links += '#### Windows 10/11 (x64)：\n\n'
  links += `- 安装版：[ZTools-${version}-x64-setup.exe](${downloadUrl}/ZTools-${version}-x64-setup.exe)\n`
  links += `- 便携版：[ZTools-${version}-x64.zip](${downloadUrl}/ZTools-${version}-x64.zip)\n\n`

  links += '#### macOS 11+ (Apple Silicon)：\n\n'
  links += `- DMG：[ZTools-${version}-arm64.dmg](${downloadUrl}/ZTools-${version}-arm64.dmg)\n`
  links += `- ZIP：[ZTools-${version}-arm64.zip](${downloadUrl}/ZTools-${version}-arm64.zip)\n`

  return links
}
