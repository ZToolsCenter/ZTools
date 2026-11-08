import type { CommandMatchContext } from '../../../../../shared/commandService'
import type { ContextMatcher } from '../contracts'
type ImageRule = { type: 'img'; label?: string }

/** img 内容规则策略；只负责内容资格，不参与名称评分。 */
export class ImageContextMatcher implements ContextMatcher<ImageRule, RegExp | null> {
  readonly type = 'img'
  /**
   * 预编译目录规则，无效表达式保存为 null。
   * @param _rule 原始规则
   * @returns 可复用表达式或空
   */
  compile(_rule: ImageRule): RegExp | null {
    return null
  }
  /**
   * 按现有共享语义验证内容快照。
   * @param _rule 原始规则
   * @param _compiled 预编译产物
   * @param context 内容快照
   * @returns 是否满足规则
   */
  matches(_rule: ImageRule, _compiled: RegExp | null, context: CommandMatchContext): boolean {
    return !!context.pastedImage
  }
}
