import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn((name: string) => `/mock/${name}`) }
}))

import os from 'os'
import path from 'path'
import {
  getWindowsFlatScanPaths,
  getWindowsRecursiveScanPaths
} from '../../src/main/utils/systemPaths'

describe('Windows 应用扫描路径', () => {
  it('递归扫描系统级与用户级 Start Menu 根目录', () => {
    const paths = getWindowsRecursiveScanPaths()
    expect(paths).toHaveLength(2)
    expect(paths).toContain(path.join('C:', 'ProgramData', 'Microsoft', 'Windows', 'Start Menu'))
    expect(paths).toContain(
      path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu')
    )
    expect(paths).not.toContain('/mock/desktop')
  })

  it('只有用户桌面和公共桌面进入扁平扫描集合', () => {
    const flatPaths = getWindowsFlatScanPaths()

    expect(flatPaths).toHaveLength(2)
    expect(flatPaths).toContain('/mock/desktop')
    expect(flatPaths).toContain(path.join('C:', 'Users', 'Public', 'Desktop'))
    for (const startMenuPath of getWindowsRecursiveScanPaths()) {
      expect(flatPaths).not.toContain(startMenuPath)
    }
  })
})
