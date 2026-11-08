import { normalizeSearchText } from '../searchNormalization'
import type { PreparedQuery } from './contracts'

/**
 * 一次性规范化输入，避免每个名称和每种表示重复扫描字符串。
 * @param input 原始搜索文本
 * @returns 可供所有匹配器复用的查询快照
 */
export function prepareQuery(input: string): PreparedQuery {
  const text = normalizeSearchText(input)
  const compact = text.replace(/\s/g, '')
  const romanText = text.replace(/ü/g, 'v')
  return {
    text,
    compact,
    romanText,
    romanCompact: romanText.replace(/\s/g, ''),
    hasRoman: /[a-zü]/i.test(text),
    hasHan: /\p{Script=Han}/u.test(text)
  }
}
