import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

test('可以启动主窗口、打开内置设置插件并截图', async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-playwright-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const searchScreenshotPath = testInfo.outputPath('search-window.png')
  const settingsPluginScreenshotPath = testInfo.outputPath('settings-plugin.png')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    // 使用完全隔离的数据目录启动真实 Electron 主进程。
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

    // 等待 Vue 完成挂载，并确认测试模式确实展示了主窗口。
    await expect(searchInput).toBeVisible()
    const isVisible = await electronApp.evaluate(async ({ BrowserWindow }) => {
      // 为 Electron 34 的 Node inspector 保留待完成的求值，直到主进程进入下一轮事件循环。
      await new Promise<void>((resolve) => setImmediate(resolve))
      return BrowserWindow.getAllWindows().some((window) => window.isVisible())
    })
    expect(isVisible).toBe(true)

    // 通过 Playwright Locator 驱动真实输入事件并校验渲染状态。
    await searchInput.fill('ZTools E2E 可行性验证')
    await expect(searchInput).toHaveValue('ZTools E2E 可行性验证')

    const searchScreenshot = await page.screenshot({ path: searchScreenshotPath })
    await testInfo.attach('search-window', {
      body: searchScreenshot,
      contentType: 'image/png'
    })

    // 搜索并点击内置设置指令，验证插件 WebContentsView 能被真实启动。
    await searchInput.fill('通用设置')
    const settingsResult = page
      .locator('.app-item, .list-item')
      .filter({ hasText: '通用设置' })
      .first()
    await expect(settingsResult).toBeVisible()
    await settingsResult.click()

    await expect
      .poll(
        () =>
          electronApp!.evaluate(async ({ webContents }) => {
            const pluginContents = webContents
              .getAllWebContents()
              .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
            if (!pluginContents || pluginContents.isLoading()) return ''
            return pluginContents.executeJavaScript('document.body.innerText')
          }),
        { timeout: 15_000 }
      )
      .toContain('开机自动启动')

    // 单独截取设置插件视图，确认 WebContentsView 本身存在可见内容。
    const settingsPluginBase64 = await electronApp.evaluate(async ({ webContents }) => {
      const pluginContents = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
      if (!pluginContents) throw new Error('未找到设置插件 WebContentsView')
      return (await pluginContents.capturePage()).toPNG().toString('base64')
    })
    const settingsPluginScreenshot = Buffer.from(settingsPluginBase64, 'base64')
    await fs.writeFile(settingsPluginScreenshotPath, settingsPluginScreenshot)
    await testInfo.attach('settings-plugin', {
      body: settingsPluginScreenshot,
      contentType: 'image/png'
    })
  } finally {
    // 无论断言是否成功，都关闭测试实例并清理明确创建的临时数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
