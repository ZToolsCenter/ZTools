export const GITHUB_REPOSITORY_URL = 'https://github.com/ZToolsCenter/ZTools'
export const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases`
export const GITHUB_LATEST_RELEASE_URL = `${GITHUB_RELEASES_URL}/latest`

export interface SelectableUpdateSource {
  id: number
  platformName: string
  isDirect: boolean
  feedUrl?: string
}

/**
 * 判断下载源是否支持由应用内更新器直接下载和安装。
 * @param source 服务端返回的候选下载源。
 * @returns 同时标记为直链且提供更新 feed 时返回 true。
 */
export function isInAppUpdateSource(source: SelectableUpdateSource): boolean {
  return source.isDirect && Boolean(source.feedUrl)
}

/**
 * 从服务端返回的下载源中选择默认渠道，优先使用官方源。
 * @param sources 当前版本可用的下载源列表。
 * @returns 默认下载源标识；没有可用来源时返回 null。
 */
export function getDefaultUpdateSourceID(sources: SelectableUpdateSource[]): number | null {
  const officialSource = sources.find((source) => source.platformName.trim() === '官方源')
  const githubSource = sources.find(
    (source) => source.platformName.trim().toLowerCase() === 'github'
  )
  return officialSource?.id ?? githubSource?.id ?? sources[0]?.id ?? null
}

/**
 * 生成指定版本的 GitHub Release 页面地址。
 * @param version 目标版本号，不包含前导 v；为空时返回最新正式版页面。
 * @returns GitHub Release 页面地址。
 */
export function getGitHubReleaseUrl(version?: string): string {
  if (!version) return GITHUB_LATEST_RELEASE_URL
  return `${GITHUB_RELEASES_URL}/tag/v${encodeURIComponent(version)}`
}
