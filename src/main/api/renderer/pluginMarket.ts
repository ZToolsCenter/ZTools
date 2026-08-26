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
        pluginCount?: number
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

type PluginMarketRankingType = 'popular' | 'recent'

type PluginMarketRankingResponse = {
  type?: PluginMarketRankingType
  items?: PluginMarketPlugin[]
}

type PluginMarketRankings = Record<PluginMarketRankingType, PluginMarketPlugin[]>

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

export type PluginMarketLatestResult = {
  available: boolean
  reason?: 'not_found' | 'unsupported_platform'
  plugin?: PluginMarketPlugin
}

type PluginMarketLatestResponse = {
  available?: boolean
  reason?: 'not_found' | 'unsupported_platform'
  plugin?: PluginMarketPlugin
}

type PluginMarketLatestCacheEntry = {
  expiresAt: number
  result: PluginMarketLatestResult
}

// ━━━ Constants ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** storefront 视图数据在 LMDB 中的缓存键 */
const PLUGIN_MARKET_STOREFRONT_CACHE_KEY = 'plugin-market-storefront'
/** storefront 指纹在 LMDB 中的缓存键，用于判断缓存是否失效 */
const PLUGIN_MARKET_STOREFRONT_FINGERPRINT_CACHE_KEY = 'plugin-market-storefront-fingerprint'
const PLUGIN_MARKET_RECOMMEND_LIMIT = 12
const PLUGIN_MARKET_RANKING_LIMIT = 50
const PLUGIN_MARKET_LATEST_CACHE_MS = 5 * 60 * 1000
const PLUGIN_MARKET_LATEST_UNAVAILABLE_CACHE_MS = 60 * 1000

// ━━━ PluginMarketAPI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 插件市场 API。
 * 负责从 ZTools 线上市场获取插件列表、缓存管理和首页 storefront 视图数据构建。
 */
export class PluginMarketAPI {
  private latestPluginCache = new Map<string, PluginMarketLatestCacheEntry>()
  private latestPluginRequests = new Map<string, Promise<PluginMarketLatestResult>>()

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

      const [marketResponse, recommendations, popularRanking, recentRanking] = await Promise.all([
        httpGet(
          `${marketApiBase}/plugins?limit=${PLUGIN_MARKET_RECOMMEND_LIMIT}&platform=${encodeURIComponent(platform)}&t=${timestamp}`
        ),
        this.fetchPluginMarketRecommendations(PLUGIN_MARKET_RECOMMEND_LIMIT).catch((error) => {
          console.warn('[Plugins] 获取推荐插件失败，将仅使用市场聚合数据:', error)
          return []
        }),
        this.fetchPluginMarketRanking('popular', platform).catch((error) => {
          console.warn('[Plugins] 获取最受欢迎排行榜失败:', error)
          return []
        }),
        this.fetchPluginMarketRanking('recent', platform).catch((error) => {
          console.warn('[Plugins] 获取最近更新排行榜失败:', error)
          return []
        })
      ])

      const marketData = this.parseMarketPluginsResponse(marketResponse.data)
      const rankings: PluginMarketRankings = {
        popular: popularRanking,
        recent: recentRanking
      }
      const plugins = this.collectPlugins(marketData, rankings)
      const storefront = this.buildPluginMarketStorefront(marketData, recommendations, rankings)
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

  /**
   * 获取单个插件在当前平台可用的市场最新版本，并合并并发请求及短期缓存结果。
   * @param pluginName 插件唯一名称
   * @param platform 目标运行平台
   * @returns 市场可用状态和最新插件元数据
   * @throws 当插件名无效或市场请求失败时抛出错误
   */
  public async fetchLatestPlugin(
    pluginName: string,
    platform = process.platform
  ): Promise<PluginMarketLatestResult> {
    const normalizedName = pluginName.trim()
    if (!normalizedName) {
      throw new Error('插件名称不能为空')
    }

    const cacheKey = `${platform}:${normalizedName}`
    const cached = this.latestPluginCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result
    }

    const pending = this.latestPluginRequests.get(cacheKey)
    if (pending) return pending

    // 同一插件的同时检查共享一次网络请求，避免频繁切换视图造成重复查询。
    const request = this.loadLatestPlugin(normalizedName, platform).then((result) => {
      const ttl = result.available
        ? PLUGIN_MARKET_LATEST_CACHE_MS
        : PLUGIN_MARKET_LATEST_UNAVAILABLE_CACHE_MS
      this.latestPluginCache.set(cacheKey, { expiresAt: Date.now() + ttl, result })
      return result
    })
    this.latestPluginRequests.set(cacheKey, request)
    try {
      return await request
    } finally {
      if (this.latestPluginRequests.get(cacheKey) === request) {
        this.latestPluginRequests.delete(cacheKey)
      }
    }
  }

  /**
   * 请求服务端的单插件最新版本接口并校验响应结构。
   * @param pluginName 插件唯一名称
   * @param platform 目标运行平台
   * @returns 服务端返回的市场可用状态和插件元数据
   * @throws 当响应声明可用却缺少有效插件信息时抛出错误
   */
  private async loadLatestPlugin(
    pluginName: string,
    platform: string
  ): Promise<PluginMarketLatestResult> {
    const query = new URLSearchParams({ name: pluginName })
    if (platform) query.set('platform', platform)

    const response = await requestPluginMarket(`/plugins/latest?${query.toString()}`)
    const data = (
      typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    ) as PluginMarketLatestResponse
    if (!data?.available) {
      return { available: false, reason: data?.reason }
    }
    if (!data.plugin?.name || !data.plugin.version) {
      throw new Error('市场最新版本响应无效')
    }
    return { available: true, plugin: data.plugin }
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

  /**
   * 获取指定类型的插件排行榜，并校验服务端响应与请求类型一致。
   * @param type 排行榜类型。
   * @param platform 目标运行平台。
   * @returns 排行榜中的有效插件列表，最多五十项。
   * @throws 当请求失败或响应类型无效时抛出错误。
   */
  private async fetchPluginMarketRanking(
    type: PluginMarketRankingType,
    platform: string
  ): Promise<PluginMarketPlugin[]> {
    const query = new URLSearchParams({
      type,
      platform,
      t: String(Date.now())
    })
    const response = await httpGet(
      `${getPluginMarketApiBase()}/plugins/rankings?${query.toString()}`
    )
    const data = (
      typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    ) as PluginMarketRankingResponse
    if (data?.type !== type || !Array.isArray(data.items)) {
      throw new Error(`插件排行榜响应无效: ${type}`)
    }
    return data.items
      .filter((plugin: PluginMarketPlugin) => !!plugin?.name)
      .slice(0, PLUGIN_MARKET_RANKING_LIMIT)
  }

  /**
   * 获取插件评论列表，并可让服务端返回包含指定评论的分页。
   * @param pluginName 插件唯一名称。
   * @param page 请求页码。
   * @param pageSize 每页数量。
   * @param anchorId 需要定位的评论标识；不定位时传 0。
   * @returns 评论列表请求结果。
   */
  public async fetchComments(
    pluginName: string,
    page = 1,
    pageSize = 20,
    anchorId = 0
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
      if (anchorId > 0) query.set('anchorId', String(anchorId))
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

  /**
   * 合并市场分类和排行榜中的插件，并按插件名称去重。
   * @param marketData 市场聚合接口数据。
   * @param rankings 两类排行榜数据。
   * @returns 可用于安装状态映射的插件列表。
   */
  private collectPlugins(
    marketData: MarketPluginsResponse,
    rankings: PluginMarketRankings
  ): PluginMarketPlugin[] {
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

    for (const plugin of [...rankings.popular, ...rankings.recent]) {
      pushPlugin(plugin)
    }

    return [...byName.values()]
  }

  /**
   * 构建插件市场首页的 storefront 视图数据。
   * 将线上聚合 API 的 banners/categories/latest/recommendations 转换为渲染端可直接使用的首页结构。
   * @param marketData 市场聚合接口数据。
   * @param recommendations 随机推荐插件列表。
   * @param rankings 最受欢迎和最近更新排行榜数据。
   * @returns 渲染端可直接使用的市场首页和分类详情数据。
   */
  private buildPluginMarketStorefront(
    marketData: MarketPluginsResponse,
    recommendations: PluginMarketPlugin[],
    rankings: PluginMarketRankings
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

    const rankingCategories = [
      {
        key: 'ranking-popular',
        title: '最受欢迎',
        description: '下载量最高的热门插件',
        plugins: rankings.popular
      },
      {
        key: 'ranking-recent',
        title: '最近更新',
        description: '近期发布新版本的插件',
        plugins: rankings.recent
      }
    ]
    for (const ranking of rankingCategories) {
      categories[ranking.key] = {
        key: ranking.key,
        title: ranking.title,
        description: ranking.description,
        plugins: ranking.plugins
      }
    }
    sections.push({
      type: 'navigation',
      key: 'rankings-0',
      title: '排行榜',
      categories: rankingCategories.map((ranking) => ({
        key: ranking.key,
        title: ranking.title,
        description: ranking.description,
        showDescription: true
      }))
    })

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
