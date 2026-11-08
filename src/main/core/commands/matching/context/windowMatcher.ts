import type { CommandMatchContext } from '../../../../../shared/commandService'
import type { ContextMatcher } from '../contracts'
import {
  compileRulePattern,
  validateRuleFields,
  InvalidContextRuleError
} from '../contextRuleValidation'
import { matchesWindowInput, type WindowCmdLike } from '../../../../../shared/commandContextShared'

/** window 内容规则策略；只负责内容资格，不参与名称评分。 */
export class WindowContextMatcher implements ContextMatcher<WindowCmdLike, RegExp | null> {
  readonly type = 'window'
  /**
   * 验证外部规则字段并预编译表达式，查询阶段不重复校验。
   * @param rule 原始规则
   * @returns 可复用表达式或空
   * @throws 字段形状或表达式不合法时抛出配置错误
   */
  compile(rule: WindowCmdLike): RegExp | null {
    if (!rule.match || typeof rule.match !== 'object' || Array.isArray(rule.match)) {
      throw new InvalidContextRuleError('窗口规则缺少 match 条件对象')
    }
    validateRuleFields(rule.match, { app: 'strings', title: 'string', className: 'strings' })
    return compileRulePattern(rule.match.title, { allowPlainString: true })
  }
  /**
   * 按现有共享语义验证内容快照。
   * @param rule 原始规则
   * @param compiled 预编译产物
   * @param context 内容快照
   * @returns 是否满足规则
   */
  matches(rule: WindowCmdLike, compiled: RegExp | null, context: CommandMatchContext): boolean {
    return matchesWindowInput(context.windowInfo, rule, {
      preserveTitleFlags: true,
      titleRegex: compiled
    })
  }
}
