import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as tar from 'tar'

const state = vi.hoisted(() => ({
  root: `/tmp/ztools-installer-npm-${process.pid}`,
  tarballPath: ''
}))

vi.mock('electron', () => ({
  app: { getPath: () => `${state.root}/temp` },
  shell: { showItemInFolder: vi.fn() }
}))

vi.mock('../../src/main/core/appData/appDataPaths', () => ({
  getPluginsPath: () => `${state.root}/plugins`
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

vi.mock('../../src/main/utils/download.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/utils/download.js')>(
    '../../src/main/utils/download.js'
  )
  return {
    ...actual,
    // 用测试构造的 tgz 代替真实网络下载。
    downloadFile: vi.fn(async (_url: string, targetPath: string) => {
      await fs.copyFile(state.tarballPath, targetPath)
    })
  }
})

vi.mock('../../src/main/api/renderer/pluginMarketConfig', () => ({
  PluginMarketAuthMode: { OPTIONAL: 'optional' },
  getPluginMarketApiBase: () => 'https://example.test',
  requestPluginMarket: vi.fn()
}))

import {
  PluginInstallerAPI,
  type PluginInstallerDeps
} from '../../src/main/api/renderer/pluginInstaller'
import { httpGet } from '../../src/main/utils/httpRequest.js'
import databaseAPI from '../../src/main/api/shared/database'

/**
 * 构造只含 plugin.json 与入口文件的 npm tarball。
 * @param pluginName 写入 plugin.json 的插件名称
 * @returns 生成的 tgz 路径
 */
async function createNpmTarball(pluginName: string): Promise<string> {
  const sourceRoot = path.join(state.root, 'source')
  const packageDir = path.join(sourceRoot, 'package')
  await fs.mkdir(packageDir, { recursive: true })
  await fs.writeFile(
    path.join(packageDir, 'plugin.json'),
    JSON.stringify({
      name: pluginName,
      title: 'Npm Demo',
      version: '1.0.0',
      main: 'index.html',
      features: [{ code: 'demo', cmds: ['demo'] }]
    })
  )
  await fs.writeFile(path.join(packageDir, 'index.html'), 'ok')
  const tarballPath = path.join(state.root, 'fixture.tgz')
  await tar.create({ gzip: true, file: tarballPath, cwd: sourceRoot }, ['package'])
  return tarballPath
}

/**
 * 创建安装器；插件登记由 databaseAPI.dbPut 记录。
 * @returns 安装器
 */
function createInstaller(): PluginInstallerAPI {
  let plugins: any[] = []
  const deps: PluginInstallerDeps = {
    mainWindow: null,
    pluginManager: { killPluginByName: vi.fn() } as any,
    devProjects: {} as any,
    getPlugins: async () => plugins,
    readInstalledPlugins: () => plugins,
    writeInstalledPlugins: (next) => {
      plugins = next
    },
    notifyPluginsChanged: vi.fn(),
    replacePluginPathReferences: vi.fn(),
    validatePluginConfig: vi.fn(() => ({ valid: true }))
  }
  return new PluginInstallerAPI(deps)
}

beforeEach(async () => {
  vi.clearAllMocks()
  await fs.rm(state.root, { recursive: true, force: true })
  await fs.mkdir(state.root, { recursive: true })
  vi.mocked(httpGet).mockResolvedValue({
    data: {
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { dist: { tarball: 'https://registry.test/demo.tgz' } } }
    }
  } as any)
})

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true })
})

describe('PluginInstallerAPI npm installation', () => {
  it.each(['../escaped-plugin', '..\\escaped-plugin', 'nested/plugin', '..', '/absolute-plugin'])(
    '拒绝会越出插件目录的插件名称 %s',
    async (pluginName) => {
      state.tarballPath = await createNpmTarball(pluginName)
      const installer = createInstaller()

      const result = await installer.installPluginFromNpm('demo-package')

      expect(result.success).toBe(false)
      expect(result.error).toContain('插件名称')
      // 插件目录之外不得出现任何由包内容创建的目录。
      await expect(fs.access(path.join(state.root, 'escaped-plugin'))).rejects.toThrow()
      expect(databaseAPI.dbPut).not.toHaveBeenCalled()
    }
  )

  it('合法的插件名称仍会安装到插件目录下', async () => {
    state.tarballPath = await createNpmTarball('npm-demo')
    const installer = createInstaller()

    const result = await installer.installPluginFromNpm('demo-package')

    expect(result.success).toBe(true)
    expect(result.plugin.name).toBe('npm-demo')
    await expect(
      fs.access(path.join(state.root, 'plugins', 'npm-demo', 'plugin.json'))
    ).resolves.toBeUndefined()
  })
})
