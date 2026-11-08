import { describe, expect, it, vi } from 'vitest'
import { buildCommandCatalog } from '../../src/main/core/commands/catalog'
import { CommandSearchEngine } from '../../src/main/core/commands/engine'
import { NAME_SCORE, NameScorer } from '../../src/main/core/commands/searchRanking'
import type { NameMatch } from '../../src/main/core/commands/searchTypes'
import type {
  NameMatcher,
  NameSource,
  PreparedQuery,
  NameMatchContext,
  ContextMatcher
} from '../../src/main/core/commands/matching/contracts'
import { createDefaultNameMatcherRegistry } from '../../src/main/core/commands/matching/nameMatcherRegistry'
import {
  ContextMatcherRegistry,
  createDefaultContextMatcherRegistry
} from '../../src/main/core/commands/matching/contextMatcherRegistry'
import { MainPushTriggerPolicy } from '../../src/main/core/commands/matching/mainPushTriggerPolicy'
import { prepareQuery } from '../../src/main/core/commands/matching/preparedQuery'
import { InvalidContextRuleError } from '../../src/main/core/commands/matching/contextRuleValidation'
import { getCommandId } from '../../src/shared/commandShared'
import type {
  CommandCatalogInput,
  CommandMatchContext,
  CommandRankState
} from '../../src/shared/commandService'

const userState: CommandRankState = {
  recommendationPins: [],
  usage: [],
  preference: {}
}

/**
 * 创建无持久化目录。
 * @param overrides 目录来源覆盖
 * @returns 完整目录输入
 */
function input(overrides: Partial<CommandCatalogInput>): CommandCatalogInput {
  return {
    apps: [],
    plugins: [],
    settings: [],
    localShortcuts: [],
    aliases: {},
    disabledCommands: [],
    disabledPlugins: [],
    enabledMainPushPlugins: [],
    ...overrides
  }
}

/**
 * 创建完整查询上下文。
 * @param text 查询文本
 * @returns 纯文本上下文
 */
function context(text: string): CommandMatchContext {
  return { searchQuery: text, pastedText: null, pastedFiles: null, pastedImage: false }
}

interface CustomIndex {
  term: string
  length: number
}

/** 使用独立索引的新增策略，验证引擎不依赖六类字段枚举。 */
class CustomMatcher implements NameMatcher<CustomIndex> {
  readonly id = 'fixture-token'
  /**
   * 给扩展名称建立自定义触发词。
   * @param source 名称来源
   * @returns 自定义索引或空
   */
  build(source: NameSource): CustomIndex | null {
    return source.name === '扩展命令' ? { term: 'fixture', length: source.name.length } : null
  }
  /**
   * 策略接受非空英文输入。
   * @param query 查询快照
   * @returns 是否适用
   */
  supports(query: PreparedQuery): boolean {
    return query.hasRoman
  }
  /**
   * 自定义命中仍由注入的评分器评分。
   * @param index 自定义索引
   * @param query 查询快照
   * @param ctx 统一评分上下文
   * @returns 命中事实与分数
   */
  match(index: CustomIndex, query: PreparedQuery, ctx: NameMatchContext): NameMatch | null {
    if (query.text !== index.term) return null
    return ctx.scorer.score({
      shape: 'exact',
      partial: false,
      compact: false,
      position: 0,
      length: index.length,
      field: this.id,
      alternatives: 0,
      ranges: []
    })
  }
}

describe('匹配器扩展契约', () => {
  it('新增独立索引策略只需注册与权重配置即可参与引擎排序', () => {
    const scorer = new NameScorer({
      ...NAME_SCORE,
      field: { ...NAME_SCORE.field, 'fixture-token': 500 }
    })
    const registry = createDefaultNameMatcherRegistry(scorer).register(new CustomMatcher())
    const engine = new CommandSearchEngine(
      buildCommandCatalog(
        input({
          apps: [
            { name: 'fixture', path: '/original' },
            { name: '扩展命令', path: '/custom' }
          ]
        })
      ),
      { nameMatchers: registry }
    )
    const result = engine.query({ context: context('ＦＩＸＴＵＲＥ') }, userState)
    expect(result.bestSearchResults.map((item) => item.path)).toEqual(['/custom', '/original'])
    expect(result.bestSearchResults[0].highlightRanges).toEqual([])
    expect(
      createDefaultNameMatcherRegistry()
        .register(new CustomMatcher())
        .scorer.upperBound('fixture-token', 4)
    ).toBe(996)
    expect(() => registry.register(new CustomMatcher())).toThrow('重复名称匹配器')
  })

  it('读音路径调权可以选择前缀，但完整 mainPush 触发仍能找到另一条合法路径', () => {
    // 呣读 m/mou：mou+mou 命中前两个字，mou+m+ou 才消费完整名称。
    const registry = createDefaultNameMatcherRegistry(
      new NameScorer({ ...NAME_SCORE, shape: { exact: 1000, prefix: 2000, contains: 100 } })
    )
    const index = registry.build({ name: '呣呣欧' }, new Map())
    const policy = new MainPushTriggerPolicy(registry)
    const budget = { remaining: 4096, degraded: 0 }
    expect(registry.match(index, prepareQuery('moumou'), budget)?.shape).toBe('prefix')
    expect(registry.match(index, prepareQuery('moumou'), budget, 'command-prefix')?.shape).toBe(
      'exact'
    )
    expect(policy.matchesPrefix(index, prepareQuery('moumou payload'), budget)).toBe(true)
    expect(policy.matchesPrefix(index, prepareQuery('moumou ' + 'a'.repeat(300)), budget)).toBe(
      true
    )
    expect(policy.matchesPrefix(index, prepareQuery('moumouextra'), budget)).toBe(false)
    expect(policy.matchesPrefix(index, prepareQuery('mou payload'), budget)).toBe(false)
  })

  it('同一规则及其别名只编译一次，null 产物查询与精确目标验证继续复用', () => {
    const compile = vi.fn(() => null)
    const matches = vi.fn(
      (_rule, compiled, ctx: CommandMatchContext) =>
        compiled === null && ctx.searchQuery === 'valid'
    )
    const matcher: ContextMatcher<{ type: 'regex'; match?: string }, null> = {
      type: 'regex',
      compile,
      matches
    }
    // 使用新注册表替换默认策略，在不修改引擎的情况下验证分派。
    const registry = new ContextMatcherRegistry().register(matcher)
    const sources = input({
      plugins: [
        {
          name: 'p',
          path: '/p',
          features: [{ code: 'rule', cmds: [{ type: 'regex', label: '规则', match: 'invalid' }] }]
        }
      ]
    })
    const initial = buildCommandCatalog(sources)
    sources.aliases = { [getCommandId(initial.rules[0])]: [{ alias: '别名' }] }
    const engine = new CommandSearchEngine(buildCommandCatalog(sources), {
      contextMatchers: registry
    })
    expect(engine.catalog.rules).toHaveLength(2)
    expect(compile).toHaveBeenCalledTimes(1)
    for (let requestId = 1; requestId <= 3; requestId++) {
      const result = engine.query({ context: context('valid'), intent: 'panel' }, userState)
      expect(result.bestMatches).toHaveLength(1)
      expect(result.panelResults).toHaveLength(1)
    }
    expect(
      engine.query({ target: '别名', context: context('invalid') }, userState).panelResults
    ).toEqual([])
    expect(
      engine.query({ target: '别名', context: context('valid') }, userState).panelResults[0]
    ).toMatchObject({ name: '别名', featureCode: 'rule' })
    expect(compile).toHaveBeenCalledTimes(1)
    expect(matches).toHaveBeenCalledTimes(5)
  })

  it('配置错误在编译时诊断一次，匹配器实现异常不被静默吞掉', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const registry = createDefaultContextMatcherRegistry()
      expect(registry.prepare({ type: 'unknown' }).matches(context('x'))).toBe(false)
      registry.register({
        type: 'invalid-config',
        compile: () => {
          throw new InvalidContextRuleError('bad config')
        },
        matches: () => true
      })
      const invalid = registry.prepare({ type: 'invalid-config' })
      for (let i = 0; i < 3; i++) expect(invalid.matches(context('x'))).toBe(false)
      expect(warning).toHaveBeenCalledTimes(2)
      registry.register({
        type: 'broken-compile',
        compile: () => {
          throw new Error('compile implementation bug')
        },
        matches: () => true
      })
      registry.register({
        type: 'broken-match',
        compile: () => null,
        matches: () => {
          throw new Error('match implementation bug')
        }
      })
      expect(() => registry.prepare({ type: 'broken-compile' })).toThrow('compile implementation')
      const broken = registry.prepare({ type: 'broken-match' })
      expect(() => broken.matches(context('x'))).toThrow('match implementation')
      expect(registry.prepare({ type: 'regex', match: '/x/' }).matches(context('x'))).toBe(true)
      expect(() =>
        registry.register({ type: 'img', compile: () => null, matches: () => true })
      ).toThrow('重复内容匹配器')
    } finally {
      warning.mockRestore()
    }
  })

  it('畸形第三方字段在编译边界隔离，不影响同目录其他规则', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const registry = createDefaultContextMatcherRegistry()
      for (const rule of [
        { type: 'window' },
        { type: 'window', match: { app: 'Fixture.app' } },
        { type: 'files', extensions: [3] },
        { type: 'over', exclude: '/[/' },
        { type: 'regex', match: 4 }
      ]) {
        const prepared = registry.prepare(rule)
        expect(prepared.matches(context('x'))).toBe(false)
        expect(prepared.matches(context('x'))).toBe(false)
      }
      expect(warning).toHaveBeenCalledTimes(5)
      expect(registry.prepare({ type: 'regex', match: '/x/' }).matches(context('x'))).toBe(true)
    } finally {
      warning.mockRestore()
    }
  })

  it('单条执行验证只调用所选预编译规则，不运行其他规则或名称匹配', () => {
    const compile = vi.fn(() => null)
    const matches = vi.fn(
      (_rule, _compiled, ctx: CommandMatchContext) => ctx.searchQuery === 'valid'
    )
    const names = createDefaultNameMatcherRegistry()
    const matchNames = vi.spyOn(names, 'match')
    const search = new CommandSearchEngine(
      buildCommandCatalog(
        input({
          plugins: [
            {
              name: 'p',
              path: '/p',
              features: [
                {
                  code: 'selected',
                  cmds: [{ type: 'regex', label: '所选规则', match: '/valid/' }]
                },
                { code: 'other', cmds: [{ type: 'regex', label: '其他规则', match: '/other/' }] }
              ]
            }
          ]
        })
      ),
      {
        nameMatchers: names,
        contextMatchers: new ContextMatcherRegistry().register({ type: 'regex', compile, matches })
      }
    )
    const selected = search.catalog.rules.find((rule) => rule.featureCode === 'selected')!
    expect(search.validateCommand(selected.ruleId, context('valid'))).toBe(true)
    expect(matches).toHaveBeenCalledTimes(1)
    expect(matches.mock.calls[0][0]).toMatchObject({ label: '所选规则' })
    expect(search.validateCommand(selected.ruleId, context('invalid'))).toBe(false)
    expect(search.validateCommand('deleted-rule', context('valid'))).toBe(false)
    expect(matches).toHaveBeenCalledTimes(2)
    expect(compile).toHaveBeenCalledTimes(2)
    expect(matchNames).not.toHaveBeenCalled()
  })

  it('默认正则 flags 及全局 lastIndex 在重复查询中保持一致', () => {
    const registry = createDefaultContextMatcherRegistry()
    const rule = registry.prepare({ type: 'regex', match: '/^hello$/ig' })
    for (let i = 0; i < 3; i++) expect(rule.matches(context('HELLO'))).toBe(true)
    expect(rule.matches({ ...context('HELLO'), pastedImage: true })).toBe(false)
    expect(registry.prepare({ type: 'regex', match: '/[/' }).matches(context('x'))).toBe(false)
  })

  it('默认内容策略继续验证排除、文件、图片和窗口资格', () => {
    const registry = createDefaultContextMatcherRegistry()
    expect(
      registry.prepare({ type: 'over', exclude: '/^blocked$/i' }).matches(context('BLOCKED'))
    ).toBe(false)
    expect(
      registry.prepare({ type: 'files', extensions: ['png'], match: '/^shot/ig' }).matches({
        ...context(''),
        pastedFiles: [
          { name: 'SHOT.png', path: '/SHOT.png', isDirectory: false },
          { name: 'shot2.png', path: '/shot2.png', isDirectory: false }
        ]
      })
    ).toBe(true)
    expect(
      registry
        .prepare({ type: 'window', match: { title: '/editor/ig' } })
        .matches({ ...context(''), windowInfo: { title: 'EDITOR' } })
    ).toBe(true)
    expect(registry.prepare({ type: 'img' }).matches({ ...context(''), pastedImage: true })).toBe(
      true
    )
  })

  it('带高亮副本的窗口别名仍按稳定规则身份验证，展示和精确目标一致', () => {
    const sources = input({
      plugins: [
        {
          name: 'p',
          path: '/p',
          features: [
            {
              code: 'window',
              cmds: [{ type: 'window', label: '窗口命令', match: { app: ['Fixture.app'] } }]
            }
          ]
        }
      ]
    })
    const initial = buildCommandCatalog(sources)
    sources.aliases = { [getCommandId(initial.rules[0])]: [{ alias: '窗口别名' }] }
    const engine = new CommandSearchEngine(buildCommandCatalog(sources))
    const ctx = { ...context('窗口别名'), windowInfo: { app: 'Fixture.app' } }
    const result = engine.query({ context: ctx }, userState)
    expect(result.bestSearchResults.map((item) => item.name)).toEqual(['窗口别名'])
    expect(result.bestSearchResults[0].highlightRanges).toEqual([[0, 3]])
    expect(result.panelResults).toEqual([])
    expect(engine.query({ context: ctx, intent: 'panel' }, userState).panelResults).toContainEqual(
      result.bestSearchResults[0]
    )
    expect(
      engine.query({ target: '窗口别名', context: ctx }, userState).panelResults[0]
    ).toMatchObject({ name: '窗口别名', featureCode: 'window' })
    expect(
      engine.query(
        {
          context: {
            ...ctx,
            windowInfo: { app: 'Other.app' }
          }
        },
        userState
      ).bestSearchResults
    ).toEqual([])
  })
})
