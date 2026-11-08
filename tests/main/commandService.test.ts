import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { commandServiceFixture } from '../helpers/commandService'
import { getCommandId } from '../../src/shared/commandShared'
import { SearchWorkerClient } from '../../src/main/core/commands/workerClient'
import { type CommandContext, type CommandSearchRequest } from '../../src/shared/commandService'

const context = (searchQuery = '', pastedText: string | null = null): CommandContext => ({
  searchQuery,
  pastedText,
  pastedImage: null,
  pastedFiles: null
})
const request = (requestId: number, input: CommandContext): CommandSearchRequest => ({
  sessionId: 'same',
  requestId,
  context: input
})
const plugin = (cmds: any[], mainPush = false): any => ({
  name: 'fixture',
  title: 'Fixture',
  path: '/fixture',
  main: 'index.html',
  features: [{ code: 'feature', explain: 'feature', cmds, mainPush }]
})

describe('主进程统一指令业务', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('输入与粘贴共用 regex flags 和 over 排除规则', async () => {
    const { service } = commandServiceFixture({
      plugins: [
        plugin([
          { type: 'regex', label: 'regex', match: '/abc/i' },
          { type: 'over', label: 'over', exclude: '/\\d+/i' }
        ])
      ]
    })
    const typed = await service.query('main', request(1, context('ABC')))
    const pasted = await service.query('panel', request(1, context('', 'ABC')))
    expect(typed.bestMatches.map((item) => item.name)).toEqual(['regex'])
    expect(pasted.bestMatches.map((item) => item.name)).toEqual(['regex'])
    expect((await service.query('main', request(2, context('123')))).recommendations).toEqual([])
    expect((await service.query('panel', request(2, context('', '123')))).recommendations).toEqual(
      []
    )
  })

  it('匹配型别名继承原规则，在内容满足后才展示，并保持原 payload', async () => {
    const original = {
      name: 'regex',
      pluginName: 'fixture',
      featureCode: 'feature',
      cmdType: 'regex'
    }
    const { service, launch } = commandServiceFixture({
      plugins: [plugin([{ type: 'regex', label: 'regex', match: '/abc/i' }])],
      aliases: { [getCommandId(original)]: [{ alias: 'Alias' }] }
    })
    expect((await service.query('main', request(1, context('Alias')))).allListModeResults).toEqual(
      []
    )
    const result = await service.query('main', request(2, context('Alias', 'ABC')))
    const selected = result.bestMatches[0]
    expect(selected.name).toBe('Alias')
    const response = await service.execute('main', {
      sessionId: 'same',
      requestId: 2,
      resultId: selected.resultId,
      context: context('hijacked')
    })
    expect(response.success).toBe(true)
    expect(launch.mock.calls[0][0].param.payload).toBe('ABC')
  })

  it('同名会话按窗口隔离，面板查询不会覆盖主窗口输入', async () => {
    const { service, launch } = commandServiceFixture({
      plugins: [plugin([{ type: 'over', label: 'over' }])]
    })
    const main = await service.query('main', request(1, context('main input')))
    await service.query('panel', request(1, context('panel input')))
    await service.execute('main', {
      sessionId: 'same',
      requestId: 1,
      resultId: main.recommendations[0].resultId
    })
    expect(launch.mock.calls[0][0].param.payload).toBe('main input')
  })

  it('新输入停止旧动态更新，但已展示的旧结果仍使用原输入执行', async () => {
    let resolveOld!: (items: any[]) => void
    const { service, queryMainPush, launch } = commandServiceFixture({
      plugins: [plugin([{ type: 'over', label: 'push' }], true)],
      enabledMainPushPlugins: ['fixture']
    })
    queryMainPush.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    const updates = vi.fn()
    const old = await service.query('main', request(1, context('old')), updates)
    await vi.advanceTimersByTimeAsync(300)
    await service.query('main', request(2, context('new')), updates)
    resolveOld([{ text: 'old result' }])
    await vi.advanceTimersByTimeAsync(1)
    expect(updates).not.toHaveBeenCalled()
    expect(
      (
        await service.execute('main', {
          sessionId: 'same',
          requestId: 1,
          resultId: old.recommendations[0].resultId
        })
      ).success
    ).toBe(true)
    expect(launch.mock.calls[0][0].param.payload).toBe('old')
  })

  it('每个动态插件独立发布，慢插件不阻塞快插件', async () => {
    const slow = plugin([{ type: 'over', label: 'slow' }], true)
    const fast = { ...plugin([{ type: 'over', label: 'fast' }], true), name: 'fast', path: '/fast' }
    const { service, queryMainPush } = commandServiceFixture({
      plugins: [slow, fast],
      enabledMainPushPlugins: ['fixture', 'fast']
    })
    queryMainPush.mockImplementation((path: string) =>
      path === '/fixture' ? new Promise(() => {}) : Promise.resolve([{ text: 'ready' }])
    )
    const updates = vi.fn()
    await service.query('main', request(1, context('input')), updates)
    await vi.advanceTimersByTimeAsync(300)
    expect(updates.mock.calls[0][0].group.pluginPath).toBe('/fast')
    expect(updates.mock.calls[0][0]).not.toHaveProperty('bestSearchResults')
  })

  it('动态选项使用粘贴快照，去除内部图标字段并由主进程完成进入', async () => {
    const { service, queryMainPush, selectMainPush, launch } = commandServiceFixture({
      plugins: [plugin([{ type: 'over', label: 'push' }], true)],
      enabledMainPushPlugins: ['fixture']
    })
    queryMainPush.mockResolvedValue([
      { text: 'option', icon: './icon.png', _resolvedIcon: 'file:///icon.png' }
    ])
    const updates = vi.fn()
    await service.query('main', request(1, context('filter', 'pasted payload')), updates)
    await vi.advanceTimersByTimeAsync(300)
    const group = updates.mock.calls[0][0].group
    const response = await service.execute('main', {
      sessionId: 'same',
      requestId: 1,
      resultId: group.resultId,
      option: group.items[0]
    })
    expect(response.success).toBe(true)
    expect(selectMainPush.mock.calls[0][2].payload).toBe('pasted payload')
    expect(launch.mock.calls[0][0].param.option).toEqual({ text: 'option', icon: './icon.png' })
  })

  it('目录更新后重新校验禁用和规则，旧结果不能绕过服务执行', async () => {
    const { service, input, launch } = commandServiceFixture({ plugins: [plugin(['Launch'])] })
    const result = await service.query('main', request(1, context('Launch')))
    input.disabledPlugins.push('/fixture')
    service.invalidate()
    expect(
      (
        await service.execute('main', {
          command: result.bestSearchResults[0],
          context: context('Launch')
        })
      ).success
    ).toBe(false)
    expect(launch).not.toHaveBeenCalled()
  })

  it('仅验证所选内容规则，不重新运行完整搜索，图片原文只用于启动', async () => {
    const { service, worker, launch } = commandServiceFixture({
      plugins: [plugin([{ type: 'img', label: 'Image' }])]
    })
    const input = { ...context(), pastedImage: 'data:image/png;base64,fixture' }
    const result = await service.query('main', request(1, input))
    expect(result).not.toHaveProperty('context')
    expect(result).not.toHaveProperty('catalogRevision')
    expect(worker.query).toHaveBeenCalledWith(
      expect.objectContaining({ context: { ...input, pastedImage: true } }),
      { preference: {}, usage: [], recommendationPins: [] }
    )
    expect(vi.mocked(worker.query).mock.calls[0][0]).not.toHaveProperty('sessionId')
    const command = result.bestMatches[0]
    expect(
      await service.execute('main', {
        sessionId: 'same',
        requestId: 1,
        resultId: command.resultId
      })
    ).toEqual({ success: true })
    expect(worker.query).toHaveBeenCalledOnce()
    expect(worker.validateCommand).toHaveBeenCalledWith(command.ruleId, {
      ...input,
      pastedImage: true
    })
    expect(launch.mock.calls[0][0].param.payload).toBe(input.pastedImage)
  })

  it('无动态订阅者的搜索和面板搜索不触发插件计算', async () => {
    const { service, worker, queryMainPush } = commandServiceFixture({
      plugins: [plugin([{ type: 'over', label: 'Push' }], true)],
      enabledMainPushPlugins: ['fixture']
    })
    const direct = await service.query('main', request(1, context('payload')))
    const panel = await service.query(
      'panel',
      { ...request(1, context('payload')), intent: 'panel' },
      vi.fn()
    )
    await vi.advanceTimersByTimeAsync(400)
    expect(direct.mainPushCandidates).toEqual([])
    expect(panel.mainPushCandidates).toEqual([])
    expect(queryMainPush).not.toHaveBeenCalled()
    expect(vi.mocked(worker.query).mock.calls.every(([query]) => !query.includeMainPush)).toBe(true)
  })

  it('释放展示后不再接受新点击，但已经排队的选择保持原始上下文', async () => {
    const { service, launch } = commandServiceFixture({ plugins: [plugin(['Launch'])] })
    const result = await service.query('main', request(1, context('Launch')))
    const selection = {
      sessionId: 'same',
      requestId: 1,
      resultId: result.bestSearchResults[0].resultId
    }
    const executing = service.execute('main', selection)
    service.releaseSearch('main', 'same', 1)
    expect(await executing).toEqual({ success: true })
    expect(launch.mock.calls[0][0].param.payload).toBe('Launch')
    expect((await service.execute('main', selection)).success).toBe(false)
    expect(launch).toHaveBeenCalledOnce()
  })

  it('新输入不改变已显示动态选项的输入，且初始结果对象保持不变', async () => {
    const { service, queryMainPush, launch } = commandServiceFixture({
      plugins: [plugin([{ type: 'over', label: 'Push' }], true)],
      enabledMainPushPlugins: ['fixture']
    })
    queryMainPush.mockResolvedValue([{ text: 'old option' }])
    const update = vi.fn()
    const original = await service.query('main', request(1, context('old')), update)
    await vi.advanceTimersByTimeAsync(300)
    const group = update.mock.calls[0][0].group
    expect(original.mainPushGroups).toEqual([])
    await service.query('main', request(2, context('new')), update)
    const selected = {
      sessionId: 'same',
      requestId: 1,
      resultId: group.resultId,
      option: group.items[0]
    }
    expect((await service.execute('main', selected)).success).toBe(true)
    expect(launch.mock.calls[0][0].param.payload).toBe('old')
    expect(
      (await service.execute('main', { ...selected, option: { text: 'not issued' } })).success
    ).toBe(false)
  })

  it('目录重建后不发布重建前的动态回调，仍按新目录校验点击', async () => {
    const { service, input, queryMainPush, launch } = commandServiceFixture({
      plugins: [plugin([{ type: 'over', label: 'Push' }], true)],
      enabledMainPushPlugins: ['fixture']
    })
    let finish!: (items: any[]) => void
    queryMainPush.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const update = vi.fn()
    const result = await service.query('main', request(1, context('old')), update)
    await vi.advanceTimersByTimeAsync(300)
    input.disabledPlugins.push('fixture')
    service.invalidate()
    await service.getCatalog()
    finish([{ text: 'old option' }])
    await vi.advanceTimersByTimeAsync(1)
    expect(update).not.toHaveBeenCalled()
    expect(
      (
        await service.execute('main', {
          sessionId: 'same',
          requestId: 1,
          resultId: result.recommendations[0].resultId
        })
      ).success
    ).toBe(false)
    expect(launch).not.toHaveBeenCalled()
  })

  it('目录加载期间只向 Worker 派发同一通道的最新查询', async () => {
    const { service, sources, input, worker } = commandServiceFixture({
      plugins: [plugin(['Launch'])]
    })
    let finish!: (catalog: typeof input) => void
    sources.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const older = service.query('main', request(1, context('L')))
    const latest = service.query('main', request(2, context('Launch')))
    finish(input)
    expect((await older).allListModeResults).toEqual([])
    expect((await latest).bestSearchResults[0].name).toBe('Launch')
    expect(worker.query).toHaveBeenCalledOnce()
  })

  it('加载旧偏好时统一关键词格式，并优先已有规范键', async () => {
    const { service, worker } = commandServiceFixture(
      {},
      {
        'search-preference': {
          ' ＷＸ ': { path: '/legacy', name: 'Legacy' },
          wx: { path: '/canonical', name: 'Canonical' }
        }
      }
    )
    await service.query('main', request(1, context('wx')))
    expect(vi.mocked(worker.query).mock.calls[0][1].preference).toEqual({
      wx: { path: '/canonical', name: 'Canonical' }
    })
  })

  it('精确目标在同名规则中按输入选择，并拒绝不同插件的歧义', async () => {
    const { service, launch, input, worker } = commandServiceFixture({
      plugins: [plugin(['Launch', { type: 'img', label: 'Launch' }])]
    })
    await service.execute('shortcut', {
      target: 'fixture / Launch',
      context: { ...context(), pastedImage: 'image' },
      source: 'global-shortcut'
    })
    expect(launch.mock.calls[0][0].param.type).toBe('img')
    expect(worker.query).toHaveBeenCalledOnce()
    expect(worker.validateCommand).not.toHaveBeenCalled()
    input.plugins.push({ ...plugin(['Launch']), name: 'other', path: '/other' })
    service.invalidate()
    const result = await service.execute('shortcut', { target: 'Launch', context: context('text') })
    expect(result.success).toBe(false)
    expect(result.error).toContain('多个指令')
  })

  it('列表分组保持搜索偏好，而不是重新按应用类型排序', async () => {
    const { service } = commandServiceFixture(
      { apps: [{ name: 'Chrome', path: '/chrome' }], plugins: [plugin(['Chart'])] },
      { 'search-preference': { ch: { name: 'Chart', path: '/fixture', featureCode: 'feature' } } }
    )
    const result = await service.query('main', request(1, context('ch')))
    expect(result.bestSearchResults[0].name).toBe('Chart')
    expect(result.allListModeResults[0].name).toBe('Chart')
  })

  it('目录迁移恢复历史名称、安装路径和文件夹身份，不修改旧持久化记录', async () => {
    const { service, storage } = commandServiceFixture(
      { plugins: [plugin(['New'])] },
      {
        'command-history': [
          {
            name: 'Old alias',
            path: '/old-version',
            type: 'plugin',
            featureCode: 'feature',
            pluginName: 'fixture'
          }
        ]
      }
    )
    const home = await service.getHome()
    expect(home.history[0]).toMatchObject({
      name: 'New',
      path: '/fixture',
      persistedName: 'Old alias'
    })
    expect(storage.get('command-history')[0].name).toBe('Old alias')
  })

  it('窗口释放后旧动态任务不能发布', async () => {
    const { service, queryMainPush } = commandServiceFixture({
      plugins: [plugin([{ type: 'over', label: 'push' }], true)],
      enabledMainPushPlugins: ['fixture']
    })
    queryMainPush.mockResolvedValue([{ text: 'result' }])
    const update = vi.fn()
    await service.query('main', request(1, context('input')), update)
    service.release('main')
    await vi.advanceTimersByTimeAsync(300)
    expect(update).not.toHaveBeenCalled()
  })

  it('本机应用搜索关闭后仍能展示并启动历史和固定应用', async () => {
    const app = { name: 'Editor', path: '/Editor.app', type: 'direct' }
    const { service, launch } = commandServiceFixture(
      { apps: [app], localAppSearchEnabled: false },
      { 'command-history': [app], 'pinned-commands': [app] }
    )
    expect((await service.query('main', request(1, context('Editor')))).bestSearchResults).toEqual(
      []
    )
    const home = await service.getHome()
    expect(home.history).toHaveLength(1)
    expect(home.pinned).toHaveLength(1)
    expect((await service.execute('main', { command: home.pinned[0] })).success).toBe(true)
    expect(launch).toHaveBeenCalledOnce()
  })

  it.each([
    {
      name: '微信',
      path: '/Applications/WeChat.app',
      apps: [{ name: 'WeChat', path: '/Applications/WeChat.app', aliases: ['微信'] }]
    },
    { name: '设置', path: 'settings:test', settings: [{ name: '设置', uri: 'settings:test' }] },
    {
      name: '启动项',
      path: '/fixture/shortcut',
      localShortcuts: [{ name: '启动项', path: '/fixture/shortcut' }]
    }
  ])('超级面板固定的 $name 兼容空字符串功能代码', async ({ name, path, ...sources }) => {
    const command = {
      name,
      path,
      type: 'direct' as const,
      featureCode: '',
      cmdType: 'text' as const
    }
    const { service, launch } = commandServiceFixture(sources, { 'super-panel-pinned': [command] })
    const result = await service.execute('super-panel', { command, source: 'super-panel' })
    expect(result).toEqual({ success: true })
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ path, type: 'direct', launchSource: 'super-panel' })
    )
  })

  it('旧文件夹身份在主进程持久化，后续加载与改名保持同一身份', async () => {
    const apps = [
      { name: 'A', path: '/A', type: 'direct' },
      { name: 'B', path: '/B', type: 'direct' }
    ]
    const { service, storage } = commandServiceFixture(
      { apps },
      { 'super-panel-pinned': [{ isFolder: true, name: 'Legacy', items: apps }] }
    )
    const folder = (await service.getHome()).superPanelPinned[0]
    expect(folder.id).toBeTruthy()
    expect(storage.get('super-panel-pinned')[0].id).toBe(folder.id)
    expect(service.getPanelState()[0].id).toBe(folder.id)
    expect(
      service.panelMutation({ action: 'rename', key: 'folder-' + folder.id, name: 'New' }).success
    ).toBe(true)
    expect(service.getPanelState()[0].name).toBe('New')
  })

  it('稳定插件名禁用配置无需依赖旧安装路径缓存', async () => {
    const { service } = commandServiceFixture({
      plugins: [plugin(['Launch'])],
      disabledPlugins: ['fixture']
    })
    expect((await service.query('main', request(1, context('Launch')))).bestSearchResults).toEqual(
      []
    )
  })

  it('重复使用带 g flag 的编译规则，每次查询都从头匹配', async () => {
    const { service } = commandServiceFixture({
      plugins: [plugin([{ type: 'regex', label: 'regex', match: '/abc/g' }])]
    })
    for (let index = 1; index <= 3; index++) {
      expect(
        (await service.query('main', request(index, context('abc')))).bestMatches[0].name
      ).toBe('regex')
    }
  })

  it('面板状态保存失败时返回原列表，不能报告成功或发布未保存状态', () => {
    const items = [{ name: 'A', path: '/A', type: 'direct' }]
    const { service, write, storage } = commandServiceFixture({}, { 'super-panel-pinned': items })
    write.mockImplementation(() => {
      throw new Error('disk failure')
    })
    expect(service.panelMutation({ action: 'remove', key: '/A--A' })).toMatchObject({
      success: false,
      items,
      error: 'disk failure'
    })
    expect(storage.get('super-panel-pinned')).toEqual(items)
  })
})

describe('隔离线程预算与恢复', () => {
  it('真正终止阻塞线程，并为下一次查询及单条规则验证重建缓存目录', async () => {
    const created: Worker[] = []
    const client = new SearchWorkerClient(() => {
      const worker = new Worker(
        `const { parentPort } = require('node:worker_threads');
        parentPort.on('message', task => {
          if ((task.type === 'query' && task.request.context.searchQuery === 'block') ||
              (task.type === 'validate' && task.ruleId === 'block')) { while (true) {} }
          const value = task.type === 'catalog'
            ? { commands: [], rules: [], canonical: [], plugins: [] }
            : task.type === 'validate'
              ? task.ruleId === 'selected' && task.context.pastedImage === true
              : { bestSearchResults: [{ name: task.request.context.searchQuery }] };
          parentPort.postMessage({ id: task.id, value });
        });`,
        { eval: true }
      )
      created.push(worker)
      return worker
    }, 150)
    const rankState = { recommendationPins: [], usage: [], preference: {} }
    try {
      await client.publish({
        apps: [],
        plugins: [],
        settings: [],
        localShortcuts: [],
        aliases: {},
        disabledPlugins: [],
        disabledCommands: [],
        enabledMainPushPlugins: []
      })
      await expect(
        client.query({ context: { ...context('block'), pastedImage: false } }, rankState)
      ).rejects.toThrow('超时')
      const result = await client.query(
        { context: { ...context('okay'), pastedImage: false } },
        rankState
      )
      expect(result.bestSearchResults[0].name).toBe('okay')
      expect(created).toHaveLength(2)
      expect(await client.validateCommand('selected', { ...context(''), pastedImage: true })).toBe(
        true
      )
      await expect(
        client.validateCommand('block', { ...context(''), pastedImage: false })
      ).rejects.toThrow('超时')
      expect(await client.validateCommand('selected', { ...context(''), pastedImage: true })).toBe(
        true
      )
      expect(created).toHaveLength(3)
    } finally {
      client.dispose()
    }
  })

  it('串行线程排队时间不消耗后续任务的执行超时预算', async () => {
    const client = new SearchWorkerClient(
      () =>
        new Worker(
          `const { parentPort } = require('node:worker_threads');
      parentPort.on('message', task => {
        if (task.type === 'query') {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
        }
        parentPort.postMessage({ id: task.id, value: task.type === 'catalog'
          ? { commands: [], rules: [], canonical: [], plugins: [] }
          : { bestSearchResults: [{ name: task.request.context.searchQuery }] } });
      });`,
          { eval: true }
        ),
      500
    )
    try {
      await client.publish({
        apps: [],
        plugins: [],
        settings: [],
        localShortcuts: [],
        aliases: {},
        disabledPlugins: [],
        disabledCommands: [],
        enabledMainPushPlugins: []
      })
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          client.query(
            { context: { ...context(String(index)), pastedImage: false } },
            { recommendationPins: [], usage: [], preference: {} }
          )
        )
      )
      expect(results.map((result) => result.bestSearchResults[0].name)).toEqual([
        '0',
        '1',
        '2',
        '3',
        '4',
        '5'
      ])
    } finally {
      client.dispose()
    }
  })
})
