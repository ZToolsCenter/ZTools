/**
 * 剪贴板文本格式化工具
 * 仅清理排版/空白，不改变实际文字内容
 */

/**
 * 格式化文本：
 * 1. 统一换行符（\r\n / \r → \n）
 * 2. 去除每行行尾多余空白
 * 3. 连续超过 2 个空行合并为 1 个空行
 * 4. 去除行内连续多个空格（保留缩进，仅压缩行中间的多余空格）
 * 5. 去除零宽字符和其他不可见控制字符
 * 6. 去除整体首尾空白
 */
export function formatText(text: string): string {
  // 1. 统一换行符
  let result = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // 2. 去除零宽字符和不可见控制字符（保留制表符和普通换行）
  // 去掉：零宽空格 U+200B、零宽非断行空格 U+FEFF、软连字符 U+00AD 等
  result = result.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2028\u2029]/g, '')

  // 3. 逐行处理
  const lines = result.split('\n')
  const processedLines = lines.map((line) => {
    const trimmed = line.trimEnd()
    const body = trimmed.trimStart()
    const indent = trimmed.slice(0, trimmed.length - body.length)
    return indent + body.replace(/ {2,}/g, ' ')
  })

  // 4. 合并连续超过 2 个的空行为 1 个
  result = processedLines.join('\n').replace(/\n{3,}/g, '\n\n')

  // 5. 去除整体首尾空白
  result = result.trim()

  return result
}
