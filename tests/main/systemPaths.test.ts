import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn((name: string) => `/mock/${name}`) }
}))

import os from 'os'
import path from 'path'
import { getWindowsRootScanPaths, getWindowsScanPaths } from '../../src/main/utils/systemPaths'

// ========== getWindowsRootScanPaths ==========

describe('getWindowsRootScanPaths（Start Menu 根路径）', () => {
  it('应返回用户级与系统级 Start Menu 根路径', () => {
    const paths = getWindowsRootScanPaths()
    expect(paths).toHaveLength(2)

    // 系统级根
    const programDataRoot = path.join('C:', 'ProgramData', 'Microsoft', 'Windows', 'Start Menu')
    expect(paths).toContain(programDataRoot)

    // 用户级根
    const userRoot = path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Microsoft',
      'Windows',
      'Start Menu'
    )
    expect(paths).toContain(userRoot)
  })

  it('路径均不以 Programs 结尾（指向 Start Menu 根，区别于 getWindowsScanPaths）', () => {
    for (const p of getWindowsRootScanPaths()) {
      expect(p.endsWith('Programs')).toBe(false)
      expect(p.endsWith('Start Menu')).toBe(true)
    }
  })

  it('与 getWindowsScanPaths 的开始菜单路径互补（root + Programs）', () => {
    const roots = getWindowsRootScanPaths()
    const scans = getWindowsScanPaths()
    // 每个 Start Menu 根在 getWindowsScanPaths 中都应有一个 root\Programs 子文件夹
    for (const root of roots) {
      expect(scans).toContain(path.join(root, 'Programs'))
    }
  })
})
