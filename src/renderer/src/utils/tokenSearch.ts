/**
 * 基于分词的模糊搜索。
 *
 * 把 command.name 编码（literal / pinyin）后切成 tokens，
 * 再把 query 按 MECE 模式（精确 / multi tokens 连续-非连续 × 全词-首字母或全词-词首 /
 * single token 全词-首字母-词首子串-…）对齐到 tokens 上，按模式精度打分排序。
 *
 * 通过 `matchInsideWord` 选项开启 single token 的「词首子序列、词内/词尾子串」2 种噪音模式。
 * pinyin 编码只允许 whole / head 两种 chunk class（音节必须完整）。
 */
import { pinyin } from 'pinyin-pro'

// ===== 对外类型 =====

export interface MatchInfo {
  indices: Array<[number, number]>
  value: string
  key: string
}

export interface TokenSearchOptions {
  matchInsideWord: boolean
}

// 命中起始 token 为 name 首词时追加 -at-start
type AtStartAwarePattern =
  | 'single-whole'
  | 'single-head'
  | 'single-prefix'
  | 'single-prefix-seq'
  | 'multi-consecutive-whole'
  | 'multi-consecutive-head-or-whole'
  | 'multi-consecutive-prefix'
  | 'multi-nonconsecutive-whole'
  | 'multi-nonconsecutive-head-or-whole'
  | 'multi-nonconsecutive-prefix'
  | 'multi-fallback'

// 不区分 at-start 的 pattern
type AtStartNeutralPattern = 'exact' | 'single-infix-substr' | 'single-infix-seq'

export type TokenPattern =
  | AtStartNeutralPattern
  | AtStartAwarePattern
  | `${AtStartAwarePattern}-at-start`

export interface TokenSearchOutcome {
  score: number
  matches: MatchInfo[]
  matchType: 'name'
  pattern: TokenPattern
}

export interface TokenSearchEntry {
  name: string
  type?: string
  subType?: string
  [k: string]: unknown
}

// ===== 内部类型 =====

type ChunkClass = 'whole' | 'head' | 'prefix' | 'prefix-seq' | 'infix-substr' | 'infix-seq'

interface Encoded {
  text: string
  // encoded.text[i] 在原 name 中的索引（用于把命中位置反推回 name 做高亮）
  mapToOriginal: number[]
}

interface Chunk {
  tokenIdx: number
  // 在 token 内的字符位置（升序），非连续子序列也允许
  positions: number[]
}

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/
const ASCII_LETTER_RE = /[A-Za-z]/
const DELIM_RE = /[\s\u3000!-/:-@[-`{-~]/
const MAX_QUERY_LENGTH = 32

// ===== 编码 =====

function encodeLiteral(name: string): Encoded {
  const mapToOriginal: number[] = new Array(name.length)
  for (let i = 0; i < name.length; i++) mapToOriginal[i] = i
  return { text: name, mapToOriginal }
}

function encodePinyin(name: string): Encoded {
  let text = ''
  const mapToOriginal: number[] = []
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]
    if (CJK_RE.test(ch)) {
      let syl = ''
      try {
        syl = pinyin(ch, { toneType: 'none', type: 'string' }) as string
      } catch {
        syl = ''
      }
      // 多音字可能返回空格分隔音节，直接拼接成一个 token
      syl = (syl || ch).replace(/\s+/g, '').toLowerCase()
      for (const p of syl) {
        text += p
        mapToOriginal.push(i)
      }
      // 音节后补一个空格做分隔，方便后续分词
      text += ' '
      mapToOriginal.push(i)
    } else {
      text += ch
      mapToOriginal.push(i)
    }
  }
  return { text, mapToOriginal }
}

export function encodeName(
  name: string,
  encoder: 'literal' | 'pinyin'
): { text: string; mapToOriginal: number[] } {
  return encoder === 'literal' ? encodeLiteral(name) : encodePinyin(name)
}

// ===== 分词 =====

/** 驼峰切分：lower→Upper 断开；Upper→Upper→lower 在第二个 Upper 前断开（VS|Code、HTTP|Server）。 */
function splitCamel(word: string): string[] {
  if (!word) return []
  const parts: string[] = []
  let start = 0
  for (let i = 1; i < word.length; i++) {
    const prev = word[i - 1]
    const curr = word[i]
    const lowerPrev = prev >= 'a' && prev <= 'z'
    const upperPrev = prev >= 'A' && prev <= 'Z'
    const upperCurr = curr >= 'A' && curr <= 'Z'
    const lowerNext = i + 1 < word.length && word[i + 1] >= 'a' && word[i + 1] <= 'z'
    if (lowerPrev && upperCurr) {
      parts.push(word.slice(start, i))
      start = i
    } else if (upperPrev && upperCurr && lowerNext) {
      parts.push(word.slice(start, i))
      start = i
    }
  }
  parts.push(word.slice(start))
  return parts
}

export function tokenize(encoded: string): string[] {
  return tokenizeInternal(encoded).tokens
}

function tokenizeInternal(encoded: string): { tokens: string[]; starts: number[] } {
  const tokens: string[] = []
  const starts: number[] = []
  let run = ''
  let runStart = -1
  const flush = (): void => {
    if (!run) return
    const parts = splitCamel(run)
    let offset = 0
    for (const p of parts) {
      if (p) {
        tokens.push(p)
        starts.push(runStart + offset)
        offset += p.length
      }
    }
    run = ''
    runStart = -1
  }
  for (let i = 0; i < encoded.length; ) {
    const cp = encoded.codePointAt(i)!
    const size = cp > 0xffff ? 2 : 1
    const ch = encoded.substr(i, size)
    if (DELIM_RE.test(ch)) {
      flush()
    } else if (ASCII_LETTER_RE.test(ch)) {
      if (run === '') runStart = i
      run += ch
    } else {
      // 数字、CJK、世界各语言字母：每个码点单独成 token
      flush()
      tokens.push(ch)
      starts.push(i)
    }
    i += size
  }
  flush()
  return { tokens, starts }
}

// ===== 对齐 =====

/** [off, off+1, …, off+n-1]。 */
function range(off: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => off + i)
}

/** 在 tok 中从 minStart 起按顺序匹配 seg 的每个字符（子序列）。失败返回 null。 */
function subseq(seg: string, tok: string, minStart: number): number[] | null {
  const positions: number[] = []
  let p = minStart
  for (let i = 0; i < seg.length; i++) {
    const next = tok.indexOf(seg[i], p)
    if (next < 0) return null
    positions.push(next)
    p = next + 1
  }
  return positions
}

/** 词首连续命中：tok 正好等于 seg（whole）或以 seg 开头（head / prefix）。 */
function matchSingleAtHead(seg: string, tokens: string[], startTok: number): Chunk[] | null {
  for (let t = startTok; t < tokens.length; t++) {
    const tok = tokens[t].toLowerCase()
    if (tok === seg) return [{ tokenIdx: t, positions: range(0, seg.length) }]
  }
  for (let t = startTok; t < tokens.length; t++) {
    const tok = tokens[t].toLowerCase()
    if (tok.length > seg.length && tok.substring(0, seg.length) === seg) {
      return [{ tokenIdx: t, positions: range(0, seg.length) }]
    }
  }
  return null
}

/**
 * 跨 token 对齐：首字符落在某个 token 词首，之后每个字符按以下优先级落点：
 *   1. 相邻 token 词首（保持 token 连续）
 *   2. 当前 token 连续延伸（构成 whole / prefix）
 *   3. 后续 token 词首（允许 gap）
 * 只走「词首 + 连续」两种落点；词内 infix / 子序列完全交给 single-token 策略。
 */
function matchMultiDfs(seg: string, tokens: string[], startTok: number): Chunk[] | null {
  const find = (
    segIdx: number,
    tokIdx: number,
    charIdx: number,
    chunks: Chunk[]
  ): Chunk[] | null => {
    if (segIdx === seg.length) return chunks
    const target = seg[segIdx]
    const tok = tokens[tokIdx].toLowerCase()
    const last = chunks[chunks.length - 1]

    // 1. 相邻 token 词首（优先保持 token 连续，避免当前 token 贪心吞掉本该属于下一个词首的字符）
    if (tokIdx + 1 < tokens.length) {
      const nt = tokens[tokIdx + 1].toLowerCase()
      if (nt.length > 0 && nt[0] === target) {
        const r = find(segIdx + 1, tokIdx + 1, 1, [
          ...chunks,
          { tokenIdx: tokIdx + 1, positions: [0] }
        ])
        if (r) return r
      }
    }
    // 2. 当前 token 连续延伸
    if (last.tokenIdx === tokIdx && charIdx < tok.length && tok[charIdx] === target) {
      const extended: Chunk = { tokenIdx: tokIdx, positions: [...last.positions, charIdx] }
      const r = find(segIdx + 1, tokIdx, charIdx + 1, [...chunks.slice(0, -1), extended])
      if (r) return r
    }
    // 3. 后续 token 词首（允许 gap）
    for (let t = tokIdx + 2; t < tokens.length; t++) {
      const tk = tokens[t].toLowerCase()
      if (tk.length > 0 && tk[0] === target) {
        const r = find(segIdx + 1, t, 1, [...chunks, { tokenIdx: t, positions: [0] }])
        if (r) return r
      }
    }
    return null
  }

  for (let t = startTok; t < tokens.length; t++) {
    const tk = tokens[t].toLowerCase()
    if (tk.length > 0 && tk[0] === seg[0]) {
      const r = find(1, t, 1, [{ tokenIdx: t, positions: [0] }])
      if (r) return r
    }
  }
  return null
}

/**
 * single token 的 2 种噪音落点（均受 matchInsideWord 门控）：
 * 词内连续子串（infix-substr）、词首子序列（prefix-seq）。
 */
function matchSingleInsideWord(seg: string, tokens: string[], startTok: number): Chunk[] | null {
  // 词内连续子串
  for (let t = startTok; t < tokens.length; t++) {
    const tok = tokens[t].toLowerCase()
    for (let off = 1; off + seg.length <= tok.length; off++) {
      if (tok.substring(off, off + seg.length) === seg) {
        return [{ tokenIdx: t, positions: range(off, seg.length) }]
      }
    }
  }
  // 词首子序列
  for (let t = startTok; t < tokens.length; t++) {
    const tok = tokens[t].toLowerCase()
    if (tok.length > 0 && tok[0] === seg[0]) {
      const positions = subseq(seg, tok, 0)
      if (positions) return [{ tokenIdx: t, positions }]
    }
  }
  return null
}

/**
 * 把一个 query segment 对齐到 tokens[startTok:]，返回精度最高的那种落点。
 * 策略顺序保证：非门控的 whole/head/prefix/multi 先于 matchInsideWord 门控的词内/子序列噪音。
 */
function alignSegment(seg: string, tokens: string[], startTok: number): Chunk[] | null {
  return (
    matchSingleAtHead(seg, tokens, startTok) ??
    matchMultiDfs(seg, tokens, startTok) ??
    matchSingleInsideWord(seg, tokens, startTok)
  )
}

// ===== 分类 =====

function classifyChunk(chunk: Chunk, tokenLen: number): ChunkClass {
  const pos = chunk.positions
  if (pos.length === 0) return 'infix-seq'
  const startsAtHead = pos[0] === 0
  let contiguous = true
  for (let i = 1; i < pos.length; i++) {
    if (pos[i] !== pos[i - 1] + 1) {
      contiguous = false
      break
    }
  }
  if (startsAtHead && contiguous && pos.length === tokenLen) return 'whole'
  if (startsAtHead && contiguous) return pos.length === 1 ? 'head' : 'prefix'
  if (startsAtHead && !contiguous) return 'prefix-seq'
  if (!startsAtHead && contiguous) return 'infix-substr'
  return 'infix-seq'
}

const SINGLE_PATTERN_FOR_CLASS: Record<ChunkClass, TokenPattern> = {
  whole: 'single-whole',
  head: 'single-head',
  prefix: 'single-prefix',
  'prefix-seq': 'single-prefix-seq',
  'infix-substr': 'single-infix-substr',
  'infix-seq': 'single-infix-seq'
}

// literal 下受 matchInsideWord 门控的 single chunk class
const GATED_SINGLE_CLASS: Record<ChunkClass, boolean> = {
  whole: false,
  head: false,
  prefix: false,
  'prefix-seq': true,
  'infix-substr': true,
  'infix-seq': false
}

// 归为 multi-fallback 的 chunk class
const MULTI_FALLBACK_CLASS: Record<ChunkClass, boolean> = {
  whole: false,
  head: false,
  prefix: false,
  'prefix-seq': true,
  'infix-substr': true,
  'infix-seq': true
}

function withAtStart(pattern: AtStartAwarePattern, atStart: boolean): TokenPattern {
  return atStart ? (`${pattern}-at-start` as TokenPattern) : pattern
}

/** MECE 分类，返回 null 表示该 encoder 不产出 */
function classifyAlignment(
  allChunks: Chunk[],
  tokens: string[],
  encoder: 'literal' | 'pinyin',
  options: TokenSearchOptions
): TokenPattern | null {
  const distinctTokens = new Set(allChunks.map((c) => c.tokenIdx))
  const isSingle = distinctTokens.size === 1
  const atStart = allChunks[0].tokenIdx === 0
  const classes = allChunks.map((c) => classifyChunk(c, tokens[c.tokenIdx].length))

  // pinyin 音节必须完整：只允许 whole / head
  if (encoder === 'pinyin' && classes.some((cl) => cl !== 'whole' && cl !== 'head')) {
    return null
  }

  if (isSingle) {
    const cls = classes[0]
    // literal 下，词首子序列 / 词内子串受 matchInsideWord 门控
    if (encoder === 'literal' && GATED_SINGLE_CLASS[cls] && !options.matchInsideWord) {
      return null
    }
    // infix-seq 无 matcher 产出（词首子序列已覆盖；非词首子序列精度过低未实现），保留 class 仅供类型完整
    if (cls === 'infix-seq') return null
    const base = SINGLE_PATTERN_FOR_CLASS[cls]
    // 非词首类（infix-substr）不区分 at-start
    return cls === 'infix-substr' ? base : withAtStart(base as AtStartAwarePattern, atStart)
  }

  // multi：计算 token 连续性
  const sortedIdx = [...distinctTokens].sort((a, b) => a - b)
  let isConsecutive = true
  for (let i = 1; i < sortedIdx.length; i++) {
    if (sortedIdx[i] !== sortedIdx[i - 1] + 1) {
      isConsecutive = false
      break
    }
  }
  if (classes.some((cl) => MULTI_FALLBACK_CLASS[cl])) return withAtStart('multi-fallback', atStart)

  const hasPrefix = classes.some((cl) => cl === 'prefix')
  const allHeadOrWhole = classes.every((cl) => cl === 'whole' || cl === 'head')
  const allWhole = classes.every((cl) => cl === 'whole')

  if (isConsecutive) {
    if (allWhole) return withAtStart('multi-consecutive-whole', atStart)
    if (allHeadOrWhole) return withAtStart('multi-consecutive-head-or-whole', atStart)
    if (hasPrefix) return withAtStart('multi-consecutive-prefix', atStart)
    return null
  }
  if (allWhole) return withAtStart('multi-nonconsecutive-whole', atStart)
  if (allHeadOrWhole) return withAtStart('multi-nonconsecutive-head-or-whole', atStart)
  if (hasPrefix) return withAtStart('multi-nonconsecutive-prefix', atStart)
  return null
}

// ===== 打分 =====

// 分数 = 各维度系数之和，调整系数即调整所有相关 pattern
const SCORE = {
  base: { single: 5500, multi: 5000 },
  continuity: { consecutive: 500, nonconsecutive: 0 },
  atStart: { yes: 1000, no: 0 },
  chunk: {
    whole: 500,
    head: 350,
    headOrWhole: 350,
    prefix: 300,
    prefixSeq: 200,
    infixSubstr: 100,
    infixSeq: 0,
    fallback: 0
  },
  consecutiveWholeBonus: 1000,
  exact: 10000,
  coverageWeight: 300,
  tokenPosMax: 150,
  tokenPosStep: 25
} as const

const PATTERN_SCORES: Record<TokenPattern, number> = {
  exact: SCORE.exact,

  // single token
  'single-whole': SCORE.base.single + SCORE.chunk.whole + SCORE.atStart.no,
  'single-whole-at-start': SCORE.base.single + SCORE.chunk.whole + SCORE.atStart.yes,
  'single-head': SCORE.base.single + SCORE.chunk.head + SCORE.atStart.no,
  'single-head-at-start': SCORE.base.single + SCORE.chunk.head + SCORE.atStart.yes,
  'single-prefix': SCORE.base.single + SCORE.chunk.prefix + SCORE.atStart.no,
  'single-prefix-at-start': SCORE.base.single + SCORE.chunk.prefix + SCORE.atStart.yes,
  'single-prefix-seq': SCORE.base.single + SCORE.chunk.prefixSeq + SCORE.atStart.no,
  'single-prefix-seq-at-start': SCORE.base.single + SCORE.chunk.prefixSeq + SCORE.atStart.yes,
  'single-infix-substr': SCORE.base.single + SCORE.chunk.infixSubstr + SCORE.atStart.no,
  'single-infix-seq': SCORE.base.single + SCORE.chunk.infixSeq + SCORE.atStart.no,

  // multi tokens 连续
  'multi-consecutive-whole':
    SCORE.base.multi +
    SCORE.continuity.consecutive +
    SCORE.chunk.whole +
    SCORE.consecutiveWholeBonus +
    SCORE.atStart.no,
  'multi-consecutive-whole-at-start':
    SCORE.base.multi +
    SCORE.continuity.consecutive +
    SCORE.chunk.whole +
    SCORE.consecutiveWholeBonus +
    SCORE.atStart.yes,
  'multi-consecutive-head-or-whole':
    SCORE.base.multi + SCORE.continuity.consecutive + SCORE.chunk.headOrWhole + SCORE.atStart.no,
  'multi-consecutive-head-or-whole-at-start':
    SCORE.base.multi + SCORE.continuity.consecutive + SCORE.chunk.headOrWhole + SCORE.atStart.yes,
  'multi-consecutive-prefix':
    SCORE.base.multi + SCORE.continuity.consecutive + SCORE.chunk.prefix + SCORE.atStart.no,
  'multi-consecutive-prefix-at-start':
    SCORE.base.multi + SCORE.continuity.consecutive + SCORE.chunk.prefix + SCORE.atStart.yes,

  // multi tokens 非连续
  'multi-nonconsecutive-whole':
    SCORE.base.multi + SCORE.continuity.nonconsecutive + SCORE.chunk.whole + SCORE.atStart.no,
  'multi-nonconsecutive-whole-at-start':
    SCORE.base.multi + SCORE.continuity.nonconsecutive + SCORE.chunk.whole + SCORE.atStart.yes,
  'multi-nonconsecutive-head-or-whole':
    SCORE.base.multi + SCORE.continuity.nonconsecutive + SCORE.chunk.headOrWhole + SCORE.atStart.no,
  'multi-nonconsecutive-head-or-whole-at-start':
    SCORE.base.multi +
    SCORE.continuity.nonconsecutive +
    SCORE.chunk.headOrWhole +
    SCORE.atStart.yes,
  'multi-nonconsecutive-prefix':
    SCORE.base.multi + SCORE.continuity.nonconsecutive + SCORE.chunk.prefix + SCORE.atStart.no,
  'multi-nonconsecutive-prefix-at-start':
    SCORE.base.multi + SCORE.continuity.nonconsecutive + SCORE.chunk.prefix + SCORE.atStart.yes,

  // multi tokens 剩余情形没必要再分类
  'multi-fallback':
    SCORE.base.multi + SCORE.continuity.nonconsecutive + SCORE.chunk.fallback + SCORE.atStart.no,
  'multi-fallback-at-start':
    SCORE.base.multi + SCORE.continuity.nonconsecutive + SCORE.chunk.fallback + SCORE.atStart.yes
}

// 动态加权
function dynamicBonus(allChunks: Chunk[], encodedLen: number): number {
  const matchedLen = allChunks.reduce((s, c) => s + c.positions.length, 0)
  const coverage = encodedLen > 0 ? matchedLen / encodedLen : 0
  const firstTokenIdx = allChunks.reduce((m, c) => Math.min(m, c.tokenIdx), Infinity)
  const tokenPos = Math.max(0, SCORE.tokenPosMax - firstTokenIdx * SCORE.tokenPosStep)
  return Math.round(coverage * SCORE.coverageWeight) + tokenPos
}

// ===== 高亮 =====

function buildMatches(
  name: string,
  allChunks: Chunk[],
  encoded: Encoded,
  tokenStarts: number[]
): MatchInfo[] {
  const points: number[] = []
  for (const chunk of allChunks) {
    const tokenStart = tokenStarts[chunk.tokenIdx]
    for (const pos of chunk.positions) {
      const encodedPos = tokenStart + pos
      if (encodedPos >= 0 && encodedPos < encoded.mapToOriginal.length) {
        points.push(encoded.mapToOriginal[encodedPos])
      }
    }
  }
  points.sort((a, b) => a - b)
  const indices: Array<[number, number]> = []
  for (const p of points) {
    if (indices.length > 0 && p <= indices[indices.length - 1][1] + 1) {
      indices[indices.length - 1][1] = Math.max(indices[indices.length - 1][1], p)
    } else {
      indices.push([p, p])
    }
  }
  return [{ indices, value: name, key: 'name' }]
}

// ===== 对外入口 =====

/**
 * 判定单个 command 是否匹配 query，返回打分与高亮信息；不匹配返回 null。
 *
 * query 先转小写并按空格切分为 segments；超过 {@link MAX_QUERY_LENGTH} 直接返回 null。
 * 对 literal / pinyin 两个编码器各跑一次，取分数较高者。
 */
export function matchCommand(
  name: string,
  query: string,
  options: TokenSearchOptions
): TokenSearchOutcome | null {
  if (!name) return null
  // 尾部空格 = 强制分词：最后一个 query 字符必须落在 token 边界（首或末）
  const forceLastBoundary = /\s$/.test(query)
  const q = query.trim().toLowerCase()
  if (!q) return null
  if (q.length > MAX_QUERY_LENGTH) return null

  if (name.toLowerCase() === q) {
    return {
      score: PATTERN_SCORES.exact,
      matches: [{ indices: [[0, name.length - 1]], value: name, key: 'name' }],
      matchType: 'name',
      pattern: 'exact'
    }
  }

  const segments = q.split(/\s+/).filter((s) => s.length > 0)
  if (segments.length === 0) return null

  let best: { outcome: TokenSearchOutcome; score: number } | null = null

  for (const encoderName of ['literal', 'pinyin'] as const) {
    const encoded = encoderName === 'literal' ? encodeLiteral(name) : encodePinyin(name)
    const { tokens, starts } = tokenizeInternal(encoded.text)
    if (tokens.length === 0) continue
    const lowerTokens = tokens.map((t) => t.toLowerCase())

    const allChunks: Chunk[] = []
    let cursor = 0
    let failed = false
    for (const seg of segments) {
      const r = alignSegment(seg, lowerTokens, cursor)
      if (!r) {
        failed = true
        break
      }
      allChunks.push(...r)
      cursor = r[r.length - 1].tokenIdx + 1
    }
    if (failed) continue
    if (forceLastBoundary) {
      const lastChunk = allChunks[allChunks.length - 1]
      const lastPos = lastChunk.positions[lastChunk.positions.length - 1]
      const tokenLen = tokens[lastChunk.tokenIdx].length
      if (lastPos !== 0 && lastPos !== tokenLen - 1) continue
    }

    const pattern = classifyAlignment(allChunks, tokens, encoderName, options)
    if (!pattern) continue

    const score = PATTERN_SCORES[pattern] + dynamicBonus(allChunks, encoded.text.length)
    if (!best || score > best.score) {
      best = {
        score,
        outcome: {
          score,
          matches: buildMatches(name, allChunks, encoded, starts),
          matchType: 'name',
          pattern
        }
      }
    }
  }

  return best?.outcome ?? null
}

/**
 * 对一组 commands 跑分词搜索，按 score 降序返回命中项。
 * 未命中或抛错的 command 不入选。空 query 返回 []。
 */
export function tokenSearch<T extends TokenSearchEntry>(
  commands: T[],
  query: string,
  options: TokenSearchOptions
): Array<T & TokenSearchOutcome> {
  const q = query.trim()
  if (!q) return []
  const results: Array<T & TokenSearchOutcome> = []
  for (const cmd of commands) {
    if (!cmd || typeof cmd.name !== 'string') continue
    let outcome: TokenSearchOutcome | null
    try {
      outcome = matchCommand(cmd.name, query, options)
    } catch {
      outcome = null
    }
    if (!outcome) continue
    const { score, matches, matchType, pattern } = outcome
    const systemAppBonus = cmd.type === 'direct' && cmd.subType === 'app' ? 300 : 0
    results.push({
      ...cmd,
      score: pattern === 'exact' ? score : score + systemAppBonus,
      matches,
      matchType,
      pattern
    })
  }
  results.sort((a, b) => b.score - a.score)
  return results
}
