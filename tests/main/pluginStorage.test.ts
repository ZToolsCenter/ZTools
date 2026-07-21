import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createAsarArtifactPath,
  removePluginArtifact,
  resolvePluginStorageKind
} from '../../src/main/utils/pluginStorage'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('plugin storage', () => {
  it('creates a versioned ASAR path and rejects unsafe path segments', () => {
    expect(createAsarArtifactPath('/plugins', 'demo', '1.2.3', 'abcd1234')).toBe(
      path.join('/plugins', 'demo-1.2.3-abcd1234.asar')
    )
    expect(() => createAsarArtifactPath('/plugins', '../demo', '1.2.3')).toThrow()
    expect(() => createAsarArtifactPath('/plugins', 'demo', '../1.2.3')).toThrow()
  })

  it('removes an ASAR together with its unpacked directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-storage-test-'))
    tempDirs.push(root)
    const asarPath = path.join(root, 'demo-1.0.0-test.asar')
    await fs.writeFile(asarPath, 'asar')
    await fs.mkdir(`${asarPath}.unpacked`)
    await fs.writeFile(path.join(`${asarPath}.unpacked`, 'addon.node'), 'native')

    await removePluginArtifact({ path: asarPath, storageKind: 'asar' })

    await expect(fs.access(asarPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(`${asarPath}.unpacked`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recognizes legacy directory and ASAR records', () => {
    expect(resolvePluginStorageKind({ path: '/plugins/demo' })).toBe('directory')
    expect(resolvePluginStorageKind({ path: '/plugins/demo.asar' })).toBe('asar')
  })
})
