/**
 * 根据主进程返回的显示区间生成安全 HTML，不在页面计算拼音。
 * @param text 显示名称
 * @param query 无区间时使用的子串显示词
 * @param ranges 主进程计算的包含两端的区间
 * @returns 转义后的高亮 HTML
 */
export function highlightMatch(
  text: string,
  query?: string,
  ranges?: Array<[number, number]>
): string {
  // 显式空区间代表无法准确映射，不能回退猜测名称中的高亮位置。
  if (!ranges) return highlightSubstring(text, query)
  let html = ''
  let offset = 0
  for (const [start, end] of ranges) {
    html += escapeHtml(text.slice(offset, start))
    html += '<mark class="highlight">' + escapeHtml(text.slice(start, end + 1)) + '</mark>'
    offset = end + 1
  }
  return html + escapeHtml(text.slice(offset))
}

/**
 * 简单子串高亮：在文本中高亮搜索查询的子串匹配
 * 适用于未提供原文映射的动态插件结果。
 * @param text 原始文本
 * @param query 搜索查询
 * @returns 包含高亮标签的HTML字符串
 */
export function highlightSubstring(text: string, query?: string): string {
  if (!query || !query.trim()) {
    return escapeHtml(text)
  }

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase().trim()
  const idx = lowerText.indexOf(lowerQuery)

  if (idx === -1) {
    return escapeHtml(text)
  }

  const before = escapeHtml(text.substring(0, idx))
  const matched = escapeHtml(text.substring(idx, idx + lowerQuery.length))
  const after = escapeHtml(text.substring(idx + lowerQuery.length))
  return before + '<mark class="highlight">' + matched + '</mark>' + after
}

/**
 * 转义 HTML 特殊字符，防止显示内容注入标签。
 * @param text 未转义文本
 * @returns 可安全嵌入 HTML 的文本
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
