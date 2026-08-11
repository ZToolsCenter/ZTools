import databaseAPI from '../../api/shared/database'
import { HOST_STORAGE_KEYS } from '../../../shared/storageKeys'

/**
 * 用户身份画像：用于首次启动引导采集，驱动插件市场推荐与首页预排。
 */
export type UserIdentity =
  | 'student'
  | 'teacher'
  | 'office'
  | 'government'
  | 'developer'
  | 'lawyer'
  | 'designer'
  | 'boss'
  | 'other'

/**
 * 用户使用场景：与插件市场分类 key 对齐，用于推荐加权。
 * 参考 internal-plugins/setting/src/views/PluginMarketSetting/marketAssets.ts。
 */
export type UserScenario =
  | 'productivity'
  | 'development'
  | 'media'
  | 'learning'
  | 'entertainment'
  | 'system'
  | 'network'
  | 'text'
  | 'game'

/** 主题偏好。 */
export type UserThemePreference = 'light' | 'dark' | 'system'

/** 窗口行为档位：standard=普通窗口（小白默认），launcher=启动器（进阶）。 */
export type UserWindowBehavior = 'standard' | 'launcher'

/**
 * 使用场景对应的中文分类关键词，用于本地推荐加权兜底。
 * 服务端推荐接口优先按画像场景侧重；服务端未实现时，本地据此将命中场景的插件前置。
 */
export const SCENARIO_KEYWORDS: Record<UserScenario, string[]> = {
  productivity: ['效率', '生产力', '办公', 'to-do', '待办', '笔记'],
  development: ['开发', '编程', '代码', '程序员', 'git'],
  media: ['媒体', '图片', '视频', '音频', '截图', '转换'],
  learning: ['学习', '教育', '词典', '翻译'],
  entertainment: ['娱乐', '游戏', '影音', '音乐'],
  system: ['系统', '清理', '监控', '工具'],
  network: ['网络', '代理', '下载', 'http'],
  text: ['文本', '文字', '格式化', 'json'],
  game: ['游戏', '攻略', '模拟器']
}

/**
 * 用户画像数据结构（设备级本地配置，不随账号同步）。
 */
export interface UserProfile {
  /** 画像结构版本，便于后续迁移。 */
  version: 1
  /** 是否完成首次引导向导。 */
  completed: boolean
  /** 身份画像。 */
  identity?: UserIdentity
  /** 使用场景多选。 */
  scenarios?: UserScenario[]
  /** 主题偏好。 */
  theme?: UserThemePreference
  /** 窗口行为档位。 */
  windowBehavior?: UserWindowBehavior
  /** 完成引导的时间戳。 */
  onboardedAt?: number
  /** 最近一次更新时间戳。 */
  updatedAt?: number
}

/**
 * 按画像使用场景从插件列表中匹配个性化推荐（纯函数，便于单测）。
 * 匹配依据：插件分类标题是否包含任一场景的中文关键词。
 * @param plugins 待匹配的插件列表（需含 categoryTitle）
 * @param scenarios 用户使用场景
 * @returns 匹配画像场景的插件子集（保持原顺序）
 */
export function matchPluginsByScenarios<T extends { categoryTitle?: string | null }>(
  plugins: T[],
  scenarios: UserScenario[]
): T[] {
  if (scenarios.length === 0) return []
  return plugins.filter((plugin) => {
    const title = String(plugin.categoryTitle ?? '').toLowerCase()
    return scenarios.some((scenario) =>
      (SCENARIO_KEYWORDS[scenario] ?? []).some((keyword) => title.includes(keyword))
    )
  })
}

/**
 * 读取当前用户画像。
 * @returns 已落盘的画像对象；尚未初始化时返回 null
 */
export function getProfile(): UserProfile | null {
  try {
    const doc = databaseAPI.dbGet(HOST_STORAGE_KEYS.userProfile) as UserProfile | null | undefined
    if (!doc || typeof doc !== 'object') return null
    return doc
  } catch (error) {
    // 画像读取失败按未初始化处理，避免启动分流被存储异常阻断。
    console.warn('[UserProfile] 读取画像失败:', error)
    return null
  }
}

/**
 * 保存画像（局部合并，保留未传字段）。
 * @param partial 需要写入的画像字段
 * @returns 合并后的完整画像
 */
export function saveProfile(partial: Partial<UserProfile>): UserProfile {
  const current = getProfile() ?? { version: 1 as const, completed: false }
  const next: UserProfile = {
    ...current,
    ...partial,
    version: 1,
    updatedAt: Date.now()
  }
  databaseAPI.dbPut(HOST_STORAGE_KEYS.userProfile, next)
  return next
}

/**
 * 判断用户是否已完成首次引导。
 * @returns true=已完成画像引导；false=仍需引导
 */
export function isOnboarded(): boolean {
  return getProfile()?.completed === true
}

/**
 * 将画像标记为已完成引导（向导结束后调用）。
 */
export function markOnboarded(): void {
  saveProfile({ completed: true, onboardedAt: Date.now() })
}

/**
 * 清除画像，回到未引导状态（供测试或重置入口使用）。
 */
export function clearProfile(): void {
  databaseAPI.dbPut(HOST_STORAGE_KEYS.userProfile, null)
}
