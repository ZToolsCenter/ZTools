import { compareNameMatches } from '../../searchRanking'
import type { NameMatch } from '../../searchTypes'
import type { NameMatchContext, PreparedQuery, RepresentationIndex } from '../contracts'
import { ContinuousFieldMatcher } from '../algorithms/continuousFieldMatcher'
import { PronunciationPathMatcher } from '../algorithms/pronunciationPathMatcher'

/** 表示策略通过组合复用算法，不为每个名称创建匹配器对象。 */
export class RepresentationMatcher {
  private readonly continuous = new ContinuousFieldMatcher()
  private readonly paths = new PronunciationPathMatcher()

  /**
   * 先查连续字段，再按评分上界决定是否展开备用路径。
   * @param index 表示索引
   * @param query 已准备查询
   * @param context 统一匹配上下文
   * @param id 表示身份
   * @param first 是否使用中文首字母路径
   * @returns 该表示的最佳命中
   */
  match(
    index: RepresentationIndex,
    query: PreparedQuery,
    context: NameMatchContext,
    id: string,
    first = false
  ): NameMatch | null {
    let best: NameMatch | null = null
    for (const field of index.fields) {
      const candidate = this.continuous.match(field, query, index.sourceLength, context)
      if (candidate && (!best || compareNameMatches(candidate, best) < 0)) best = candidate
      if (best && context.purpose === 'command-prefix') return best
    }
    // 用途约束先由算法验证；剪枝上界只决定搜索工作量，不决定触发资格。
    if (
      index.pronunciation &&
      (!best || best.score < context.scorer.upperBound(id, index.sourceLength))
    ) {
      const candidate = this.paths.match(index.pronunciation, query, first, id, context)
      if (candidate && (!best || compareNameMatches(candidate, best) < 0)) best = candidate
    }
    return best
  }
}
