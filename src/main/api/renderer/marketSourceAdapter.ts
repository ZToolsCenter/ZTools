/**
 * 多源插件市场适配器。
 * 支持从 GitHub 仓库、CDN 清单或官方 API 获取插件列表，并统一为 PluginMarketPlugin 格式。
 */

import { httpGet } from '../../utils/httpRequest.js'
import type { PluginMarketPlugin, PluginMarketResult } from './pluginMarket'

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 市场源类型 */
export type MarketSourceType = 'official' | 'github' | 'cdn'

/** 市场源配置（持久化到 LMDB） */
export interface MarketSourceConfig {
  /** 市场源类型 */
  type: MarketSourceType
  /** GitHub 仓库地址（owner/repo 格式）或 CDN 清单 URL */
  url?: string
  /** 分支名，默认 main */
  branch?: string
  /** GitHub 仓库中插件所在的子目录，默认 'plugins' */
  pluginsDir?: string
  /** GitHub Personal Access Token（可选，用于私有仓库或提高速率限制） */
  token?: string
}

/** CDN 清单文件中单个插件的描述 */
interface CdnManifestPlugin {
  name: string
  version: string
  title?: string
  description?: string
  logo?: string
  author?: string
  homepage?: string
  downloadUrl: string
  platform?: string[]
  [key: string]: unknown
}

/** CDN 清单文件结构 */
interface CdnManifest {
  plugins: CdnManifestPlugin[]
}

/** GitHub API 目录项 */
interface GitHubTreeItem {
  path: string
  type: string
  sha: string
  url: string
}

/** GitHub API tree 响应 */
interface GitHubTreeResponse {
  tree: GitHubTreeItem[]
  truncated: boolean
}

/** plugin.json 文件结构（来自仓库中的插件目录） */
interface PluginJsonManifest {
  name: string
  version: string
  title?: string
  description?: string
  logo?: string
  author?: string
  homepage?: string
  platform?: string[]
  [key: string]: unknown
}

// ━━━ 常量 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const DEFAULT_MARKET_SOURCE: MarketSourceConfig = {
  type: 'official'
}

export const MARKET_SOURCE_DB_KEY = 'plugin-market-source'

/** 默认的 GitHub 插件仓库 */
export const DEFAULT_GITHUB_REPO = 'ZToolsCenter/ZTools-plugins'
export const DEFAULT_GITHUB_BRANCH = 'main'
export const DEFAULT_GITHUB_PLUGINS_DIR = 'plugins'

// ━━━ 工具函数 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 解析 owner/repo 格式的仓库地址。
 * 支持完整 URL（https://github.com/owner/repo）或简写（owner/repo）。
 * @param input - 仓库地址字符串
 * @returns 解析后的 owner 和 repo，解析失败时返回 null
 */
export function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  if (!input) return null

  // 完整 GitHub URL
  const urlMatch = input.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$|\?)/)
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] }
  }

  // owner/repo 简写
  const shorthandMatch = input.match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/)
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], repo: shorthandMatch[2] }
  }

  return null
}

/**
 * 构建 GitHub raw 文件 URL。
 * @param owner - 仓库所有者
 * @param repo - 仓库名
 * @param branch - 分支名
 * @param filePath - 文件相对路径
 * @returns raw 文件 URL
 */
function buildGitHubRawUrl(owner: string, repo: string, branch: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`
}

// ━━━ GitHub 适配器 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 从 GitHub 仓库获取插件列表。
 * 通过 GitHub API 获取仓库目录树，找到所有 plugin.json 文件并解析。
 * @param config - GitHub 市场源配置
 * @returns 标准化的插件列表
 */
export async function fetchPluginsFromGitHub(
  config: MarketSourceConfig
): Promise<PluginMarketPlugin[]> {
  const repo = parseGitHubRepo(config.url || '')
  if (!repo) {
    throw new Error(`无效的 GitHub 仓库地址: ${config.url || '(空)'}`)
  }

  const branch = config.branch || DEFAULT_GITHUB_BRANCH
  const pluginsDir = config.pluginsDir || DEFAULT_GITHUB_PLUGINS_DIR
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json'
  }
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`
  }

  // 获取仓库目录树（递归）
  const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${branch}?recursive=1`
  console.log('[MarketAdapter] 从 GitHub 获取插件列表:', treeUrl)

  const treeResponse = await httpGet(treeUrl, { headers })
  const treeData = (
    typeof treeResponse.data === 'string' ? JSON.parse(treeResponse.data) : treeResponse.data
  ) as GitHubTreeResponse

  if (!treeData?.tree || !Array.isArray(treeData.tree)) {
    throw new Error('GitHub API 返回的目录树无效')
  }

  // 找到所有 plugin.json 文件路径
  const pluginJsonPaths = treeData.tree
    .filter((item) => {
      if (item.type !== 'blob') return false
      if (!item.path.endsWith('/plugin.json') && item.path !== 'plugin.json') return false
      // 确保在 pluginsDir 目录下（如果配置了的话）
      if (pluginsDir && !item.path.startsWith(pluginsDir + '/')) return false
      return true
    })
    .map((item) => item.path)

  if (pluginJsonPaths.length === 0) {
    console.warn('[MarketAdapter] GitHub 仓库中未找到插件（目录:', pluginsDir, '）')
    return []
  }

  console.log(`[MarketAdapter] 找到 ${pluginJsonPaths.length} 个插件配置文件`)

  // 并行获取所有 plugin.json 内容
  const plugins = await Promise.allSettled(
    pluginJsonPaths.map(async (jsonPath): Promise<PluginMarketPlugin | null> => {
      const rawUrl = buildGitHubRawUrl(repo.owner, repo.repo, branch, jsonPath)
      const response = await httpGet(rawUrl, { headers })
      const manifest = (
        typeof response.data === 'string' ? JSON.parse(response.data) : response.data
      ) as PluginJsonManifest

      if (!manifest?.name) return null

      // logo 路径转为 GitHub raw URL
      const pluginDir = jsonPath.substring(0, jsonPath.lastIndexOf('/'))
      let logoUrl = manifest.logo || ''
      if (logoUrl && !logoUrl.startsWith('http')) {
        logoUrl = buildGitHubRawUrl(repo.owner, repo.repo, branch, `${pluginDir}/${logoUrl}`)
      }

      // 构建下载 URL（ZIP 格式的仓库子目录归档）
      const downloadUrl = `https://github.com/${repo.owner}/${repo.repo}/archive/refs/heads/${branch}.zip`

      return {
        name: manifest.name,
        version: manifest.version || '0.0.0',
        title: manifest.title,
        description: manifest.description,
        logo: logoUrl,
        author: manifest.author,
        homepage: manifest.homepage,
        downloadUrl,
        platform: manifest.platform,
        // 标记来源为 GitHub，用于下载时的特殊处理
        _source: 'github' as const,
        _pluginDir: pluginDir
      }
    })
  )

  return plugins
    .filter(
      (result): result is PromiseFulfilledResult<PluginMarketPlugin | null> =>
        result.status === 'fulfilled' && result.value !== null
    )
    .map((result) => result.value!)
}

// ━━━ CDN 适配器 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 从 CDN 清单文件获取插件列表。
 * 清单文件格式: { "plugins": [{ "name": "...", "version": "...", "downloadUrl": "...", ... }] }
 * @param config - CDN 市场源配置
 * @returns 标准化的插件列表
 */
export async function fetchPluginsFromCDN(
  config: MarketSourceConfig
): Promise<PluginMarketPlugin[]> {
  if (!config.url) {
    throw new Error('CDN 清单 URL 不能为空')
  }

  console.log('[MarketAdapter] 从 CDN 获取插件列表:', config.url)

  const response = await httpGet(config.url)
  const manifest = (
    typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  ) as CdnManifest

  if (!manifest?.plugins || !Array.isArray(manifest.plugins)) {
    throw new Error('CDN 清单文件格式无效，需要 { "plugins": [...] }')
  }

  // 解析清单的 base URL（用于解析相对路径）
  const baseUrl = config.url.substring(0, config.url.lastIndexOf('/') + 1)

  return manifest.plugins
    .filter((plugin) => !!plugin?.name)
    .map((plugin) => {
      // logo 和 downloadUrl 相对路径解析
      let logoUrl = plugin.logo || ''
      if (logoUrl && !logoUrl.startsWith('http')) {
        logoUrl = baseUrl + logoUrl
      }

      let downloadUrl = plugin.downloadUrl || ''
      if (downloadUrl && !downloadUrl.startsWith('http')) {
        downloadUrl = baseUrl + downloadUrl
      }

      return {
        name: plugin.name,
        version: plugin.version || '0.0.0',
        title: plugin.title,
        description: plugin.description,
        logo: logoUrl,
        author: plugin.author,
        homepage: plugin.homepage,
        downloadUrl,
        platform: plugin.platform,
        _source: 'cdn' as const
      }
    })
}

// ━━━ 统一入口 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 从非官方源获取插件市场数据。
 * 根据配置的源类型自动选择适配器，返回与官方 API 兼容的结果格式。
 * @param config - 市场源配置
 * @returns 标准化的插件市场结果（不含 storefront 详细分类，仅为平铺列表）
 */
export async function fetchMarketFromAlternativeSource(
  config: MarketSourceConfig
): Promise<PluginMarketResult> {
  try {
    let plugins: PluginMarketPlugin[]

    if (config.type === 'github') {
      plugins = await fetchPluginsFromGitHub(config)
    } else if (config.type === 'cdn') {
      plugins = await fetchPluginsFromCDN(config)
    } else {
      throw new Error(`不支持的市场源类型: ${config.type}`)
    }

    console.log(`[MarketAdapter] 成功获取 ${plugins.length} 个插件（来源: ${config.type}）`)

    return {
      success: true,
      data: plugins,
      // 非官方源不提供分类和 banner，前端会降级为平铺列表
      storefront: undefined
    }
  } catch (error: unknown) {
    console.error(`[MarketAdapter] 从 ${config.type} 获取插件列表失败:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '获取失败'
    }
  }
}
