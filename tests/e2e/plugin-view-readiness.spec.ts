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

const projectRoot = path.resolve(__dirname, '../..')

interface ReadinessPlugin {
  name: string
  path: string
  url: string
  eventFile: string
}

interface ReadinessHost {
  app: ElectronApplication
  page: Page
  /** 跨源链接指向的另一个源，用于触发宿主的外链拦截。 */
  externalUrl: string
  addPlugin: (name: string, failFirstLoads?: number) => Promise<ReadinessPlugin>
  pageRequests: (plugin: ReadinessPlugin) => number
  openedExternal: () => Promise<string[]>
  close: () => Promise<void>
}

/**
 * 创建隔离数据目录的源码 Electron 宿主，插件页面由本地 HTTP 服务提供。
 * @returns 本次宿主、页面和夹具控制方法。
 * @throws 临时目录、HTTP 服务或 Electron 启动失败时抛出错误。
 */
async function createReadinessHost(): Promise<ReadinessHost> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-view-readiness-'))
  // 每个页面剩余需要失败的请求次数，以及已收到的请求次数。
  const failures = new Map<string, number>()
  const requests = new Map<string, number>()
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    if (!failures.has(pathname)) {
      response.writeHead(404).end()
      return
    }
    requests.set(pathname, (requests.get(pathname) ?? 0) + 1)
    const remaining = failures.get(pathname)!
    if (remaining > 0) {
      failures.set(pathname, remaining - 1)
      // 直接断开连接，使主框架加载以 ERR_EMPTY_RESPONSE 失败。
      request.socket.destroy()
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(
      '<!doctype html><html><body>' +
        `<a id="external" href="${externalUrl}">外部链接</a>` +
        '<main>Readiness fixture ready</main></body></html>'
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as import('node:net').AddressInfo
  const origin = `http://127.0.0.1:${address.port}`
  // localhost 与 127.0.0.1 是不同的源，链接会被宿主视为跨源跳转。
  const externalUrl = `http://localhost:${address.port}/external`
  let app: ElectronApplication | undefined

  /**
   * 关闭本次实例和 HTTP 连接，再删除隔离目录。
   * @returns 清理完成后结束的 Promise。
   */
  async function close(): Promise<void> {
    await app?.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(dataRoot, { recursive: true, force: true })
  }

  try {
    const legacyRoot = path.join(dataRoot, 'legacy')
    await fs.mkdir(legacyRoot)
    app = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] =>
            Boolean(entry[1])
          )
        ),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    const page = await app.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    // 记录外链而不真的打开系统浏览器。
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { __openedExternal?: string[] }).__openedExternal = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })

    /**
     * 安装记录进入回调的页面插件。
     * @param name 本次测试内唯一插件名称。
     * @param failFirstLoads 页面前几次请求直接断开，模拟首次加载失败。
     * @returns 插件地址和事件文件。
     * @throws 夹具写入或隔离注册表更新失败时抛出错误。
     */
    async function addPlugin(name: string, failFirstLoads = 0): Promise<ReadinessPlugin> {
      const pluginRoot = path.join(dataRoot, name)
      const eventFile = path.join(dataRoot, `${name}.jsonl`)
      const url = `${origin}/${name}/index.html`
      const manifest = {
        name,
        title: name,
        version: '1.0.0',
        main: 'index.html',
        preload: 'preload.js',
        development: { main: url },
        features: [{ code: 'record', cmds: [name] }]
      }
      failures.set(`/${name}/index.html`, failFirstLoads)
      await fs.mkdir(pluginRoot)
      await fs.writeFile(eventFile, '')
      await fs.writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify(manifest))
      await fs.writeFile(
        path.join(pluginRoot, 'preload.js'),
        `const fs = require('node:fs')
ztools.onPluginEnter(action => {
  fs.appendFileSync(${JSON.stringify(eventFile)}, JSON.stringify(action) + '\\n')
})
`
      )
      const plugin = { ...manifest, path: pluginRoot, isDevelopment: true as const }
      await page.evaluate(async (plugin) => {
        const current = (await window.ztools.dbGet('plugins')) || []
        await window.ztools.dbPut('plugins', [...current, plugin])
      }, plugin)
      return { name, path: pluginRoot, url, eventFile }
    }

    return {
      app,
      page,
      externalUrl,
      addPlugin,
      pageRequests: (plugin) => requests.get(new URL(plugin.url).pathname) ?? 0,
      openedExternal: () =>
        app!.evaluate(() => (globalThis as { __openedExternal?: string[] }).__openedExternal ?? []),
      close
    }
  } catch (error) {
    await close()
    throw error
  }
}

/**
 * 读取插件收到的进入参数。
 * @param plugin 目标插件。
 * @returns 按发生顺序排列的进入载荷。
 */
async function enters(plugin: ReadinessPlugin): Promise<string[]> {
  const text = (await fs.readFile(plugin.eventFile, 'utf8')).trim()
  return text ? text.split('\n').map((line) => JSON.parse(line).payload) : []
}

/**
 * 使用真实宿主启动入口打开插件。
 * @param page 宿主页面。
 * @param plugin 目标插件。
 * @param payload 本次独立输入。
 * @returns 宿主接收启动请求后结束的 Promise。
 */
async function launch(page: Page, plugin: ReadinessPlugin, payload: string): Promise<void> {
  const result = await page.evaluate(
    ({ pluginPath, payload }) =>
      window.ztools.launch({
        path: pluginPath,
        type: 'plugin',
        featureCode: 'record',
        param: { type: 'text', payload, option: { label: payload } }
      }),
    { pluginPath: plugin.path, payload }
  )
  expect(result).toMatchObject({ success: true })
}

/**
 * 读取实际挂载到窗口的插件 URL。
 * @param app 当前 Electron 实例。
 * @returns 所有窗口已挂载的 WebContentsView 地址。
 */
async function attachedUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().flatMap((window) =>
      window.contentView.children.flatMap((child) =>
        'webContents' in child ? [(child as Electron.WebContentsView).webContents.getURL()] : []
      )
    )
  )
}

/**
 * 读取插件视图是否仍在加载，用于确认失败的加载已经停止。
 * @param app 当前 Electron 实例。
 * @param plugin 目标插件。
 * @returns 视图存在时的加载状态，不存在时为 null。
 */
async function pluginLoading(
  app: ElectronApplication,
  plugin: ReadinessPlugin
): Promise<boolean | null> {
  return app.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)
    return contents ? contents.isLoading() : null
  }, plugin.url)
}

test('插件内跨源链接被拦截后，缓存插件仍可再次打开', async () => {
  const host = await createReadinessHost()
  try {
    const plugin = await host.addPlugin('external-link')
    await launch(host.page, plugin, 'first')
    await expect.poll(() => enters(plugin)).toEqual(['first'])

    // 主框架导航开始后被 will-navigate 取消，原文档仍然可用。
    await host.app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)
      if (!contents) throw new Error(`缺少插件视图：${url}`)
      await contents.executeJavaScript('document.getElementById("external").click()')
    }, plugin.url)
    await expect.poll(() => host.openedExternal()).toEqual([host.externalUrl])

    await host.page.evaluate(() => window.ztools.hidePlugin())
    await expect.poll(() => attachedUrls(host.app)).toEqual([])

    // 修复前就绪等待停在被取消的导航上，再次打开会超时并持续报「插件页面未能加载完成」。
    await launch(host.page, plugin, 'second')
    await expect.poll(() => enters(plugin)).toEqual(['first', 'second'])
    expect(await attachedUrls(host.app)).toEqual([plugin.url])
    // 原文档被复用，没有因恢复而重新请求页面。
    expect(host.pageRequests(plugin)).toBe(1)
  } finally {
    await host.close()
  }
})

test('首次加载失败的缓存插件在再次打开时重新加载', async () => {
  const host = await createReadinessHost()
  try {
    const plugin = await host.addPlugin('failed-first-load', 1)
    await launch(host.page, plugin, 'failed')
    await expect.poll(() => host.pageRequests(plugin)).toBe(1)
    await expect.poll(() => pluginLoading(host.app, plugin)).toBe(false)
    await expect.poll(() => attachedUrls(host.app)).toEqual([])
    expect(await enters(plugin)).toEqual([])

    // 失败的缓存实例不会再收到就绪事件，再次打开需重载而非复用失败结果。
    await launch(host.page, plugin, 'retry')
    await expect.poll(() => enters(plugin)).toEqual(['retry'])
    expect(host.pageRequests(plugin)).toBe(2)
    expect(await attachedUrls(host.app)).toEqual([plugin.url])
  } finally {
    await host.close()
  }
})
