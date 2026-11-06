import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const SETTINGS_URL_FRAGMENTS = ['http://127.0.0.1:15177', 'internal-plugins/setting/index.html']
const SLOW_PAGE_DELAY_MS = 7_000

interface PluginFixtureOptions {
  root: string
  name: string
  title: string
  main: string
  featureCode: string
  command: string
}

interface TestServer {
  server: http.Server
  baseUrl: string
}

/**
 * 启动监听随机本地端口的测试服务。
 * @param handler HTTP 请求处理器
 * @returns 已启动的服务器及访问地址
 * @throws 服务器监听失败或无法读取端口时抛错
 */
async function startTestServer(handler: http.RequestListener): Promise<TestServer> {
  const server = http.createServer(handler)
  // 绑定随机端口，避免并行 E2E 发生地址冲突。
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  // 监听成功后读取实际端口；异常地址会导致测试无法继续。
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法获取测试服务端口')
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

/**
 * 启动延迟返回正文的测试服务。
 * @returns 测试服务器及请求计数
 * @throws 服务器监听失败时抛错
 */
async function startSlowPluginServer(): Promise<TestServer & { requestCount: () => number }> {
  let requests = 0
  const result = await startTestServer((_request, response) => {
    requests += 1
    // 首次加载必须超过插件就绪判断的 5 秒上限，以覆盖超时后的重新打开。
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html><body><main>SLOW PLUGIN READY</main></body></html>')
    }, SLOW_PAGE_DELAY_MS)
  })
  return { ...result, requestCount: () => requests }
}

/**
 * 启动返回可点击外部链接的插件页面服务。
 * @returns 测试服务器
 * @throws 服务器监听失败时抛错
 */
async function startExternalLinkPluginServer(): Promise<TestServer> {
  return await startTestServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html>
<html>
  <body data-e2e="external-link-plugin">
    <main>EXTERNAL LINK PLUGIN READY</main>
    <a id="external-link" href="https://github.com/ZToolsCenter/ZTools">Open external link</a>
  </body>
</html>`)
  })
}

/**
 * 启动首次连接失败、后续请求成功的插件页面服务。
 * @returns 测试服务器及请求计数
 * @throws 服务器监听失败时抛错
 */
async function startRecoverablePluginServer(): Promise<
  TestServer & { requestCount: () => number }
> {
  let requests = 0
  const result = await startTestServer((request, response) => {
    requests += 1
    // 首次请求主动断开，触发插件视图的真实加载失败。
    if (requests === 1) {
      request.socket.destroy()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html><body><main>RECOVERABLE PLUGIN READY</main></body></html>')
  })
  return { ...result, requestCount: () => requests }
}

/**
 * 创建隔离的测试插件目录和清单。
 * @param options 插件名称、入口及指令配置
 * @returns 插件目录绝对路径
 */
async function createPluginFixture(options: PluginFixtureOptions): Promise<string> {
  // 每个用例使用独立目录，禁止触碰真实插件数据。
  await fs.mkdir(options.root, { recursive: true })
  await fs.writeFile(
    path.join(options.root, 'plugin.json'),
    JSON.stringify({
      name: options.name,
      title: options.title,
      version: '1.0.0',
      main: options.main,
      features: [
        {
          code: options.featureCode,
          explain: options.title,
          cmds: [options.command]
        }
      ]
    }),
    'utf-8'
  )
  return options.root
}

/**
 * 使用隔离数据目录启动源码 Electron 测试实例。
 * @param dataRoot 测试实例专用数据目录
 * @param legacyRoot 测试实例专用旧数据目录
 * @returns 已启动的 Electron 应用实例
 */
async function launchTestApp(dataRoot: string, legacyRoot: string): Promise<ElectronApplication> {
  return await electron.launch({
    args: [PROJECT_ROOT],
    cwd: PROJECT_ROOT,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      ZTOOLS_DATA_ROOT: dataRoot,
      ZTOOLS_E2E: '1',
      ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
    }
  })
}

/**
 * 在设置插件 WebContentsView 中执行页面脚本。
 * @param electronApp 隔离 Electron 应用实例
 * @param source 要执行的 JavaScript 源码
 * @returns 页面脚本结果
 * @throws 设置插件视图不存在或脚本执行失败时抛错
 */
async function executeInSettings(
  electronApp: ElectronApplication,
  source: string
): Promise<unknown> {
  return electronApp.evaluate(
    async ({ webContents }, { script, urlFragments }) => {
      // 通过开发服务器 URL 定位缓存中的设置插件，避免依赖窗口焦点。
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => urlFragments.some((fragment) => candidate.getURL().includes(fragment)))
      if (!contents) throw new Error('未找到设置插件 WebContentsView')
      return await contents.executeJavaScript(script)
    },
    { script: source, urlFragments: SETTINGS_URL_FRAGMENTS }
  )
}

/**
 * 在指定 URL 的插件 WebContentsView 中执行页面脚本。
 * @param electronApp 隔离 Electron 应用实例
 * @param urlPrefix 插件页面 URL 前缀
 * @param source 要执行的 JavaScript 源码
 * @returns 页面脚本结果
 * @throws 插件视图不存在或脚本执行失败时抛错
 */
async function executeInPluginPage(
  electronApp: ElectronApplication,
  urlPrefix: string,
  source: string
): Promise<unknown> {
  return electronApp.evaluate(
    async ({ webContents }, { prefix, script }) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL().startsWith(prefix))
      if (!contents) throw new Error('未找到测试插件 WebContentsView')
      return await contents.executeJavaScript(script)
    },
    { prefix: urlPrefix, script: source }
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
  }, SETTINGS_URL_FRAGMENTS)
}

/**
 * 打开内置设置插件并等待正文完成渲染。
 * @param electronApp 隔离 Electron 应用实例
 * @returns 主窗口页面
 */
async function openSettings(electronApp: ElectronApplication): Promise<Page> {
  const page = await electronApp.firstWindow()
  const searchInput = page.locator('.search-input')
  await expect(searchInput).toBeVisible()

  // 通过真实搜索指令进入设置，确保插件加载链路与用户操作一致。
  await searchInput.fill('通用设置')
  await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
  await expect
    .poll(() => readSettingsText(electronApp), { timeout: 15_000 })
    .toContain('开机自动启动')
  return page
}

/**
 * 将测试插件登记到隔离的插件注册表。
 * @param electronApp 隔离 Electron 应用实例
 * @param pluginRoot 测试插件目录
 * @returns 无返回值
 */
async function adoptPlugin(electronApp: ElectronApplication, pluginRoot: string): Promise<void> {
  const adopted = await executeInSettings(
    electronApp,
    `(async () => await window.ztools.internal.adoptPluginEntity(${JSON.stringify(pluginRoot)}))()`
  )
  expect(adopted).toMatchObject({ success: true, adopted: true })
}

/**
 * 从设置插件内部启动指定测试插件。
 * @param electronApp 隔离 Electron 应用实例
 * @param options 插件路径、功能代码和显示名称
 * @returns 无返回值
 */
async function launchPlugin(
  electronApp: ElectronApplication,
  options: Pick<PluginFixtureOptions, 'root' | 'featureCode' | 'command'>
): Promise<void> {
  // 使用内部启动 API，直接驱动主进程的插件装配与就绪判断。
  await executeInSettings(
    electronApp,
    `(async () =>
      await window.ztools.internal.launch({
        path: ${JSON.stringify(options.root)},
        type: 'plugin',
        featureCode: ${JSON.stringify(options.featureCode)},
        name: ${JSON.stringify(options.command)},
        cmdType: 'text',
        param: { code: ${JSON.stringify(options.featureCode)} }
      }))()`
  )
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

/**
 * 关闭测试 HTTP 服务并等待监听资源释放。
 * @param server 测试服务器
 * @returns 服务关闭后结束的 Promise
 */
async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

test('慢插件超时后再次打开会等待页面完成并挂载', async ({ browserName: _browserName }) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-readiness-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugins', 'e2e-slow-readiness')
  const pluginServer = await startSlowPluginServer()
  const plugin = {
    root: pluginRoot,
    name: 'e2e-slow-readiness',
    title: 'E2E Slow Plugin',
    main: `${pluginServer.baseUrl}/`,
    featureCode: 'e2e-slow-readiness',
    command: 'E2E慢插件'
  }
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await createPluginFixture(plugin)

  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    await openSettings(electronApp)
    await adoptPlugin(electronApp, pluginRoot)

    // 第一次打开在 5 秒后超时，第二次打开发生在慢页面返回之前。
    await launchPlugin(electronApp, plugin)
    await new Promise((resolve) => setTimeout(resolve, 5_500))
    await launchPlugin(electronApp, plugin)

    await expect
      .poll(() => getPluginViewCount(electronApp!), { timeout: 15_000 })
      .toBeGreaterThan(0)
    expect(pluginServer.requestCount()).toBe(1)
  } finally {
    await electronApp?.close()
    await closeServer(pluginServer.server)
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('外部链接导航被拦截后再次打开插件仍可显示', async ({ browserName: _browserName }) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-external-link-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugins', 'e2e-external-link')
  const pluginServer = await startExternalLinkPluginServer()
  const plugin = {
    root: pluginRoot,
    name: 'e2e-external-link',
    title: 'E2E External Link',
    main: `${pluginServer.baseUrl}/`,
    featureCode: 'e2e-external-link',
    command: 'E2E外链插件'
  }
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await createPluginFixture(plugin)

  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    await electronApp.evaluate(({ shell }) => {
      // 避免测试时真的唤起系统浏览器。
      shell.openExternal = async () => undefined
      return true
    })

    await openSettings(electronApp)
    await adoptPlugin(electronApp, pluginRoot)
    await launchPlugin(electronApp, plugin)
    await expect
      .poll(() => getPluginViewCount(electronApp!), { timeout: 15_000 })
      .toBeGreaterThan(0)

    // 插件页发起跨源导航，宿主应拦截并恢复原文档的可用状态。
    await executeInPluginPage(
      electronApp,
      pluginServer.baseUrl,
      'document.querySelector("#external-link").click(); true'
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    await executeInPluginPage(electronApp, pluginServer.baseUrl, 'window.ztools.outPlugin()')
    await expect.poll(() => getPluginViewCount(electronApp!)).toBe(0)

    await launchPlugin(electronApp, plugin)
    await expect
      .poll(() => getPluginViewCount(electronApp!), { timeout: 15_000 })
      .toBeGreaterThan(0)
  } finally {
    await electronApp?.close()
    await closeServer(pluginServer.server)
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('真实加载失败后再次打开会重新加载插件并显示', async ({ browserName: _browserName }) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-reload-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugins', 'e2e-recoverable')
  const pluginServer = await startRecoverablePluginServer()
  const plugin = {
    root: pluginRoot,
    name: 'e2e-recoverable',
    title: 'E2E Recoverable Plugin',
    main: `${pluginServer.baseUrl}/`,
    featureCode: 'e2e-recoverable',
    command: 'E2E恢复插件'
  }
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await createPluginFixture(plugin)

  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    await openSettings(electronApp)
    await adoptPlugin(electronApp, pluginRoot)

    // 第一次请求主动断开，验证失败后的缓存插件可以重新加载。
    await launchPlugin(electronApp, plugin)
    await expect.poll(() => pluginServer.requestCount()).toBeGreaterThan(0)
    await expect.poll(() => getPluginViewCount(electronApp!)).toBe(0)

    await launchPlugin(electronApp, plugin)
    await expect
      .poll(() => getPluginViewCount(electronApp!), { timeout: 15_000 })
      .toBeGreaterThan(0)
    expect(pluginServer.requestCount()).toBe(2)
  } finally {
    await electronApp?.close()
    await closeServer(pluginServer.server)
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
