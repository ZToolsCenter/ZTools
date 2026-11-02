import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginViewReadiness } from '../../src/main/core/pluginViewReadiness'

/**
 * 创建可发出加载事件并观察监听清理情况的 WebContents 替身。
 * @returns 具有销毁状态查询的事件发射器
 */
function createContents(): EventEmitter & WebContents {
  const contents = new EventEmitter() as EventEmitter & WebContents
  contents.isDestroyed = vi.fn(() => false)
  return contents
}

/**
 * 模拟主框架打开新文档或重载页面。
 * @param contents 接收导航事件的视图替身
 * @returns 无返回值
 */
function navigate(contents: EventEmitter): void {
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
}

describe('plugin view readiness', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('preserves the initial wait obtained before loadURL starts navigation', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    const beforeLoad = readiness.ready
    expect(readiness.isReady).toBe(false)

    navigate(contents)
    expect(readiness.ready).toBe(beforeLoad)
    contents.emit('dom-ready')

    await expect(beforeLoad).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(contents.listenerCount('dom-ready')).toBe(1)
    expect(contents.listenerCount('did-fail-load')).toBe(1)
  })

  it('waits for the new document after reload while ignoring in-page and iframe navigation', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')
    const previous = readiness.ready

    contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    expect(readiness.ready).toBe(previous)
    expect(readiness.isReady).toBe(true)

    navigate(contents)
    const reloaded = readiness.ready
    expect(readiness.isReady).toBe(false)
    expect(reloaded).not.toBe(previous)
    expect(vi.getTimerCount()).toBe(1)
    contents.emit('dom-ready')
    await expect(reloaded).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
  })

  it('releases callers waiting on an unfinished document when navigation replaces it', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    const previous = readiness.ready

    navigate(contents)
    await expect(previous).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    expect(contents.listenerCount('dom-ready')).toBe(1)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)
  })

  it('only fails for a main frame load error and recovers on a subsequent navigation', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('did-fail-load', {}, -105, 'DNS failure', 'https://example.invalid', false)
    expect(vi.getTimerCount()).toBe(1)

    contents.emit('did-fail-load', {}, -105, 'DNS failure', 'https://example.invalid', true)
    await expect(readiness.ready).resolves.toBe(false)
    expect(contents.listenerCount('dom-ready')).toBe(1)
    expect(contents.listenerCount('did-fail-load')).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(false)
    expect(readiness.isReady).toBe(false)

    navigate(contents)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)
  })

  it('keeps the previous document usable when an intercepted navigation aborts', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)

    // 外部链接被宿主拦截后，新导航会先开始，再由 Chromium 以 ERR_ABORTED 取消。
    navigate(contents)
    contents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'https://github.com/ZToolsCenter/ZTools',
      true
    )

    await expect(readiness.ready).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a ready document usable when an aborted load reports without navigation start', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)

    // Electron 可能只上报被取消的跨源加载，不再补发主框架导航开始事件。
    contents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'https://github.com/ZToolsCenter/ZTools',
      true
    )

    await expect(readiness.ready).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves the ready document across multiple navigation starts before an abort', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)

    // 一次链接点击可能触发多个主框架导航开始事件，旧文档备份不能被后续事件覆盖。
    navigate(contents)
    navigate(contents)
    contents.emit(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'https://github.com/ZToolsCenter/ZTools',
      true
    )

    await expect(readiness.ready).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restores the ready document when the host cancels an intercepted navigation', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)

    navigate(contents)
    readiness.markNavigationCancelled()

    await expect(readiness.ready).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns false on timeout and reuses one set of listeners for a new load', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents, 100)
    const initial = readiness.ready
    await vi.advanceTimersByTimeAsync(100)

    await expect(initial).resolves.toBe(false)
    expect(contents.listenerCount('dom-ready')).toBe(1)
    expect(contents.listenerCount('did-fail-load')).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    navigate(contents)
    expect(readiness.ready).not.toBe(initial)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)
  })

  it('allows future callers to use a slow page that becomes ready after the wait timed out', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents, 100)
    navigate(contents)
    const timedOutWait = readiness.ready
    await vi.advanceTimersByTimeAsync(100)
    await expect(timedOutWait).resolves.toBe(false)
    expect(readiness.isReady).toBe(false)

    // 首次调用保留超时结果，但缓存视图加载完成后无需重载即可继续使用。
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)
    await expect(timedOutWait).resolves.toBe(false)
    expect(readiness.isReady).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    contents.emit('destroyed')
    expect(contents.eventNames()).toEqual([])
    expect(readiness.isReady).toBe(false)
  })

  it('rearms the wait when a caller reads readiness after a timeout', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents, 100)
    navigate(contents)
    const initial = readiness.ready
    await vi.advanceTimersByTimeAsync(100)
    await expect(initial).resolves.toBe(false)

    // 前台重新打开插件时，新的读取应等待仍在加载的同一文档。
    const lateReady = readiness.ready
    expect(readiness.isReady).toBe(false)
    contents.emit('dom-ready')

    await expect(lateReady).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns false and removes every listener when a pending view is destroyed', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    const pending = readiness.ready

    contents.emit('destroyed')

    await expect(pending).resolves.toBe(false)
    await expect(readiness.ready).resolves.toBe(false)
    expect(contents.eventNames()).toEqual([])
    expect(readiness.isReady).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not report a previously ready document as usable after destruction', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)

    contents.emit('destroyed')

    await expect(readiness.ready).resolves.toBe(false)
    expect(contents.eventNames()).toEqual([])
  })

  it('does not register listeners on an already destroyed view', async () => {
    const contents = createContents()
    vi.mocked(contents.isDestroyed).mockReturnValue(true)

    const readiness = createPluginViewReadiness(contents)

    await expect(readiness.ready).resolves.toBe(false)
    expect(readiness.isReady).toBe(false)
    expect(contents.eventNames()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
