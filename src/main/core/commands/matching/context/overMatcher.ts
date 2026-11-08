import type { CommandMatchContext } from '../../../../../shared/commandService'
import type { ContextMatcher } from '../contracts'
import { compileRulePattern, validateRuleFields } from '../contextRuleValidation'
import { matchesOverText, type OverCmdLike } from '../../../../../shared/commandContextShared'

/** over 内容规则策略；只负责内容资格，不参与名称评分。 */
export class OverContextMatcher implements ContextMatcher<OverCmdLike, RegExp | null> {
  readonly type = 'over'
  /**
   * 验证外部规则字段并预编译表达式，查询阶段不重复校验。
   * @param rule 原始规则
   * @returns 可复用表达式或空
   * @throws 字段形状或表达式不合法时抛出配置错误
   */
  compile(rule: OverCmdLike): RegExp | null {
    validateRuleFields(rule, { exclude: 'string', minLength: 'number', maxLength: 'number' })
    return compileRulePattern(rule.exclude, { allowPlainString: true })
  }
  /**
   * 按现有共享语义验证内容快照。
   * @param rule 原始规则
   * @param compiled 预编译产物
   * @param context 内容快照
   * @returns 是否满足规则
   */
  matches(rule: OverCmdLike, compiled: RegExp | null, context: CommandMatchContext): boolean {
    return (
      !context.pastedImage &&
      !context.pastedFiles &&
      matchesOverText(context.pastedText || context.searchQuery, rule, {
        useExclude: true,
        preserveExcludeFlags: true,
        allowPlainExclude: true,
        compiledExclude: compiled
      })
    )
  }
}
