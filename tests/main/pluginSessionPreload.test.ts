import { describe, expect, it, vi } from 'vitest'
import { ensurePluginSessionPreload } from '../../src/main/core/pluginSessionPreload'

describe('plugin session preload registration', () => {
  it('adds the host preload once while preserving existing session preloads', () => {
    const existingPreload = '/tmp/existing-preload.js'
    const hostPreload = '/tmp/host-preload.js'
    let preloads = [existingPreload]
    const session = {
      getPreloads: vi.fn(() => preloads),
      setPreloads: vi.fn((scripts: string[]) => {
        preloads = scripts
      })
    }

    ensurePluginSessionPreload(session, hostPreload)
    ensurePluginSessionPreload(session, hostPreload)

    expect(session.setPreloads).toHaveBeenCalledTimes(1)
    expect(session.setPreloads).toHaveBeenCalledWith([existingPreload, hostPreload])
  })
})
