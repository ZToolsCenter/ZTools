import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPluginWindowReadyCallback } from '../../src/main/core/pluginWindowReadyCallback'

/**
 * 创建用于观察窗口加载与销毁的 WebContents 替身。
 * @returns 具有销毁状态的事件发射器。
 */
function createContents(): any {
  const contents = new EventEmitter() as any
  contents.isDestroyed = vi.fn(() => false)
  return contents
}

describe('plugin window initialization callback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not call into the parent while the first document is still initializing', () => {
    const contents = createContents()
    const callback = vi.fn()
    registerPluginWindowReadyCallback(contents, callback)

    contents.emit('dom-ready')
    vi.advanceTimersByTime(1000)
    expect(callback).not.toHaveBeenCalled()
    contents.emit('did-finish-load')
    vi.advanceTimersByTime(999)
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('cancels the queued callback when navigation replaces its document', () => {
    const contents = createContents()
    const callback = vi.fn()
    registerPluginWindowReadyCallback(contents, callback)

    contents.emit('did-finish-load')
    vi.advanceTimersByTime(500)
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    vi.advanceTimersByTime(500)
    expect(callback).not.toHaveBeenCalled()
    contents.emit('did-finish-load')
    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not invoke callbacks after the window is destroyed', () => {
    const contents = createContents()
    const callback = vi.fn()
    registerPluginWindowReadyCallback(contents, callback)

    contents.emit('did-finish-load')
    contents.emit('destroyed')
    vi.advanceTimersByTime(1000)
    expect(callback).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
