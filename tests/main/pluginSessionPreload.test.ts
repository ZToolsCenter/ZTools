import { describe, expect, it, vi } from 'vitest'
import { ensurePluginSessionPreload } from '../../src/main/core/pluginSessionPreload'

describe('plugin session preload registration', () => {
  it('registers the host preload only once across repeated child window creation', () => {
    const scripts: Array<{ id: string; type: 'frame'; filePath: string }> = []
    const session = {
      getPreloadScripts: vi.fn(() => scripts),
      registerPreloadScript: vi.fn((script) => {
        scripts.push({ ...script, id: 'host-preload' })
        return 'host-preload'
      })
    }
    for (let index = 0; index < 5; index++)
      ensurePluginSessionPreload(session as any, '/tmp/preload.js')
    expect(session.registerPreloadScript).toHaveBeenCalledTimes(1)
    expect(scripts).toHaveLength(1)
  })
})
