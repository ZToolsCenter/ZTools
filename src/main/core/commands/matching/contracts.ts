import type { CommandMatchContext } from '../../../../shared/commandService'
import type { MatchBudget, NameMatch, PronunciationToken, SearchField } from '../searchTypes'
import type { NameScorer } from '../searchRanking'

export interface NameSource {
  name: string
  acronym?: string
}

/** 一个名称的原文与读音数据，所有表示共用，不展开多音字组合。 */
export interface IndexBuildContext {
  sourceLength: number
  tokens: PronunciationToken[]
  effectiveTokens: PronunciationToken[]
  initials: Set<string>
  hasAlternatives: boolean
  hasHan: boolean
  pureHan: boolean
}

export interface PreparedQuery {
  text: string
  compact: string
  romanText: string
  romanCompact: string
  hasRoman: boolean
  hasHan: boolean
}

export type NameMatchPurpose = 'search' | 'command-prefix'

export interface NameMatchContext {
  scorer: NameScorer
  budget: MatchBudget
  purpose: NameMatchPurpose
}

export interface NameMatcher<TIndex> {
  readonly id: string
  /**
   * 为适用名称建立策略专用索引。
   * @param source 名称与扫描器兼容缩写
   * @param context 同名表示共用的读音图
   * @returns 索引或不适用时的 null
   */
  build(source: NameSource, context: IndexBuildContext): TIndex | null
  /**
   * 快速判断表示能否处理输入。
   * @param query 一次规范化的查询快照
   * @returns 是否需要调度该策略
   */
  supports(query: PreparedQuery): boolean
  /**
   * 产生命中事实并使用注入评分器选择路径。
   * @param index 由该策略建立的索引
   * @param query 查询快照
   * @param context 评分、预算和用途；command-prefix 只接受完整触发词
   * @returns 最佳合法命中或 null
   */
  match(index: TIndex, query: PreparedQuery, context: NameMatchContext): NameMatch | null
}

/** 内置表示的连续字段和可选读音图；同名实例共用图节点。 */
export interface RepresentationIndex {
  sourceLength: number
  fields: SearchField[]
  pronunciation?: IndexBuildContext
}

/** 编译产物可为 null；未编译状态由注册表是否存在条目区分。 */
export interface ContextMatcher<TRule extends { type: string }, TCompiled> {
  readonly type: TRule['type']
  /**
   * 编译目录规则，编译产物不参与名称排名。
   * @param rule 策略专用规则
   * @returns 可复用的编译产物
   */
  compile(rule: TRule): TCompiled
  /**
   * 验证输入的内容资格，不能改写输入快照。
   * @param rule 原始规则
   * @param compiled 目录建立时的编译产物
   * @param context 当前内容和窗口快照
   * @returns 是否满足内容资格
   */
  matches(rule: TRule, compiled: TCompiled, context: CommandMatchContext): boolean
}
