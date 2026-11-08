import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { watch } from 'vue'
import { useCommandDataStore } from '../../src/renderer/src/stores/commandDataStore'
import { commandServiceFixture } from '../helpers/commandService'
import {
  emptyCommandSearchResult,
  type CommandContext,
  type CommandSearchRequest,
  type CommandSearchResult,
  type CommandSearchUpdate,
  type MainPushGroup
} from '../../src/shared/commandService'

/**
 * 构造测试输入快照。
 * @param searchQuery 搜索文本
 * @returns 完整输入
 */
function input(searchQuery: string): CommandContext {
  return { searchQuery, pastedFiles: null, pastedImage: null, pastedText: null }
}

/**
 * 为指定查询构造可辨别身份的结果。
 * @param request 查询版本
 * @returns 静态结果
 */
function response(request: CommandSearchRequest): CommandSearchResult {
  const command = {
    name: request.context.searchQuery,
    path: '/fixture',
    type: 'plugin' as const,
    resultId: 'result-' + request.requestId
  }
  return {
    ...emptyCommandSearchResult(request),
    bestSearchResults: [command],
    allListModeResults: [command]
  }
}

/**
 * 创建由用例控制完成时间的查询。
 * @returns Promise 与完成控制器
 */
function deferred(): {
  promise: Promise<CommandSearchResult>
  resolve: (value: CommandSearchResult) => void
  reject: (error: Error) => void
} {
  let resolve!: (value: CommandSearchResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<CommandSearchResult>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/**
 * 创建可区分完成顺序的动态分组。
 * @param resultId 静态候选身份
 * @returns 插件分组
 */
function group(resultId: string): MainPushGroup {
  return {
    resultId,
    featureKey: resultId,
    pluginPath: '/fixture',
    pluginName: 'fixture',
    pluginLogo: '',
    featureCode: resultId,
    featureExplain: resultId,
    matchedCmdType: 'text',
    items: [{ text: resultId }]
  }
}

describe('main search display snapshots', () => {
  let pinia: ReturnType<typeof createPinia>
  let store: ReturnType<typeof useCommandDataStore>
  let update: (result: CommandSearchUpdate) => void
  const query = vi.fn<(request: CommandSearchRequest) => Promise<CommandSearchResult>>()
  const execute = vi.fn().mockResolvedValue({ success: true })
  const cancel = vi.fn()
  const releaseSearch = vi.fn()

  beforeEach(async () => {
    query.mockReset().mockImplementation(async (request) => response(request))
    execute.mockReset().mockResolvedValue({ success: true })
    cancel.mockReset()
    releaseSearch.mockReset()
    vi.stubGlobal('window', {
      ztools: {
        commands: {
          query,
          execute,
          cancel,
          releaseSearch,
          getHome: vi.fn().mockResolvedValue({
            history: [],
            pinned: [],
            superPanelPinned: [],
            recommendationPins: []
          }),
          onSearchUpdate: vi.fn((callback) => {
            update = callback
            return () => {}
          }),
          onStateChanged: vi.fn(() => () => {})
        }
      }
    })
    pinia = createPinia()
    setActivePinia(pinia)
    store = useCommandDataStore()
    await store.initializeData()
    await store.query(input('old'), true)
  })

  afterEach(() => {
    disposePinia(pinia)
    vi.unstubAllGlobals()
  })

  it('keeps results and highlights until one atomic display commit', async () => {
    const delayed = deferred()
    query.mockReturnValueOnce(delayed.promise)
    const displays: string[][] = []
    const stop = watch(
      () => [store.displayContext.searchQuery, store.result.bestSearchResults[0]?.name],
      (value) => displays.push(value),
      { flush: 'sync' }
    )
    const searching = store.query(input('new'), true)
    expect(store.searchPending).toBe(true)
    expect(store.result.bestSearchResults[0].name).toBe('old')
    expect(store.displayContext.searchQuery).toBe('old')
    expect(displays).toEqual([])
    delayed.resolve(response(query.mock.calls.at(-1)![0]))
    await searching
    expect(displays).toEqual([['new', 'new']])
    expect(store.searchPending).toBe(false)
    stop()
  })

  it('rejects out of order replies and dynamic updates from the previous input', async () => {
    const oldResult = store.result
    const delayed = deferred()
    query.mockReturnValueOnce(delayed.promise)
    const older = store.query(input('middle'), true)
    const middleRequest = query.mock.calls.at(-1)![0]
    await store.query(input('latest'), true)
    update({
      sessionId: oldResult.sessionId,
      requestId: oldResult.requestId,
      group: group('stale')
    })
    delayed.resolve(response(middleRequest))
    await older
    expect(store.result.bestSearchResults[0].name).toBe('latest')
    expect(store.displayContext.searchQuery).toBe('latest')
    expect(releaseSearch).toHaveBeenCalledWith(oldResult.sessionId, oldResult.requestId)
    expect(releaseSearch).toHaveBeenCalledWith(middleRequest.sessionId, middleRequest.requestId)
  })

  it('keeps execution immediate while a new display query is pending', async () => {
    const oldCommand = store.result.bestSearchResults[0]
    const delayed = deferred()
    query.mockReturnValueOnce(delayed.promise)
    const searching = store.query(input('new'), true)
    expect((await store.execute(oldCommand)).success).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: store.result.requestId,
        resultId: oldCommand.resultId
      })
    )
    delayed.resolve(response(query.mock.calls.at(-1)![0]))
    await searching
  })

  it('executes the visible result through the real service with its original payload', async () => {
    const fixture = commandServiceFixture({
      plugins: [
        {
          name: 'fixture',
          title: 'Fixture',
          path: '/fixture',
          features: [
            { code: 'regex', cmds: [{ type: 'regex', label: 'Select text', match: '/old|new/' }] }
          ]
        }
      ]
    })
    query.mockImplementation((request) => fixture.service.query('renderer', request))
    execute.mockImplementation((request) => fixture.service.execute('renderer', request))
    releaseSearch.mockImplementation((sessionId, requestId) =>
      fixture.service.releaseSearch('renderer', sessionId, requestId)
    )
    cancel.mockImplementation((sessionId, requestId) =>
      fixture.service.cancel('renderer', sessionId, requestId)
    )
    await store.query(input('old'), true)
    const visible = store.result.bestMatches[0]
    const visibleRequest = store.result.requestId
    const delayed = deferred()
    let latest: CommandSearchResult | undefined
    query.mockImplementationOnce(async (request) => {
      latest = await fixture.service.query('renderer', request)
      return delayed.promise
    })
    const searching = store.query(input('new'), true)
    await vi.waitFor(() => expect(latest).toBeDefined())
    expect(releaseSearch).not.toHaveBeenCalledWith(store.result.sessionId, visibleRequest)
    expect((await store.execute(visible)).success).toBe(true)
    expect(fixture.launch).toHaveBeenCalledWith(
      expect.objectContaining({ param: expect.objectContaining({ payload: 'old' }) })
    )
    delayed.resolve(latest!)
    await searching
    expect(releaseSearch).toHaveBeenCalledWith(store.result.sessionId, visibleRequest)
  })

  it('buffers early dynamic groups and merges later deltas without replacing static arrays', async () => {
    const delayed = deferred()
    query.mockReturnValueOnce(delayed.promise)
    const searching = store.query(input('dynamic'), true)
    const request = query.mock.calls.at(-1)![0]
    const base = response(request)
    base.mainPushCandidates = ['first', 'second'].map((resultId) => ({
      name: resultId,
      path: '/fixture',
      type: 'plugin',
      resultId
    }))
    update({ sessionId: request.sessionId, requestId: request.requestId, group: group('second') })
    expect(store.result.mainPushGroups).toEqual([])
    expect(store.searchPending).toBe(true)
    delayed.resolve(base)
    await searching
    expect(store.result.mainPushGroups.map((item) => item.resultId)).toEqual(['second'])
    const staticResults = store.result.bestSearchResults
    update({ sessionId: request.sessionId, requestId: request.requestId, group: group('first') })
    expect(store.result.mainPushGroups.map((item) => item.resultId)).toEqual(['first', 'second'])
    expect(store.result.bestSearchResults).toBe(staticResults)
    expect(store.displayContext.searchQuery).toBe('dynamic')
  })

  it('publishes a failure state rather than leaving stale results executable', async () => {
    query.mockRejectedValueOnce(new Error('IPC unavailable'))
    const searching = store.query(input('new'), true)
    await expect(searching).rejects.toThrow('IPC unavailable')
    expect(store.searchPending).toBe(false)
    expect(store.result.bestSearchResults).toEqual([])
    expect(store.result.error).toBe('IPC unavailable')
    expect(store.displayContext.searchQuery).toBe('new')
  })

  it('cancels the query without allowing delayed results to revive the page', async () => {
    const delayed = deferred()
    query.mockReturnValueOnce(delayed.promise)
    const searching = store.query(input('new'), true)
    const request = query.mock.calls.at(-1)![0]
    store.cancelQuery()
    delayed.resolve(response(request))
    await searching
    expect(store.searchPending).toBe(false)
    expect(store.result.bestSearchResults).toEqual([])
    expect(cancel).toHaveBeenCalledWith(request.sessionId, request.requestId + 1)
  })
})
