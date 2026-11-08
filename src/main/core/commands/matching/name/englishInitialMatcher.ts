import type {
  NameMatcher,
  NameSource,
  IndexBuildContext,
  PreparedQuery,
  NameMatchContext,
  RepresentationIndex
} from '../contracts'
import type { NameMatch } from '../../searchTypes'
import { englishField, tokenField } from '../algorithms/representationBuilder'
import { RepresentationMatcher } from './representationMatcher'
import { normalizeSearchText } from '../../searchNormalization'
/** 英文词组缩写策略，同时保留扫描器提供的兼容缩写。 */
export class EnglishInitialMatcher implements NameMatcher<RepresentationIndex> {
  readonly id = 'enfirst'
  private readonly algorithm = new RepresentationMatcher()
  /**
   * 生成英文词组缩写，兼容缩写不猜测原文映射。
   * @param source 名称与扫描器缩写
   * @param context 共享构建数据
   * @returns 缩写索引；没有缩写时为空
   */
  build(source: NameSource, context: IndexBuildContext): RepresentationIndex | null {
    const english = englishField(source.name)
    const fields = english ? [english] : []
    const acronym = normalizeSearchText(source.acronym || '')
    // 扫描器缩写没有可信字符映射，保留空高亮。
    const existing = new Set(fields.map((field) => field.text))
    if (acronym) {
      existing.add(tokenField(context.tokens, 'base', false).text)
      existing.add(tokenField(context.tokens, 'base', true).text)
      if (context.hasHan) {
        existing.add(tokenField(context.tokens, context.pureHan ? 'py' : 'py+', true).text)
        existing.add(
          tokenField(context.tokens, context.pureHan ? 'pyfirst' : 'pyfirst+', true).text
        )
      }
    }
    if (acronym && !existing.has(acronym)) {
      fields.push({
        kind: this.id,
        text: acronym,
        ranges: [],
        compact: false,
        boundaries: new Uint8Array(acronym.length + 1).fill(3)
      })
    }
    return fields.length ? { sourceLength: context.sourceLength, fields } : null
  }
  /**
   * 缩写表示只处理含拉丁字母的输入。
   * @param query 查询快照
   * @returns 是否适用
   */
  supports(query: PreparedQuery): boolean {
    return query.hasRoman
  }
  /**
   * 连续匹配词组缩写。
   * @param index 缩写索引
   * @param query 查询快照
   * @param context 匹配上下文
   * @returns 最佳命中或空
   */
  match(
    index: RepresentationIndex,
    query: PreparedQuery,
    context: NameMatchContext
  ): NameMatch | null {
    return this.algorithm.match(index, query, context, this.id)
  }
}
