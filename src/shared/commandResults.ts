/**
 * 合并同一执行目标的搜索表示，保留已经排在最前的名称。
 * @param results 已排序结果
 * @returns 去重结果
 */
export function deduplicateResults<
  T extends { type?: string; subType?: string; path: string; name: string; featureCode?: string }
>(results: T[]): T[] {
  const seen = new Set<string>()
  return results.filter((item) => {
    const path = item.path.replace(/\\/g, '/')
    const normalizedPath =
      /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path
    const key =
      item.type === 'plugin'
        ? JSON.stringify([item.path, item.featureCode])
        : item.type === 'direct' && item.subType === 'app'
          ? `app:${normalizedPath}`
          : JSON.stringify([item.path, item.name])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
