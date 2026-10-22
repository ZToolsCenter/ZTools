import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

/**
 * 创建进入后隐藏宿主并在子窗口创建回调中立即重载的测试插件。
 * @param pluginRoot 测试插件实体目录。
 * @returns 插件文件写入完成后的 Promise。
 */
async function createReloadPlugin(pluginRoot: string): Promise<void> {
  await fs.mkdir(pluginRoot, { recursive: true })
  await fs.writeFile(
    path.join(pluginRoot, 'plugin.json'),
    JSON.stringify({
      name: 'e2e-child-reload',
      title: 'E2E 独立窗口重载',
      version: '1.0.0',
      main: 'index.html',
      preload: 'preload.js',
      features: [{ code: 'open', explain: '测试独立窗口重载', cmds: ['E2E 独立窗口重载'] }]
    })
  )
  await fs.writeFile(path.join(pluginRoot, 'index.html'), '<html><body>插件入口</body></html>')
  await fs.writeFile(
    path.join(pluginRoot, 'preload.js'),
    `
    window.ztools.onPluginEnter(() => {
      window.ztools.hideMainWindow(false)
      const child = window.ztools.createBrowserWindow('child.html', {
        show:false, width:500, height:300, webPreferences:{preload:'child-preload.js'}
      }, () => child.webContents.executeJavaScript('window.location.reload()'))
      child.show()
      child.focus()
      window.ztools.outPlugin()
    })
  `
  )
  await fs.writeFile(
    path.join(pluginRoot, 'child-preload.js'),
    `
    const fs = require('node:fs')
    const path = require('node:path')
    const counterPath = path.join(__dirname, 'reload-count.txt')
    const starts = (fs.existsSync(counterPath) ? Number(fs.readFileSync(counterPath, 'utf8')) : 0) + 1
    fs.writeFileSync(counterPath, String(starts))
    window.addEventListener('DOMContentLoaded', () => {
      document.body.innerText = '子窗口正文已就绪，加载次数 ' + starts
    })
  `
  )
  await fs.writeFile(path.join(pluginRoot, 'child.html'), '<html><body>加载中</body></html>')
}

/**
 * 找到设置插件后执行测试登记脚本。
 * @param application 当前使用隔离数据目录的 Electron 实例。
 * @param source 设置插件中执行的脚本。
 * @returns 脚本执行结果。
 */
async function executeInSettings(
  application: ElectronApplication,
  source: string
): Promise<unknown> {
  return await application.evaluate(async ({ webContents }, script) => {
    const settings = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
    if (!settings) return ''
    return await settings.executeJavaScript(script)
  }, source)
}

test('插件自建窗口可在创建回调中重载且共享会话不重复注入 preload', async ({
  browserName: _browserName
}) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-child-reload-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugins', 'e2e-child-reload')
  let application: ElectronApplication | undefined
  try {
    // 插件、主程序和旧数据均在本测试创建的目录内，不读写真实用户数据。
    await fs.mkdir(legacyRoot, { recursive: true })
    await createReloadPlugin(pluginRoot)
    application = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] =>
            Boolean(entry[1])
          )
        ),
        ZTOOLS_E2E: '1',
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    const main = await application.firstWindow()
    await expect(main.locator('.search-input')).toBeVisible()
    await main.locator('.search-input').fill('通用设置')
    await main.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() => executeInSettings(application!, 'document.body.innerText'))
      .toContain('开机自动启动')
    expect(
      await executeInSettings(
        application,
        `window.ztools.internal.adoptPluginEntity(${JSON.stringify(pluginRoot)})`
      )
    ).toMatchObject({ success: true })

    for (let cycle = 0; cycle < 3; cycle++) {
      // 模拟 Paste 插件在进入事件中创建窗口、隐藏宿主并重载，观察真实渲染进程。
      expect(
        await main.evaluate(() =>
          window.ztools.commands.execute({
            target: 'E2E 独立窗口重载',
            context: { searchQuery: '', pastedText: null, pastedImage: null, pastedFiles: null },
            source: 'global-shortcut'
          })
        )
      ).toMatchObject({ success: true })
      await expect
        .poll(() =>
          application!.evaluate(async ({ BrowserWindow }) => {
            const child = BrowserWindow.getAllWindows().find((win) =>
              win.webContents.getURL().endsWith('/child.html')
            )
            if (!child || child.webContents.isCrashed()) return ''
            return await child.webContents
              .executeJavaScript('document.body.innerText')
              .catch(() => '')
          })
        )
        .toContain(`加载次数 ${(cycle + 1) * 2}`)
      expect(
        await application.evaluate(({ BrowserWindow, session }) => {
          const child = BrowserWindow.getAllWindows().find((win) =>
            win.webContents.getURL().endsWith('/child.html')
          )!
          const result = {
            visible: child.isVisible(),
            crashed: child.webContents.isCrashed(),
            preloads: session.fromPartition('persist:e2e-child-reload').getPreloadScripts().length
          }
          child.destroy()
          return result
        })
      ).toEqual({ visible: true, crashed: false, preloads: 1 })
    }
  } finally {
    // 关闭隔离测试实例并清理本用例创建的目录。
    await application?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
