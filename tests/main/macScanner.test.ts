import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import plist from 'simple-plist'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanApplications } from '../../src/main/core/commandScanner/macScanner'
import { getMacApplicationPaths } from '../../src/main/utils/systemPaths'

vi.mock('electron', () => ({
  app: { getPreferredSystemLanguages: () => ['zh-Hans-CN', 'en-US'] }
}))
vi.mock('../../src/main/core/native/index.js', () => ({ WindowManager: {} }))
vi.mock('../../src/main/utils/systemPaths', () => ({ getMacApplicationPaths: vi.fn() }))

describe('macOS 应用名称扫描', () => {
  let appsDir: string

  beforeEach(async () => {
    appsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-mac-apps-'))
    vi.mocked(getMacApplicationPaths).mockReturnValue([appsDir])
  })

  afterEach(async () => {
    await fs.rm(appsDir, { recursive: true, force: true })
  })

  it('收录 WrappedBundle 的默认和本地化名称，并保留外层启动路径', async () => {
    const outerApp = path.join(appsDir, 'rednote.app')
    const innerApp = path.join(outerApp, 'Wrapper', 'discover.app')
    const localizedResources = path.join(innerApp, 'zh-Hans.lproj')
    await fs.mkdir(localizedResources, { recursive: true })
    await fs.symlink(innerApp, path.join(outerApp, 'WrappedBundle'), 'junction')
    plist.writeBinaryFileSync(path.join(innerApp, 'Info.plist'), {
      CFBundleDisplayName: 'Red Note',
      CFBundleName: 'discover'
    })
    plist.writeBinaryFileSync(path.join(localizedResources, 'InfoPlist.strings'), {
      CFBundleDisplayName: '小红书',
      APP_NAME_SYNONYM_1: '小红薯'
    })

    expect(await scanApplications()).toMatchObject([
      {
        name: 'rednote',
        path: outerApp,
        icon: `ztools-icon://${encodeURIComponent(outerApp)}`,
        aliases: ['小红书', '小红薯', 'Red Note', 'discover']
      }
    ])
  })

  it('继续从 Contents 读取原生 Mac 应用名称和别名', async () => {
    const appPath = path.join(appsDir, 'Example.app')
    const contentsPath = path.join(appPath, 'Contents')
    const localizedResources = path.join(contentsPath, 'Resources', 'zh-Hans.lproj')
    await fs.mkdir(localizedResources, { recursive: true })
    plist.writeFileSync(path.join(contentsPath, 'Info.plist'), { CFBundleName: 'Example' })
    await fs.writeFile(
      path.join(localizedResources, 'InfoPlist.strings'),
      '"CFBundleDisplayName" = "示例";'
    )

    expect(await scanApplications()).toMatchObject([
      { name: '示例', path: appPath, aliases: ['Example'] }
    ])
  })
})
