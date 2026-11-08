import { compareNameMatches } from '../../searchRanking'
import type { NameMatch, SearchField } from '../../searchTypes'
import type { NameMatchContext, PreparedQuery } from '../contracts'

/** 连续字段匹配算法，负责边界与原文映射，评分由上下文注入。 */
export class ContinuousFieldMatcher {
  /**
   * 在预处理字段里查找最佳连续命中或完整触发词。
   * @param field 预处理表示
   * @param query 已准备的输入
   * @param sourceLength 显示名称的原始长度
   * @param context 评分器、预算与匹配用途
   * @returns 最佳命中；没有合法边界时为空
   */
  match(
    field: SearchField,
    query: PreparedQuery,
    sourceLength: number,
    context: NameMatchContext
  ): NameMatch | null {
    const original = field.kind === 'base'
    const q =
      context.purpose === 'command-prefix'
        ? original
          ? query.text
          : query.romanText
        : original
          ? field.compact
            ? query.compact
            : query.text
          : field.compact
            ? query.romanCompact
            : query.romanText
    if (!q || !field.text) return null
    // 触发校验先验证完整表示与参数边界，完全独立于排名分数。
    if (context.purpose === 'command-prefix') {
      const next = q[field.text.length]
      if (
        !q.startsWith(field.text) ||
        (next && /[a-z0-9]/i.test(next) && !/\p{Script=Han}$/u.test(field.text))
      )
        return null
      return context.scorer.score({
        shape: 'exact',
        partial: false,
        compact: original && field.compact,
        position: 0,
        length: sourceLength,
        field: field.kind,
        alternatives: 0,
        ranges: field.ranges.slice()
      })
    }
    let position = field.text.indexOf(q)
    let best: NameMatch | null = null
    while (position >= 0) {
      if (original || field.boundaries[position] & 1) {
        const end = position + q.length
        const candidate = context.scorer.score({
          shape: position === 0 ? (end === field.text.length ? 'exact' : 'prefix') : 'contains',
          partial: !(field.boundaries[end] & 2),
          compact: original && field.compact,
          position: field.ranges[position]?.[0] ?? position,
          length: sourceLength,
          field: field.kind,
          alternatives: 0,
          ranges: field.ranges.slice(position, end)
        })
        if (!best || compareNameMatches(candidate, best) < 0) best = candidate
        // 上界包含长度与字段权重，调整形态分后也不会跳过更优位置。
        if (candidate.score >= context.scorer.upperBound(field.kind, sourceLength)) return best
      }
      position = field.text.indexOf(q, position + 1)
    }
    return best
  }
}
