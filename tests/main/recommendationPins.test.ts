import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandServiceFixture } from '../helpers/commandService'
import { getRecommendationPinKey, type Command } from '../../src/shared/commandService'

const commands: Command[] = [
  { name: '普通推荐', path: '/normal', type: 'plugin', featureCode: 'normal' },
  { name: '置顶 A', path: '/a', type: 'plugin', featureCode: 'a' },
  { name: '置顶 B', path: '/b', type: 'plugin', featureCode: 'b' }
]

/**
 * 创建拥有真实推荐规则的主进程服务。
 * @returns 推荐测试夹具
 */
function fixture(): ReturnType<typeof commandServiceFixture> & { order: () => Promise<string[]> } {
  const test = commandServiceFixture(
    {
      plugins: commands.map((command) => ({
        name: command.path,
        path: command.path,
        main: 'index.html',
        features: [{ code: command.featureCode, cmds: [{ type: 'over', label: command.name }] }]
      }))
    },
    { 'pinned-commands': [{ name: '固定栏项目', path: '/fixed', type: 'direct' }] }
  )
  let id = 0
  return {
    ...test,
    order: async () =>
      (
        await test.service.query('main', {
          sessionId: 'recommendation',
          requestId: ++id,
          context: { searchQuery: 'input', pastedImage: null, pastedFiles: null, pastedText: null }
        })
      ).recommendations.map((item) => item.name)
  }
}

describe('主进程匹配推荐置顶', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('插件版本路径变化后继续使用插件名称和功能代码', () => {
    const command: Command = {
      name: '翻译',
      path: '/old',
      pluginName: 'translate',
      type: 'plugin',
      featureCode: 'translate'
    }
    expect(getRecommendationPinKey(command)).toBe(
      getRecommendationPinKey({ ...command, path: '/new' })
    )
  })

  it('只写入独立的推荐文档，不修改主页固定栏', async () => {
    const { service, write, storage } = fixture()
    await service.recommendation({ action: 'pin', command: commands[1] })
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0][0]).toBe('recommendation-pinned')
    expect(storage.get('pinned-commands')[0].name).toBe('固定栏项目')
  })

  it('按独立置顶序列优先展示推荐', async () => {
    const { service, order } = fixture()
    await service.recommendation({ action: 'pin', command: commands[1] })
    await service.recommendation({ action: 'pin', command: commands[2] })
    expect(await order()).toEqual(['置顶 A', '置顶 B', '普通推荐'])
  })

  it('排到最前只调整推荐序列', async () => {
    const { service, order, write } = fixture()
    await service.recommendation({ action: 'pin', command: commands[1] })
    await service.recommendation({ action: 'pin', command: commands[2] })
    write.mockClear()
    await service.recommendation({ action: 'front', command: commands[2] })
    expect(await order()).toEqual(['置顶 B', '置顶 A', '普通推荐'])
    expect(write).toHaveBeenCalledWith('recommendation-pinned', expect.any(Array))
  })

  it('取消置顶后恢复使用统计产生的原始顺序', async () => {
    const { service, order } = fixture()
    await service.recommendation({ action: 'pin', command: commands[2] })
    await service.recommendation({ action: 'unpin', command: commands[2] })
    expect(await order()).toEqual(['普通推荐', '置顶 A', '置顶 B'])
  })
})
