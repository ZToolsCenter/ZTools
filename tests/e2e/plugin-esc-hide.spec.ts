import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const settingsUrlFragments = ['http://127.0.0.1:15177', 'internal-plugins/setting/index.html']

/**
 * 使用隔离数据目录启动当前构建的 ZTools 测试实例。
 * @param dataRoot 测试实例专用数据目录。
 * @param legacyRoot 测试实例专用旧数据目录。
 * @returns 已启动的 Electron 应用实例。
 */
async function launchTestApp(dataRoot: string, legacyRoot: string): Promise<ElectronApplication> {
  return await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
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
 * 在设置插件 WebContentsView 中执行脚本。
 * @param electronApp 当前隔离 Electron 应用实例。
 * @param source 要在设置页面执行的 JavaScript 源码。
 * @returns 脚本执行结果。
 */
async function executeInSettings(
  electronApp: ElectronApplication,
  source: string
): Promise<unknown> {
  return await electronApp.evaluate(
    async ({ webContents }, { script, urlFragments }) => {
      const settingsContents = webContents
        .getAllWebContents()
        .find((contents) => urlFragments.some((fragment) => contents.getURL().includes(fragment)))
      if (!settingsContents) throw new Error('未找到内置设置插件 WebContentsView')
      return await settingsContents.executeJavaScript(script)
    },
    { script: source, urlFragments: settingsUrlFragments }
  )
}

/**
 * 读取设置插件正文；视图尚未创建时返回空字符串供轮询继续等待。
 * @param electronApp 当前隔离 Electron 应用实例。
 * @returns 设置插件当前正文，视图尚未出现时返回空字符串。
 */
async function readSettingsText(electronApp: ElectronApplication): Promise<string> {
  return await electronApp.evaluate(async ({ webContents }, urlFragments) => {
    const settingsContents = webContents
      .getAllWebContents()
      .find((contents) => urlFragments.some((fragment) => contents.getURL().includes(fragment)))
    if (!settingsContents || settingsContents.isLoading()) return ''
    return await settingsContents.executeJavaScript('document.body?.innerText || ""')
  }, settingsUrlFragments)
}

/**
 * 读取主窗口可见性和当前承载的插件视图数量。
 * @param electronApp 当前隔离 Electron 应用实例。
 * @returns 主窗口运行状态快照。
 */
async function readMainWindowState(
  electronApp: ElectronApplication
): Promise<{ visible: boolean; pluginViewCount: number }> {
  return await electronApp.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find(
      (window) => window.getTitle() === 'ZTools'
    )
    if (!mainWindow) throw new Error('未找到 ZTools 主窗口')
    return {
      visible: mainWindow.isVisible(),
      pluginViewCount: mainWindow.contentView.children.length
    }
  })
}

/**
 * 重新显示隔离测试实例的主窗口。
 * @param electronApp 当前隔离 Electron 应用实例。
 * @returns 无返回值。
 */
async function showMainWindow(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find(
      (window) => window.getTitle() === 'ZTools'
    )
    if (!mainWindow) throw new Error('未找到 ZTools 主窗口')
    mainWindow.show()
    mainWindow.webContents.focus()
  })
}

test('插件内 ESC 可直接隐藏主窗口并立即返回搜索', async ({
  browserName: _browserName
}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-esc-hide-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const settingsScreenshotPath = testInfo.outputPath('plugin-esc-hide-setting.png')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const page = await electronApp.firstWindow()
    const searchInput = page.locator('.search-input')

    // 打开通用设置并等待新行为设置项渲染完成。
    await expect(searchInput).toBeVisible()
    await searchInput.fill('通用设置')
    const settingsResult = page
      .locator('.app-item, .list-item')
      .filter({ hasText: '通用设置' })
      .first()
    await expect(settingsResult).toBeVisible()
    await settingsResult.click()
    await expect
      .poll(() => readSettingsText(electronApp!), { timeout: 15_000 })
      .toContain('插件内 ESC 直接隐藏')

    // 通过真实开关启用配置，确保关联的自动返回值同步保存为立即。
    expect(
      await executeInSettings(
        electronApp,
        `(() => {
          const item = Array.from(document.querySelectorAll('.setting-item'))
            .find((element) => element.textContent?.includes('插件内 ESC 直接隐藏'))
          const input = item?.querySelector('input[type="checkbox"]')
          if (!(input instanceof HTMLInputElement)) throw new Error('未找到插件 ESC 设置开关')
          input.click()
          return input.checked
        })()`
      )
    ).toBe(true)
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `window.ztools.internal.dbGet('settings-general').then((settings) => ({
            hide: settings?.hideMainWindowOnPluginEsc,
            autoBack: settings?.autoBackToSearch
          }))`
        )
      )
      .toEqual({ hide: true, autoBack: 'immediately' })

    // 将设置项滚动到可见区域后直接截取插件 WebContentsView。
    await executeInSettings(
      electronApp,
      `(async () => {
        const item = Array.from(document.querySelectorAll('.setting-item'))
          .find((element) => element.textContent?.includes('插件内 ESC 直接隐藏'))
        if (!(item instanceof HTMLElement)) throw new Error('未找到插件 ESC 设置项')
        item.scrollIntoView({ block: 'center' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        await new Promise((resolve) => setTimeout(resolve, 350))
      })()`
    )
    const settingsScreenshotBase64 = await electronApp.evaluate(
      async ({ webContents }, urlFragments) => {
        const settingsContents = webContents
          .getAllWebContents()
          .find((contents) => urlFragments.some((fragment) => contents.getURL().includes(fragment)))
        if (!settingsContents) throw new Error('未找到内置设置插件 WebContentsView')
        return (await settingsContents.capturePage()).toPNG().toString('base64')
      },
      settingsUrlFragments
    )
    const settingsScreenshot = Buffer.from(settingsScreenshotBase64, 'base64')
    expect(settingsScreenshot.byteLength).toBeGreaterThan(5_000)
    await fs.writeFile(settingsScreenshotPath, settingsScreenshot)
    await testInfo.attach('plugin-esc-hide-setting', {
      body: settingsScreenshot,
      contentType: 'image/png'
    })

    // 插件 WebContents 内按 ESC 时消费默认行为并直接隐藏，避免 macOS 系统提示音。
    expect(
      await executeInSettings(
        electronApp,
        `(() => {
          const event = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true
          })
          const dispatchResult = document.body.dispatchEvent(event)
          return { defaultPrevented: event.defaultPrevented, dispatchResult }
        })()`
      )
    ).toEqual({ defaultPrevented: true, dispatchResult: false })
    await expect
      .poll(() => readMainWindowState(electronApp!))
      .toEqual({
        visible: false,
        pluginViewCount: 0
      })
    await showMainWindow(electronApp)
    await expect(searchInput).toBeVisible()
    await expect(page.locator('.plugin-tag')).toHaveCount(0)

    // 再次进入插件，宿主顶部输入有内容时第一次 ESC 只清空，不提前隐藏。
    await searchInput.fill('通用设置')
    await expect(settingsResult).toBeVisible()
    await settingsResult.click()
    await expect
      .poll(() => readSettingsText(electronApp!), { timeout: 15_000 })
      .toContain('插件内 ESC 直接隐藏')
    expect(
      await executeInSettings(
        electronApp,
        `window.ztools.setSubInput(() => {}, '测试顶部输入', true)`
      )
    ).toBe(true)
    await expect(searchInput).toBeVisible()
    await searchInput.fill('待清空内容')
    await expect(searchInput).toHaveValue('待清空内容')
    await searchInput.press('Escape')
    await expect(searchInput).toHaveValue('')
    await expect
      .poll(() => readMainWindowState(electronApp!))
      .toEqual({
        visible: true,
        pluginViewCount: 1
      })

    // 顶部输入已经为空时再次 ESC，才在原本返回搜索的位置隐藏主窗口。
    await searchInput.press('Escape')
    await expect
      .poll(() => readMainWindowState(electronApp!))
      .toEqual({
        visible: false,
        pluginViewCount: 0
      })
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
