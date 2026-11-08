import type { CommandMatchContext } from '../../../../shared/commandService'
import type { ContextMatcher } from './contracts'
import { RegexContextMatcher } from './context/regexMatcher'
import { OverContextMatcher } from './context/overMatcher'
import { ImageContextMatcher } from './context/imageMatcher'
import { FilesContextMatcher } from './context/filesMatcher'
import { WindowContextMatcher } from './context/windowMatcher'
import { InvalidContextRuleError } from './contextRuleValidation'

export interface PreparedContextRule {
  /**
   * 验证一个快照，复用目录发布时绑定的规则和编译产物。
   * @param context 内容及窗口输入快照
   * @returns 是否符合规则
   */
  matches(context: CommandMatchContext): boolean
}

/** 内容注册表在目录建立时编译规则，查询和执行复验使用同一产物。 */
export class ContextMatcherRegistry {
  private readonly matchers = new Map<string, (rule: { type: string }) => PreparedContextRule>()

  /**
   * 绑定规则与编译产物类型，类型擦除限制在注册边界。
   * @param matcher 内容规则策略
   * @returns 当前注册表
   * @throws 类型重复注册时抛错
   */
  register<TRule extends { type: string }, TCompiled>(
    matcher: ContextMatcher<TRule, TCompiled>
  ): this {
    if (this.matchers.has(matcher.type)) throw new Error('重复内容匹配器: ' + matcher.type)
    this.matchers.set(matcher.type, (input) => {
      const rule = input as TRule
      const compiled = matcher.compile(rule)
      return { matches: (context) => matcher.matches(rule, compiled, context) }
    })
    return this
  }

  /**
   * 编译一次外部规则，已知配置错误只拒绝该规则并记录一次诊断。
   * @param rule 原始内容规则
   * @returns 可重复验证的规则；未知类型或无效配置始终不匹配
   * @throws 匹配器自身的编译实现异常继续抛出，避免伪装成搜索未命中
   */
  prepare<TRule extends { type: string }>(rule: TRule): PreparedContextRule {
    const prepare = this.matchers.get(rule.type)
    if (!prepare) {
      console.warn('[Search] 未注册的内容规则类型:', rule.type)
      return { matches: () => false }
    }
    // 仅隔离明确识别的第三方配置错误；查询时不再逐次吞掉内部实现异常。
    try {
      return prepare(rule)
    } catch (error) {
      if (!(error instanceof InvalidContextRuleError)) throw error
      console.warn('[Search] 无效内容规则:', rule, error.message)
      return { matches: () => false }
    }
  }
}

/**
 * 组合默认五种内容规则策略。
 * @returns 默认内容注册表
 */
export function createDefaultContextMatcherRegistry(): ContextMatcherRegistry {
  return new ContextMatcherRegistry()
    .register(new RegexContextMatcher())
    .register(new OverContextMatcher())
    .register(new ImageContextMatcher())
    .register(new FilesContextMatcher())
    .register(new WindowContextMatcher())
}
