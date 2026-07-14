import { httpGet } from '../../utils/httpRequest.js'
import databaseAPI from '../shared/database'
import {
  PluginMarketAuthRequiredError,
  PluginMarketAuthMode,
  getPluginMarketApiBase,
  requestPluginMarket
} from './pluginMarketConfig'

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 插件市场中单个插件的描述信息（来自 ZTools 线上市场 API） */
export type PluginMarketPlugin = {
  name: string
  version: string
  title?: string
  description?: string
  logo?: string
  author?: string
  homepage?: string
  size?: number
  downloadCount?: number
  updatedAt?: number
  publishedAt?: number
  categoryId?: number | null
  categoryTitle?: string
  [key: string]: unknown
}

/** 市场首页轮播图项 */
type PluginMarketBannerItem = {
  /** 轮播图图片 URL */
  image: string
  /** 点击跳转链接 */
  url?: string
}

/** 分类详情页的布局区域配置 */
type PluginMarketCategoryLayoutSection = {
  /** 区域类型：list / fixed / random */
  type: string
  /** 支持模板字符串如 '${title}系列，共${count}个工具' */
  title?: string
  count?: number
  plugins?: string[]
}

/** 插件市场分类（构建后的视图数据） */
type PluginMarketStorefrontCategory = {
  key: string
  title: string
  description?: string
  icon?: string
  /** 该分类下的插件对象列表（已按平台过滤） */
  plugins: PluginMarketPlugin[]
}

/** 插件市场首页的单个布局区域（联合类型） */
type PluginMarketStorefrontSection =
  | {
      type: 'banner'
      key: string
      items: PluginMarketBannerItem[]
      height?: number
    }
  | {
      type: 'navigation'
      key: string
      title?: string
      categories: Array<{
        key: string
        title: string
        description?: string
        icon?: string
        showDescription: boolean
        pluginCount: number
      }>
    }
  | {
      type: 'fixed' | 'random'
      key: string
      title?: string
      plugins: PluginMarketPlugin[]
    }

/** 插件市场完整的首页视图数据 */
type PluginMarketStorefront = {
  /** 首页布局区域列表（按顺序渲染） */
  sections: PluginMarketStorefrontSection[]
  /** 所有分类的详细信息，以 key 为索引 */
  categories: Record<string, PluginMarketStorefrontCategory>
  /** 各分类详情页的布局配置 */
  categoryLayouts: Record<string, PluginMarketCategoryLayoutSection[]>
}

type MarketBannerResponse = {
  title?: string
  imageUrl?: string
  linkUrl?: string
}

type MarketCategoryResponse = {
  id?: number
  title?: string
  description?: string
  logo?: string
  plugins?: PluginMarketPlugin[]
}

type MarketPluginsResponse = {
  banners?: MarketBannerResponse[]
  categories?: MarketCategoryResponse[]
  latest?: PluginMarketPlugin[]
}

type PluginMarketCommentItem = {
  id: number
  pluginName: string
  uid: string
  nickname: string
  avatarUrl?: string
  parentId?: number | null
  parent?: PluginMarketCommentParent | null
  content: string
  likeCount: number
  liked: boolean
  deleted?: boolean
  createdAt: number
  updatedAt: number
}

type PluginMarketCommentParent = {
  id: number
  uid: string
  nickname: string
  avatarUrl?: string
  content: string
  deleted: boolean
  createdAt: number
}

type PluginMarketCommentPage = {
  items: PluginMarketCommentItem[]
  page: {
    page: number
    pageSize: number
    total: number
  }
}

/** fetchPluginMarket 的返回结果 */
export type PluginMarketResult = {
  success: boolean
  /** 全量插件列表（原始数据，未按平台过滤） */
  data?: PluginMarketPlugin[]
  /** 构建好的首页视图数据（平台已过滤） */
  storefront?: PluginMarketStorefront
  error?: string
}

// ━━━ Constants ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** storefront 视图数据在 LMDB 中的缓存键 */
const PLUGIN_MARKET_STOREFRONT_CACHE_KEY = 'plugin-market-storefront'
/** storefront 指纹在 LMDB 中的缓存键，用于判断缓存是否失效 */
const PLUGIN_MARKET_STOREFRONT_FINGERPRINT_CACHE_KEY = 'plugin-market-storefront-fingerprint'
const PLUGIN_MARKET_RECOMMEND_LIMIT = 12

// ━━━ PluginMarketAPI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 插件市场 API。
 * 负责从 ZTools 线上市场获取插件列表、缓存管理和首页 storefront 视图数据构建。
 */
export class PluginMarketAPI {
  /**
   * 获取插件市场列表。
   * 缓存策略：
   * 1. 优先请求线上聚合 API
   * 2. 网络失败时降级使用本地缓存
   * @returns 插件列表和可选的 storefront 视图数据
   */
  public async fetchPluginMarket(): Promise<PluginMarketResult> {
    const getCachedResult = (): PluginMarketResult | null => {
      const cachedData = databaseAPI.dbGet('plugin-market-data')
      if (!Array.isArray(cachedData)) {
        return null
      }

      const storefrontFingerprint = databaseAPI.dbGet(
        PLUGIN_MARKET_STOREFRONT_FINGERPRINT_CACHE_KEY
      )
      const cachedStorefront = databaseAPI.dbGet(PLUGIN_MARKET_STOREFRONT_CACHE_KEY)
      const currentFingerprint = this.getPluginMarketFingerprint(cachedData)
      const storefront =
        storefrontFingerprint === currentFingerprint && cachedStorefront
          ? cachedStorefront
          : undefined

      return {
        success: true,
        data: cachedData,
        ...(storefront ? { storefront } : {})
      }
    }

    try {
      const marketApiBase = getPluginMarketApiBase()
      const timestamp = Date.now()
      const platform = process.platform

      console.log('[Plugins] 从 ZTools 插件市场获取列表...', marketApiBase)

      const [marketResponse, recommendations] = await Promise.all([
        httpGet(
          `${marketApiBase}/plugins?limit=${PLUGIN_MARKET_RECOMMEND_LIMIT}&platform=${encodeURIComponent(platform)}&t=${timestamp}`
        ),
        this.fetchPluginMarketRecommendations(PLUGIN_MARKET_RECOMMEND_LIMIT).catch((error) => {
          console.warn('[Plugins] 获取推荐插件失败，将仅使用市场聚合数据:', error)
          return []
        })
      ])

      const marketData = this.parseMarketPluginsResponse(marketResponse.data)
      const plugins = this.collectPlugins(marketData)
      const storefront = this.buildPluginMarketStorefront(marketData, recommendations)
      const pluginMarketFingerprint = this.getPluginMarketFingerprint(plugins)

      databaseAPI.dbPut('plugin-market-version', String(timestamp))
      databaseAPI.dbPut('plugin-market-data', plugins)
      databaseAPI.dbPut(PLUGIN_MARKET_STOREFRONT_CACHE_KEY, storefront)
      databaseAPI.dbPut(PLUGIN_MARKET_STOREFRONT_FINGERPRINT_CACHE_KEY, pluginMarketFingerprint)

      return { success: true, data: plugins, storefront }
    } catch (error: unknown) {
      console.error('[Plugins] 获取插件市场列表失败:', error)
      try {
        const cachedResult = getCachedResult()
        if (cachedResult) {
          console.log('[Plugins] 获取失败，降级使用本地缓存')
          return cachedResult
        }
      } catch {
        // ignore
      }
      return { success: false, error: error instanceof Error ? error.message : '获取失败' }
    }
  }

  public async fetchPluginMarketRecommendations(
    limit = PLUGIN_MARKET_RECOMMEND_LIMIT
  ): Promise<PluginMarketPlugin[]> {
    const marketApiBase = getPluginMarketApiBase()
    const timestamp = Date.now()
    const platform = process.platform
    const response = await httpGet(
      `${marketApiBase}/plugins/recommendations?limit=${limit}&platform=${encodeURIComponent(platform)}&t=${timestamp}`
    )
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    const items = Array.isArray(data?.items) ? data.items : []
    return items.filter((plugin: PluginMarketPlugin) => !!plugin?.name)
  }

  public async fetchComments(
    pluginName: string,
    page = 1,
    pageSize = 20
  ): Promise<{
    success: boolean
    data?: PluginMarketCommentPage
    error?: string
    authRequired?: boolean
  }> {
    try {
      const query = new URLSearchParams({
        pluginName,
        page: String(page),
        pageSize: String(pageSize)
      })
      const response = await requestPluginMarket(`/plugins/comments?${query.toString()}`)
      return { success: true, data: this.parseCommentPage(response.data) }
    } catch (error: unknown) {
      return this.commentError(error, '评论加载失败')
    }
  }

  public async createComment(input: {
    pluginName: string
    content: string
    parentId?: number | null
  }): Promise<{
    success: boolean
    data?: PluginMarketCommentItem
    error?: string
    authRequired?: boolean
  }> {
    try {
      const response = await requestPluginMarket(
        '/plugins/comments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        },
        PluginMarketAuthMode.REQUIRED
      )
      return { success: true, data: this.parseCommentItem(response.data) }
    } catch (error: unknown) {
      return this.commentError(error, '评论发布失败')
    }
  }

  public async toggleCommentLike(commentId: number): Promise<{
    success: boolean
    data?: { liked: boolean; likeCount: number }
    error?: string
    authRequired?: boolean
  }> {
    try {
      const response = await requestPluginMarket(
        `/plugins/comments/${commentId}/like`,
        {
          method: 'POST'
        },
        PluginMarketAuthMode.REQUIRED
      )
      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
      return {
        success: true,
        data: {
          liked: Boolean(data?.liked),
          likeCount: Number(data?.likeCount || 0)
        }
      }
    } catch (error: unknown) {
      return this.commentError(error, '操作失败')
    }
  }

  public async deleteComment(
    commentId: number
  ): Promise<{ success: boolean; error?: string; authRequired?: boolean }> {
    try {
      await requestPluginMarket(
        `/plugins/comments/${commentId}`,
        {
          method: 'DELETE'
        },
        PluginMarketAuthMode.REQUIRED
      )
      return { success: true }
    } catch (error: unknown) {
      return this.commentError(error, '删除失败')
    }
  }

  /**
   * 生成插件列表的指纹字符串。
   * 用于判断缓存的 storefront 是否需要重新构建（插件名称/版本/平台变化时失效）。
   * @param plugins - 全量插件列表
   * @returns 排序后的指纹字符串
   */
  private getPluginMarketFingerprint(plugins: PluginMarketPlugin[]): string {
    return plugins
      .map((plugin) => `${plugin?.name || ''}:${plugin?.version || ''}`)
      .sort()
      .join('|')
  }

  private parseMarketPluginsResponse(value: unknown): MarketPluginsResponse {
    const data = typeof value === 'string' ? JSON.parse(value) : value
    return data && typeof data === 'object' ? (data as MarketPluginsResponse) : {}
  }

  private parseCommentPage(value: unknown): PluginMarketCommentPage {
    const data = typeof value === 'string' ? JSON.parse(value) : value
    const page = (data as PluginMarketCommentPage)?.page || { page: 1, pageSize: 20, total: 0 }
    const items = Array.isArray((data as PluginMarketCommentPage)?.items)
      ? (data as PluginMarketCommentPage).items.map((item) => this.parseCommentItem(item))
      : []
    return { items, page }
  }

  private parseCommentItem(value: unknown): PluginMarketCommentItem {
    const item = (typeof value === 'string' ? JSON.parse(value) : value) as PluginMarketCommentItem
    return {
      id: Number(item?.id || 0),
      pluginName: String(item?.pluginName || ''),
      uid: String(item?.uid || ''),
      nickname: String(item?.nickname || ''),
      avatarUrl: String(item?.avatarUrl || ''),
      parentId: item?.parentId == null ? null : Number(item.parentId),
      parent: item?.parent ? this.parseCommentParent(item.parent) : null,
      content: String(item?.content || ''),
      likeCount: Number(item?.likeCount || 0),
      liked: Boolean(item?.liked),
      deleted: Boolean(item?.deleted),
      createdAt: Number(item?.createdAt || 0),
      updatedAt: Number(item?.updatedAt || 0)
    }
  }

  private parseCommentParent(value: unknown): PluginMarketCommentParent {
    const item = (
      typeof value === 'string' ? JSON.parse(value) : value
    ) as PluginMarketCommentParent
    return {
      id: Number(item?.id || 0),
      uid: String(item?.uid || ''),
      nickname: String(item?.nickname || ''),
      avatarUrl: String(item?.avatarUrl || ''),
      content: String(item?.content || ''),
      deleted: Boolean(item?.deleted),
      createdAt: Number(item?.createdAt || 0)
    }
  }

  private commentError(
    error: unknown,
    fallback: string
  ): { success: false; error: string; authRequired?: boolean } {
    if (error instanceof PluginMarketAuthRequiredError) {
      return { success: false, error: error.message, authRequired: true }
    }
    return { success: false, error: error instanceof Error ? error.message : fallback }
  }

  private collectPlugins(marketData: MarketPluginsResponse): PluginMarketPlugin[] {
    const byName = new Map<string, PluginMarketPlugin>()
    const pushPlugin = (plugin?: PluginMarketPlugin): void => {
      if (!plugin?.name) return
      byName.set(plugin.name, plugin)
    }

    for (const category of marketData.categories || []) {
      for (const plugin of category.plugins || []) {
        pushPlugin(plugin)
      }
    }

    return [...byName.values()]
  }

  /**
   * 构建插件市场首页的 storefront 视图数据。
   * 将线上聚合 API 的 banners/categories/latest/recommendations 转换为渲染端可直接使用的首页结构。
   */
  private buildPluginMarketStorefront(
    marketData: MarketPluginsResponse,
    recommendations: PluginMarketPlugin[]
  ): PluginMarketStorefront {
    const categoriesList = Array.isArray(marketData.categories) ? marketData.categories : []
    const latest = Array.isArray(marketData.latest) ? marketData.latest : []

    const categories: Record<string, PluginMarketStorefrontCategory> = {}
    const navigationCategories: Array<{
      key: string
      title: string
      description?: string
      icon?: string
      showDescription: boolean
      pluginCount: number
    }> = []

    for (const category of categoriesList) {
      const key = this.categoryKey(category)
      const plugins = (category.plugins || []).filter((plugin) => !!plugin?.name)
      if (plugins.length === 0) continue

      categories[key] = {
        key,
        title: category.title || key,
        description: category.description,
        icon: category.logo,
        plugins
      }
      navigationCategories.push({
        key,
        title: category.title || key,
        description: category.description,
        icon: category.logo,
        showDescription: true,
        pluginCount: plugins.length
      })
    }

    const sections: PluginMarketStorefrontSection[] = []
    const bannerItems = (marketData.banners || [])
      .map((banner) => ({
        image: banner.imageUrl || '',
        url: banner.linkUrl || undefined
      }))
      .filter((item) => !!item.image)
    if (bannerItems.length > 0) {
      sections.push({ type: 'banner', key: 'banner-0', items: bannerItems, height: 160 })
    }

    if (navigationCategories.length > 0) {
      sections.push({
        type: 'navigation',
        key: 'navigation-0',
        title: '插件分类',
        categories: navigationCategories
      })
    }

    if (latest.length > 0) {
      sections.push({
        type: 'fixed',
        key: 'latest-0',
        title: '最新发布',
        plugins: latest
      })
    }

    const randomPlugins = recommendations.filter((plugin) => !!plugin?.name)
    if (randomPlugins.length > 0) {
      sections.push({
        type: 'random',
        key: 'recommendations-0',
        title: '探索发现',
        plugins: randomPlugins
      })
    }

    return {
      sections,
      categories,
      categoryLayouts: { default: [{ type: 'list' }] }
    }
  }

  private categoryKey(category: MarketCategoryResponse): string {
    if (typeof category.id === 'number' && category.id > 0) {
      return String(category.id)
    }
    return String(category.title || 'category').trim() || 'category'
  }
}
