import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createAsarArtifactPath,
  isOwnedPluginArtifact,
  removePluginArtifact,
  removePluginArtifactsByName,
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

  it('attributes versioned ASARs to the owning plugin without prefix collisions', () => {
    expect(isOwnedPluginArtifact('he-calendar-1.3.0-bd65d78d.asar', 'he-calendar')).toBe(true)
    expect(isOwnedPluginArtifact('he-calendar-1.3.0-bd65d78d.asar.unpacked', 'he-calendar')).toBe(
      true
    )
    expect(isOwnedPluginArtifact('he-calendar', 'he-calendar')).toBe(true)
    expect(
      isOwnedPluginArtifact('he-calendar-extra-1.0.0-abcd1234.asar', 'he-calendar', [
        'he-calendar-extra'
      ])
    ).toBe(false)
    expect(
      isOwnedPluginArtifact('he-calendar-extra-1.0.0-abcd1234.asar', 'he-calendar-extra')
    ).toBe(true)
    expect(isOwnedPluginArtifact('other-1.0.0-abcd1234.asar', 'he-calendar')).toBe(false)
  })

  it('removes all name-matching ASAR leftovers while keeping reserved plugins', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-storage-sweep-'))
    tempDirs.push(root)
    const current = path.join(root, 'he-calendar-1.3.0-bd65d78d.asar')
    const orphan = path.join(root, 'he-calendar-1.3.0-c1158ad4.asar')
    const other = path.join(root, 'he-calendar-extra-1.0.0-abcd1234.asar')
    await fs.writeFile(current, 'current')
    await fs.mkdir(`${current}.unpacked`)
    await fs.writeFile(orphan, 'orphan')
    await fs.mkdir(`${orphan}.unpacked`)
    await fs.writeFile(other, 'other')

    await removePluginArtifactsByName(root, 'he-calendar', {
      reservedNames: ['he-calendar-extra']
    })

    await expect(fs.access(current)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(`${current}.unpacked`)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(orphan)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(`${orphan}.unpacked`)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(other)).resolves.toBeUndefined()
  })

  it('keeps the current ASAR when sweeping leftovers after upgrade', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-storage-keep-'))
    tempDirs.push(root)
    const current = path.join(root, 'demo-2.0.0-aaaaaaaa.asar')
    const orphan = path.join(root, 'demo-1.0.0-bbbbbbbb.asar')
    await fs.writeFile(current, 'current')
    await fs.mkdir(`${current}.unpacked`)
    await fs.writeFile(orphan, 'orphan')

    await removePluginArtifactsByName(root, 'demo', {
      keepPaths: [current]
    })

    await expect(fs.access(current)).resolves.toBeUndefined()
    await expect(fs.access(`${current}.unpacked`)).resolves.toBeUndefined()
    await expect(fs.access(orphan)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
