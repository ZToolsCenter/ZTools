import type { WebContentsView } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPluginInstanceContext } from '../../src/main/core/commands/pluginLaunchContext'
import { sendPluginLifecycle } from '../../src/main/core/pluginLifecycle'

/**
 * 创建可观察发送顺序和销毁状态的插件视图替身。
 * @returns 视图、消息发送函数和销毁操作
 */
function createView(): {
  view: WebContentsView
  send: ReturnType<typeof vi.fn>
  destroy: () => void
} {
  let destroyed = false
  const send = vi.fn()
  const contents = { id: 5, isDestroyed: () => destroyed, send }
  const view = { webContents: contents } as unknown as WebContentsView
  return {
    view,
    send,
    destroy: () => {
      destroyed = true
    }
  }
}

describe('plugin lifecycle dispatch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('sends exit before immediate view destruction and skips later notifications', () => {
    const { view, send, destroy } = createView()
    const operations: string[] = []
    send.mockImplementation(() => operations.push('exit'))

    // 退出通知必须在调用方随后的清理前发出，不能延迟到微任务中丢失。
    sendPluginLifecycle(view, 'PluginOut', true)
    destroy()
    operations.push('destroy')
    sendPluginLifecycle(view, 'PluginDetach')

    expect(operations).toEqual(['exit', 'destroy'])
    expect(send).toHaveBeenCalledExactlyOnceWith('plugin-out', true)
  })

  it('binds the latest immutable instance context before delivering re-entry', () => {
    const { view, send } = createView()
    const contexts: unknown[] = []
    send.mockImplementation(() => contexts.push(getPluginInstanceContext(view.webContents)))
    const first = { code: 'demo', type: 'text', payload: { value: 'first' } }
    const second = { code: 'demo', type: 'text', payload: { value: 'second' } }

    // 同一实例连续进入时，发送前的上下文绑定与参数快照必须同步生效。
    sendPluginLifecycle(view, 'PluginEnter', first)
    sendPluginLifecycle(view, 'PluginEnter', second)
    second.payload.value = 'changed after dispatch'

    expect(contexts).toEqual([
      { code: 'demo', type: 'text', payload: { value: 'first' } },
      { code: 'demo', type: 'text', payload: { value: 'second' } }
    ])
    expect(getPluginInstanceContext(view.webContents)).toEqual(contexts[1])
  })

  it('allows host cleanup to continue when IPC fails after the destroyed check', () => {
    const { view, send, destroy } = createView()
    const failure = new Error('Render frame was disposed before IPC could be sent')
    send.mockImplementationOnce(() => {
      throw failure
    })

    // 帧失效时发送仍可能抛错；同步通知不能因此截断宿主关闭流程。
    expect(() => {
      sendPluginLifecycle(view, 'PluginOut', true)
      destroy()
    }).not.toThrow()
    expect(view.webContents.isDestroyed()).toBe(true)
    expect(console.error).toHaveBeenCalledWith(
      '[插件][生命周期] 派发失败',
      { webContentsId: 5, eventName: 'PluginOut' },
      failure
    )
  })
})
