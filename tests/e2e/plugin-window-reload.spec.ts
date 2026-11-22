import {
  expect,
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

/**
 * 创建测试插件，覆盖自建窗口和自动分离后的窗口 API。
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
      features: [
        { code: 'open', explain: '测试独立窗口重载', cmds: ['E2E 独立窗口重载'] },
        { code: 'callbacks', explain: '测试独立窗口回调', cmds: ['E2E 独立窗口回调'] },
        { code: 'show-main-window', cmds: ['E2E 自动分离唤起主窗口'] }
      ]
    })
  )
  await fs.writeFile(path.join(pluginRoot, 'index.html'), '<html><body>插件入口</body></html>')
  await fs.writeFile(
    path.join(pluginRoot, 'preload.js'),
    `
    window.readyCallbacks = []
    window.ztools.onPluginEnter(({ code }) => {
      // 模拟 ctool 在进入独立窗口后立即请求唤起主窗口。
      if (code === 'show-main-window') {
        const result = window.ztools.showMainWindow()
        window.showMainWindowResult = typeof result === 'boolean' ? result : null
        return
      }
      if (code !== 'open') return
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

/**
 * 在独立 Electron 实例登记测试插件，测试完成后释放数据与进程。
 * @param fixtures 当前 Playwright 测试的内置夹具。
 * @param use 使用已安装测试插件的回调。
 * @returns 测试与清理完成后结束的 Promise。
 */
async function provideWindowFixture(
  { browserName: _browserName }: { browserName: string },
  use: (value: { application: ElectronApplication; main: Page }) => Promise<void>
): Promise<void> {
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

    await use({ application, main })
  } finally {
    // 关闭隔离测试实例并清理本用例创建的目录。
    await application?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
}

const test = base.extend<{ windowFixture: { application: ElectronApplication; main: Page } }>({
  windowFixture: provideWindowFixture
})

test('插件自建窗口可在创建回调中重载且共享会话不重复注入 preload', async ({
  windowFixture: { application, main }
}) => {
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
        application.evaluate(async ({ BrowserWindow }) => {
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
})

test('并行创建、失败和关闭的独立窗口只处理各自的回调', async ({
  windowFixture: { application, main }
}) => {
  expect(
    await main.evaluate(() =>
      window.ztools.commands.execute({
        target: 'E2E 独立窗口回调',
        context: { searchQuery: '', pastedText: null, pastedImage: null, pastedFiles: null },
        source: 'global-shortcut'
      })
    )
  ).toMatchObject({ success: true })

  let parentId = 0
  await expect
    .poll(async () => {
      parentId = await application.evaluate(async ({ webContents }) => {
        for (const contents of webContents.getAllWebContents()) {
          if (!contents.getURL().endsWith('/index.html')) continue
          const ready = await contents
            .executeJavaScript('Array.isArray(window.readyCallbacks)')
            .catch(() => false)
          if (ready) return contents.id
        }
        return 0
      })
      return parentId
    })
    .toBeGreaterThan(0)

  const { activeId, failedId } = await application.evaluate(({ webContents }, id) => {
    // 同一任务内创建多个窗口，确保它们的回调登记存在重叠。
    return webContents.fromId(id)!.executeJavaScript(`
      (() => {
        const open = (url, cb) => ztools.createBrowserWindow(url, { show: false }, cb)
        const active = open('child.html?window=A', () => {
          window.readyCallbacks.push('A')
          open('child.html?window=C', () => window.readyCallbacks.push('C'))
        })
        open('child.html?window=B', () => window.readyCallbacks.push('B'))
        open('child.html?window=no-callback')
        const failed = open('missing.html', () => window.readyCallbacks.push('failed'))
        open('child.html?window=closed', () => window.readyCallbacks.push('closed')).destroy()
        return { activeId: active.id, failedId: failed.id }
      })()
    `)
  }, parentId)

  await expect
    .poll(() =>
      application.evaluate(
        ({ webContents }, id) =>
          webContents.fromId(id)!.executeJavaScript('window.readyCallbacks.slice().sort()'),
        parentId
      )
    )
    .toEqual(['A', 'B', 'C'])

  // 后续导航不会重新触发已消费或已取消的创建回调。
  expect(
    await application.evaluate(
      async ({ BrowserWindow, webContents }, args) => {
        const active = BrowserWindow.fromId(args.activeId)!
        const failed = BrowserWindow.fromId(args.failedId)!
        await active.loadURL(active.webContents.getURL())
        await failed.loadURL(active.webContents.getURL())
        return await webContents
          .fromId(args.parentId)!
          .executeJavaScript('window.readyCallbacks.slice().sort()')
      },
      { activeId, failedId, parentId }
    )
  ).toEqual(['A', 'B', 'C'])
})

test('自动分离的插件不能在进入回调中重新唤起主窗口', async ({
  windowFixture: { application, main }
}) => {
  await main.evaluate(() => window.ztools.dbPut('auto-detach-plugin', ['e2e-child-reload']))
  await main.getByRole('button', { name: '返回搜索' }).click()
  await main.locator('.search-input').fill('E2E 自动分离唤起主窗口')
  await main
    .locator('.app-item, .list-item')
    .filter({ hasText: 'E2E 自动分离唤起主窗口' })
    .first()
    .click()

  // 等待插件实际收到 IPC 返回值，再检查宿主与独立窗口的可见状态。
  await expect
    .poll(() =>
      application.evaluate(async ({ BrowserWindow, webContents }) => {
        const plugin = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().endsWith('/e2e-child-reload/index.html'))
        if (!plugin) return null
        const result = await plugin.executeJavaScript('window.showMainWindowResult')
        const windows = BrowserWindow.getAllWindows()
        return {
          result,
          mainVisible: windows
            .find((win) => win.webContents.getURL().endsWith('/index.html'))
            ?.isVisible(),
          detachedVisible: windows
            .find((win) => win.webContents.getURL().endsWith('/detached-titlebar.html'))
            ?.isVisible()
        }
      })
    )
    .toEqual({ result: false, mainVisible: false, detachedVisible: true })
})

test('插件自建窗口不能唤起主窗口，嵌入主窗口的插件仍可唤起', async ({
  windowFixture: { application, main }
}) => {
  expect(
    await main.evaluate(() =>
      window.ztools.commands.execute({
        target: 'E2E 独立窗口回调',
        context: { searchQuery: '', pastedText: null, pastedImage: null, pastedFiles: null }
      })
    )
  ).toMatchObject({ success: true })

  // 等到主窗口插件的正文已加载，再让插件通过公开 API 创建子窗口。
  await expect
    .poll(() =>
      application.evaluate(async ({ webContents }) => {
        const plugin = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().endsWith('/e2e-child-reload/index.html'))
        return plugin?.executeJavaScript('document.body?.innerText')
      })
    )
    .toContain('插件入口')
  const { parentId, childId } = await application.evaluate(async ({ webContents }) => {
    const plugin = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().endsWith('/e2e-child-reload/index.html'))!
    const childId = await plugin.executeJavaScript(
      "ztools.createBrowserWindow('child.html', { show: false }).webContents.id"
    )
    return { parentId: plugin.id, childId }
  })
  await expect
    .poll(() =>
      application.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), childId)
    )
    .toContain('/child.html')

  const result = await application.evaluate(
    async ({ BrowserWindow, webContents }, { parentId, childId }) => {
      const parent = webContents.fromId(parentId)!
      const child = webContents.fromId(childId)!
      const mainWindow = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().endsWith('/index.html')
      )!
      await parent.executeJavaScript('ztools.hideMainWindow(false)')
      // 在渲染进程中检查返回类型，避免 executeJavaScript 自动等待 Promise。
      const requestShow = `(() => {
        const result = ztools.showMainWindow()
        return typeof result === 'boolean' ? result : null
      })()`
      const childResult = await child.executeJavaScript(requestShow)
      const visibleAfterChild = mainWindow.isVisible()
      const parentResult = await parent.executeJavaScript(requestShow)
      return {
        childResult,
        visibleAfterChild,
        parentResult,
        visibleAfterParent: mainWindow.isVisible()
      }
    },
    { parentId, childId }
  )
  expect(result).toEqual({
    childResult: false,
    visibleAfterChild: false,
    parentResult: true,
    visibleAfterParent: true
  })
})
