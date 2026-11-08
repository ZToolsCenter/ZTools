import { compareNameMatches } from '../../searchRanking'
import type { NameMatch } from '../../searchTypes'
import type { IndexBuildContext, NameMatchContext, PreparedQuery } from '../contracts'

interface TokenPath {
  end: number
  partial: boolean
  alternatives: number
}

/**
 * 连续匹配多音字或中英文混合输入，记忆化合并重复读音状态。
 * @param index 名称的共享读音图
 * @param query 无空格的查询
 * @param first 是否使用中文首字母模式
 * @param field 当前匹配表示身份
 * @param context 统一评分、共享预算与用途
 * @returns 最佳路径或空；预算耗尽时记录降级
 */
function matchTokens(
  index: IndexBuildContext,
  query: string,
  first: boolean,
  field: string,
  context: NameMatchContext
): NameMatch | null {
  const { budget, scorer, purpose } = context
  const tokens = index.effectiveTokens
  if (query.length > 128 || tokens.length > 512 || budget.remaining <= 0) {
    budget.degraded++
    return null
  }
  const memo = new Map<number, TokenPath | null>()
  let visited = 0
  let exhausted = false
  /**
   * 查找给定 token 与查询位置之后的最佳连续路径。
   * @param tokenIndex 下一个原文 token
   * @param offset 尚未消费的查询位置
   * @param leading 整条路径是否从名称开头进入
   * @returns 可达结束位置与备用读音数量
   */
  function visit(tokenIndex: number, offset: number, leading: boolean): TokenPath | null {
    // 完整触发用途只接受从头消费整个名称，余下输入必须满足参数边界。
    if (purpose === 'command-prefix' && tokenIndex === tokens.length) {
      const next = query[offset]
      const endsHan = tokens[tokens.length - 1]?.han
      return !next || !/[a-z0-9]/i.test(next) || (endsHan && /\p{Script=Han}/u.test(next))
        ? { end: tokenIndex, partial: false, alternatives: 0 }
        : null
    }
    if (offset === query.length)
      return purpose === 'search' ? { end: tokenIndex, partial: false, alternatives: 0 } : null
    if (tokenIndex >= tokens.length) return null
    const key = (tokenIndex * (query.length + 1) + offset) * 2 + Number(leading)
    if (memo.has(key)) return memo.get(key)!
    // 状态预算是失败边界；常规字面和默认拼音结果始终保留。
    if (++visited > 4096 || --budget.remaining < 0) {
      exhausted = true
      return null
    }
    const token = tokens[tokenIndex]
    const choices = new Map<string, number>()
    for (const [value, alternate] of [
      [token.primary, 0],
      [token.literal, 0],
      ...token.alternatives.map((reading) => [reading, 1])
    ] as Array<[string, number]>) {
      const text = token.han && first && value !== token.literal ? value[0] : value
      if (text && !choices.has(text)) choices.set(text, alternate)
    }
    let best: TokenPath | null = null
    let bestScore = -Infinity
    for (const [value, alternate] of choices) {
      let path: TokenPath | null = null
      if (query.startsWith(value, offset)) {
        const suffix = visit(tokenIndex + 1, offset + value.length, leading)
        if (suffix) path = { ...suffix, alternatives: suffix.alternatives + alternate }
      } else if (purpose === 'search' && value.startsWith(query.slice(offset))) {
        path = { end: tokenIndex + 1, partial: true, alternatives: alternate }
      }
      if (path) {
        // 同一状态的字段、起点和长度相同；形态分仍参与选择，允许以后独立调权。
        const shape = leading
          ? path.end === tokens.length && !path.partial
            ? 'exact'
            : 'prefix'
          : 'contains'
        const score = scorer.pathScore(field, shape, path.partial, path.alternatives)
        if (score > bestScore) {
          best = path
          bestScore = score
        }
      }
    }
    memo.set(key, best)
    return best
  }
  let best: NameMatch | null = null
  for (
    let start = 0;
    start < (purpose === 'command-prefix' ? Math.min(1, tokens.length) : tokens.length) &&
    !exhausted;
    start++
  ) {
    // 起点首字符不匹配时跳过，避免为每个无关 token 建立状态与读音选择。
    const token = tokens[start]
    if (
      ![token.literal, token.primary, ...token.alternatives].some(
        (reading) => reading[0] === query[0]
      )
    )
      continue
    const path = visit(start, 0, start === 0)
    if (!path) continue
    const exact = start === 0 && path.end === tokens.length && !path.partial
    const candidate = scorer.score({
      shape: purpose === 'command-prefix' || exact ? 'exact' : start === 0 ? 'prefix' : 'contains',
      partial: path.partial,
      compact: false,
      position: token.range[0],
      length: index.sourceLength,
      field,
      alternatives: path.alternatives,
      ranges: tokens.slice(start, path.end).map((token) => token.range)
    })
    if (!best || compareNameMatches(candidate, best) < 0) best = candidate
  }
  if (exhausted) budget.degraded++
  return best
}

/** 多音字连续路径算法，完整拼音与首字母模式共用预算和评分服务。 */
export class PronunciationPathMatcher {
  /**
   * 只为可能命中且有新信息的查询展开读音路径。
   * @param index 名称共享读音图
   * @param query 已准备的输入
   * @param first 是否使用汉字首字母
   * @param field 表示身份
   * @param context 评分、预算与用途
   * @returns 最佳路径或空；预算不足时更新降级统计
   */
  match(
    index: IndexBuildContext,
    query: PreparedQuery,
    first: boolean,
    field: string,
    context: NameMatchContext
  ): NameMatch | null {
    // 参数长度不占命令词预算，避免长 payload 使有效备用读音触发失效。
    const text =
      context.purpose === 'command-prefix' ? query.romanText.split(' ', 1)[0] : query.romanCompact
    if (
      !query.hasRoman ||
      !index.initials.has(text[0]) ||
      (!index.hasAlternatives && !query.hasHan)
    )
      return null
    return matchTokens(index, text, first, field, context)
  }
}
