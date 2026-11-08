import { pinyin, polyphonic } from 'pinyin-pro'
import { normalizeSearchText } from './searchNormalization'
import type { PronunciationToken } from './searchTypes'

/**
 * 生成上下文读音和每字备用读音，同时保存原文 UTF-16 位置。
 * @param name 显示名称
 * @param characterCache 当前目录复用的汉字读音缓存
 * @returns 原文对齐的读音 token；转换失败时保留字面搜索
 */
export function createPronunciation(
  name: string,
  characterCache: Map<string, string[]>
): PronunciationToken[] {
  let primary = new Map<number, string>()
  try {
    const rows = pinyin(name, { toneType: 'none', type: 'all', v: true })
    // 先验证库输出与原文对齐，不能假设非中文片段总是单字符。
    if (rows.map((row) => row.origin).join('') === name) {
      let offset = 0
      for (const row of rows) {
        if (row.isZh) primary.set(offset, row.pinyin)
        offset += row.origin.length
      }
    }
  } catch {
    primary = new Map()
  }
  const tokens: PronunciationToken[] = []
  let offset = 0
  for (const char of name) {
    const literal = normalizeSearchText(char)
    const han = /\p{Script=Han}/u.test(char)
    const reading = primary.get(offset) || literal
    let alternatives: string[] = []
    if (han && primary.has(offset)) {
      let readings = characterCache.get(char)
      if (!readings) {
        try {
          readings = [...new Set(polyphonic(char, { toneType: 'none', type: 'array', v: true })[0])]
        } catch {
          readings = []
        }
        characterCache.set(char, readings)
      }
      alternatives = readings.filter((value) => value !== reading)
    }
    tokens.push({
      literal,
      primary: reading,
      alternatives,
      range: [offset, offset + char.length - 1],
      han
    })
    offset += char.length
  }
  return tokens
}
