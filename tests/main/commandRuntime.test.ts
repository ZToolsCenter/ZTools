import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const events = vi.hoisted(() => ({
  device: new Map<string, (change: { docId?: string }) => void>(),
  account: new Map<string, (change: { docId?: string }) => void>(),
  storage: new Map<string, () => void>()
}))

vi.mock('electron', () => ({
  app: { once: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

vi.mock('../../src/main/core/commands/searchWorker?nodeWorker', () => ({ default: vi.fn() }))

vi.mock('../../src/main/core/lmdb/lmdbInstance', () => ({
  default: { on: (name: string, listener: any) => events.account.set(name, listener) },
  storageManager: {
    getDeviceDb: () => ({
      on: (name: string, listener: any) => events.device.set(name, listener)
    }),
    on: (name: string, listener: () => void) => events.storage.set(name, listener)
  }
}))

/**
 * 初始化使用内存设置和存储通知的运行时，不创建真实 Worker 或读写用户数据。
 * @param settings 初始化时的常规设置
 * @returns 可变设置文档和目录失效观察器
 */
async function runtimeFixture(settings?: Record<string, unknown>): Promise<{
  documents: Map<string, Record<string, unknown>>
  invalidate: ReturnType<typeof vi.spyOn>
}> {
  const documents = new Map<string, Record<string, unknown>>()
  if (settings) documents.set('settings-general', settings)
  const { initializeCommandService } = await import('../../src/main/core/commands/runtime')
  const service = initializeCommandService(
    {
      sources: async () => ({
        apps: [],
        plugins: [],
        settings: [],
        localShortcuts: [],
        aliases: {},
        disabledPlugins: [],
        disabledCommands: [],
        enabledMainPushPlugins: []
      }),
      read: (key) => documents.get(key),
      write: vi.fn(),
      launch: vi.fn(),
      queryMainPush: vi.fn(),
      selectMainPush: vi.fn()
    },
    {
      id: 1,
      on: vi.fn(),
      once: vi.fn(),
      isDestroyed: () => false,
      send: vi.fn()
    } as unknown as WebContents
  )
  return { documents, invalidate: vi.spyOn(service, 'invalidate') }
}

describe('指令运行时目录失效范围', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    events.device.clear()
    events.account.clear()
    events.storage.clear()
  })

  it('主题等无关设置以及本地搜索默认值的等价写入不重建目录', async () => {
    const { documents, invalidate } = await runtimeFixture()
    documents.set('settings-general', { theme: 'dark' })
    events.device.get('local-change')!({ docId: 'ZTOOLS/settings-general' })
    documents.set('settings-general', { theme: 'light', localAppSearch: true })
    events.account.get('change')!({ docId: 'ZTOOLS/settings-general' })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('只在本地应用搜索的有效开关变化时重建，并兼容文档删除', async () => {
    const { documents, invalidate } = await runtimeFixture({ localAppSearch: true })
    documents.set('settings-general', { localAppSearch: false })
    events.device.get('local-change')!({ docId: 'ZTOOLS/settings-general' })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenLastCalledWith()

    documents.set('settings-general', { localAppSearch: false, theme: 'dark' })
    events.device.get('local-change')!({ docId: 'ZTOOLS/settings-general' })
    expect(invalidate).toHaveBeenCalledTimes(1)

    documents.delete('settings-general')
    events.account.get('change')!({ docId: 'settings-general' })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('保留目录来源、动态功能和用户排序状态的不同刷新行为', async () => {
    const { invalidate } = await runtimeFixture()
    events.account.get('change')!({ docId: 'ZTOOLS/command-aliases' })
    events.device.get('local-change')!({ docId: 'ZTOOLS/cached-commands' })
    events.account.get('change')!({ docId: 'PLUGIN/fixture/dynamic-features' })
    expect(invalidate.mock.calls).toEqual([[], [], []])

    events.account.get('change')!({ docId: 'ZTOOLS/search-preference' })
    expect(invalidate).toHaveBeenLastCalledWith(false)
    events.account.get('change')!({ docId: 'ZTOOLS/unrelated-setting' })
    expect(invalidate).toHaveBeenCalledTimes(4)
  })

  it('切换账号重建目录并更新配置基线，不重复响应新账号相同配置', async () => {
    const { documents, invalidate } = await runtimeFixture({ localAppSearch: true })
    documents.set('settings-general', { localAppSearch: false })
    events.storage.get('account-switched')!()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenLastCalledWith()

    events.account.get('change')!({ docId: 'ZTOOLS/settings-general' })
    expect(invalidate).toHaveBeenCalledTimes(1)

    documents.set('settings-general', { localAppSearch: true })
    events.device.get('local-change')!({ docId: 'ZTOOLS/settings-general' })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
