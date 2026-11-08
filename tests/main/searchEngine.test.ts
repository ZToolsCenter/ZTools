import { describe, expect, it, vi } from 'vitest'
import { buildCommandCatalog } from '../../src/main/core/commands/catalog'
import { CommandSearchEngine } from '../../src/main/core/commands/engine'
import { createDefaultNameMatcherRegistry } from '../../src/main/core/commands/matching/nameMatcherRegistry'
import { MainPushTriggerPolicy } from '../../src/main/core/commands/matching/mainPushTriggerPolicy'
import { prepareQuery } from '../../src/main/core/commands/matching/preparedQuery'
import { normalizeSearchText } from '../../src/main/core/commands/searchNormalization'
import { commandServiceFixture } from '../helpers/commandService'
import type {
  CommandCatalogInput,
  CommandMatchContext,
  CommandRankState
} from '../../src/shared/commandService'

/**
 * 创建无持久化副作用的完整查询上下文。
 * @param searchQuery 查询词
 * @returns 输入快照
 */
function context(searchQuery: string): CommandMatchContext {
  return { searchQuery, pastedImage: false, pastedFiles: null, pastedText: null }
}

/**
 * 创建可覆盖偏好和统计的用户状态。
 * @param overrides 覆盖状态
 * @returns 完整用户快照
 */
function state(overrides: Partial<CommandRankState> = {}): CommandRankState {
  return {
    recommendationPins: [],
    usage: [],
    preference: {},
    ...overrides
  }
}

/**
 * 以应用名称构建实际目录和引擎。
 * @param names 名称数组
 * @param overrides 目录覆盖项
 * @returns 搜索引擎
 */
function engine(
  names: string[],
  overrides: Partial<CommandCatalogInput> = {}
): CommandSearchEngine {
  return new CommandSearchEngine(
    buildCommandCatalog({
      apps: names.map((name, i) => ({ name, path: '/app/' + i })),
      plugins: [],
      settings: [],
      localShortcuts: [],
      aliases: {},
      disabledCommands: [],
      disabledPlugins: [],
      enabledMainPushPlugins: [],
      ...overrides
    })
  )
}

describe('六类名称索引与连续匹配', () => {
  it.each([
    ['微信', ['base', 'py', 'pyfirst']],
    ['微信 OCR', ['base', 'py+', 'pyfirst+']],
    ['Visual Studio Code', ['base', 'enfirst']],
    ['HTTPServer', ['base', 'enfirst']],
    ['工具2', ['base', 'py+', 'pyfirst+']]
  ])('按 %s 生成适用字段', (name, kinds) => {
    const registry = createDefaultNameMatcherRegistry()
    expect(registry.build({ name }, new Map()).entries.map((entry) => entry.matcher.id)).toEqual(
      kinds
    )
  })

  it.each([
    ['微信', '微信', ['微信']],
    ['微信', 'weixin', ['微信']],
    ['微信', 'wx', ['微信']],
    ['微信', 'weix', ['微信']],
    ['微信', 'wei信', ['微信']],
    ['微信 OCR', 'weixinocr', ['微信', 'OCR']],
    ['微信 OCR', 'wxocr', ['微信', 'OCR']],
    ['微信 OCR', '微信ocr', ['微信', 'OCR']],
    ['微信 OCR', 'ＷＸＯＣＲ', ['微信', 'OCR']],
    ['微信读书', '微信读shu', ['微信读书']],
    ['微信工具2', 'wxgj2', ['微信工具2']],
    ['Visual Studio Code', 'vsc', ['V', 'S', 'C']],
    ['GoogleChrome', 'gc', ['G', 'C']],
    ['HTTPServer', 'hs', ['H', 'S']],
    ['打开 Visual Studio Code', '打开vsc', ['打开', 'V', 'S', 'C']],
    ['重庆天气', 'chongqing', ['重庆']],
    ['重庆天气', 'zhongqing', ['重庆']],
    ['重庆天气', 'cq', ['重庆']],
    ['重庆天气', 'zq', ['重庆']],
    ['银行助手', 'yinhang', ['银行']],
    ['银行助手', 'yinxing', ['银行']],
    ['银行助手', 'yh', ['银行']],
    ['银行助手', 'yx', ['银行']],
    ['音乐播放器', 'yinyue', ['音乐']],
    ['音乐播放器', 'yinle', ['音乐']],
    ['音乐播放器', 'yy', ['音乐']],
    ['音乐播放器', 'yl', ['音乐']],
    ['音乐播放器', 'bofang', ['播放']],
    ['音乐播放器', 'fang', ['放']],
    ['安下西', 'xi', ['西']],
    ['😀重庆天气', 'zq', ['重庆']],
    ['女娲', 'nüwa', ['女娲']],
    ['女娲', 'nvwa', ['女娲']],
    ['C++', 'c++', ['C++']],
    ['C#', 'c#', ['C#']]
  ])('%s 搜索 %s 使用获胜路径高亮', (name, searchQuery, highlighted) => {
    const search = engine([name])
    const result = search.query({ context: context(searchQuery) }, state())
    expect(result.bestSearchResults).toHaveLength(1)
    const item = result.bestSearchResults[0]
    expect(item.highlightRanges!.map(([start, end]) => item.name.slice(start, end + 1))).toEqual(
      highlighted
    )
    expect(result.allListModeResults).toEqual(result.bestSearchResults)
  })

  it.each(['ang', 'wiexin', 'wxqi', 'wxin'])(
    '不引入音节内部、纠错和任意跳字匹配：%s',
    (searchQuery) => {
      expect(
        engine(['微信', '音乐播放器']).query({ context: context(searchQuery) }, state())
          .bestSearchResults
      ).toEqual([])
    }
  )

  it('兼容长名称和全角/空白，但保留有意义的标点', () => {
    const name = '长名称'.repeat(20) + '结尾'
    const result = engine([name, 'C++', 'C#']).query({ context: context(name) }, state())
    expect(result.bestSearchResults[0].name).toBe(name)
    expect(normalizeSearchText('　ＶＳ   Code　')).toBe('vs code')
    expect(normalizeSearchText(' C++ ')).toBe('c++')
  })

  it('备用路径预算耗尽可诊断且默认字面路径仍然可用', () => {
    const registry = createDefaultNameMatcherRegistry()
    const index = registry.build({ name: '重庆' }, new Map())
    const budget = { remaining: 0, degraded: 0 }
    expect(registry.match(index, prepareQuery('zhongqing'), budget)).toBeNull()
    expect(budget.degraded).toBeGreaterThan(0)
    expect(registry.match(index, prepareQuery('重庆'), budget)?.shape).toBe('exact')
    expect(registry.match(index, prepareQuery('chongqing'), budget)?.shape).toBe('exact')
  })

  it('扫描器兼容缩写不能伪造原名高亮', () => {
    const search = engine([], { apps: [{ name: '测试软件', path: '/fixture', acronym: 'custom' }] })
    const result = search.query({ context: context('custom') }, state())
    expect(result.bestSearchResults).toHaveLength(1)
    expect(result.bestSearchResults[0].highlightRanges).toEqual([])
  })
})

describe('统一评分与功能身份', () => {
  it('拼音完全匹配可以超过原文内部包含，不再按字段固定分层', () => {
    const search = engine(['打开weixin', '微信'])
    const result = search.query({ context: context('weixin') }, state())
    expect(result.bestSearchResults.map((item) => item.name)).toEqual(['微信', '打开weixin'])
  })

  it('备用读音前缀可以超过默认拼音内部命中', () => {
    const search = engine(['高中', '重庆'])
    const result = search.query({ context: context('zhong') }, state())
    expect(result.bestSearchResults.map((item) => item.name)).toEqual(['重庆', '高中'])
  })

  it('无偏好时短名称自然优先，偏好加分可以超过全名', () => {
    const search = engine(['微信', '微信读书', '微信 OCR'])
    const user = state({
      preference: { 微信: { path: '/app/2', name: '微信 OCR', type: 'direct' } as any }
    })
    const request = { context: context('微信') }
    expect(search.query(request, state()).bestSearchResults[0].name).toBe('微信')
    const result = search.query(request, user)
    expect(result.bestSearchResults.map((item) => item.name)).toEqual([
      '微信 OCR',
      '微信',
      '微信读书'
    ])
  })

  it('备用读音通过扣分处理，偏好加分可以改变默认与备用的顺序', () => {
    const search = engine(['重启', '中期'])
    const result = search.query(
      { context: context('zhongqi') },
      state({ preference: { zhongqi: { path: '/app/0', name: '重启' } } })
    )
    expect(result.bestSearchResults.map((item) => item.name)).toEqual(['重启', '中期'])
    expect(
      search
        .query({ context: context('zhongqi') }, state())
        .bestSearchResults.map((item) => item.name)
    ).toEqual(['中期', '重启'])
  })

  it('去空格表示扣分，偏好仍可以将它提高到字面全名前面', () => {
    const search = engine(['微信 OCR', '微信OCR'])
    const result = search.query(
      { context: context('微信OCR') },
      state({ preference: { 微信ocr: { path: '/app/0', name: '微信 OCR' } } })
    )
    expect(result.bestSearchResults[0].name).toBe('微信 OCR')
  })

  it('备用读音数量参与评分，用户偏好不受备用层约束', () => {
    const search = engine(['重庆重启', '重庆中期'])
    const result = search.query(
      { context: context('zhongqingzhongqi') },
      state({ preference: { zhongqingzhongqi: { path: '/app/0', name: '重庆重启' } } })
    )
    expect(result.bestSearchResults.map((item) => item.name)).toEqual(['重庆重启', '重庆中期'])
  })

  it('应用多个别名只保留最佳显示名，跨插件同名仍独立', () => {
    const search = engine([], {
      apps: [{ name: 'WeChat', path: '/WeChat.app', aliases: ['微信', '微信软件'] }],
      plugins: ['a', 'b'].map((name) => ({
        name,
        path: '/' + name,
        features: [{ code: 'cmd', cmds: ['微信'] }]
      }))
    })
    const result = search.query({ context: context('微信') }, state())
    expect(result.bestSearchResults).toHaveLength(3)
    expect(result.bestSearchResults.find((item) => item.path === '/WeChat.app')?.name).toBe('微信')
  })

  it('内容与窗口筛选共用评分，内容使用次数可以提高较长名称的排名', () => {
    const search = engine([], {
      plugins: [
        {
          name: 'p',
          path: '/p',
          features: [
            { code: 'exact', cmds: [{ type: 'over', label: '重庆' }] },
            { code: 'long', cmds: [{ type: 'over', label: '重庆天气' }] },
            {
              code: 'window',
              cmds: [{ type: 'window', label: '银行助手', match: { app: ['Fixture.app'] } }]
            }
          ]
        }
      ]
    })
    const user = state({ usage: [{ path: '/p', featureCode: 'long', useCount: 1000 }] })
    const result = search.query({ context: { ...context('重庆'), pastedText: 'payload' } }, user)
    expect(result.bestSearchResults[0].name).toBe('重庆天气')
    const window = search.query(
      {
        intent: 'window',
        context: { ...context('yx'), windowInfo: { app: 'Fixture.app' } }
      },
      user
    )
    expect(window.windowCommands[0].name).toBe('银行助手')
  })
})

describe('mainPush 与偏好学习', () => {
  it('共用备用拼音匹配，同时保留命令词参数触发和英文边界', () => {
    const search = engine([], {
      plugins: [
        {
          name: 'p',
          path: '/p',
          features: [
            { code: 'cq', mainPush: true, cmds: ['重庆'] },
            { code: 'push', mainPush: true, cmds: ['Push'] }
          ]
        }
      ],
      enabledMainPushPlugins: ['p']
    })
    for (const searchQuery of ['zq', 'zhongqing', 'zhongqing hello', '重庆天气']) {
      const result = search.query({ context: context(searchQuery), includeMainPush: true }, state())
      expect(result.mainPushCandidates.some((item) => item.featureCode === 'cq')).toBe(true)
    }
    const registry = createDefaultNameMatcherRegistry()
    const policy = new MainPushTriggerPolicy(registry)
    const index = registry.build({ name: 'Push' }, new Map())
    const budget = { remaining: 4096, degraded: 0 }
    expect(policy.matchesPrefix(index, prepareQuery('push hello'), budget)).toBe(true)
    expect(policy.matchesPrefix(index, prepareQuery('pusher'), budget)).toBe(false)
  })

  it('静态查询按需跳过动态候选；相同输入的动态候选复用名称命中事实', () => {
    const names = createDefaultNameMatcherRegistry()
    const match = vi.spyOn(names, 'match')
    const sources = engine([], {
      plugins: [
        { name: 'p', path: '/p', features: [{ code: 'cq', mainPush: true, cmds: ['重庆'] }] }
      ],
      enabledMainPushPlugins: ['p']
    }).catalog
    const search = new CommandSearchEngine(sources, { nameMatchers: names })
    expect(search.query({ context: context('zq') }, state()).mainPushCandidates).toEqual([])
    const staticCalls = match.mock.calls.length
    match.mockClear()
    const result = search.query({ context: context('zq'), includeMainPush: true }, state())
    expect(result.mainPushCandidates.map((item) => item.featureCode)).toEqual(['cq'])
    expect(match).toHaveBeenCalledTimes(staticCalls)
    expect(result.panelResults).toEqual([])
    expect(Object.keys(result)).not.toContain('context')
    expect(Object.keys(result)).not.toContain('catalogRevision')
    expect(Object.keys(result)).not.toContain('sessionId')
  })

  it('主搜索粘贴图片时不匹配不可展示的普通名称', () => {
    const names = createDefaultNameMatcherRegistry()
    const match = vi.spyOn(names, 'match')
    const search = new CommandSearchEngine(engine(['微信']).catalog, { nameMatchers: names })
    const ctx = { ...context('微信'), pastedImage: true }
    expect(search.query({ context: ctx }, state()).bestSearchResults).toEqual([])
    expect(match).not.toHaveBeenCalled()
    expect(search.query({ context: ctx, intent: 'panel' }, state()).panelResults).toHaveLength(1)
    expect(match).toHaveBeenCalledTimes(1)
  })

  it('主搜索显式选择成功后学习，失败、面板、快捷键和精确目标不学习', async () => {
    const { service, write, launch } = commandServiceFixture({
      apps: [{ name: '微信', path: '/WeChat.app' }]
    })
    const request = {
      sessionId: 'main',
      requestId: 1,
      context: { ...context('微信'), pastedImage: null }
    }
    const result = await service.query('main', request)
    const command = result.bestSearchResults[0]
    await service.execute('main', { sessionId: 'main', requestId: 1, resultId: command.resultId })
    expect(write).toHaveBeenCalledWith('search-preference', {
      微信: { path: '/WeChat.app', name: '微信', featureCode: undefined }
    })
    write.mockClear()
    await service.execute('super-panel', {
      command,
      context: { ...context('微信'), pastedImage: null },
      source: 'super-panel'
    })
    await service.execute('shortcut', {
      command,
      context: { ...context('微信'), pastedImage: null },
      source: 'global-shortcut'
    })
    await service.execute('api', {
      target: '微信',
      context: { ...context('微信'), pastedImage: null }
    })
    const panel = await service.query('panel', { ...request, intent: 'panel' })
    await service.execute('panel', {
      sessionId: 'main',
      requestId: 1,
      resultId: panel.bestSearchResults[0].resultId
    })
    launch.mockResolvedValueOnce({ success: false, error: 'launch failed' })
    await service.execute('main', { sessionId: 'main', requestId: 1, resultId: command.resultId })
    expect(write).not.toHaveBeenCalledWith('search-preference', expect.anything())
  })
})
