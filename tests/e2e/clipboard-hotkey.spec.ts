import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const settingsUrlFragments = ['127.0.0.1:15177', 'internal-plugins/setting/index.html']
const pluginName = 'e2e-clipboard-hotkey'

/**
 * 写入一个最小剪贴板插件，只在宿主派发进入事件时同步历史。
 * @param pluginRoot 插件目录
 * @returns 插件清单路径
 */
async function createClipboardPlugin(pluginRoot: string): Promise<string> {
  await fs.mkdir(pluginRoot, { recursive: true })
  const pluginJsonPath = path.join(pluginRoot, 'plugin.json')
  await fs.writeFile(
    pluginJsonPath,
    JSON.stringify(
      {
        name: pluginName,
        title: 'E2E 剪贴板快捷键',
        version: '1.0.0',
        main: 'index.html',
        preload: 'preload.js',
        features: [
          {
            code: 'clipboard-hotkey',
            explain: 'E2E 剪贴板快捷键',
            cmds: ['E2E 剪贴板快捷键']
          }
        ]
      },
      null,
      2
    )
  )
  await fs.writeFile(path.join(pluginRoot, 'preload.js'), "'use strict'\n")
  await fs.writeFile(
    path.join(pluginRoot, 'index.html'),
    `<!doctype html>
<html>
  <body>
    <main id="history">loading</main>
    <script>
      window.enterCount = 0
      async function renderHistory() {
        const result = await window.ztools.clipboard.getHistory(1, 50)
        document.querySelector('#history').textContent = result.items
          .map((item) => item.content || item.preview || '')
          .join('\\n')
      }
      window.ztools.onPluginEnter(() => {
        window.enterCount += 1
        void renderHistory()
      })
      void renderHistory()
    </script>
  </body>
</html>`,
    'utf-8'
  )
  return pluginJsonPath
}

/**
 * 在设置插件的 WebContents 中执行脚本。
 * @param electronApp Electron 应用
 * @param script 待执行脚本
 * @returns 脚本执行结果
 */
async function executeInSettings(
  electronApp: ElectronApplication,
  script: string
): Promise<unknown> {
  return await electronApp.evaluate(
    async ({ webContents }, { fragments, code }) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => fragments.some((fragment) => item.getURL().includes(fragment)))
      if (!contents) throw new Error('未找到设置插件 WebContents')
      return await contents.executeJavaScript(code)
    },
    { fragments: settingsUrlFragments, code: script }
  )
}

/**
 * 读取设置插件正文；视图尚未创建时返回空字符串供轮询继续等待。
 * @param electronApp Electron 应用
 * @returns 设置插件正文
 */
async function readSettingsText(electronApp: ElectronApplication): Promise<string> {
  return await electronApp.evaluate(async ({ webContents }, fragments) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => fragments.some((fragment) => item.getURL().includes(fragment)))
    if (!contents || contents.isLoading()) return ''
    return await contents.executeJavaScript('document.body?.innerText || ""')
  }, settingsUrlFragments)
}

/**
 * 读取测试剪贴板插件正文和进入事件次数。
 * @param electronApp Electron 应用
 * @returns 插件状态；视图尚未创建时返回空状态
 */
async function readClipboardPlugin(
  electronApp: ElectronApplication
): Promise<{ text: string; enterCount: number }> {
  return await electronApp.evaluate(async ({ webContents }, marker) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(marker))
    if (!contents || contents.isLoading()) return { text: '', enterCount: 0 }
    return await contents.executeJavaScript(
      `({ text: document.body.innerText, enterCount: window.enterCount })`
    )
  }, pluginName)
}

test('快捷键重新打开剪贴板插件时显示最新记录', async ({ browserName: _browserName }, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-clipboard-hotkey-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugins', pluginName)
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await createClipboardPlugin(pluginRoot)

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
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('hotkey-old-record'))

    await searchInput.fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => readSettingsText(electronApp!)).toContain('开机自动启动')
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `window.ztools.clipboard.getHistory(1, 10).then((result) => result.items[0]?.content)`
        )
      )
      .toBe('hotkey-old-record')

    expect(
      await executeInSettings(
        electronApp,
        `window.ztools.internal.adoptPluginEntity(${JSON.stringify(pluginRoot)})`
      )
    ).toMatchObject({ success: true, adopted: true })

    await page.evaluate(
      async ({ pluginRoot }) =>
        await window.ztools.launch({
          path: pluginRoot,
          type: 'plugin',
          featureCode: 'clipboard-hotkey',
          name: 'E2E 剪贴板快捷键',
          cmdType: 'text',
          param: { code: 'clipboard-hotkey', type: 'text', payload: '' }
        }),
      { pluginRoot }
    )
    await expect
      .poll(() => readClipboardPlugin(electronApp!))
      .toEqual({
        text: 'hotkey-old-record',
        enterCount: 1
      })

    // 保持插件为当前视图，只更新系统剪贴板和宿主历史，再由同一快捷键目标重新进入。
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('hotkey-latest-record'))
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `window.ztools.clipboard.getHistory(1, 10).then((result) => result.items[0]?.content)`
        )
      )
      .toBe('hotkey-latest-record')

    expect(
      await page.evaluate(
        async () =>
          await window.ztools.commands.execute({
            target: 'E2E 剪贴板快捷键',
            context: {
              searchQuery: '',
              pastedImage: null,
              pastedFiles: null,
              pastedText: null
            },
            source: 'global-shortcut'
          })
      )
    ).toMatchObject({ success: true })

    await expect.poll(async () => (await readClipboardPlugin(electronApp!)).enterCount).toBe(2)
    await expect
      .poll(async () => (await readClipboardPlugin(electronApp!)).text)
      .toContain('hotkey-latest-record')

    const screenshot = await electronApp.evaluate(async ({ webContents }, marker) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().includes(marker))
      if (!contents) throw new Error('未找到剪贴板插件视图')
      return (await contents.capturePage()).toPNG().toString('base64')
    }, pluginName)
    await testInfo.attach('clipboard-hotkey-reopen', {
      body: Buffer.from(screenshot, 'base64'),
      contentType: 'image/png'
    })
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
