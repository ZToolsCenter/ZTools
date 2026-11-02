import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const settingsUrlFragments = ['http://127.0.0.1:15177', 'internal-plugins/setting/index.html']
const slowPageDelayMs = 7_000

/**
 * 启动延迟返回正文的测试服务。
 * @returns 监听地址、服务器及请求计数
 */
async function startSlowPluginServer(): Promise<{
  server: http.Server
  baseUrl: string
  requestCount: () => number
}> {
  let requests = 0
  const server = http.createServer((_request, response) => {
    requests += 1
    // 首次加载必须超过插件就绪判断的 5 秒上限，以覆盖超时后的重新打开。
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html><body><main>SLOW PLUGIN READY</main></body></html>')
    }, slowPageDelayMs)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法获取慢插件测试服务端口')
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCount: () => requests
  }
}

/**
 * 启动返回可点击外部链接的插件页面服务。
 * @returns 监听地址和服务器
 */
async function startExternalLinkPluginServer(): Promise<{
  server: http.Server
  baseUrl: string
}> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html>
<html>
  <body data-e2e="external-link-plugin">
    <main>EXTERNAL LINK PLUGIN READY</main>
    <a id="external-link" href="https://github.com/ZToolsCenter/ZTools">Open external link</a>
  </body>
</html>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法获取外链插件测试服务端口')
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

/**
 * 在设置插件 WebContentsView 中执行页面脚本。
 * @param electronApp 隔离 Electron 应用实例
 * @param source 要执行的 JavaScript 源码
 * @returns 页面脚本结果
 */
async function executeInSettings(
  electronApp: ElectronApplication,
  source: string
): Promise<unknown> {
  return electronApp.evaluate(
    async ({ webContents }, { script, urlFragments }) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => urlFragments.some((fragment) => candidate.getURL().includes(fragment)))
      if (!contents) throw new Error('未找到设置插件 WebContentsView')
      return await contents.executeJavaScript(script)
    },
    { script: source, urlFragments: settingsUrlFragments }
  )
}

/**
 * 读取设置插件正文；视图尚未创建时返回空字符串。
 * @param electronApp 隔离 Electron 应用实例
 * @returns 设置插件当前正文
 */
async function readSettingsText(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(async ({ webContents }, urlFragments) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => urlFragments.some((fragment) => candidate.getURL().includes(fragment)))
    if (!contents || contents.isLoading()) return ''
    return await contents.executeJavaScript('document.body?.innerText || ""')
  }, settingsUrlFragments)
}

/**
 * 读取主窗口当前挂载的插件视图数量。
 * @param electronApp 隔离 Electron 应用实例
 * @returns 当前挂载的插件视图数量
 */
async function getPluginViewCount(electronApp: ElectronApplication): Promise<number> {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find(
      (window) => window.getTitle() === 'ZTools'
    )
    return mainWindow?.contentView.children.length ?? 0
  })
}

test('慢插件超时后再次打开会等待页面完成并挂载', async ({ browserName: _browserName }) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-readiness-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugins', 'e2e-slow-readiness')
  const slowServer = await startSlowPluginServer()
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await fs.mkdir(pluginRoot, { recursive: true })
  await fs.writeFile(
    path.join(pluginRoot, 'plugin.json'),
    JSON.stringify({
      name: 'e2e-slow-readiness',
      title: 'E2E Slow Plugin',
      version: '1.0.0',
      main: `${slowServer.baseUrl}/`,
      features: [
        {
          code: 'e2e-slow-readiness',
          explain: 'E2E Slow Plugin',
          cmds: ['E2E慢插件']
        }
      ]
    }),
    'utf-8'
  )

  try {
    electronApp = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] =>
            Boolean(entry[1])
          )
        ),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })

    const page = await electronApp.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() => readSettingsText(electronApp!), { timeout: 15_000 })
      .toContain('开机自动启动')

    const adopted = await executeInSettings(
      electronApp,
      `(async () => await window.ztools.internal.adoptPluginEntity(${JSON.stringify(pluginRoot)}))()`
    )
    expect(adopted).toMatchObject({ success: true, adopted: true })

    const launchSource = `(async () =>
      await window.ztools.internal.launch({
        path: ${JSON.stringify(pluginRoot)},
        type: 'plugin',
        featureCode: 'e2e-slow-readiness',
        name: 'E2E慢插件',
        cmdType: 'text',
        param: { code: 'e2e-slow-readiness' }
      }))()`
    await executeInSettings(electronApp, launchSource)

    // 第一次打开在 5 秒后超时，第二次打开发生在慢页面返回之前。
    await page.waitForTimeout(5_500)
    await executeInSettings(electronApp, launchSource)

    await expect
      .poll(() => getPluginViewCount(electronApp!), { timeout: 15_000 })
      .toBeGreaterThan(0)
    expect(slowServer.requestCount()).toBe(1)
  } finally {
    await electronApp?.close()
    await new Promise<void>((resolve) => slowServer.server.close(() => resolve()))
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('外部链接导航被拦截后再次打开插件仍可显示', async ({ browserName: _browserName }) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-external-link-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugins', 'e2e-external-link')
  const pluginServer = await startExternalLinkPluginServer()
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await fs.mkdir(pluginRoot, { recursive: true })
  await fs.writeFile(
    path.join(pluginRoot, 'plugin.json'),
    JSON.stringify({
      name: 'e2e-external-link',
      title: 'E2E External Link',
      version: '1.0.0',
      main: `${pluginServer.baseUrl}/`,
      features: [
        {
          code: 'e2e-external-link',
          explain: 'E2E External Link',
          cmds: ['E2E外链插件']
        }
      ]
    }),
    'utf-8'
  )

  try {
    electronApp = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] =>
            Boolean(entry[1])
          )
        ),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    // 避免测试时真的唤起系统浏览器。
    await electronApp.evaluate(({ shell }) => {
      shell.openExternal = async () => undefined
      return true
    })

    const page = await electronApp.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() => readSettingsText(electronApp!), { timeout: 15_000 })
      .toContain('开机自动启动')

    const adopted = await executeInSettings(
      electronApp,
      `(async () => await window.ztools.internal.adoptPluginEntity(${JSON.stringify(pluginRoot)}))()`
    )
    expect(adopted).toMatchObject({ success: true, adopted: true })

    const launchSource = `(async () =>
      await window.ztools.internal.launch({
        path: ${JSON.stringify(pluginRoot)},
        type: 'plugin',
        featureCode: 'e2e-external-link',
        name: 'E2E外链插件',
        cmdType: 'text',
        param: { code: 'e2e-external-link' }
      }))()`
    await executeInSettings(electronApp, launchSource)
    await expect
      .poll(() => getPluginViewCount(electronApp!), { timeout: 15_000 })
      .toBeGreaterThan(0)

    // 插件页发起跨源导航，宿主拦截后 Chromium 会产生 ERR_ABORTED。
    await electronApp.evaluate(async ({ webContents }, urlPrefix) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL().startsWith(urlPrefix))
      if (!contents) throw new Error('未找到外链测试插件页面')
      await contents.executeJavaScript('document.querySelector("#external-link").click(); true')
    }, pluginServer.baseUrl)
    await page.waitForTimeout(300)

    await electronApp.evaluate(async ({ webContents }, urlPrefix) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL().startsWith(urlPrefix))
      if (!contents) throw new Error('未找到外链测试插件页面')
      await contents.executeJavaScript('window.ztools.outPlugin()')
    }, pluginServer.baseUrl)
    await expect.poll(() => getPluginViewCount(electronApp!)).toBe(0)

    await executeInSettings(electronApp, launchSource)
    await expect
      .poll(() => getPluginViewCount(electronApp!), { timeout: 15_000 })
      .toBeGreaterThan(0)
  } finally {
    await electronApp?.close()
    await new Promise<void>((resolve) => pluginServer.server.close(() => resolve()))
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
