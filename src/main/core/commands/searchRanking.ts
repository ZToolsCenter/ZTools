import type { NameMatch, RankedName } from './searchTypes'

/** 各匹配信号的统一分值；新增表示只需声明字段分值，无需新增排序分支。 */
export const NAME_SCORE = {
  shape: { exact: 1000, prefix: 1000, contains: 100 },
  field: {
    base: 0,
    py: 0,
    'py+': 0,
    pyfirst: 0,
    'pyfirst+': 0,
    enfirst: 0
  } as Record<string, number>,
  partialPenalty: 30,
  compactPenalty: 10,
  alternativePenalty: 20,
  positionPenalty: 2,
  lengthPenalty: 1,
  preferenceBonus: 2000,
  usageBonus: 1,
  maxUsageBonus: 8
} as const

export interface NameScoreConfig {
  shape: Record<NameMatch['shape'], number>
  field: Readonly<Record<string, number>>
  partialPenalty: number
  compactPenalty: number
  alternativePenalty: number
  positionPenalty: number
  lengthPenalty: number
}

/** 名称评分服务由引擎注入，路径搜索与最终表示选择共用同一套分值。 */
export class NameScorer {
  private readonly shapeCeiling: number
  /**
   * 保存统一评分配置。
   * @param config 字段权重和匹配事实分值；扣分项须非负
   * @returns 评分器实例
   * @throws 扣分项为负数或配置包含非有限数值时抛错
   */
  constructor(readonly config: NameScoreConfig = NAME_SCORE) {
    // 安全上界依赖非负扣分，入口验证防止剪枝丢失高分路径。
    const penalties = [
      config.partialPenalty,
      config.compactPenalty,
      config.alternativePenalty,
      config.positionPenalty,
      config.lengthPenalty
    ]
    if (
      penalties.some((value) => value < 0) ||
      [...penalties, ...Object.values(config.shape), ...Object.values(config.field)].some(
        (value) => !Number.isFinite(value)
      )
    )
      throw new Error('名称评分配置无效')
    this.shapeCeiling = Math.max(...Object.values(config.shape))
  }

  /**
   * 对名称匹配事实评分，未知字段使用零权重。
   * @param match 不含分数的命中事实
   * @returns 带统一基础分的命中
   */
  score(match: Omit<NameMatch, 'score'>): NameMatch {
    const config = this.config
    return {
      ...match,
      score:
        this.pathScore(match.field, match.shape, match.partial, match.alternatives) -
        (match.compact ? config.compactPenalty : 0) -
        match.position * config.positionPenalty -
        match.length * config.lengthPenalty
    }
  }

  /**
   * 对读音路径的可变事实评分，省去 DP 状态里的命中对象分配。
   * @param field 表示身份
   * @param shape 命中形态
   * @param partial 是否停在半个音节
   * @param alternatives 备用读音数量
   * @returns 与完整命中评分共用的路径分
   */
  pathScore(
    field: string,
    shape: NameMatch['shape'],
    partial: boolean,
    alternatives: number
  ): number {
    return (
      this.config.shape[shape] +
      (this.config.field[field] ?? 0) -
      (partial ? this.config.partialPenalty : 0) -
      alternatives * this.config.alternativePenalty
    )
  }

  /**
   * 计算当前表示可达到的分数上界，供读音路径剪枝使用。
   * @param field 匹配器身份
   * @param sourceLength 原始名称长度
   * @returns 未扣读音、位置和部分命中成本的最高分
   */
  upperBound(field: string, sourceLength: number): number {
    return (
      this.shapeCeiling + (this.config.field[field] ?? 0) - sourceLength * this.config.lengthPenalty
    )
  }
}

/**
 * 为名称基础分叠加用户信号，普通名称由调用方传入零使用次数。
 * @param match 最佳命中
 * @param preferred 是否为当前查询的历史选择
 * @param usage 内容或窗口候选的使用次数
 * @returns 最终排序分；用户信号与匹配信号直接相加，不进行全名或层级保护
 */
export function scoreNameResult(match: NameMatch, preferred: boolean, usage: number): number {
  // 历史选择参与统一评分，允许跨匹配方式提升；内容使用次数使用对数平滑。
  return (
    match.score +
    (preferred ? NAME_SCORE.preferenceBonus : 0) +
    Math.min(NAME_SCORE.maxUsageBonus, Math.log2(1 + Math.max(0, usage)) * NAME_SCORE.usageBonus)
  )
}

/**
 * 选择同一名称的最佳命中路径，等分时固定字段顺序。
 * @param a 第一条命中
 * @param b 第二条命中
 * @returns 小于零时第一条优先
 */
export function compareNameMatches(a: NameMatch, b: NameMatch): number {
  return b.score - a.score || a.field.localeCompare(b.field)
}

/**
 * 按最终分排列显示表示，等分时使用稳定身份保证列表不抖动。
 * @param a 第一条表示
 * @param b 第二条表示
 * @returns 小于零时第一条优先
 */
export function compareRankedNames(a: RankedName, b: RankedName): number {
  return b.score - a.score || (a.stableKey < b.stableKey ? -1 : a.stableKey > b.stableKey ? 1 : 0)
}
