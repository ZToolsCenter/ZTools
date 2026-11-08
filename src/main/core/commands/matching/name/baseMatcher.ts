import type {
  NameMatcher,
  NameSource,
  IndexBuildContext,
  PreparedQuery,
  NameMatchContext,
  RepresentationIndex
} from '../contracts'
import type { NameMatch } from '../../searchTypes'
import { tokenField } from '../algorithms/representationBuilder'
import { RepresentationMatcher } from './representationMatcher'

/** 原文及去空格原文策略，保留源字符位置。 */
export class BaseMatcher implements NameMatcher<RepresentationIndex> {
  readonly id = 'base'
  private readonly algorithm = new RepresentationMatcher()
  /**
   * 生成原文表示，共用逐字 token。
   * @param _source 名称来源；该策略直接使用共享 token
   * @param context 共享索引构建数据
   * @returns 原文索引
   */
  build(_source: NameSource, context: IndexBuildContext): RepresentationIndex {
    const fields = [tokenField(context.tokens, this.id, false)]
    const compact = tokenField(context.tokens, this.id, true)
    if (compact.text !== fields[0].text) fields.push(compact)
    return { sourceLength: context.sourceLength, fields }
  }
  /**
   * 原文接受所有非空查询。
   * @param query 查询快照
   * @returns 是否适用
   */
  supports(query: PreparedQuery): boolean {
    return !!query.text
  }
  /**
   * 按原文边界匹配。
   * @param index 原文索引
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
