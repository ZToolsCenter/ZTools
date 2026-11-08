import type { SourceRange } from './searchTypes'

/**
 * 规范化字面搜索，保留有意义的标点。
 * @param text 原始文本
 * @returns 大小写、全角 ASCII 和空白统一后的文本
 */
export function normalizeSearchText(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 合并命中路径对应的 UTF-16 原文范围，忽略未映射的兼容缩写。
 * @param ranges 命中范围
 * @returns 有序、无重叠的高亮区间
 */
export function mergeSourceRanges(ranges: SourceRange[]): SourceRange[] {
  const sorted = ranges
    .filter(([start, end]) => start >= 0 && end >= start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: SourceRange[] = []
  for (const [start, end] of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end)
    else merged.push([start, end])
  }
  return merged
}
