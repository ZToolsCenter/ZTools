import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  materializeZpxAsar,
  packZpx,
  prepareZpxAsar,
  readFileFromAsar
} from '../../src/main/utils/zpxArchive'

const tempDirs: string[] = []

async function createFixture(options?: {
  unpack?: string
  files?: Record<string, string>
}): Promise<{ root: string; sourceDir: string; zpxPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-zpx-test-'))
  tempDirs.push(root)
  const sourceDir = path.join(root, 'source')
  await fs.mkdir(sourceDir, { recursive: true })
  await fs.writeFile(
    path.join(sourceDir, 'plugin.json'),
    JSON.stringify({
      name: 'demo',
      version: '1.2.3',
      main: 'index.html',
      features: [{ code: 'demo', cmds: ['demo'] }],
      ...(options?.unpack ? { unpack: options.unpack } : {})
    })
  )
  await fs.writeFile(path.join(sourceDir, 'index.html'), '<main>demo</main>')
  for (const [relativePath, content] of Object.entries(options?.files || {})) {
    const filePath = path.join(sourceDir, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content)
  }
  const zpxPath = path.join(root, 'demo.zpx')
  await packZpx(sourceDir, zpxPath)
  return { root, sourceDir, zpxPath }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('prepareZpxAsar', () => {
  it('keeps the materialized ASAR unchanged when no file needs unpacking', async () => {
    const fixture = await createFixture({ unpack: '*.exe' })
    const expectedAsar = path.join(fixture.root, 'expected.asar')
    await materializeZpxAsar(fixture.zpxPath, expectedAsar)

    const prepared = await prepareZpxAsar(fixture.zpxPath, path.join(fixture.root, 'work'))

    expect(prepared.unpackedPath).toBeUndefined()
    expect(prepared.unpackedFiles).toEqual([])
    expect(await fs.readFile(prepared.asarPath)).toEqual(await fs.readFile(expectedAsar))
  })

  it('automatically places native modules in the unpacked directory', async () => {
    const fixture = await createFixture({ files: { 'native/addon.node': 'native-binary' } })

    const prepared = await prepareZpxAsar(fixture.zpxPath, path.join(fixture.root, 'work'))

    expect(prepared.unpackedFiles).toEqual(['native/addon.node'])
    expect(
      await fs.readFile(path.join(`${prepared.asarPath}.unpacked`, 'native/addon.node'), 'utf8')
    ).toBe('native-binary')
    expect(readFileFromAsar(prepared.asarPath, 'native/addon.node').toString()).toBe(
      'native-binary'
    )
  })

  it('supports explicit extglob rules while leaving unmatched files packed', async () => {
    const fixture = await createFixture({
      unpack: '@(*.exe|aperture)',
      files: {
        'bin/tool.exe': 'exe',
        'bin/aperture': 'aperture',
        'bin/keep.txt': 'packed',
        'native/addon.node': 'native'
      }
    })

    const prepared = await prepareZpxAsar(fixture.zpxPath, path.join(fixture.root, 'work'))
    const unpackedRoot = `${prepared.asarPath}.unpacked`

    expect(prepared.unpackedFiles.sort()).toEqual([
      'bin/aperture',
      'bin/tool.exe',
      'native/addon.node'
    ])
    await expect(fs.readFile(path.join(unpackedRoot, 'bin/tool.exe'), 'utf8')).resolves.toBe('exe')
    await expect(fs.readFile(path.join(unpackedRoot, 'bin/aperture'), 'utf8')).resolves.toBe(
      'aperture'
    )
    await expect(fs.readFile(path.join(unpackedRoot, 'native/addon.node'), 'utf8')).resolves.toBe(
      'native'
    )
    await expect(fs.access(path.join(unpackedRoot, 'bin/keep.txt'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
