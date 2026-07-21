import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { packZpx } from '../../src/main/utils/zpxArchive'

const state = vi.hoisted(() => ({
  pluginDir: `/tmp/ztools-plugin-installer-${process.pid}`
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  shell: { showItemInFolder: vi.fn() }
}))

vi.mock('../../src/main/core/appData/appDataPaths', () => ({
  getPluginsPath: () => state.pluginDir
}))

vi.mock('../../src/main/api/shared/database', () => ({
  default: { dbGet: vi.fn(), dbPut: vi.fn() }
}))

vi.mock('../../src/main/utils/windowUtils', () => ({
  openDialog: vi.fn()
}))

vi.mock('../../src/main/utils/common.js', () => ({
  sleep: vi.fn()
}))

vi.mock('../../src/main/utils/httpRequest.js', () => ({
  httpGet: vi.fn()
}))

vi.mock('../../src/main/api/renderer/pluginMarketConfig', () => ({
  PluginMarketAuthMode: { OPTIONAL: 'optional' },
  getPluginMarketApiBase: () => 'https://example.test',
  requestPluginMarket: vi.fn()
}))

import {
  PluginInstallerAPI,
  type PluginInstallerDeps
} from '../../src/main/api/renderer/pluginInstaller'
import { requestPluginMarket } from '../../src/main/api/renderer/pluginMarketConfig'

const tempDirs: string[] = []

async function createPackage(
  version: string,
  options?: { zip?: boolean; files?: Record<string, string>; unpack?: string }
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-installer-package-'))
  tempDirs.push(root)
  const sourceDir = path.join(root, 'source')
  await fs.mkdir(sourceDir)
  await fs.writeFile(
    path.join(sourceDir, 'plugin.json'),
    JSON.stringify({
      name: 'demo',
      title: 'Demo',
      version,
      main: 'index.html',
      features: [{ code: 'demo', cmds: ['demo'] }],
      ...(options?.unpack ? { unpack: options.unpack } : {})
    })
  )
  await fs.writeFile(path.join(sourceDir, 'index.html'), version)
  for (const [relativePath, content] of Object.entries(options?.files || {})) {
    const filePath = path.join(sourceDir, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content)
  }

  if (options?.zip) {
    const zipPath = path.join(root, 'demo.zip')
    const zip = new AdmZip()
    zip.addLocalFolder(sourceDir)
    zip.writeZip(zipPath)
    return zipPath
  }
  const zpxPath = path.join(root, 'demo.zpx')
  await packZpx(sourceDir, zpxPath)
  return zpxPath
}

function createInstaller(): {
  installer: PluginInstallerAPI
  getPlugins: () => any[]
  killPluginByName: ReturnType<typeof vi.fn>
  replacePluginPathReferences: ReturnType<typeof vi.fn>
  failNextRegistryWrite: () => void
} {
  let plugins: any[] = []
  let registryWriteShouldFail = false
  const killPluginByName = vi.fn()
  const replacePluginPathReferences = vi.fn()
  const deps: PluginInstallerDeps = {
    mainWindow: null,
    pluginManager: { killPluginByName } as any,
    devProjects: {} as any,
    getPlugins: async () => plugins,
    readInstalledPlugins: () => plugins,
    writeInstalledPlugins: (next) => {
      if (registryWriteShouldFail) {
        registryWriteShouldFail = false
        throw new Error('registry write failed')
      }
      plugins = next
    },
    notifyPluginsChanged: vi.fn(),
    replacePluginPathReferences,
    validatePluginConfig: vi.fn(() => ({ valid: true }))
  }
  return {
    installer: new PluginInstallerAPI(deps),
    getPlugins: () => plugins,
    killPluginByName,
    replacePluginPathReferences,
    failNextRegistryWrite: () => {
      registryWriteShouldFail = true
    }
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await fs.rm(state.pluginDir, { recursive: true, force: true })
})

afterEach(async () => {
  await fs.rm(state.pluginDir, { recursive: true, force: true })
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('PluginInstallerAPI package installation', () => {
  it('installs ZPX as a versioned ASAR with automatic native unpacking', async () => {
    const packagePath = await createPackage('1.0.0', {
      files: { 'native/addon.node': 'native' }
    })
    const context = createInstaller()

    const result = await context.installer.installPluginFromPath(packagePath)

    expect(result.success).toBe(true)
    expect(result.plugin.storageKind).toBe('asar')
    expect(path.basename(result.plugin.path)).toMatch(/^demo-1\.0\.0-[a-f0-9]{8}\.asar$/)
    await expect(fs.access(result.plugin.path)).resolves.toBeUndefined()
    await expect(
      fs.readFile(path.join(`${result.plugin.path}.unpacked`, 'native/addon.node'), 'utf8')
    ).resolves.toBe('native')
  })

  it('switches to a new ZPX path before deleting the previous version', async () => {
    const firstPackage = await createPackage('1.0.0')
    const secondPackage = await createPackage('2.0.0')
    const context = createInstaller()
    const first = await context.installer.installPluginFromPath(firstPackage)

    const second = await context.installer.installPluginFromPath(secondPackage)

    expect(second.success).toBe(true)
    expect(second.plugin.path).not.toBe(first.plugin.path)
    expect(context.getPlugins()).toHaveLength(1)
    expect(context.getPlugins()[0].path).toBe(second.plugin.path)
    expect(context.replacePluginPathReferences).toHaveBeenCalledWith(
      'demo',
      first.plugin.path,
      second.plugin.path
    )
    await expect(fs.access(first.plugin.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(second.plugin.path)).resolves.toBeUndefined()
  })

  it('keeps ZIP plugins as directories', async () => {
    const packagePath = await createPackage('1.0.0', { zip: true })
    const context = createInstaller()

    const result = await context.installer.installPluginFromPath(packagePath)

    expect(result.success).toBe(true)
    expect(result.plugin.storageKind).toBe('directory')
    expect(result.plugin.path).toBe(path.join(state.pluginDir, 'demo'))
    await expect(fs.readFile(path.join(result.plugin.path, 'index.html'), 'utf8')).resolves.toBe(
      '1.0.0'
    )
  })

  it('supports upgrading from ZIP to ZPX', async () => {
    const zipPackage = await createPackage('1.0.0', { zip: true })
    const zpxPackage = await createPackage('2.0.0')
    const context = createInstaller()
    const first = await context.installer.installPluginFromPath(zipPackage)

    const second = await context.installer.installPluginFromPath(zpxPackage)

    expect(first.plugin.storageKind).toBe('directory')
    expect(second.plugin.storageKind).toBe('asar')
    await expect(fs.access(first.plugin.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(second.plugin.path)).resolves.toBeUndefined()
  })

  it('replaces a ZIP directory without changing its registered path', async () => {
    const firstPackage = await createPackage('1.0.0', { zip: true })
    const secondPackage = await createPackage('2.0.0', { zip: true })
    const context = createInstaller()
    const first = await context.installer.installPluginFromPath(firstPackage)

    const second = await context.installer.installPluginFromPath(secondPackage)

    expect(second.success).toBe(true)
    expect(second.plugin.path).toBe(first.plugin.path)
    await expect(fs.readFile(path.join(second.plugin.path, 'index.html'), 'utf8')).resolves.toBe(
      '2.0.0'
    )
  })

  it('supports upgrading from ZPX to ZIP', async () => {
    const zpxPackage = await createPackage('1.0.0')
    const zipPackage = await createPackage('2.0.0', { zip: true })
    const context = createInstaller()
    const first = await context.installer.installPluginFromPath(zpxPackage)

    const second = await context.installer.installPluginFromPath(zipPackage)

    expect(second.success).toBe(true)
    expect(second.plugin.storageKind).toBe('directory')
    await expect(fs.access(first.plugin.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(path.join(second.plugin.path, 'index.html'), 'utf8')).resolves.toBe(
      '2.0.0'
    )
  })

  it('keeps the previous ASAR when switching the registry fails', async () => {
    const firstPackage = await createPackage('1.0.0')
    const secondPackage = await createPackage('2.0.0')
    const context = createInstaller()
    const first = await context.installer.installPluginFromPath(firstPackage)
    context.failNextRegistryWrite()

    const second = await context.installer.installPluginFromPath(secondPackage)

    expect(second).toMatchObject({ success: false, error: 'registry write failed' })
    expect(context.getPlugins()[0].path).toBe(first.plugin.path)
    await expect(fs.access(first.plugin.path)).resolves.toBeUndefined()
    const asarFiles = (await fs.readdir(state.pluginDir)).filter((name) => name.endsWith('.asar'))
    expect(asarFiles).toEqual([path.basename(first.plugin.path)])
  })
})

describe('PluginInstallerAPI market download URL resolution', () => {
  it('prefers the ZPX URL returned by the market', async () => {
    vi.mocked(requestPluginMarket).mockResolvedValue({
      status: 200,
      data: {
        downloadUrl: 'https://example.test/demo.zip',
        zpxDownloadUrl: 'https://example.test/demo.zpx'
      }
    } as any)
    const { installer } = createInstaller()

    const downloadUrl = await (installer as any).resolveMarketDownloadUrl({ name: 'demo' })

    expect(downloadUrl).toBe('https://example.test/demo.zpx')
  })

  it('falls back to the ZIP URL when the market has no ZPX asset', async () => {
    vi.mocked(requestPluginMarket).mockResolvedValue({
      status: 200,
      data: { downloadUrl: 'https://example.test/demo.zip' }
    } as any)
    const { installer } = createInstaller()

    const downloadUrl = await (installer as any).resolveMarketDownloadUrl({ name: 'demo' })

    expect(downloadUrl).toBe('https://example.test/demo.zip')
  })
})
