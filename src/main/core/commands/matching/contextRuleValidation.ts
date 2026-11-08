import { parseMatchPattern } from '../../../../shared/commandContextShared'

/** 已知的第三方规则配置错误；与匹配器实现异常区分。 */
export class InvalidContextRuleError extends Error {}

type FieldKind = 'string' | 'number' | 'strings'

/**
 * 在目录编译边界验证外部配置，运行匹配时直接使用已确认的字段。
 * @param rule 外部规则或窗口条件对象
 * @param fields 需要验证的可选字段及形状
 * @returns 无返回值
 * @throws 已提供的字段类型不合法时抛出配置错误
 */
export function validateRuleFields(rule: object, fields: Record<string, FieldKind>): void {
  for (const [key, kind] of Object.entries(fields)) {
    const value = (rule as Record<string, unknown>)[key]
    if (value === undefined) continue
    const valid =
      kind === 'strings'
        ? Array.isArray(value) && value.every((item) => typeof item === 'string')
        : kind === 'number'
          ? typeof value === 'number' && Number.isFinite(value) && value >= 0
          : typeof value === 'string'
    if (!valid) throw new InvalidContextRuleError(`字段 ${key} 应为 ${kind}`)
  }
}

/**
 * 预编译规则表达式，外部无效表达式只在目录发布时诊断一次。
 * @param pattern 原始表达式
 * @param options 是否接受普通正则字符串或文件名的字面包含条件
 * @returns 已编译正则，未配置或合法字面条件时为 null
 * @throws 已提供的表达式无法编译时抛出配置错误
 */
export function compileRulePattern(
  pattern: string | undefined,
  options: { allowPlainString?: boolean; allowLiteral?: boolean } = {}
): RegExp | null {
  if (!pattern) return null
  const compiled = parseMatchPattern(pattern, {
    preserveFlags: true,
    allowPlainString: options.allowPlainString
  })
  if (compiled) return compiled
  // 文件规则历史上允许字面文件名包含条件，不把普通字符串改成正则。
  if (options.allowLiteral && !pattern.startsWith('/')) return null
  throw new InvalidContextRuleError('无效匹配表达式: ' + pattern)
}
