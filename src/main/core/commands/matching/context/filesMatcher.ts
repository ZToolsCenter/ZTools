import type { CommandMatchContext } from '../../../../../shared/commandService'
import type { ContextMatcher } from '../contracts'
import {
  compileRulePattern,
  validateRuleFields,
  InvalidContextRuleError
} from '../contextRuleValidation'
import { matchesFilesInput, type FilesCmdLike } from '../../../../../shared/commandContextShared'

/** files 内容规则策略；只负责内容资格，不参与名称评分。 */
export class FilesContextMatcher implements ContextMatcher<FilesCmdLike, RegExp | null> {
  readonly type = 'files'
  /**
   * 验证外部规则字段并预编译表达式，查询阶段不重复校验。
   * @param rule 原始规则
   * @returns 可复用表达式或空
   * @throws 字段形状或表达式不合法时抛出配置错误
   */
  compile(rule: FilesCmdLike): RegExp | null {
    validateRuleFields(rule, {
      match: 'string',
      extensions: 'strings',
      minLength: 'number',
      maxLength: 'number'
    })
    if (rule.fileType !== undefined && !['file', 'directory'].includes(rule.fileType)) {
      throw new InvalidContextRuleError('fileType 应为 file 或 directory')
    }
    return compileRulePattern(rule.match, { allowLiteral: true })
  }
  /**
   * 按现有共享语义验证内容快照。
   * @param rule 原始规则
   * @param compiled 预编译产物
   * @param context 内容快照
   * @returns 是否满足规则
   */
  matches(rule: FilesCmdLike, compiled: RegExp | null, context: CommandMatchContext): boolean {
    return (
      !!context.pastedFiles &&
      matchesFilesInput(context.pastedFiles, rule, {
        preserveFlags: true,
        allowPlainString: true,
        compiledRegex: compiled
      })
    )
  }
}
