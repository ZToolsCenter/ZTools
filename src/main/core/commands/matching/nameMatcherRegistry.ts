import { createPronunciation } from '../pronunciation'
import { mergeSourceRanges } from '../searchNormalization'
import { compareNameMatches, NameScorer } from '../searchRanking'
import type { MatchBudget, NameMatch } from '../searchTypes'
import type {
  NameMatcher,
  NameSource,
  IndexBuildContext,
  NameMatchContext,
  NameMatchPurpose,
  PreparedQuery
} from './contracts'
import { BaseMatcher } from './name/baseMatcher'
import { PinyinMatcher } from './name/pinyinMatcher'
import { PinyinInitialMatcher } from './name/pinyinInitialMatcher'
import { MixedPinyinMatcher } from './name/mixedPinyinMatcher'
import { MixedInitialMatcher } from './name/mixedInitialMatcher'
import { EnglishInitialMatcher } from './name/englishInitialMatcher'

interface RegisteredMatcher {
  id: string
  /**
   * 经泛型边界绑定的索引构建入口。
   * @param source 名称来源
   * @param context 共享构建数据
   * @returns 类型擦除后的索引或 null
   */
  build(source: NameSource, context: IndexBuildContext): unknown
  /**
   * 判定当前策略是否适用。
   * @param query 已准备查询
   * @returns 是否需要匹配
   */
  supports(query: PreparedQuery): boolean
  /**
   * 将索引交回与其绑定的策略。
   * @param index 类型擦除的索引
   * @param query 已准备查询
   * @param context 匹配上下文
   * @returns 最佳命中或 null
   */
  match(index: unknown, query: PreparedQuery, context: NameMatchContext): NameMatch | null
}

export interface IndexedName {
  entries: Array<{ matcher: RegisteredMatcher; index: unknown }>
}

/** 显式注册名称策略，算法实例跟随引擎生命周期，不跟随名称数量增长。 */
export class NameMatcherRegistry {
  private readonly matchers: RegisteredMatcher[] = []

  /**
   * 注入名称评分服务。
   * @param scorer 全部表示共用的评分器
   * @returns 注册表实例
   */
  constructor(readonly scorer = new NameScorer()) {}

  /**
   * 在类型边界绑定匹配器及其索引类型。
   * @param matcher 具有独立索引类型的名称策略
   * @returns 当前注册表，便于组合配置
   * @throws 匹配器身份重复时抛错
   */
  register<TIndex>(matcher: NameMatcher<TIndex>): this {
    // 类型擦除只发生在注册边界；索引始终交回建立它的匹配器。
    if (this.matchers.some((item) => item.id === matcher.id))
      throw new Error('重复名称匹配器: ' + matcher.id)
    this.matchers.push({
      id: matcher.id,
      build: matcher.build.bind(matcher),
      supports: matcher.supports.bind(matcher),
      match: (index, query, context) => matcher.match(index as TIndex, query, context)
    })
    return this
  }

  /**
   * 建立一个名称的共享读音及各策略索引。
   * @param source 显示名称与兼容缩写
   * @param characterCache 当前目录的逐字读音缓存
   * @returns 只包含适用匹配器的内部索引
   */
  build(source: NameSource, characterCache: Map<string, string[]>): IndexedName {
    const tokens = createPronunciation(source.name, characterCache)
    const initials = new Set<string>()
    for (const token of tokens)
      for (const reading of [token.literal, token.primary, ...token.alternatives])
        if (reading) initials.add(reading[0])
    const context: IndexBuildContext = {
      sourceLength: source.name.length,
      tokens,
      effectiveTokens: tokens.filter((token) => token.literal || token.primary),
      initials,
      hasAlternatives: tokens.some((token) => token.alternatives.length > 0),
      hasHan: tokens.some((token) => token.han),
      pureHan: tokens.every((token) => token.han)
    }
    const entries: IndexedName['entries'] = []
    for (const matcher of this.matchers) {
      const index = matcher.build(source, context)
      if (index !== null) entries.push({ matcher, index })
    }
    return { entries }
  }

  /**
   * 调度已绑定策略并选择最佳路径，注册顺序不参与排名。
   * @param index 当前名称的内部索引
   * @param query 查询快照
   * @param budget 全查询共享读音预算
   * @param purpose 搜索或完整指令词触发
   * @returns 最佳命中；触发用途找到合法路径即可返回
   */
  match(
    index: IndexedName,
    query: PreparedQuery,
    budget: MatchBudget,
    purpose: NameMatchPurpose = 'search'
  ): NameMatch | null {
    if (!query.text) return null
    const context: NameMatchContext = { scorer: this.scorer, budget, purpose }
    let best: NameMatch | null = null
    for (const entry of index.entries) {
      if (!entry.matcher.supports(query)) continue
      const candidate = entry.matcher.match(entry.index, query, context)
      if (!candidate) continue
      if (purpose === 'command-prefix') return candidate
      if (!best || compareNameMatches(candidate, best) < 0) best = candidate
    }
    if (best) best.ranges = mergeSourceRanges(best.ranges)
    return best
  }
}

/**
 * 显式组合六类默认表示；增加表示只需实现接口并注册。
 * @param scorer 可覆盖的统一评分器
 * @returns 默认名称匹配器注册表
 */
export function createDefaultNameMatcherRegistry(scorer = new NameScorer()): NameMatcherRegistry {
  return new NameMatcherRegistry(scorer)
    .register(new BaseMatcher())
    .register(new PinyinMatcher())
    .register(new PinyinInitialMatcher())
    .register(new MixedPinyinMatcher())
    .register(new MixedInitialMatcher())
    .register(new EnglishInitialMatcher())
}
