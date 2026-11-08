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

/** 纯中文名称的完整拼音策略。 */
export class PinyinMatcher implements NameMatcher<RepresentationIndex> {
  readonly id = 'py'
  private readonly algorithm = new RepresentationMatcher()
  /**
   * 只为适用名称建立表示，备用读音引用同一份图。
   * @param _source 名称来源；该策略直接使用共享 token
   * @param context 共享读音与原文数据
   * @returns 表示索引；名称不适用时为空
   */
  build(_source: NameSource, context: IndexBuildContext): RepresentationIndex | null {
    if (!context.hasHan || !context.pureHan) return null
    return {
      sourceLength: context.sourceLength,
      fields: [tokenField(context.tokens, this.id, true)],
      pronunciation: context
    }
  }
  /**
   * 拼音表示只处理含拉丁字母的输入。
   * @param query 查询快照
   * @returns 是否适用
   */
  supports(query: PreparedQuery): boolean {
    return query.hasRoman
  }
  /**
   * 组合连续表示和完整拼音备用路径。
   * @param index 表示索引
   * @param query 查询快照
   * @param context 匹配上下文
   * @returns 最佳命中或空
   */
  match(
    index: RepresentationIndex,
    query: PreparedQuery,
    context: NameMatchContext
  ): NameMatch | null {
    return this.algorithm.match(index, query, context, this.id, false)
  }
}
