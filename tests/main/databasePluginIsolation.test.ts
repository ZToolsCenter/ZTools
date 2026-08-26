import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAttachmentDb = vi.hoisted(() => ({
  getRange: vi.fn(),
  get: vi.fn(),
  removeSync: vi.fn()
}))

const mockMetaDb = vi.hoisted(() => ({
  getRange: vi.fn(),
  removeSync: vi.fn()
}))

const mockLmdb = vi.hoisted(() => ({
  allDocs: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  removeAndResolve: vi.fn(),
  removeAttachmentSilent: vi.fn(),
  getAttachmentDb: vi.fn(() => mockAttachmentDb),
  getMetaDb: vi.fn(() => mockMetaDb)
}))

const mockPluginWindowManager = vi.hoisted(() => ({
  getPluginNameByWebContentsId: vi.fn(),
  getPluginPathByWebContentsId: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn()
  }
}))

vi.mock('../../src/main/core/lmdb/lmdbInstance', () => ({
  default: mockLmdb
}))

vi.mock('../../src/main/core/pluginWindowManager', () => ({
  default: mockPluginWindowManager
}))

import { DatabaseAPI } from '../../src/main/api/shared/database'
import { getPluginDataPath } from '../../src/main/core/appData/appDataPaths'
import { physicalFs } from '../../src/main/utils/physicalFs'

describe('database plugin isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPluginWindowManager.getPluginNameByWebContentsId.mockReturnValue(null)
    mockPluginWindowManager.getPluginPathByWebContentsId.mockReturnValue(null)
    mockLmdb.allDocs.mockReturnValue([])
    mockLmdb.get.mockReturnValue(null)
    mockLmdb.remove.mockReturnValue({ ok: true })
    mockLmdb.removeAndResolve.mockReturnValue({ ok: true })
    mockAttachmentDb.getRange.mockReturnValue([])
    mockAttachmentDb.get.mockReturnValue(null)
    mockMetaDb.getRange.mockReturnValue([])
  })

  it('separates installed and development data stats for the same plugin name', async () => {
    // 新系统：dev 插件 name 已含 __dev 后缀，是独立条目
    mockLmdb.allDocs.mockImplementation((prefix: string) => {
      if (prefix === 'PLUGIN/') {
        return [{ _id: 'PLUGIN/demo/settings' }, { _id: 'PLUGIN/demo__dev/settings' }]
      }
      if (prefix === 'ZTOOLS/') {
        return []
      }
      return []
    })

    mockAttachmentDb.getRange.mockImplementation(({ start }: { start: string }) => {
      if (start === 'attachment-ext:PLUGIN/') {
        return [
          { key: 'attachment-ext:PLUGIN/demo/logo' },
          { key: 'attachment-ext:PLUGIN/demo__dev/logo' }
        ]
      }
      return []
    })

    mockLmdb.get.mockImplementation((key: string) => {
      if (key === 'ZTOOLS/plugins') {
        return {
          data: [
            {
              name: 'demo',
              title: 'Demo Installed',
              isDevelopment: false,
              logo: 'installed.png'
            },
            {
              name: 'demo__dev',
              title: 'Demo Dev',
              isDevelopment: true,
              logo: 'dev.png'
            }
          ]
        }
      }
      return null
    })

    const database = new DatabaseAPI()
    const result = await database.getPluginDataStats()

    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2)

    const installed = result.data!.find((d) => d.pluginName === 'demo')
    const dev = result.data!.find((d) => d.pluginName === 'demo__dev')

    expect(installed).toMatchObject({
      pluginName: 'demo',
      pluginTitle: 'Demo Installed',
      isDevelopment: false,
      docCount: 1,
      attachmentCount: 1,
      logo: 'installed.png'
    })

    expect(dev).toMatchObject({
      pluginName: 'demo__dev',
      pluginTitle: 'Demo Dev',
      isDevelopment: true,
      docCount: 1,
      attachmentCount: 1,
      logo: 'dev.png'
    })
  })

  it('reads development doc keys from the development runtime namespace', async () => {
    mockLmdb.allDocs.mockImplementation((prefix: string) => {
      if (prefix === 'PLUGIN/demo__dev/') {
        return [{ _id: 'PLUGIN/demo__dev/settings' }]
      }
      return []
    })

    mockAttachmentDb.getRange.mockImplementation(({ start }: { start: string }) => {
      if (start === 'attachment-ext:PLUGIN/demo__dev/') {
        return [{ key: 'attachment-ext:PLUGIN/demo__dev/logo' }]
      }
      return []
    })

    const database = new DatabaseAPI()
    // 新 API：直接传字符串 pluginName（含 __dev 后缀）
    const result = await database.getPluginDocKeys('demo__dev')

    expect(mockLmdb.allDocs).toHaveBeenCalledWith('PLUGIN/demo__dev/')
    expect(result).toEqual({
      success: true,
      data: [
        { key: 'settings', type: 'document' },
        { key: 'logo', type: 'attachment' }
      ]
    })
  })

  it('clears only the selected development namespace data', async () => {
    mockLmdb.allDocs.mockImplementation((prefix: string) => {
      if (prefix === 'PLUGIN/demo__dev/') {
        return [{ _id: 'PLUGIN/demo__dev/settings' }]
      }
      return []
    })

    mockMetaDb.getRange.mockImplementation(({ start }: { start: string }) => {
      if (start === 'PLUGIN/demo__dev/') {
        return [{ key: 'PLUGIN/demo__dev/settings' }]
      }
      return []
    })

    mockAttachmentDb.getRange.mockImplementation(({ start }: { start: string }) => {
      if (start === 'attachment:PLUGIN/demo__dev/') {
        return [{ key: 'attachment:PLUGIN/demo__dev/logo' }]
      }
      if (start === 'attachment-ext:PLUGIN/demo__dev/') {
        return [{ key: 'attachment-ext:PLUGIN/demo__dev/logo' }]
      }
      return []
    })

    const database = new DatabaseAPI()
    // 新 API：直接传字符串 pluginName（含 __dev 后缀）
    const result = await database.clearPluginData('demo__dev')

    expect(mockLmdb.allDocs).toHaveBeenCalledWith('PLUGIN/demo__dev/')
    expect(mockLmdb.removeAndResolve).toHaveBeenCalledWith('PLUGIN/demo__dev/settings')
    expect(mockMetaDb.removeSync).not.toHaveBeenCalled()
    expect(mockLmdb.removeAttachmentSilent).toHaveBeenCalledWith('PLUGIN/demo__dev/logo')
    expect(result).toEqual({
      success: true,
      deletedCount: 2
    })
  })

  it('clears the plugin filesystem data directory alongside the database namespace', async () => {
    const fsRm = vi.spyOn(physicalFs.promises, 'rm').mockResolvedValue(undefined as any)
    mockLmdb.allDocs.mockReturnValue([])

    const database = new DatabaseAPI()
    const result = await database.clearPluginData('demo')

    expect(result).toEqual({ success: true, deletedCount: 0 })
    // 「清除数据」同时删除 ztools.getPath('pluginData') 指向的目录，与卸载清理语义一致
    expect(fsRm).toHaveBeenCalledWith(getPluginDataPath('demo'), {
      recursive: true,
      force: true
    })
    fsRm.mockRestore()
  })

  it('does not delete the filesystem data directory when clearing host data', async () => {
    const fsRm = vi.spyOn(physicalFs.promises, 'rm').mockResolvedValue(undefined as any)

    const database = new DatabaseAPI()
    const result = await database.clearPluginData('ZTOOLS')

    expect(result).toEqual({ success: false, error: '主程序数据不支持通过该接口清空' })
    expect(fsRm).not.toHaveBeenCalled()
    fsRm.mockRestore()
  })

  it('derives plugin prefix from child window session partition when webContents is not a main view', () => {
    const database = new DatabaseAPI()
    ;(database as any).pluginManager = {
      getPluginInfoByWebContents: vi.fn().mockReturnValue(null)
    }

    const prefix = (database as any).getPluginPrefix({
      sender: {
        id: 99,
        session: {
          partition: 'persist:demo__dev'
        }
      }
    })

    expect(prefix).toBe('PLUGIN/demo__dev/')
  })
})
