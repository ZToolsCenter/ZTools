import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const moduleLoader = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const preloadPath = require.resolve('../../resources/preload.js')
const originalLoad = moduleLoader._load

describe('plugin preload internal api bridge', () => {
  const ipcInvoke = vi.fn()
  const ipcOn = vi.fn()
  const ipcSend = vi.fn()
  const ipcSendSync = vi.fn()
  const ipcRemoveListener = vi.fn()
  const ipcEmit = vi.fn()

  beforeEach(() => {
    delete require.cache[preloadPath]
    ipcInvoke.mockReset().mockResolvedValue({ success: true })
    ipcOn.mockReset()
    ipcSend.mockReset()
    ipcSendSync.mockReset()
    ipcRemoveListener.mockReset()
    ipcEmit.mockReset()
    ;(globalThis as any).window = {
      addEventListener: vi.fn()
    }

    moduleLoader._load = ((request: string, parent: unknown, isMain: boolean) => {
      if (request === 'electron') {
        return {
          ipcRenderer: {
            invoke: ipcInvoke,
            on: ipcOn,
            send: ipcSend,
            sendSync: ipcSendSync,
            removeListener: ipcRemoveListener,
            emit: ipcEmit
          }
        }
      }

      return originalLoad.call(moduleLoader, request, parent, isMain)
    }) as typeof originalLoad
  })

  afterEach(() => {
    delete require.cache[preloadPath]
    moduleLoader._load = originalLoad
    delete (globalThis as any).window
  })

  it('exposes updateDevProjectsOrder for internal plugin runtimes', async () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal

    expect(internalApi?.updateDevProjectsOrder).toBeTypeOf('function')

    await internalApi.updateDevProjectsOrder(['beta', 'alpha'])

    expect(ipcInvoke).toHaveBeenCalledWith('internal:update-dev-projects-order', ['beta', 'alpha'])
  })

  it('exposes upsertDevProjectByConfigPath for internal plugin runtimes', async () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal

    expect(internalApi?.upsertDevProjectByConfigPath).toBeTypeOf('function')

    await internalApi.upsertDevProjectByConfigPath('/workspace/demo/plugin.json')

    expect(ipcInvoke).toHaveBeenCalledWith(
      'internal:upsert-dev-project-by-config-path',
      '/workspace/demo/plugin.json'
    )
  })

  it('exposes accountDelete through the account IPC channel', async () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal

    expect(internalApi?.accountDelete).toBeTypeOf('function')

    await internalApi.accountDelete()

    expect(ipcInvoke).toHaveBeenCalledWith('account:delete')
  })

  it('exposes getLinuxSession through the internal IPC channel', () => {
    require(preloadPath)

    const internalApi = (globalThis as any).window.ztools?.internal

    expect(internalApi?.getLinuxSession).toBeTypeOf('function')

    ipcSendSync.mockReturnValue({ isWayland: true })
    const result = internalApi.getLinuxSession()

    expect(ipcSendSync).toHaveBeenCalledWith('internal:get-linux-session')
    expect(result).toEqual({ isWayland: true })
  })
})
