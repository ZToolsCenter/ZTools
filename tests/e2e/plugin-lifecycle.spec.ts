import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

interface LifecycleRecord {
  plugin: string
  instance: string
  event: 'enter' | 'out' | 'detach' | 'select'
  value: unknown
}

/**
 * 创建通过公开生命周期回调记录事件的本地页面插件。
 * @param pluginRoot 临时插件目录。
 * @param name 插件唯一名称。
 * @param eventFile 当前插件专用事件文件。
 * @returns 可写入隔离宿主注册表的插件信息。
 */
async function createLifecyclePlugin(
  pluginRoot: string,
  name: string,
  eventFile: string
): Promise<{ name: string; path: string }> {
  // 夹具只读写本次临时目录，回调落盘便于验证销毁前的最后一次通知。
  const plugin = {
    name,
    title: name,
    version: '1.0.0',
    main: 'index.html',
    preload: 'preload.js',
    features: [{ code: 'record', cmds: [name] }]
  }
  await fs.mkdir(pluginRoot, { recursive: true })
  await fs.writeFile(eventFile, '')
  await fs.writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify(plugin))
  await fs.writeFile(
    path.join(pluginRoot, 'index.html'),
    '<!doctype html><html><body><main>Lifecycle fixture ready</main></body></html>'
  )
  await fs.writeFile(
    path.join(pluginRoot, 'preload.js'),
    `const fs = require('node:fs')
const instance = require('node:crypto').randomUUID()
/**
 * 持久化插件实际收到的回调，实例标识用于区分缓存复用与重新加载。
 * @param event 生命周期事件名称。
 * @param value 生命周期回调参数。
 * @returns 无返回值。
 * @throws 临时事件文件不可写时抛出文件系统错误。
 */
function recordLifecycle(event, value = null) {
  fs.appendFileSync(${JSON.stringify(eventFile)}, JSON.stringify({
    plugin: ${JSON.stringify(name)}, instance, event, value
  }) + '\\n')
}
ztools.onPluginEnter(action => recordLifecycle('enter', action))
ztools.onPluginOut(isKill => recordLifecycle('out', isKill))
ztools.onPluginDetach(() => recordLifecycle('detach'))
`
  )
  return { ...plugin, path: pluginRoot }
}

/**
 * 读取插件公开回调产生的事件记录。
 * @param eventFile 当前插件专用事件文件。
 * @returns 按回调发生顺序排列的事件。
 * @throws 事件文件无法读取或记录格式错误时抛出错误。
 */
async function readLifecycleEvents(eventFile: string): Promise<LifecycleRecord[]> {
  const source = (await fs.readFile(eventFile, 'utf8')).trim()
  return source ? source.split('\n').map((line) => JSON.parse(line) as LifecycleRecord) : []
}

/**
 * 经由宿主实际启动入口进入插件并传入本次独立参数。
 * @param page 宿主主窗口页面。
 * @param pluginRoot 临时插件目录。
 * @param payload 本次进入的文本参数。
 * @returns 启动请求成功后结束的 Promise。
 */
async function launchLifecyclePlugin(
  page: Page,
  pluginRoot: string,
  payload: string
): Promise<void> {
  const result = await page.evaluate(
    ({ pluginRoot, payload }) =>
      window.ztools.launch({
        path: pluginRoot,
        type: 'plugin',
        featureCode: 'record',
        param: { type: 'text', payload, option: { label: payload } }
      }),
    { pluginRoot, payload }
  )
  expect(result).toMatchObject({ success: true })
}

/**
 * 从源码工程启动使用隔离数据目录的 Electron 宿主。
 * @param dataRoot 本次测试专用数据目录。
 * @returns 已启动的 Electron 测试实例。
 */
async function launchLifecycleHost(dataRoot: string): Promise<ElectronApplication> {
  // 旧数据目录也独立设置，禁止迁移真实用户数据。
  const legacyRoot = path.join(dataRoot, 'legacy')
  await fs.mkdir(legacyRoot, { recursive: true })
  return electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      ZTOOLS_DATA_ROOT: dataRoot,
      ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      ZTOOLS_E2E: '1',
      ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
    }
  })
}

test('生命周期直接通知在切换、缓存重入、分离和终止时保持顺序及参数', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-lifecycle-'))
  const pluginRoot = path.join(dataRoot, 'lifecycle-a')
  const otherRoot = path.join(dataRoot, 'lifecycle-b')
  const eventFile = path.join(dataRoot, 'lifecycle-a.jsonl')
  const otherEventFile = path.join(dataRoot, 'lifecycle-b.jsonl')
  let electronApp: ElectronApplication | undefined

  try {
    // 源码 Electron 和两个插件都使用隔离目录，不依赖服务端或真实用户数据。
    const plugin = await createLifecyclePlugin(pluginRoot, 'Lifecycle A', eventFile)
    const otherPlugin = await createLifecyclePlugin(otherRoot, 'Lifecycle B', otherEventFile)
    electronApp = await launchLifecycleHost(dataRoot)
    const page = await electronApp.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    await page.evaluate(
      async (plugins) => {
        const current = (await window.ztools.dbGet('plugins')) || []
        await window.ztools.dbPut('plugins', [...current, ...plugins])
      },
      [plugin, otherPlugin]
    )

    // 首次加载收到一次进入；切换插件后，旧实例收到普通退出并保留缓存。
    await launchLifecyclePlugin(page, pluginRoot, 'first')
    await expect.poll(() => readLifecycleEvents(eventFile)).toHaveLength(1)
    await launchLifecyclePlugin(page, otherRoot, 'other')
    await expect.poll(() => readLifecycleEvents(eventFile)).toHaveLength(2)
    await expect.poll(() => readLifecycleEvents(otherEventFile)).toHaveLength(1)
    await page.locator('.plugin-tag-close').click()
    await expect(page.locator('.plugin-tag')).toHaveCount(0)
    await expect.poll(() => readLifecycleEvents(otherEventFile)).toHaveLength(2)
    expect(
      (await readLifecycleEvents(otherEventFile)).map(({ event, value }) => ({ event, value }))
    ).toEqual([
      { event: 'enter', value: expect.objectContaining({ code: 'record', payload: 'other' }) },
      { event: 'out', value: false }
    ])

    // 缓存重入必须保持原实例，并使用本次参数而非另一插件或上次进入的参数。
    await launchLifecyclePlugin(page, pluginRoot, 'second')
    await expect.poll(() => readLifecycleEvents(eventFile)).toHaveLength(3)
    const reentered = await readLifecycleEvents(eventFile)
    expect(new Set(reentered.map(({ instance }) => instance)).size).toBe(1)
    expect(reentered.map(({ event, value }) => ({ event, value }))).toEqual([
      {
        event: 'enter',
        value: expect.objectContaining({
          code: 'record',
          type: 'text',
          payload: 'first',
          option: { label: 'first' }
        })
      },
      { event: 'out', value: false },
      {
        event: 'enter',
        value: expect.objectContaining({
          code: 'record',
          type: 'text',
          payload: 'second',
          option: { label: 'second' }
        })
      }
    ])

    // 分离继续复用同一实例；终止前的宽限时间应允许退出回调实际执行。
    expect(await page.evaluate(() => window.ztools.detachPlugin())).toMatchObject({ success: true })
    await expect.poll(() => readLifecycleEvents(eventFile)).toHaveLength(4)
    expect(
      await page.evaluate((root) => window.ztools.killPluginAndReturn(root), pluginRoot)
    ).toMatchObject({ success: true })
    await expect.poll(() => readLifecycleEvents(eventFile)).toHaveLength(5)
    await expect
      .poll(() =>
        electronApp!.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((contents) => contents.getURL().includes('/lifecycle-a/index.html'))
        )
      )
      .toBe(false)
    const completed = await readLifecycleEvents(eventFile)
    expect(completed.slice(0, 3)).toEqual(reentered)
    expect(completed.slice(3)).toEqual([
      { plugin: plugin.name, instance: reentered[0].instance, event: 'detach', value: null },
      { plugin: plugin.name, instance: reentered[0].instance, event: 'out', value: true }
    ])
  } finally {
    // 只销毁本次测试实例及其临时文件。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('无搜索框列表插件缓存恢复后保留键盘焦点并可选择第二项', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-list-focus-'))
  const pluginRoot = path.join(dataRoot, 'list-focus')
  const otherRoot = path.join(dataRoot, 'other')
  const eventFile = path.join(dataRoot, 'list.jsonl')
  const otherEventFile = path.join(dataRoot, 'other.jsonl')
  let electronApp: ElectronApplication | undefined

  try {
    const plugin = await createLifecyclePlugin(pluginRoot, 'List focus', eventFile)
    const other = await createLifecyclePlugin(otherRoot, 'Other plugin', otherEventFile)
    await fs.appendFile(
      path.join(pluginRoot, 'preload.js'),
      `window.exports = {
  record: {
    mode: 'list',
    args: {
      /**
       * 渲染无搜索框的列表并记录本次进入。
       * @param action 本次启动参数。
       * @param setList 宿主列表渲染回调。
       * @returns 无返回值。
       */
      enter(action, setList) {
        setList([{ title: 'First choice', id: 'first' }, { title: 'Second choice', id: 'second' }])
        recordLifecycle('enter', action)
      },
      /**
       * 记录由真实键盘事件选中的项目。
       * @param action 本次启动参数。
       * @param item 当前选中项。
       * @returns 无返回值。
       */
      select(action, item) {
        recordLifecycle('select', { payload: action.payload, id: item.id })
      }
    }
  }
}
`
    )
    electronApp = await launchLifecycleHost(dataRoot)
    const page = await electronApp.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    await page.evaluate(
      async (plugins) => {
        const current = (await window.ztools.dbGet('plugins')) || []
        await window.ztools.dbPut('plugins', [...current, ...plugins])
      },
      [plugin, other]
    )

    // 先把焦点交给另一插件，再恢复同一个缓存列表实例。
    await launchLifecyclePlugin(page, pluginRoot, 'initial')
    await expect.poll(() => readLifecycleEvents(eventFile)).toHaveLength(1)
    await launchLifecyclePlugin(page, otherRoot, 'other')
    await expect.poll(() => readLifecycleEvents(otherEventFile)).toHaveLength(1)
    await launchLifecyclePlugin(page, pluginRoot, 'restored')
    await expect.poll(() => readLifecycleEvents(eventFile)).toHaveLength(3)
    const events = await readLifecycleEvents(eventFile)
    expect(new Set(events.map(({ instance }) => instance)).size).toBe(1)

    // 只向当前实际获得焦点的 WebContents 发按键，避免直接定位列表掩盖焦点丢失。
    await expect
      .poll(() =>
        electronApp!.evaluate(({ webContents }) =>
          webContents.getFocusedWebContents()?.getURL().includes('/list-focus/index.html')
        )
      )
      .toBe(true)
    await electronApp.evaluate(({ webContents }) => {
      const contents = webContents.getFocusedWebContents()
      if (!contents?.getURL().includes('/list-focus/index.html')) {
        throw new Error('List plugin did not retain keyboard focus')
      }
      for (const keyCode of ['Down', 'Return']) {
        contents.sendInputEvent({ type: 'keyDown', keyCode })
        contents.sendInputEvent({ type: 'keyUp', keyCode })
      }
    })
    await expect.poll(() => readLifecycleEvents(eventFile)).toHaveLength(4)
    expect((await readLifecycleEvents(eventFile))[3]).toMatchObject({
      event: 'select',
      value: { payload: 'restored', id: 'second' }
    })
  } finally {
    // 仅关闭本次源码 Electron，并释放测试夹具和隔离数据。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
