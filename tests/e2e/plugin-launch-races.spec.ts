import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import fs from 'node:fs/promises'
import http, { type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

interface RacePlugin {
  name: string
  path: string
  url: string
  eventFile: string
  isDevelopment: true
}

interface RaceRecord {
  event: string
  instance: string
  value?: { payload?: string; [key: string]: unknown }
}

interface PageGate {
  blocked: boolean
  responses: ServerResponse[]
}

interface RaceHost {
  app: ElectronApplication
  page: Page
  addPlugin: (name: string, blocked?: boolean, lateEnter?: boolean) => Promise<RacePlugin>
  releasePage: (plugin: RacePlugin) => Promise<void>
  waitForPageGate: (plugin: RacePlugin) => Promise<void>
  close: () => Promise<void>
}

/**
 * 创建拥有可控 DOM 阻塞点的源码 Electron 宿主及隔离插件目录。
 * @returns 本次宿主、页面和夹具控制方法。
 * @throws 临时目录、HTTP 服务或 Electron 启动失败时抛出错误。
 */
async function createRaceHost(): Promise<RaceHost> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-launch-races-'))
  const gates = new Map<string, PageGate>()
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    const gate = gates.get(pathname.replace(/\/gate\.js$/, '/index.html'))
    if (!gate) {
      response.writeHead(404).end()
      return
    }
    if (pathname.endsWith('/gate.js')) {
      response.setHeader('Content-Type', 'text/javascript')
      if (gate.blocked) gate.responses.push(response)
      else response.end('')
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    // 同步脚本阻止 DOMContentLoaded，测试释放响应才允许宿主继续启动。
    response.end(
      '<!doctype html><html><head><script src="gate.js"></script></head>' +
        '<body><main>Launch race fixture ready</main></body></html>'
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as import('node:net').AddressInfo
  const origin = `http://127.0.0.1:${address.port}`
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
    // 所有真实宿主读写均限制在临时数据和旧数据目录内。
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

    /**
     * 安装记录公开回调的页面插件，并允许延迟 DOM 或进入回调注册。
     * @param name 本次测试内唯一插件名称。
     * @param blocked 是否在同步脚本处阻塞 DOM 就绪。
     * @param lateEnter 是否由测试稍后注册进入回调。
     * @returns 插件地址和事件文件。
     * @throws 夹具写入或隔离注册表更新失败时抛出错误。
     */
    async function addPlugin(
      name: string,
      blocked = false,
      lateEnter = false
    ): Promise<RacePlugin> {
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
        features: [
          { code: 'record', cmds: [name], mainPush: true },
          { code: 'other', cmds: [`${name}-other`] }
        ]
      }
      gates.set(`/${name}/index.html`, { blocked, responses: [] })
      await fs.mkdir(pluginRoot)
      await fs.writeFile(eventFile, '')
      await fs.writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify(manifest))
      await fs.writeFile(
        path.join(pluginRoot, 'preload.js'),
        `const fs = require('node:fs')
const { ipcRenderer } = require('electron')
const instance = require('node:crypto').randomUUID()
let holdNextMode = false
let pendingMode = null
/**
 * 持久化回调和就绪边界，避免用固定等待时间猜测异步顺序。
 * @param event 观察到的事件。
 * @param value 回调数据。
 * @returns 无返回值。
 * @throws 临时文件写入失败时抛出错误。
 */
function record(event, value) {
  fs.appendFileSync(${JSON.stringify(eventFile)}, JSON.stringify({ event, instance, value }) + '\\n')
}
/**
 * 在测试指定时机通过公开 API 注册进入回调。
 * @param legacy 是否使用旧版 onPluginReady 兼容入口。
 * @returns 无返回值。
 */
function registerEnter(legacy = false) {
  ztools[legacy ? 'onPluginReady' : 'onPluginEnter'](action => record('enter', action))
}
window.__raceFixture = {
  registerEnter,
  /**
   * 暂存下一条模式回复，使旧恢复请求停在真实 IPC 等待边界。
   * @returns 无返回值。
   */
  armModeGate() { holdNextMode = true },
  /**
   * 释放暂存回复，让旧请求在新请求提交后继续执行。
   * @returns 无返回值。
   */
  releaseModeGate() {
    if (pendingMode) {
      pendingMode()
      pendingMode = null
      record('mode-released')
    }
  }
}
ipcRenderer.on('on-plugin-enter', (_event, action) => record('enter-received', action))
if (!${lateEnter}) registerEnter()
window.addEventListener('DOMContentLoaded', () => {
  // mainPush 到 DOM 就绪才注册，过早查询会丢失请求并暴露加载等待回归。
  ztools.onMainPush(action => {
    record('query', action)
    return [{ text: action.payload }]
  })
  const modeListeners = ipcRenderer.listeners('get-plugin-mode')
  ipcRenderer.removeAllListeners('get-plugin-mode')
  ipcRenderer.on('get-plugin-mode', (event, request) => {
    const reply = () => modeListeners.forEach(listener => listener(event, request))
    if (holdNextMode) {
      holdNextMode = false
      pendingMode = reply
      record('mode-blocked', request)
    } else reply()
  })
  record('dom-ready')
})
`
      )
      const plugin = { ...manifest, path: pluginRoot, isDevelopment: true as const }
      await page.evaluate(async (plugin) => {
        const current = (await window.ztools.dbGet('plugins')) || []
        await window.ztools.dbPut('plugins', [...current, plugin])
      }, plugin)
      return { ...plugin, url, eventFile }
    }

    /**
     * 等待页面确实阻塞，再放行同步脚本响应。
     * @param plugin 目标插件。
     * @returns 放行完成后的 Promise。
     */
    async function releasePage(plugin: RacePlugin): Promise<void> {
      const gate = gates.get(new URL(plugin.url).pathname)!
      await expect.poll(() => gate.responses.length).toBeGreaterThan(0)
      gate.blocked = false
      for (const response of gate.responses.splice(0)) response.end('')
    }

    /**
     * 确认页面加载已到达可控阻塞点。
     * @param plugin 目标插件。
     * @returns 请求到达后结束的 Promise。
     */
    async function waitForPageGate(plugin: RacePlugin): Promise<void> {
      await expect
        .poll(() => gates.get(new URL(plugin.url).pathname)!.responses.length)
        .toBeGreaterThan(0)
    }

    return { app, page, addPlugin, releasePage, waitForPageGate, close }
  } catch (error) {
    await close()
    throw error
  }
}

/**
 * 读取指定种类的插件运行记录。
 * @param plugin 目标插件。
 * @param event 事件名称。
 * @returns 按发生顺序排列的记录。
 * @throws 文件读取或 JSON 解析失败时抛出错误。
 */
async function records(plugin: RacePlugin, event: string): Promise<RaceRecord[]> {
  const text = (await fs.readFile(plugin.eventFile, 'utf8')).trim()
  return text
    ? text
        .split('\n')
        .map((line) => JSON.parse(line) as RaceRecord)
        .filter((record) => record.event === event)
    : []
}

/**
 * 使用真实宿主启动入口发送独立输入，允许测试并发持有启动 Promise。
 * @param page 宿主页面。
 * @param plugin 目标插件。
 * @param payload 本次独立输入。
 * @param featureCode 本次功能代码。
 * @param withOption 是否携带新输入选项，关闭时允许同文本功能走跳过重入分支。
 * @returns 宿主接收启动请求后结束的 Promise。
 */
async function launch(
  page: Page,
  plugin: RacePlugin,
  payload: string,
  featureCode = 'record',
  withOption = true
): Promise<void> {
  const result = await page.evaluate(
    ({ pluginPath, payload, featureCode, withOption }) =>
      window.ztools.launch({
        path: pluginPath,
        type: 'plugin',
        featureCode,
        param: { type: 'text', payload, ...(withOption ? { option: { label: payload } } : {}) }
      }),
    { pluginPath: plugin.path, payload, featureCode, withOption }
  )
  expect(result).toMatchObject({ success: true })
}

/**
 * 在真实插件视图中操作测试夹具，宿主页面不承担插件脚本执行。
 * @param app 当前 Electron 实例。
 * @param plugin 目标插件。
 * @param script 待执行脚本。
 * @returns 脚本执行完成后的 Promise。
 * @throws 插件实例不存在或脚本执行失败时抛出错误。
 */
async function executeFixture(
  app: ElectronApplication,
  plugin: RacePlugin,
  script: string
): Promise<void> {
  await app.evaluate(
    async ({ webContents }, { url, script }) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)
      if (!contents) throw new Error(`缺少插件视图：${url}`)
      await contents.executeJavaScript(script)
    },
    { url: plugin.url, script }
  )
}

/**
 * 读取实际挂载到窗口的插件 URL，验证旧请求未卸载新请求复用的视图。
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
 * 读取宿主实际窗口高度，校验加载占位与插件正文的尺寸切换。
 * @param host 当前隔离宿主及其主界面页面。
 * @returns 主窗口内容区高度。
 */
async function mainWindowHeight(host: RaceHost): Promise<number> {
  // Playwright 按页面取得对应的原生窗口，避免同名的 macOS 临时窗口干扰尺寸检查。
  const mainWindow = await host.app.browserWindow(host.page)
  try {
    return await mainWindow.evaluate((window) => window.getContentBounds().height)
  } finally {
    await mainWindow.dispose()
  }
}

/**
 * 展示真实搜索结果并等待窗口按搜索正文完成布局。
 * @param host 当前隔离 Electron 宿主。
 * @returns 展开的搜索窗口高度。
 */
async function expandSearchResults(host: RaceHost): Promise<number> {
  // 等待实际结果提交，避免初始化或目录刷新覆盖手动设置的假定尺寸。
  await host.page.locator('.search-input').fill('通用设置')
  await expect(
    host.page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first()
  ).toBeVisible()
  const height = await host.page
    .locator('.app-container')
    .evaluate((element) => element.scrollHeight + 1)
  await expect.poll(() => mainWindowHeight(host)).toBe(height)
  return height
}

/**
 * 释放仍未超时的模式回复，并等待主进程处理完该回复后的事件循环。
 * @param app 当前 Electron 实例。
 * @param plugin 目标插件。
 * @returns 旧请求已继续执行后的 Promise。
 * @throws 模式请求提前超时或视图不存在时抛出错误。
 */
async function releaseHeldMode(app: ElectronApplication, plugin: RacePlugin): Promise<void> {
  const blocked = await records(plugin, 'mode-blocked')
  const channel = `plugin-mode-result-${blocked.at(-1)?.value?.callId}`
  await app.evaluate(
    async ({ webContents }, { url, channel }) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)
      if (!contents || contents.ipc.listenerCount(channel) === 0) {
        throw new Error('旧模式请求已超时，无法验证释放后的竞态')
      }
      // 回复先恢复真实启动流程，再用下一事件循环观察其提交或取消结果。
      await new Promise<void>((resolve, reject) => {
        contents.ipc.once(channel, () => setImmediate(resolve))
        void contents.executeJavaScript('window.__raceFixture.releaseModeGate()').catch(reject)
      })
    },
    { url: plugin.url, channel }
  )
}

test('慢加载切换和加载中退出不会恢复旧插件', async () => {
  const host = await createRaceHost()
  try {
    const slow = await host.addPlugin('slow-a', true)
    const other = await host.addPlugin('fast-b')
    const cancelled = await host.addPlugin('cancelled-c', true)
    const loadingHeight =
      (await host.page
        .locator('.search-box')
        .evaluate((element) => element.getBoundingClientRect().height)) + 1

    // 搜索结果撑开的窗口，冷启动等待期间应立即收回顶部栏。
    expect(await expandSearchResults(host)).toBeGreaterThan(loadingHeight)

    // A 尚未 DOM 就绪时先进入 B；放行 A 后仍必须保留 B 的视图与参数。
    await launch(host.page, slow, 'obsolete')
    await host.waitForPageGate(slow)
    await expect.poll(() => mainWindowHeight(host)).toBe(loadingHeight)
    await launch(host.page, other, 'current')
    await expect.poll(() => records(other, 'enter')).toHaveLength(1)
    await expect.poll(() => mainWindowHeight(host)).toBeGreaterThan(loadingHeight)
    const displayedHeight = await mainWindowHeight(host)

    // 已有缓存但尚未 DOM 就绪的 A 仍需加载占位，不能把“创建过”当成可直接恢复。
    await launch(host.page, slow, 'still-loading')
    expect(await mainWindowHeight(host)).toBe(loadingHeight)
    await launch(host.page, other, 'current-again')
    await expect.poll(() => records(other, 'enter')).toHaveLength(2)
    await host.releasePage(slow)
    await expect.poll(() => records(slow, 'dom-ready')).toHaveLength(1)
    expect(await records(slow, 'enter')).toHaveLength(0)
    expect(await attachedUrls(host.app)).toEqual([other.url])
    expect(await mainWindowHeight(host)).toBe(displayedHeight)

    // 加载中的返回搜索必须取消启动，即使视图还没有正式进入。
    await launch(host.page, cancelled, 'cancelled')
    await host.waitForPageGate(cancelled)
    await expect.poll(() => mainWindowHeight(host)).toBe(loadingHeight)
    await host.page.evaluate(() => window.ztools.hidePlugin())
    await expect.poll(() => attachedUrls(host.app)).toEqual([])
    await host.releasePage(cancelled)
    await expect.poll(() => records(cancelled, 'dom-ready')).toHaveLength(1)
    expect(await records(cancelled, 'enter')).toHaveLength(0)
    expect(await attachedUrls(host.app)).toEqual([])
  } finally {
    await host.close()
  }
})

test('返回搜索后缓存重入不收起，A→B→A 旧请求不会覆盖新视图', async () => {
  const host = await createRaceHost()
  try {
    const first = await host.addPlugin('cached-a')
    const second = await host.addPlugin('cached-b')
    await launch(host.page, first, 'seed-a')
    await expect.poll(() => records(first, 'enter')).toHaveLength(1)
    // 使用插件自行设置的高度，验证加载占位不会抹掉缓存中的正文尺寸。
    await executeFixture(host.app, first, 'ztools.setExpendHeight(260)')
    const restoredHeight = await mainWindowHeight(host)
    await launch(host.page, second, 'seed-b')
    await expect.poll(() => records(second, 'enter')).toHaveLength(1)

    // 从真实返回入口回到搜索，再进入已经运行过的缓存插件。
    await host.page.locator('.plugin-tag-close').click()
    await expect(host.page.locator('.plugin-tag')).toHaveCount(0)
    const searchHeight = await expandSearchResults(host)

    // 旧恢复停在模式查询；同一 WebContents 被更新请求复用后才释放旧回复。
    await executeFixture(host.app, first, 'window.__raceFixture.armModeGate()')
    await launch(host.page, first, 'obsolete-a')
    await expect.poll(() => records(first, 'mode-blocked')).toHaveLength(1)
    // 即便模式回复尚未到达，也不应额外缩到搜索框高度。
    expect(await mainWindowHeight(host)).toBe(searchHeight)
    await launch(host.page, second, 'middle-b')
    await launch(host.page, first, 'latest-a')
    await expect.poll(() => records(first, 'enter')).toHaveLength(2)
    await releaseHeldMode(host.app, first)

    const entered = await records(first, 'enter')
    expect(entered.map(({ value }) => value?.payload)).toEqual(['seed-a', 'latest-a'])
    expect(new Set(entered.map(({ instance }) => instance)).size).toBe(1)
    expect(await attachedUrls(host.app)).toEqual([first.url])
    expect(await mainWindowHeight(host)).toBe(restoredHeight)

    // F1 已显示时等待 F2，再次选择 F1 即使跳过 Enter 也必须取消旧 F2 请求。
    await executeFixture(host.app, first, "ztools.setSubInput(console.log, '搜索记录...', true)")
    await executeFixture(host.app, first, "ztools.setSubInputValue('cached search')")
    await expect(host.page.locator('.search-input')).toHaveValue('cached search')
    await executeFixture(host.app, first, 'window.__raceFixture.armModeGate()')
    await launch(host.page, first, 'obsolete-feature', 'other', false)
    await expect.poll(() => records(first, 'mode-blocked')).toHaveLength(2)
    await expect(host.page.locator('.search-input')).toHaveValue('')
    expect(await mainWindowHeight(host)).toBe(restoredHeight)
    await launch(host.page, first, 'same-feature', 'record', false)
    await releaseHeldMode(host.app, first)
    // 被取消功能曾清空顶部栏，但当前功能的搜索词仍应从插件缓存恢复。
    await expect(host.page.locator('.search-input')).toHaveValue('cached search')
    expect(await records(first, 'enter')).toEqual(entered)
    expect(await attachedUrls(host.app)).toEqual([first.url])
    expect(await mainWindowHeight(host)).toBe(restoredHeight)
  } finally {
    await host.close()
  }
})

test('后台 mainPush 等待 DOM，晚注册 Enter 和旧 Ready 入口回放进入参数', async () => {
  const host = await createRaceHost()
  try {
    const deferred = await host.addPlugin('deferred-enter', true, true)
    const legacy = await host.addPlugin('deferred-ready', false, true)
    // 后台查询不进入插件占位，已完成布局的搜索窗口应保持原尺寸。
    const searchHeight = await expandSearchResults(host)

    // 主界面不打开插件，查询自行后台预加载并等待 DOM 中注册的回调。
    const query = host.page.evaluate(
      (pluginPath) =>
        window.ztools.queryMainPush(pluginPath, 'record', {
          code: 'record',
          type: 'text',
          payload: 'background-query'
        }),
      deferred.path
    )
    await host.waitForPageGate(deferred)
    expect(await mainWindowHeight(host)).toBe(searchHeight)
    expect(await records(deferred, 'query')).toHaveLength(0)
    await host.releasePage(deferred)
    expect(await query).toEqual([{ text: 'background-query' }])
    expect(await attachedUrls(host.app)).toEqual([])
    expect(await mainWindowHeight(host)).toBe(searchHeight)

    // 原始 Enter 已到达但插件尚未注册，公开入口注册后必须只回放最新参数。
    await launch(host.page, deferred, 'late-enter')
    await expect.poll(() => records(deferred, 'enter-received')).toHaveLength(1)
    expect(await records(deferred, 'enter')).toHaveLength(0)
    await executeFixture(host.app, deferred, 'window.__raceFixture.registerEnter()')
    await expect.poll(() => records(deferred, 'enter')).toHaveLength(1)
    expect((await records(deferred, 'enter'))[0].value?.payload).toBe('late-enter')

    // 兼容入口接收相同 Enter 协议，不依赖已删除的内部 Ready 消息。
    await launch(host.page, legacy, 'late-ready')
    await expect.poll(() => records(legacy, 'enter-received')).toHaveLength(1)
    expect(await records(legacy, 'enter')).toHaveLength(0)
    await executeFixture(host.app, legacy, 'window.__raceFixture.registerEnter(true)')
    await expect.poll(() => records(legacy, 'enter')).toHaveLength(1)
    expect((await records(legacy, 'enter'))[0].value?.payload).toBe('late-ready')
  } finally {
    await host.close()
  }
})
