import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

// chokidar 的 mock watcher：记录 on 注册的回调，并提供 __emit 触发事件
type MockWatcherApi = {
  on: Mock
  close: Mock
  __emit: (event: string, ...args: unknown[]) => void
}
const { createMockWatcher } = vi.hoisted(() => {
  const createMockWatcher = (): MockWatcherApi => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
    const api: MockWatcherApi = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        ;(handlers[event] ||= []).push(cb)
        return api
      }),
      close: vi.fn(),
      __emit: (event: string, ...args: unknown[]) => {
        for (const cb of handlers[event] || []) cb(...args)
      }
    }
    return api
  }
  return { createMockWatcher }
})

vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => createMockWatcher()) }
}))

// appWatcher 用 BrowserWindow（类型）；systemPaths 用 app.getPath —— 一并 mock
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  app: { getPath: vi.fn((name: string) => `/mock/${name}`) }
}))

// notifyChange -> appsAPI.refreshAppsCache；mock 避免加载重量级 commands.ts（LMDB 等依赖）
vi.mock('../../src/main/api/renderer/commands', () => ({
  default: { refreshAppsCache: vi.fn() }
}))

import chokidar from 'chokidar'
import path from 'path'
import appsAPI from '../../src/main/api/renderer/commands'
import { getWindowsScanPaths, getWindowsRootScanPaths } from '../../src/main/utils/systemPaths'
import appWatcher from '../../src/main/appWatcher'

let originalPlatform: string
beforeEach(() => {
  vi.clearAllMocks()
  originalPlatform = process.platform
  // stub 为 win32：使 getRecursiveWatchPaths / getFlatRootWatchPaths 返回 Windows 路径，
  // 从而同时创建递归 watcher 与扁平根 watcher
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  vi.useFakeTimers()
})
afterEach(() => {
  appWatcher.stop()
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})

describe('AppWatcher 双 watcher 接线', () => {
  it('启动递归（depth:5）与扁平（depth:0）两个 watcher', () => {
    appWatcher.init({} as never)

    const watchMock = vi.mocked(chokidar.watch)
    expect(watchMock).toHaveBeenCalledTimes(2)

    const [recursivePaths, recursiveOpts] = watchMock.mock.calls[0]
    const [flatPaths, flatOpts] = watchMock.mock.calls[1]

    expect(recursiveOpts?.depth).toBe(5)
    expect(flatOpts?.depth).toBe(0)
    expect(recursivePaths).toEqual(getWindowsScanPaths())
    expect(flatPaths).toEqual(getWindowsRootScanPaths())
  })

  it('扁平根路径为空时（非 win32，如 darwin）不创建扁平 watcher', () => {
    // getFlatRootWatchPaths 仅 win32 返回非空；其余平台为 []，命中 startWatching 的 length>0 守卫
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    appWatcher.init({} as never)
    const watchMock = vi.mocked(chokidar.watch)
    // 仅创建递归 watcher；扁平 watcher 因路径为空而跳过
    expect(watchMock).toHaveBeenCalledTimes(1)
  })

  it('.lnk add/unlink 事件路由到防抖 notifyChange → refreshAppsCache', () => {
    appWatcher.init({} as never)

    const watchMock = vi.mocked(chokidar.watch)
    const flatWatcher = watchMock.mock.results[1].value as {
      __emit: (event: string, ...args: unknown[]) => void
    }
    const rootPath = getWindowsRootScanPaths()[0]
    const lnkPath = path.join(rootPath, 'NewApp.lnk')

    // add 事件：防抖未到时不刷新
    flatWatcher.__emit('add', lnkPath)
    expect(appsAPI.refreshAppsCache).not.toHaveBeenCalled()

    // 推进防抖窗口（DEBOUNCE_DELAY = 1000ms）后刷新
    vi.advanceTimersByTime(1000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(1)

    // unlink 事件同样触发刷新
    flatWatcher.__emit('unlink', lnkPath)
    vi.advanceTimersByTime(1000)
    expect(appsAPI.refreshAppsCache).toHaveBeenCalledTimes(2)
  })

  it('非 .lnk 文件事件不触发刷新', () => {
    appWatcher.init({} as never)
    const watchMock = vi.mocked(chokidar.watch)
    const flatWatcher = watchMock.mock.results[1].value as {
      __emit: (event: string, ...args: unknown[]) => void
    }

    flatWatcher.__emit('add', path.join(getWindowsRootScanPaths()[0], 'notes.txt'))
    vi.advanceTimersByTime(1000)
    expect(appsAPI.refreshAppsCache).not.toHaveBeenCalled()
  })

  it('stop 关闭两个 watcher', () => {
    appWatcher.init({} as never)
    const watchMock = vi.mocked(chokidar.watch)
    const recursiveWatcher = watchMock.mock.results[0].value as { close: ReturnType<typeof vi.fn> }
    const flatWatcher = watchMock.mock.results[1].value as { close: ReturnType<typeof vi.fn> }

    appWatcher.stop()

    expect(recursiveWatcher.close).toHaveBeenCalledTimes(1)
    expect(flatWatcher.close).toHaveBeenCalledTimes(1)
  })
})
