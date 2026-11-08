import type { CommandMatchContext } from '../../../../../shared/commandService'
import type { ContextMatcher } from '../contracts'
import { compileRulePattern, validateRuleFields } from '../contextRuleValidation'
import { matchesRegexText, type RegexCmdLike } from '../../../../../shared/commandContextShared'

/** regex 内容规则策略；只负责内容资格，不参与名称评分。 */
export class RegexContextMatcher implements ContextMatcher<RegexCmdLike, RegExp | null> {
  readonly type = 'regex'
  /**
   * 验证外部规则字段并预编译表达式，查询阶段不重复校验。
   * @param rule 原始规则
   * @returns 可复用表达式或空
   * @throws 字段形状或表达式不合法时抛出配置错误
   */
  compile(rule: RegexCmdLike): RegExp | null {
    validateRuleFields(rule, { match: 'string', regex: 'string', minLength: 'number' })
    return compileRulePattern(rule.match ?? rule.regex)
  }
  /**
   * 按现有共享语义验证内容快照。
   * @param rule 原始规则
   * @param compiled 预编译产物
   * @param context 内容快照
   * @returns 是否满足规则
   */
  matches(rule: RegexCmdLike, compiled: RegExp | null, context: CommandMatchContext): boolean {
    return (
      !context.pastedImage &&
      !context.pastedFiles &&
      matchesRegexText(context.pastedText || context.searchQuery, rule, {
        preserveFlags: true,
        compiledRegex: compiled
      })
    )
  }
}
