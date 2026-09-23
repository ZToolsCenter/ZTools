import { describe, it, expect } from 'vitest'
import {
  tokenize,
  encodeName,
  matchCommand,
  tokenSearch
} from '../../src/renderer/src/utils/tokenSearch'

describe('tokenize', () => {
  it('英文驼峰切分', () => {
    expect(tokenize('VSCode')).toEqual(['VS', 'Code'])
    expect(tokenize('HTTPServer')).toEqual(['HTTP', 'Server'])
    expect(tokenize('fooBar')).toEqual(['foo', 'Bar'])
  })

  it('CJK 与英文混排', () => {
    expect(tokenize('冰与火之舞 A Dance of Fire and Ice')).toEqual([
      '冰',
      '与',
      '火',
      '之',
      '舞',
      'A',
      'Dance',
      'of',
      'Fire',
      'and',
      'Ice'
    ])
  })

  it('符号与数字作为分隔符', () => {
    expect(tokenize('7-Zip File Manager')).toEqual(['7', 'Zip', 'File', 'Manager'])
    expect(tokenize('Dism++')).toEqual(['Dism'])
  })
})

describe('encodeName (pinyin)', () => {
  it('CJK 转音节，非 CJK 原样', () => {
    const { text } = encodeName('冰A', 'pinyin')
    expect(text.replace(/\s+$/, '')).toBe('bing A')
  })

  it('多 CJK 音节用空格分隔，方便后续分词', () => {
    const { text } = encodeName('冰与火', 'pinyin')
    expect(text.replace(/\s+$/, '')).toBe('bing yu huo')
  })
})

describe('matchCommand 分词匹配', () => {
  const opt = { matchInsideWord: false }

  it('精确匹配', () => {
    expect(matchCommand('Task Manager', 'task manager', opt)?.pattern).toBe('exact')
  })

  it('multi 连续 全词 (literal): fire and ice', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'fire and ice', opt)?.pattern).toBe(
      'multi-consecutive-whole'
    )
  })

  it('multi 连续 首字母或全词 at-start (literal): adofai', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'adofai', opt)?.pattern).toBe(
      'multi-consecutive-head-or-whole-at-start'
    )
  })

  it('multi 非连续 全词 (literal): fire ice', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'fire ice', opt)?.pattern).toBe(
      'multi-nonconsecutive-whole'
    )
  })

  it('multi 非连续 首字母或全词 (literal): f i', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'f i', opt)?.pattern).toBe(
      'multi-nonconsecutive-head-or-whole'
    )
  })

  it('single 全词: dance', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'dance', opt)?.pattern).toBe('single-whole')
  })

  it('single 词首子串: dan', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'dan', opt)?.pattern).toBe('single-prefix')
  })

  it('single 词首子序列 默认禁用: dne -> null', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'dne', opt)).toBeNull()
  })

  it('single 词首子序列 启用后命中', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'dne', { matchInsideWord: true })?.pattern).toBe(
      'single-prefix-seq'
    )
  })

  it('single 非词首子串 启用后命中: anc', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'anc', { matchInsideWord: true })?.pattern).toBe(
      'single-infix-substr'
    )
  })

  it('pinyin multi 连续 全词 at-start: bing yu huo', () => {
    expect(matchCommand('冰与火之舞', 'bing yu huo', opt)?.pattern).toBe(
      'multi-consecutive-whole-at-start'
    )
  })

  it('pinyin multi 连续 首字母或全词 at-start: byhzw', () => {
    expect(matchCommand('冰与火之舞', 'byhzw', opt)?.pattern).toBe(
      'multi-consecutive-head-or-whole-at-start'
    )
  })

  it('pinyin 音节必须完整: bi 不应命中 bing', () => {
    expect(matchCommand('冰与火之舞', 'bi', opt)).toBeNull()
  })

  it('pinyin 非连续 全词 at-start: bing huo', () => {
    expect(matchCommand('冰与火之舞', 'bing huo', opt)?.pattern).toBe(
      'multi-nonconsecutive-whole-at-start'
    )
  })

  it('pinyin 单字符首字母 at-start: b', () => {
    expect(matchCommand('冰与火之舞', 'b', opt)?.pattern).toBe('single-head-at-start')
  })

  it('含符号 query 不命中: 7-Zip', () => {
    expect(matchCommand('7-Zip File Manager', '7-zip', opt)).toBeNull()
  })

  it('数字 query at-start 命中: 7', () => {
    expect(matchCommand('7-Zip File Manager', '7', opt)?.pattern).toBe('single-whole-at-start')
  })

  it('query 超长(>32)返回 null', () => {
    expect(matchCommand('Chrome', 'c'.repeat(33), opt)).toBeNull()
  })

  it('空 query 返回 null', () => {
    expect(matchCommand('Chrome', '', opt)).toBeNull()
    expect(matchCommand('Chrome', '   ', opt)).toBeNull()
  })

  it('尾部空格: 末位落在词中不命中 - ado vs Adobe', () => {
    expect(matchCommand('Adobe Photoshop', 'ado ', opt)).toBeNull()
  })

  it('尾部空格: 末位是词末字符通过 - dance 命中 Dance', () => {
    expect(matchCommand('A Dance of Fire and Ice', 'dance ', opt)?.pattern).toBe('single-whole')
  })

  it('尾部空格: 单字符落词首通过 at-start - a 命中 Adobe', () => {
    expect(matchCommand('Adobe Photoshop', 'a ', opt)?.pattern).toBe('single-head-at-start')
  })

  it('尾部空格: 末位落在词中不命中 - ph vs Photoshop', () => {
    expect(matchCommand('Adobe Photoshop', 'ph ', opt)).toBeNull()
  })

  it('multi-fallback: anc ice', () => {
    expect(
      matchCommand('A Dance of Fire and Ice', 'anc ice', { matchInsideWord: true })?.pattern
    ).toBe('multi-fallback')
  })
})

describe('tokenSearch 排序', () => {
  it('系统应用在同 pattern 下加分排前', () => {
    const r = tokenSearch(
      [
        { name: 'Dancer', type: 'plugin', path: '/p', featureCode: 'd' },
        { name: 'Dancer', type: 'direct', subType: 'app', path: '/app' }
      ],
      'danc',
      { matchInsideWord: false }
    )
    expect(r[0].path).toBe('/app')
  })

  it('未命中项被过滤', () => {
    const r = tokenSearch(
      [
        { name: 'Chrome', type: 'direct', subType: 'app', path: '/ch' },
        { name: 'Firefox', type: 'direct', subType: 'app', path: '/ff' }
      ],
      'chrome',
      { matchInsideWord: false }
    )
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe('Chrome')
  })

  it('同 pattern 覆盖率高者排前', () => {
    const r = tokenSearch(
      [
        { name: 'Dance Revolution', type: 'plugin', path: '/a', featureCode: 'a' },
        { name: 'Dance', type: 'plugin', path: '/b', featureCode: 'b' }
      ],
      'dance',
      { matchInsideWord: false }
    )
    expect(r[0].name).toBe('Dance')
  })

  it('同 pattern 首 token 越靠前分越高', () => {
    const a = matchCommand('A Dance', 'dance', { matchInsideWord: false })!.score
    const b = matchCommand('A X Dance', 'dance', { matchInsideWord: false })!.score
    expect(a).toBeGreaterThan(b)
  })
})
