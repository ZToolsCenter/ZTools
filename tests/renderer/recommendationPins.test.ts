import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRecommendationPinKey,
  useCommandDataStore,
  type Command
} from '../../src/renderer/src/stores/commandDataStore'

describe('匹配推荐置顶', () => {
  const dbPut = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    setActivePinia(createPinia())
    dbPut.mockClear()
    vi.stubGlobal('window', {
      ztools: {
        dbPut
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('插件版本路径变化后仍使用插件名称和功能代码识别同一推荐', () => {
    const oldCommand: Command = {
      name: '翻译',
      path: '/plugins/translate-1.0.0.asar',
      type: 'plugin',
      featureCode: 'translate',
      pluginName: 'translate'
    }
    const newCommand: Command = {
      ...oldCommand,
      path: '/plugins/translate-2.0.0.asar'
    }

    expect(getRecommendationPinKey(oldCommand)).toBe(getRecommendationPinKey(newCommand))
  })

  it('置顶推荐时只写入独立的 recommendation-pinned 文档', async () => {
    const store = useCommandDataStore()
    store.pinnedCommands = [{ name: '固定栏项目', path: '/fixed', type: 'direct', subType: 'app' }]
    const command: Command = {
      name: '翻译',
      path: '/plugins/translate.asar',
      type: 'plugin',
      featureCode: 'translate',
      pluginName: 'translate'
    }

    await store.pinRecommendation(command)

    expect(store.isRecommendationPinned(command)).toBe(true)
    expect(store.pinnedCommands.map((item) => item.name)).toEqual(['固定栏项目'])
    expect(dbPut).toHaveBeenCalledOnce()
    expect(dbPut.mock.calls[0][0]).toBe('recommendation-pinned')
  })

  it('已置顶推荐应按置顶序列排在普通推荐之前', async () => {
    const store = useCommandDataStore()
    const commands: Command[] = [
      { name: '普通推荐', path: '/normal', type: 'plugin', featureCode: 'normal' },
      { name: '置顶 A', path: '/a', type: 'plugin', featureCode: 'a' },
      { name: '置顶 B', path: '/b', type: 'plugin', featureCode: 'b' }
    ]

    await store.pinRecommendation(commands[1])
    await store.pinRecommendation(commands[2])

    expect(store.sortRecommendations(commands).map((item) => item.name)).toEqual([
      '置顶 A',
      '置顶 B',
      '普通推荐'
    ])
  })

  it('排到最前应只调整推荐置顶序列', async () => {
    const store = useCommandDataStore()
    const commands: Command[] = [
      { name: '置顶 A', path: '/a', type: 'plugin', featureCode: 'a' },
      { name: '置顶 B', path: '/b', type: 'plugin', featureCode: 'b' }
    ]
    await store.pinRecommendation(commands[0])
    await store.pinRecommendation(commands[1])
    dbPut.mockClear()

    await store.moveRecommendationToFront(commands[1])

    expect(store.sortRecommendations(commands).map((item) => item.name)).toEqual([
      '置顶 B',
      '置顶 A'
    ])
    expect(dbPut).toHaveBeenCalledWith('recommendation-pinned', expect.any(Array))
  })

  it('取消置顶后应恢复为传入的原始推荐顺序', async () => {
    const store = useCommandDataStore()
    const commands: Command[] = [
      { name: '高频推荐', path: '/high', type: 'plugin', featureCode: 'high' },
      { name: '低频推荐', path: '/low', type: 'plugin', featureCode: 'low' }
    ]
    await store.pinRecommendation(commands[1])

    await store.unpinRecommendation(commands[1])

    expect(store.sortRecommendations(commands).map((item) => item.name)).toEqual([
      '高频推荐',
      '低频推荐'
    ])
  })
})
