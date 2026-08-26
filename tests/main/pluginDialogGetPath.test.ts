import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import path from 'path'

const mockGetPath = vi.hoisted(() => vi.fn())
const mockMkdirSync = vi.hoisted(() => vi.fn())
const ipcHandlers = new Map<string, (...args: any[]) => void>()

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  app: { getPath: mockGetPath },
  ipcMain: {
    on: (channel: string, handler: (...args: any[]) => void) => {
      ipcHandlers.set(channel, handler)
    }
  }
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  const mockedFs = { ...actual, mkdirSync: mockMkdirSync }
  return { ...mockedFs, default: mockedFs }
})

vi.mock('../../src/main/core/detachedWindowManager', () => ({
  default: { getWindowByPluginWebContents: vi.fn() }
}))
vi.mock('../../src/main/managers/windowManager', () => ({
  default: { withBlurHideSuppressed: vi.fn() }
}))
vi.mock('../../src/main/core/pluginWindowManager', () => ({
  default: { getPluginNameByWebContentsId: vi.fn(() => undefined) }
}))

import { PluginDialogAPI } from '../../src/main/api/plugin/dialog'
import { getPluginDataPath } from '../../src/main/core/appData/appDataPaths'

describe('plugin dialog get-path', () => {
  const existingDataRoot = process.env.ZTOOLS_DATA_ROOT
  const testRoot = path.join(os.tmpdir(), 'ztools-dialog-test')
  let handler: ((event: any, name: string) => void) | undefined

  beforeEach(() => {
    process.env.ZTOOLS_DATA_ROOT = testRoot
    ipcHandlers.clear()
    mockMkdirSync.mockReset()
    mockGetPath.mockReset().mockImplementation((name: string) => `/mock/${name}`)
  })

  afterEach(() => {
    if (existingDataRoot === undefined) {
      delete process.env.ZTOOLS_DATA_ROOT
    } else {
      process.env.ZTOOLS_DATA_ROOT = existingDataRoot
    }
  })

  function makeApi(pluginManager: { getPluginInfoByWebContents: (...args: any[]) => any }): void {
    const api = new PluginDialogAPI()
    api.init({} as any, pluginManager as any)
    handler = ipcHandlers.get('get-path')
  }

  it('返回发起调用的插件专属数据目录并自动创建', () => {
    makeApi({
      getPluginInfoByWebContents: vi.fn(() => ({ name: 'demo', path: '/plugins/demo' }))
    })
    const event = { sender: { id: 1, session: {} } as any, returnValue: '' } as any
    handler?.(event, 'pluginData')
    expect(event.returnValue).toBe(getPluginDataPath('demo'))
    expect(mockMkdirSync).toHaveBeenCalledWith(getPluginDataPath('demo'), { recursive: true })
  })

  it('无法定位插件时返回空字符串且不创建目录', () => {
    makeApi({ getPluginInfoByWebContents: vi.fn(() => null) })
    const event = { sender: { id: 42, session: {} } as any, returnValue: '' } as any
    handler?.(event, 'pluginData')
    expect(event.returnValue).toBe('')
    expect(mockMkdirSync).not.toHaveBeenCalled()
  })

  it('保留原有系统路径透传', () => {
    makeApi({ getPluginInfoByWebContents: vi.fn(() => null) })
    const event = { sender: {} as any, returnValue: '' } as any
    handler?.(event, 'home')
    expect(event.returnValue).toBe('/mock/home')
  })
})
