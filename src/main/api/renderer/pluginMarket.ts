import { httpGet } from '../../utils/httpRequest.js'
import databaseAPI from '../shared/database'
import {
  getProfile,
  matchPluginsByScenarios,
  SCENARIO_KEYWORDS
} from '../../core/userPreferences/userProfile'
import {
  PluginMarketAuthRequiredError,
  PluginMarketAuthMode,
  getPluginMarketApiBase,
  getMarketSourceConfig,
  requestPluginMarket
} from './pluginMarketConfig'
import { fetchMarketFromAlternativeSource } from './marketSourceAdapter'

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
/** storefront 构建时用户画像场景快照缓存键，画像变化时使 storefront 缓存失效 */
const PLUGIN_MARKET_STOREFRONT_PROFILE_CACHE_KEY = 'plugin-market-storefront-profile'
const PLUGIN_MARKET_RECOMMEND_LIMIT = 12
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
      const cachedProfileKey = databaseAPI.dbGet(PLUGIN_MARKET_STOREFRONT_PROFILE_CACHE_KEY)
      const currentFingerprint = this.getPluginMarketFingerprint(cachedData)
      // 画像场景变化（如完成首次引导或修改偏好）时，缓存的"为你推荐"已失效，需重新构建。
      const storefront =
        storefrontFingerprint === currentFingerprint &&
        cachedStorefront &&
        cachedProfileKey === this.getProfileKey()
          ? cachedStorefront
          : undefined

      return {
        success: true,
        data: cachedData,
        ...(storefront ? { storefront } : {})
      }
    }

    try {
      const source = getMarketSourceConfig()

      // 非官方源（GitHub / CDN）走适配器，不经过官方 API 的认证和聚合流程
      if (source.type !== 'official') {
        const result = await fetchMarketFromAlternativeSource(source)
        if (result.success && result.data) {
          databaseAPI.dbPut('plugin-market-data', result.data)
        }
        return result
      }

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
      databaseAPI.dbPut(PLUGIN_MARKET_STOREFRONT_PROFILE_CACHE_KEY, this.getProfileKey())

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
    const source = getMarketSourceConfig()

    // 非官方源：从本地缓存的市场数据中查找插件
    if (source.type !== 'official') {
      const cachedData = databaseAPI.dbGet('plugin-market-data')
      if (Array.isArray(cachedData)) {
        const found = cachedData.find((p: PluginMarketPlugin) => p?.name === pluginName) as
          | PluginMarketPlugin
          | undefined
        if (found) {
          return { available: true, plugin: found }
        }
      }
      return { available: false, reason: 'not_found' }
    }

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
    const source = getMarketSourceConfig()
    // 非官方源不支持服务端推荐，返回空数组
    if (source.type !== 'official') return []

    const marketApiBase = getPluginMarketApiBase()
    const timestamp = Date.now()
    const platform = process.platform
    // 读取用户画像使用场景，作为推荐侧重的依据。
    const profile = getProfile()
    const scenarios = profile?.completed ? (profile.scenarios ?? []) : []
    const scenarioParam =
      scenarios.length > 0 ? `&scenarios=${encodeURIComponent(scenarios.join(','))}` : ''
    const response = await httpGet(
      `${marketApiBase}/plugins/recommendations?limit=${limit}&platform=${encodeURIComponent(platform)}&t=${timestamp}${scenarioParam}`
    )
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    const items = Array.isArray(data?.items) ? data.items : []
    const plugins = items.filter((plugin: PluginMarketPlugin) => !!plugin?.name)
    // 本地兜底加权：画像场景命中的插件前置，服务端未实现侧重时仍保证有侧重。
    if (scenarios.length === 0) return plugins
    const hitNames = new Set(
      matchPluginsByScenarios<PluginMarketPlugin>(plugins, scenarios).map((plugin) => plugin.name)
    )
    return [
      ...plugins.filter((plugin) => hitNames.has(plugin.name)),
      ...plugins.filter((plugin) => !hitNames.has(plugin.name))
    ]
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
    // 非官方源不支持评论系统
    const source = getMarketSourceConfig()
    if (source.type !== 'official') {
      return { success: true, data: { items: [], page: { page: 1, pageSize: 20, total: 0 } } }
    }

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
    const source = getMarketSourceConfig()
    if (source.type !== 'official') {
      return { success: false, error: '当前市场源不支持评论功能' }
    }

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
    const source = getMarketSourceConfig()
    if (source.type !== 'official') {
      return { success: false, error: '当前市场源不支持评论功能' }
    }

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
    const source = getMarketSourceConfig()
    if (source.type !== 'official') {
      return { success: false, error: '当前市场源不支持评论功能' }
    }

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
   * 当前用户画像场景快照，用于判断 storefront 缓存中的"为你推荐"是否仍有效。
   * @returns 画像场景的稳定序列化字符串；未完成引导时为空数组表示
   */
  private getProfileKey(): string {
    const profile = getProfile()
    return JSON.stringify(profile?.completed ? (profile.scenarios ?? []) : [])
  }

  /**
   * 按用户画像使用场景从全量插件中匹配出个性化推荐。
   * 画像未配置或无匹配时返回空数组，交由"探索发现"等服务端推荐兜底。
   * @param marketData 市场聚合数据（含全量分类与插件）
   * @param limit 最多返回条数
   * @returns 匹配画像场景的插件列表
   */
  private buildPersonalizedRecommendations(
    marketData: MarketPluginsResponse,
    limit: number
  ): PluginMarketPlugin[] {
    const profile = getProfile()
    const scenarios = profile?.completed ? (profile.scenarios ?? []) : []
    if (scenarios.length === 0) return []

    const seen = new Set<string>()
    const result: PluginMarketPlugin[] = []
    const push = (plugin?: PluginMarketPlugin): void => {
      if (plugin?.name && !seen.has(plugin.name)) {
        seen.add(plugin.name)
        result.push(plugin)
      }
    }

    // 优先按分类维度匹配：市场分类 key 多为英文（productivity/development...），
    // 与画像场景 key 直接对应；分类标题也能命中场景中文关键词。插件自身 categoryTitle 可能为空，分类维度更可靠。
    for (const category of marketData.categories || []) {
      if (result.length >= limit) break
      const key = this.categoryKey(category).toLowerCase()
      const title = String(category.title ?? '').toLowerCase()
      const categoryMatched = scenarios.some(
        (scenario) =>
          key === scenario ||
          (SCENARIO_KEYWORDS[scenario] ?? []).some((keyword) => title.includes(keyword))
      )
      if (!categoryMatched) continue
      for (const plugin of category.plugins || []) push(plugin)
    }

    // 分类匹配不足时，按插件分类标题关键词兜底补充。
    if (result.length < limit) {
      const all = this.collectPlugins(marketData)
      for (const plugin of matchPluginsByScenarios<PluginMarketPlugin>(all, scenarios)) push(plugin)
    }

    return result.slice(0, limit)
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

    // 按用户画像场景从全量插件中挑出"为你推荐"，置顶展示（不依赖服务端推荐接口）。
    const personalized = this.buildPersonalizedRecommendations(
      marketData,
      PLUGIN_MARKET_RECOMMEND_LIMIT
    )
    if (personalized.length > 0) {
      sections.push({
        type: 'fixed',
        key: 'for-you-0',
        title: '为你推荐',
        plugins: personalized
      })
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
