import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import path from 'path'
import { getPluginDataPath, getPluginDataRoot } from '../../src/main/core/appData/appDataPaths'

vi.mock('electron', () => ({
  app: { getPath: vi.fn() }
}))

describe('getPluginDataPath', () => {
  const existingDataRoot = process.env.ZTOOLS_DATA_ROOT

  afterEach(() => {
    if (existingDataRoot === undefined) {
      delete process.env.ZTOOLS_DATA_ROOT
    } else {
      process.env.ZTOOLS_DATA_ROOT = existingDataRoot
    }
  })

  it('返回数据根目录下的插件数据根容器', () => {
    expect(getPluginDataRoot()).toBe(path.join(os.homedir(), '.ztools', 'plugins-data'))
  })

  it('返回插件名对应的专属数据目录', () => {
    expect(getPluginDataPath('demo')).toBe(
      path.join(os.homedir(), '.ztools', 'plugins-data', 'demo')
    )
  })

  it('支持通过 ZTOOLS_DATA_ROOT 隔离数据根目录', () => {
    process.env.ZTOOLS_DATA_ROOT = path.join(os.tmpdir(), 'ztools-data-root')
    expect(getPluginDataPath('demo')).toBe(
      path.join(process.env.ZTOOLS_DATA_ROOT, 'plugins-data', 'demo')
    )
  })

  it('拒绝会导致目录穿越的插件名', () => {
    for (const name of ['', '.', '..', 'a/b', 'a\\b', 'C:\\evil', '/abs']) {
      expect(() => getPluginDataPath(name)).toThrow()
    }
  })
})
