import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

/**
 * 跨平台隔离回归测试。
 *
 * Linux 移植往若干共享文件里加了平台分支（appWatcher 的监听路径与事件绑定、
 * commandScanner 的分发）。这里把 process.platform 分别 stub 成 win32 / darwin / linux，
 * 断言非 Linux 平台走的仍是原有逻辑，避免移植改动泄漏到 macOS/Windows。
 */

// ---------- chokidar mock：记录注册的事件名，用于判断绑定了哪些处理器 ----------
type MockWatcherApi = {
  on: Mock
  close: Mock
  events: () => string[]
}
const { createMockWatcher } = vi.hoisted(() => {
  const createMockWatcher = (): MockWatcherApi => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
    const api = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        ;(handlers[event] ||= []).push(cb)
        return api
      }),
      close: vi.fn(),
      events: () => Object.keys(handlers),
      __emit: (event: string, ...args: unknown[]) => {
        for (const cb of handlers[event] || []) cb(...args)
      }
    }
    return api as unknown as MockWatcherApi
  }
  return { createMockWatcher }
})

vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => createMockWatcher()) }
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  app: { getPath: vi.fn((name: string) => `/mock/${name}`) }
}))

const appsAPIMock = vi.hoisted(() => ({
  refreshAppsCache: vi.fn(),
  refreshUwpAppsCache: vi.fn(),
  refreshAppsCacheIfUwpPackagesChanged: vi.fn()
}))

vi.mock('../../src/main/api/renderer/commands', () => ({ default: appsAPIMock }))

vi.mock('../../src/main/core/uwpPackageMonitor', () => ({
  startUwpPackageMonitor: vi.fn(),
  stopUwpPackageMonitor: vi.fn()
}))

const scannerMocks = vi.hoisted(() => ({
  mac: vi.fn(async () => [{ name: 'MacApp', path: '/Applications/MacApp.app' }]),
  win: vi.fn(async () => ({
    apps: [{ name: 'WinApp', path: 'C:\\WinApp.lnk' }],
    complete: true,
    errors: []
  })),
  linux: vi.fn(async () => ({
    apps: [{ name: 'LinuxApp', path: '/usr/bin/linuxapp' }],
    complete: true,
    errors: []
  }))
}))

vi.mock('../../src/main/core/commandScanner/macScanner', () => ({
  scanApplications: scannerMocks.mac
}))
vi.mock('../../src/main/core/commandScanner/windowsScanner', () => ({
  scanApplications: scannerMocks.win
}))
vi.mock('../../src/main/core/commandScanner/linuxScanner', () => ({
  scanApplications: scannerMocks.linux
}))

import chokidar from 'chokidar'
import appWatcher from '../../src/main/appWatcher'
import { scanApplications } from '../../src/main/core/commandScanner'
import {
  getLinuxApplicationPaths,
  getMacApplicationPaths,
  getWindowsFlatScanPaths,
  getWindowsRecursiveScanPaths
} from '../../src/main/utils/systemPaths'

const realPlatform = process.platform
const setPlatform = (value: string): void => {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  appWatcher.stop()
  setPlatform(realPlatform)
})

/** 取本次 appWatcher.init 创建的第一个 watcher */
function firstWatcher(): MockWatcherApi {
  return vi.mocked(chokidar.watch).mock.results[0].value as MockWatcherApi
}

describe('appWatcher 在非 Linux 平台不进入 Linux 分支', () => {
  it('win32 仍使用 Windows 递归与扁平路径', () => {
    setPlatform('win32')
    appWatcher.init({} as never)

    const calls = vi.mocked(chokidar.watch).mock.calls
    expect(calls[0][0]).toEqual(getWindowsRecursiveScanPaths())
    expect(calls[1][0]).toEqual(getWindowsFlatScanPaths())
    // 关键：不能出现任何 XDG 应用目录
    const allPaths = calls.flatMap((c) => c[0] as string[])
    for (const linuxPath of getLinuxApplicationPaths()) {
      expect(allPaths).not.toContain(linuxPath)
    }
  })

  it('darwin 仍只使用 macOS 应用目录，且不创建扁平 watcher', () => {
    setPlatform('darwin')
    appWatcher.init({} as never)

    const calls = vi.mocked(chokidar.watch).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toEqual(getMacApplicationPaths())
  })

  it('win32 / darwin 下不注册 .desktop 相关 handler', () => {
    for (const platform of ['win32', 'darwin']) {
      vi.clearAllMocks()
      appWatcher.stop()
      setPlatform(platform)
      appWatcher.init({} as never)

      // 仅 win32 绑 add/unlink，darwin 绑 addDir/unlinkDir；
      // 两者都不应出现 Linux 分支才会绑的 change
      const events = firstWatcher().events()
      expect(events).not.toContain('change')
    }
  })

  it('linux 下才会监听 XDG 应用目录', () => {
    setPlatform('linux')
    appWatcher.init({} as never)

    expect(vi.mocked(chokidar.watch).mock.calls[0][0]).toEqual(getLinuxApplicationPaths())
    expect(firstWatcher().events()).toContain('change')
  })
})

describe('commandScanner 按平台分发', () => {
  it('darwin 分发给 macScanner，且不触碰 linuxScanner', async () => {
    setPlatform('darwin')
    const result = await scanApplications()

    expect(scannerMocks.mac).toHaveBeenCalledTimes(1)
    expect(scannerMocks.linux).not.toHaveBeenCalled()
    expect(scannerMocks.win).not.toHaveBeenCalled()
    // macOS 扫描器返回数组，由 index 包装成完整结果
    expect(result.complete).toBe(true)
    expect(result.apps[0].name).toBe('MacApp')
  })

  it('win32 分发给 windowsScanner，且不触碰 linuxScanner', async () => {
    setPlatform('win32')
    const result = await scanApplications()

    expect(scannerMocks.win).toHaveBeenCalledTimes(1)
    expect(scannerMocks.linux).not.toHaveBeenCalled()
    expect(scannerMocks.mac).not.toHaveBeenCalled()
    expect(result.apps[0].name).toBe('WinApp')
  })

  it('linux 分发给 linuxScanner 并保留其上报的完整性', async () => {
    setPlatform('linux')
    const result = await scanApplications()

    expect(scannerMocks.linux).toHaveBeenCalledTimes(1)
    expect(scannerMocks.mac).not.toHaveBeenCalled()
    expect(scannerMocks.win).not.toHaveBeenCalled()
    expect(result.apps[0].name).toBe('LinuxApp')

    // 扫描器报告不完整时，index 必须原样透传（否则空列表会覆盖旧缓存）
    scannerMocks.linux.mockResolvedValueOnce({
      apps: [],
      complete: false,
      errors: ['boom']
    } as never)
    const incomplete = await scanApplications()
    expect(incomplete.complete).toBe(false)
    expect(incomplete.errors).toEqual(['boom'])
  })
})
