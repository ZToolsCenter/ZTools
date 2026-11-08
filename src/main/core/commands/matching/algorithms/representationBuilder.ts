import { normalizeSearchText } from '../../searchNormalization'
import type {
  PronunciationToken,
  SearchField,
  SearchFieldKind,
  SourceRange
} from '../../searchTypes'

/**
 * 为 token 序列生成一个带字符映射和边界的字段。
 * @param tokens 原文 token
 * @param kind 搜索表示类型
 * @param compact 是否忽略空白
 * @returns 预处理字段
 */
export function tokenField(
  tokens: PronunciationToken[],
  kind: SearchFieldKind,
  compact: boolean
): SearchField {
  let text = ''
  const ranges: SourceRange[] = []
  const boundaries: number[] = []
  // 字段展开与原文映射同时生成，字节位图保留边界而不重复分配 Set。
  for (const token of tokens) {
    const value =
      kind === 'base'
        ? token.literal || ' '
        : token.han
          ? kind === 'pyfirst' || kind === 'pyfirst+'
            ? token.primary[0]
            : token.primary
          : token.literal || ' '
    if (compact && !value.trim()) continue
    if (!text.length && !value.trim()) continue
    if (!compact && value === ' ' && text.endsWith(' ')) continue
    boundaries[text.length] = (boundaries[text.length] || 0) | 1
    text += value
    for (let i = 0; i < value.length; i++) ranges.push(token.range)
    boundaries[text.length] = (boundaries[text.length] || 0) | 2
  }
  const trimmed = text.trimEnd()
  return {
    kind,
    text: trimmed,
    ranges: ranges.slice(0, trimmed.length),
    boundaries: Uint8Array.from(boundaries),
    compact
  }
}

/**
 * 从英文词组和驼峰生成缩写，保留名称中的中文和符号。
 * @param name 显示名称
 * @returns 可映射的缩写字段；无词组时为空
 */
export function englishField(name: string): SearchField | undefined {
  const normalized = name.replace(/[\uFF01-\uFF5E]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  )
  const pieces: Array<{ value: string; range: SourceRange }> = []
  let cursor = 0
  let abbreviated = false
  // 按英文词组和驼峰缩写，其余片段保留原文，避免缩写跨过中文或符号。
  for (const run of normalized.matchAll(/[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*/g)) {
    for (let i = cursor; i < run.index!; i++) {
      const value = normalizeSearchText(normalized[i])
      if (value) pieces.push({ value, range: [i, i] })
    }
    const words = [...run[0].matchAll(/[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g)]
    if (words.length > 1) {
      abbreviated = true
      for (const word of words) {
        const value = /^\d+$/.test(word[0]) ? word[0] : word[0][0].toLowerCase()
        const start = run.index! + word.index!
        for (let i = 0; i < value.length; i++)
          pieces.push({ value: value[i], range: [start + i, start + i] })
      }
    } else {
      for (let i = 0; i < run[0].length; i++) {
        const value = normalizeSearchText(run[0][i])
        if (value) pieces.push({ value, range: [run.index! + i, run.index! + i] })
      }
    }
    cursor = run.index! + run[0].length
  }
  for (let i = cursor; i < normalized.length; i++) {
    const value = normalizeSearchText(normalized[i])
    if (value) pieces.push({ value, range: [i, i] })
  }
  if (!abbreviated) return undefined
  return {
    kind: 'enfirst',
    text: pieces.map((piece) => piece.value).join(''),
    ranges: pieces.map((piece) => piece.range),
    boundaries: new Uint8Array(pieces.length + 1).fill(3),
    compact: true
  }
}
