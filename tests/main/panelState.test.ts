import { describe, expect, it } from 'vitest'
import {
  applyPanelMutation,
  normalizePanelState,
  panelItemKey
} from '../../src/main/core/commands/panelState'

const command = (name: string): { name: string; path: string; type: string } => ({
  name,
  path: '/' + name,
  type: 'direct'
})
const a = command('a'),
  b = command('b'),
  c = command('c')
const folder = { isFolder: true, id: 'folder', name: 'folder', items: [a, b] }

describe('主进程面板文件夹操作', () => {
  it('移动后合并只保存一份源项，不修改调用方快照', () => {
    const original = [a, b, c]
    const result = applyPanelMutation(original, {
      action: 'move',
      sourceKey: panelItemKey(a),
      targetKey: panelItemKey(b)
    })
    expect(result).toHaveLength(2)
    expect(result[0].items).toEqual([b, a])
    expect(original).toEqual([a, b, c])
  })

  it('移出后自动解散只剩一项的文件夹并使用稳定插入锚点', () => {
    const result = applyPanelMutation([folder, c], {
      action: 'move',
      sourceKey: panelItemKey(a),
      beforeKey: panelItemKey(c)
    })
    expect(result).toEqual([b, a, c])
  })

  it('文件夹内部排序保留文件夹身份', () => {
    const result = applyPanelMutation([folder, c], {
      action: 'move',
      sourceKey: panelItemKey(b),
      containerKey: panelItemKey(folder),
      beforeKey: panelItemKey(a)
    })
    expect(result[0]).toMatchObject({ id: 'folder', items: [b, a] })
  })

  it('移除内部项目后在主进程退化文件夹', () => {
    expect(applyPanelMutation([folder, c], { action: 'remove', key: panelItemKey(a) })).toEqual([
      b,
      c
    ])
  })

  it('重命名和解散在服务端校验，拒绝空名和失效身份', () => {
    expect(
      applyPanelMutation([folder], {
        action: 'rename',
        key: panelItemKey(folder),
        name: ' New '
      })[0].name
    ).toBe('New')
    expect(applyPanelMutation([folder], { action: 'ungroup', key: panelItemKey(folder) })).toEqual([
      a,
      b
    ])
    expect(() =>
      applyPanelMutation([folder], { action: 'rename', key: panelItemKey(folder), name: ' ' })
    ).toThrow()
    expect(() => applyPanelMutation([folder], { action: 'remove', key: 'gone' })).toThrow()
  })

  it('拒绝嵌套和重复指令，允许主动创建单项目文件夹进行改名', () => {
    expect(() => normalizePanelState([folder, a])).toThrow('重复')
    expect(() => normalizePanelState([{ ...folder, items: [folder] }])).toThrow('嵌套')
    const result = applyPanelMutation([a], { action: 'new-folder', key: panelItemKey(a) })
    expect(result[0]).toMatchObject({ isFolder: true, items: [a] })
    expect(result[0].id).toBeTruthy()
  })
})
