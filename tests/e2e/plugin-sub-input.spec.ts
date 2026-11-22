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
import { pathToFileURL } from 'node:url'

const projectRoot = path.resolve(__dirname, '../..')

interface SearchPlugin {
  name: string
  url: string
}

interface SearchState {
  instance: string
  enterCount: number
  outCount: number
  query: string
  changes: string[]
  items: string[]
  body: string
}

interface SearchHost {
  app: ElectronApplication
  page: Page
  addPlugin: (name: string) => Promise<SearchPlugin>
  close: () => Promise<void>
}

/**
 * 创建源码 Electron 宿主，以及按剪贴板插件方式处理搜索和进入回调的夹具。
 * @returns 使用独立数据目录的宿主及插件安装、清理方法。
 * @throws 临时目录、插件文件或 Electron 启动失败时抛出错误。
 */
async function createSearchHost(): Promise<SearchHost> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-sub-input-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let app: ElectronApplication | undefined

  /**
   * 关闭本次测试实例并删除隔离数据，保留真实用户目录。
   * @returns 清理完成后的 Promise。
   */
  async function close(): Promise<void> {
    await app?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }

  try {
    // 当前和旧数据目录都隔离，禁止测试启动迁移真实用户数据。
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
     * 安装使用公开搜索及退出 API 的独立插件，记录过滤结果和退出次数。
     * @param name 本次测试中唯一的插件与指令名称。
     * @returns 供启动及定位 WebContents 使用的插件身份。
     * @throws 插件文件或隔离注册表写入失败时抛出错误。
     */
    async function addPlugin(name: string): Promise<SearchPlugin> {
      const pluginRoot = path.join(dataRoot, name)
      const manifest = {
        name,
        title: name,
        version: '1.0.0',
        main: 'index.html',
        features: [{ code: 'search', cmds: [name] }]
      }
      await fs.mkdir(pluginRoot)
      await fs.writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify(manifest))
      await fs.writeFile(
        path.join(pluginRoot, 'index.html'),
        `<!doctype html><html><body><main id="results"></main><script>
const state = window.__searchState = {
  instance: crypto.randomUUID(), enterCount: 0, outCount: 0, query: '', changes: [], items: []
}
/**
 * 根据插件内部关键词刷新正文，独立于宿主输入框的可见值。
 * @returns 无返回值。
 */
function refresh() {
  state.items = ['apple', 'banana'].filter(item => item.includes(state.query))
  document.querySelector('#results').textContent = state.items.join(', ') || '没有匹配记录'
}
/**
 * 消费宿主搜索通知并更新插件过滤条件。
 * @param details 宿主提供的搜索词。
 * @returns 无返回值。
 */
function onSearchChange(details) {
  state.query = details.text
  state.changes.push(details.text)
  refresh()
}
/**
 * 与剪贴板插件一致，在每次进入时重置搜索、刷新列表并聚焦搜索框。
 * @returns 操作完成后的 Promise。
 */
async function onEnter() {
  state.enterCount++
  state.query = ''
  await ztools.setSubInputValue('')
  refresh()
  ztools.subInputFocus()
}
/**
 * 记录插件退出，验证编辑输入期间没有意外触发生命周期切换。
 * @returns 无返回值。
 */
function onOut() {
  state.outCount++
}
ztools.setSubInput(onSearchChange, '搜索记录...', true)
ztools.onPluginEnter(onEnter)
ztools.onPluginOut(onOut)
refresh()
</script></body></html>`
      )
      await page.evaluate(
        async (plugin) => {
          const current = (await window.ztools.dbGet('plugins')) || []
          await window.ztools.dbPut('plugins', [...current, plugin])
        },
        { ...manifest, path: pluginRoot }
      )
      return { name, url: pathToFileURL(path.join(pluginRoot, 'index.html')).href }
    }

    return { app, page, addPlugin, close }
  } catch (error) {
    await close()
    throw error
  }
}

/**
 * 通过全局快捷键共用的指令执行入口启动插件，避免依赖系统按键权限。
 * @param host 当前隔离宿主。
 * @param plugin 目标插件。
 * @returns 宿主接受启动请求后的 Promise。
 */
async function launchShortcut(host: SearchHost, plugin: SearchPlugin): Promise<void> {
  const result = await host.page.evaluate(
    (target) =>
      window.ztools.commands.execute({
        target,
        source: 'global-shortcut',
        context: { searchQuery: '' }
      }),
    plugin.name
  )
  expect(result).toMatchObject({ success: true })
}

/**
 * 从插件自己的 WebContents 读取内部搜索状态及可见正文。
 * @param host 当前隔离宿主。
 * @param plugin 目标插件。
 * @returns 插件状态；实例尚未创建时返回 null。
 * @throws 插件脚本执行失败时抛出错误。
 */
async function readSearchState(
  host: SearchHost,
  plugin: SearchPlugin
): Promise<SearchState | null> {
  return host.app.evaluate(async ({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)
    return contents
      ? contents.executeJavaScript(
          '({ ...window.__searchState, body: document.querySelector("#results").textContent })'
        )
      : null
  }, plugin.url)
}

/**
 * 等待宿主隐藏，覆盖失焦处理共用的隐藏入口而不受 E2E 失焦抑制影响。
 * @param host 当前隔离宿主。
 * @returns 确认窗口隐藏后的 Promise。
 */
async function hideHost(host: SearchHost): Promise<void> {
  await host.page.evaluate(() => window.ztools.hideWindow())
  await expect
    .poll(() =>
      host.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.getTitle() === 'ZTools')
          ?.isVisible()
      )
    )
    .toBe(false)
}

/**
 * 从搜索页面进入夹具，并等待进入回调清空搜索的通知送达后再操作键盘。
 * @param host 当前隔离宿主。
 * @param plugin 目标插件。
 * @returns 插件搜索初始化完成后的 Promise。
 */
async function enterSearchPlugin(host: SearchHost, plugin: SearchPlugin): Promise<void> {
  const previous = await readSearchState(host, plugin)
  await launchShortcut(host, plugin)
  await expect
    .poll(() => readSearchState(host, plugin))
    .toMatchObject({
      enterCount: (previous?.enterCount ?? 0) + 1,
      query: '',
      changes: [...(previous?.changes ?? []), ''],
      body: 'apple, banana'
    })
}

test('快捷键从隐藏状态重入时同步清空搜索并刷新列表，保持同一插件实例', async () => {
  const host = await createSearchHost()
  try {
    const plugin = await host.addPlugin('search-reentry')
    const input = host.page.locator('.search-input')
    await launchShortcut(host, plugin)
    await expect
      .poll(() => readSearchState(host, plugin))
      .toMatchObject({
        enterCount: 1,
        query: '',
        changes: [''],
        body: 'apple, banana'
      })
    const instance = (await readSearchState(host, plugin))!.instance

    // 同时覆盖有搜索结果和无结果的情况，重入都应回到完整列表并且只进入一次。
    for (const [index, keyword] of ['apple', 'missing'].entries()) {
      await input.fill(keyword)
      await expect
        .poll(() => readSearchState(host, plugin))
        .toMatchObject({
          query: keyword,
          body: keyword === 'apple' ? 'apple' : '没有匹配记录'
        })
      await hideHost(host)
      await launchShortcut(host, plugin)
      await expect(input).toHaveValue('')
      await expect(input).toBeFocused()
      await expect
        .poll(() => readSearchState(host, plugin))
        .toMatchObject({
          instance,
          enterCount: index + 2,
          query: '',
          items: ['apple', 'banana'],
          body: 'apple, banana'
        })
    }
  } finally {
    await host.close()
  }
})

test('前台重复快捷键保留搜索状态，切换插件不向旧插件发送空搜索', async () => {
  const host = await createSearchHost()
  try {
    const first = await host.addPlugin('search-first')
    const second = await host.addPlugin('search-second')
    const input = host.page.locator('.search-input')
    await launchShortcut(host, first)
    await expect
      .poll(() => readSearchState(host, first))
      .toMatchObject({
        enterCount: 1,
        changes: ['']
      })
    await input.fill('apple')
    await expect
      .poll(() => readSearchState(host, first))
      .toMatchObject({
        query: 'apple',
        body: 'apple'
      })
    const before = await readSearchState(host, first)

    // 前台重复启动保持宿主搜索词、插件状态和实例，不能重复进入或重置过滤条件。
    await launchShortcut(host, first)
    await expect(input).toHaveValue('apple')
    expect(await readSearchState(host, first)).toEqual(before)

    // 切换到另一个插件时，清空宿主输入不能被广播给仍持有搜索词的旧插件。
    await launchShortcut(host, second)
    await expect
      .poll(() => readSearchState(host, second))
      .toMatchObject({
        enterCount: 1,
        query: '',
        body: 'apple, banana'
      })
    await expect(input).toHaveValue('')
    await expect.poll(() => readSearchState(host, first)).toEqual({ ...before, outCount: 1 })

    // 真正切换回缓存插件仍需进入，不能因文本功能相同误当成前台聚焦。
    await launchShortcut(host, first)
    await expect(input).toHaveValue('')
    await expect
      .poll(() => readSearchState(host, first))
      .toMatchObject({
        instance: before!.instance,
        enterCount: 2,
        query: '',
        body: 'apple, banana'
      })
  } finally {
    await host.close()
  }
})

test('插件搜索中的空白按字符删除，输入已经为空时再次退格才退出', async () => {
  const host = await createSearchHost()
  try {
    const plugin = await host.addPlugin('search-backspace')
    const input = host.page.locator('.search-input')

    // 覆盖普通空格、全角空格、不换行空格及混合文本，均通过真实键盘编辑输入。
    for (const [index, text] of ['   ', '\u3000\u3000', '\u00a0\u00a0', 'a  ', 'a'].entries()) {
      await enterSearchPlugin(host, plugin)
      await input.pressSequentially(text)
      await expect.poll(() => readSearchState(host, plugin)).toMatchObject({ query: text })

      for (let remaining = text.length - 1; remaining >= 0; remaining--) {
        const before = (await readSearchState(host, plugin))!
        const expected = text.slice(0, remaining)
        await input.press('Backspace')
        await expect(input).toHaveValue(expected)
        await expect(host.page.locator('.plugin-tag')).toHaveCount(1)
        await expect
          .poll(() => readSearchState(host, plugin))
          .toMatchObject({
            enterCount: index + 1,
            outCount: index,
            query: expected,
            changes: [...before.changes, expected]
          })
      }

      // 删掉最后一个字符只刷新搜索；另一次空输入退格才触发退出回调。
      await expect
        .poll(() => readSearchState(host, plugin))
        .toMatchObject({
          body: 'apple, banana'
        })
      await input.press('Backspace')
      await expect(host.page.locator('.plugin-tag')).toHaveCount(0)
      await expect.poll(() => readSearchState(host, plugin)).toMatchObject({ outCount: index + 1 })
    }
  } finally {
    await host.close()
  }
})

test('空白选区、光标位置、修饰键和输入法组合态保持原生编辑与退出边界', async () => {
  const host = await createSearchHost()
  try {
    const plugin = await host.addPlugin('search-editing')
    const input = host.page.locator('.search-input')
    await enterSearchPlugin(host, plugin)
    await input.pressSequentially('   ')
    await expect.poll(() => readSearchState(host, plugin)).toMatchObject({ query: '   ' })
    const before = (await readSearchState(host, plugin))!

    // 光标在开头时退格不能删除右侧空格，更不能把纯空白当作空输入退出。
    await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(0, 0))
    await input.press('Backspace')
    await expect(input).toHaveValue('   ')
    expect(await readSearchState(host, plugin)).toEqual(before)

    // 全选删除只清空选区，并且只向插件发送一次空搜索通知。
    await input.selectText()
    await input.press('Backspace')
    await expect(input).toHaveValue('')
    await expect
      .poll(() => readSearchState(host, plugin))
      .toMatchObject({
        outCount: 0,
        changes: [...before.changes, ''],
        body: 'apple, banana'
      })

    // 带修饰键的退格保持文本编辑语义，不触发裸退格的退出路径。
    for (const modifier of ['Control', 'Meta', 'Alt', 'Shift']) {
      await input.press(`${modifier}+Backspace`)
      await expect(host.page.locator('.plugin-tag')).toHaveCount(1)
    }

    // 用组合事件驱动宿主真实的输入法状态，组合期间退格和 ESC 都不能退出插件。
    await input.dispatchEvent('compositionstart')
    await input.press('Backspace')
    await input.press('Escape')
    await expect(host.page.locator('.plugin-tag')).toHaveCount(1)
    await input.dispatchEvent('compositionend')
    await input.press('Backspace')
    await expect(host.page.locator('.plugin-tag')).toHaveCount(0)
    await expect.poll(() => readSearchState(host, plugin)).toMatchObject({ outCount: 1 })
  } finally {
    await host.close()
  }
})

test('空白退格先编辑输入，再处理粘贴内容，最后才退出插件', async () => {
  const host = await createSearchHost()
  try {
    const plugin = await host.addPlugin('search-pasted-text')
    const input = host.page.locator('.search-input')
    await enterSearchPlugin(host, plugin)

    // 通过现有二次筛选快捷键建立粘贴态，无需读取或修改系统剪贴板。
    await input.pressSequentially('filter')
    await input.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
    await expect(host.page.locator('.pasted-text')).toContainText('filter')
    await expect(input).toHaveValue('')
    await input.pressSequentially('  ')
    await input.press('Backspace')
    await expect(input).toHaveValue(' ')
    await expect(host.page.locator('.pasted-text')).toHaveCount(1)
    await input.press('Backspace')
    await expect(input).toHaveValue('')
    await expect(host.page.locator('.pasted-text')).toHaveCount(1)

    // 空输入退格由 SearchBox 消费并还原粘贴文本，宿主不能重复处理同一个按键。
    await input.press('Backspace')
    await expect(input).toHaveValue('filter')
    await expect(host.page.locator('.pasted-text')).toHaveCount(0)
    await expect
      .poll(() => readSearchState(host, plugin))
      .toMatchObject({
        query: 'filter',
        outCount: 0
      })
    await input.press('Backspace')
    await expect(input).toHaveValue('')
    await expect(host.page.locator('.plugin-tag')).toHaveCount(1)
    await input.press('Backspace')
    await expect(host.page.locator('.plugin-tag')).toHaveCount(0)
  } finally {
    await host.close()
  }
})

test('插件及主搜索页面的 ESC 先清空纯空白，再执行退出或隐藏', async () => {
  const host = await createSearchHost()
  try {
    const plugin = await host.addPlugin('search-escape')
    const input = host.page.locator('.search-input')
    await enterSearchPlugin(host, plugin)
    await input.pressSequentially(' \u3000\u00a0')
    await expect.poll(() => readSearchState(host, plugin)).toMatchObject({ query: ' \u3000\u00a0' })
    const before = (await readSearchState(host, plugin))!

    // 插件搜索清空时发送一次变更通知，留在当前插件并恢复完整结果。
    await input.press('Escape')
    await expect(input).toHaveValue('')
    await expect(host.page.locator('.plugin-tag')).toHaveCount(1)
    await expect
      .poll(() => readSearchState(host, plugin))
      .toMatchObject({
        query: '',
        changes: [...before.changes, ''],
        outCount: 0,
        body: 'apple, banana'
      })
    await input.press('Escape')
    await expect(host.page.locator('.plugin-tag')).toHaveCount(0)
    await expect.poll(() => readSearchState(host, plugin)).toMatchObject({ outCount: 1 })

    // 主搜索页面也要先清除空白，再由下一次 ESC 隐藏窗口。
    await input.pressSequentially(' \u3000\u00a0')
    await input.press('Escape')
    await expect(input).toHaveValue('')
    expect(
      await host.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(true)
    await input.press('Escape')
    await expect
      .poll(() =>
        host.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((window) => window.isVisible())
        )
      )
      .toBe(false)
  } finally {
    await host.close()
  }
})

test('分离窗口的 ESC 清空纯空白并通知插件，空输入再次 ESC 保持窗口', async () => {
  const host = await createSearchHost()
  try {
    const plugin = await host.addPlugin('search-detached')
    await enterSearchPlugin(host, plugin)
    expect(await host.page.evaluate(() => window.ztools.detachPlugin())).toMatchObject({
      success: true
    })
    await expect
      .poll(() => host.app.windows().some((page) => page.url().includes('detached-titlebar.html')))
      .toBe(true)
    const detached = host.app
      .windows()
      .find((page) => page.url().includes('detached-titlebar.html'))!
    const input = detached.locator('.search-input')
    await expect(input).toBeVisible()
    await input.pressSequentially(' \u3000\u00a0')
    await expect.poll(() => readSearchState(host, plugin)).toMatchObject({ query: ' \u3000\u00a0' })
    const before = (await readSearchState(host, plugin))!

    // 标题栏输入清空与实际插件列表刷新必须同步，不能只清掉可见文本。
    await input.press('Escape')
    await expect(input).toHaveValue('')
    await expect
      .poll(() => readSearchState(host, plugin))
      .toMatchObject({
        query: '',
        changes: [...before.changes, ''],
        outCount: 0,
        body: 'apple, banana'
      })
    const cleared = await readSearchState(host, plugin)
    await input.press('Escape')
    await expect(input).toBeVisible()
    expect(await readSearchState(host, plugin)).toEqual(cleared)
  } finally {
    await host.close()
  }
})
