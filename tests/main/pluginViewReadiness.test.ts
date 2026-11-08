import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPluginViewReadiness,
  waitForPluginViewReady
} from '../../src/main/core/pluginViewReadiness'

/**
 * 创建可发出加载事件并观察监听清理情况的 WebContents 替身。
 * @returns 具有销毁状态查询的事件发射器
 */
function createContents(): EventEmitter & WebContents {
  const contents = new EventEmitter() as EventEmitter & WebContents
  contents.isDestroyed = vi.fn(() => false)
  contents.reload = vi.fn()
  return contents
}

/**
 * 模拟主框架开始导航，尚未提交新文档。
 * @param contents 接收导航事件的视图替身
 * @returns 无返回值
 */
function startNavigation(contents: EventEmitter): void {
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
}

/**
 * 模拟主框架打开新文档或重载页面并提交。
 * @param contents 接收导航事件的视图替身
 * @returns 无返回值
 */
function navigate(contents: EventEmitter): void {
  startNavigation(contents)
  contents.emit('did-navigate', {}, 'file:///plugin/index.html')
}

/**
 * 判断 Promise 在当前微任务队列清空后是否仍未完成。
 * @param promise 待检查的 Promise
 * @returns 仍未完成时为 true
 */
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending')
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker
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
    contents.emit('did-stop-loading')

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
    expect(contents.listenerCount('dom-ready')).toBe(1)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)
  })

  it('only fails for a main frame load error and recovers on a subsequent navigation', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('did-fail-load', {}, -105, 'DNS failure', 'https://example.invalid', false)
    expect(await isPending(readiness.ready)).toBe(true)

    contents.emit('did-fail-load', {}, -105, 'DNS failure', 'https://example.invalid', true)
    await expect(readiness.ready).resolves.toBe(false)
    expect(contents.listenerCount('dom-ready')).toBe(1)
    expect(contents.listenerCount('did-fail-load')).toBe(1)

    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(false)
    expect(readiness.isReady).toBe(false)

    navigate(contents)
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(true)
  })

  it('restores the ready document when a navigation is cancelled before commit', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')
    contents.emit('did-stop-loading')

    // will-navigate 拦截跨源跳转时，Electron 先发出导航开始，随后只有停止加载。
    startNavigation(contents)
    const duringNavigation = readiness.ready
    expect(readiness.isReady).toBe(false)
    contents.emit('did-stop-loading')

    await expect(duringNavigation).resolves.toBe(true)
    await expect(readiness.ready).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
  })

  it('restores the original document after several cancelled navigations', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')

    startNavigation(contents)
    startNavigation(contents)
    contents.emit('did-stop-loading')

    await expect(readiness.ready).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)

    startNavigation(contents)
    contents.emit('did-stop-loading')
    await expect(readiness.ready).resolves.toBe(true)
  })

  it('keeps a failed document unusable when a later navigation is cancelled', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    startNavigation(contents)
    contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///missing.html', true)
    contents.emit('did-stop-loading')
    await expect(readiness.ready).resolves.toBe(false)

    startNavigation(contents)
    contents.emit('did-stop-loading')
    await expect(readiness.ready).resolves.toBe(false)
    // 恢复的仍是错误页，其后续 DOM 就绪不能当成插件页面。
    contents.emit('dom-ready')
    await expect(readiness.ready).resolves.toBe(false)
    expect(readiness.isReady).toBe(false)
  })

  it('does not restore the previous document when the new navigation fails', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')

    startNavigation(contents)
    contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///missing.html', true)
    contents.emit('did-stop-loading')

    await expect(readiness.ready).resolves.toBe(false)
    expect(readiness.isReady).toBe(false)
  })

  it('ignores loading stop after the new document was committed', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')

    navigate(contents)
    const reloaded = readiness.ready
    contents.emit('did-stop-loading')

    expect(await isPending(reloaded)).toBe(true)
    expect(readiness.isReady).toBe(false)
    contents.emit('dom-ready')
    await expect(reloaded).resolves.toBe(true)
  })

  it('waits for the reloaded document before its navigation event arrives', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    startNavigation(contents)
    contents.emit('did-fail-load', {}, -324, 'ERR_EMPTY_RESPONSE', 'http://plugin/index.html', true)
    contents.emit('dom-ready')
    contents.emit('did-stop-loading')
    const failed = readiness.ready
    await expect(failed).resolves.toBe(false)

    // 插件视图的重载导航事件异步到达，调用方在此之前读取也必须拿到新文档的等待。
    readiness.reload()
    expect(contents.reload).toHaveBeenCalledTimes(1)
    const reloaded = readiness.ready
    expect(reloaded).not.toBe(failed)
    expect(await isPending(reloaded)).toBe(true)

    navigate(contents)
    expect(readiness.ready).toBe(reloaded)
    contents.emit('dom-ready')
    await expect(reloaded).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
  })

  it('restores the ready document when a reload is cancelled before commit', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    contents.emit('dom-ready')

    readiness.reload()
    const reloading = readiness.ready
    startNavigation(contents)
    contents.emit('did-stop-loading')

    await expect(reloading).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
  })

  it('does not reload a destroyed view', () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    contents.emit('destroyed')
    vi.mocked(contents.isDestroyed).mockReturnValue(true)

    readiness.reload()

    expect(contents.reload).not.toHaveBeenCalled()
  })

  it('keeps waiting for a slow page instead of failing every later caller', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)

    const firstCall = waitForPluginViewReady(readiness.ready, 100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(firstCall).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    // 超时只结束本次调用，页面记录仍在等待，后续调用重新计时。
    expect(await isPending(readiness.ready)).toBe(true)
    const secondCall = waitForPluginViewReady(readiness.ready, 100)
    await vi.advanceTimersByTimeAsync(50)
    contents.emit('dom-ready')

    await expect(secondCall).resolves.toBe(true)
    await expect(readiness.ready).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows future callers to use a slow page that becomes ready after a caller timed out', async () => {
    const contents = createContents()
    const readiness = createPluginViewReadiness(contents)
    navigate(contents)
    const timedOutCall = waitForPluginViewReady(readiness.ready, 100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(timedOutCall).resolves.toBe(false)
    expect(readiness.isReady).toBe(false)

    contents.emit('dom-ready')
    await expect(waitForPluginViewReady(readiness.ready, 100)).resolves.toBe(true)
    expect(readiness.isReady).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    contents.emit('destroyed')
    expect(contents.eventNames()).toEqual([])
    expect(readiness.isReady).toBe(false)
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
  })
})
