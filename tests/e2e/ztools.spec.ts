import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import electronPath from 'electron'
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

    // 等待 Vue 完成挂载，并确认测试模式确实创建了主窗口。
    // Wayland 下 Electron 的 isVisible 可能不反映实际呈现状态，改用实例存在性判断。
    await expect(searchInput).toBeVisible()
    const hasMainWindow = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => !window.isDestroyed())
    )
    expect(hasMainWindow).toBe(true)

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

test('CSS app-region 拖拽开关可以切换并持久化', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-playwright-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })

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

    // 该开关仅在 Linux 平台显示，其他平台直接跳过。
    const platform = await electronApp.evaluate(() => process.platform)
    test.skip(platform !== 'linux', 'CSS app-region 拖拽选项仅 Linux 平台显示')

    // 搜索并打开内置设置插件。
    await searchInput.fill('通用设置')
    const settingsResult = page
      .locator('.app-item, .list-item')
      .filter({ hasText: '通用设置' })
      .first()
    await expect(settingsResult).toBeVisible()
    await settingsResult.click()

    // 等待设置插件渲染出 CSS app-region 拖拽开关。
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
      .toContain('使用 CSS -webkit-app-region 拖拽')

    // 在设置插件 WebContentsView 中点击开关，触发主进程实时通知。
    const toggleResult = await electronApp!.evaluate(async ({ webContents }) => {
      const pluginContents = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
      if (!pluginContents) return { found: false }
      return pluginContents.executeJavaScript(`
        (() => {
          const label = [...document.querySelectorAll('.setting-label')]
            .find((el) => el.querySelector('span')?.textContent?.includes('使用 CSS -webkit-app-region 拖拽'))
          const input = label?.closest('.setting-item')?.querySelector('.toggle input[type="checkbox"]')
          if (!input) return { found: false }
          input.click()
          return { found: true }
        })()
      `)
    })
    expect(toggleResult.found).toBe(true)

    // 主窗口搜索框应获得 css-app-region-drag 类，且计算样式为 drag。
    await expect(page.locator('.search-box')).toHaveClass(/css-app-region-drag/)
    const boxRegion = await page.locator('.search-box').evaluate((el) => {
      const style = getComputedStyle(el) as CSSStyleDeclaration & { webkitAppRegion?: string }
      return style.webkitAppRegion ?? ''
    })
    expect(boxRegion).toBe('drag')

    // 关闭设置插件（no-drag 的关闭按钮在 app-region 拖拽模式下仍应可点击），
    // 返回搜索界面后搜索框不再使用 CSS 拖拽，输入框计算样式仍为 no-drag。
    await page.locator('.plugin-tag-close').click()
    await expect(searchInput).toBeVisible()
    await expect(page.locator('.search-box')).not.toHaveClass(/css-app-region-drag/)
    const inputRegion = await page.locator('.search-input').evaluate((el) => {
      const style = getComputedStyle(el) as CSSStyleDeclaration & { webkitAppRegion?: string }
      return style.webkitAppRegion ?? ''
    })
    expect(inputRegion).toBe('no-drag')

    // 开关状态应已写入数据库。
    const saved = await page.evaluate(() =>
      (window as unknown as { ztools: { dbGet: (key: string) => Promise<any> } }).ztools.dbGet(
        'settings-general'
      )
    )
    expect(saved?.useCssAppRegionDrag).toBe(true)

    // 重新进入设置页并重新加载插件，确认开关状态从数据库恢复。
    await searchInput.fill('通用设置')
    const reopenedResult = page
      .locator('.app-item, .list-item')
      .filter({ hasText: '通用设置' })
      .first()
    await expect(reopenedResult).toBeVisible()
    await reopenedResult.click()
    await electronApp!.evaluate(async ({ webContents }) => {
      const pluginContents = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
      pluginContents?.reload()
    })

    await expect
      .poll(
        () =>
          electronApp!.evaluate(async ({ webContents }) => {
            const pluginContents = webContents
              .getAllWebContents()
              .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
            if (!pluginContents || pluginContents.isLoading()) return null
            return pluginContents.executeJavaScript(`
              (() => {
                const label = [...document.querySelectorAll('.setting-label')]
                  .find((el) => el.querySelector('span')?.textContent?.includes('使用 CSS -webkit-app-region 拖拽'))
                const input = label?.closest('.setting-item')?.querySelector('.toggle input[type="checkbox"]')
                return input ? input.checked : null
              })()
            `)
          }),
        { timeout: 15_000 }
      )
      .toBe(true)
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('命令行唤起已运行实例', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-playwright-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })

  // 主实例与第二实例必须使用完全一致的隔离环境，才能命中同一个单实例锁，
  // 并且保证第二实例不会读写真实的 ~/.ztools 数据。
  const testEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
    ),
    ZTOOLS_DATA_ROOT: dataRoot,
    ZTOOLS_E2E: '1',
    ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
    ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
  }

  try {
    // 使用完全隔离的数据目录启动真实 Electron 主进程。
    electronApp = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: testEnv
    })

    const page = await electronApp.firstWindow()
    const searchInput = page.locator('.search-input')
    // 等待主窗口完全就绪，确保单实例锁已被首个实例持有。
    await expect(searchInput).toBeVisible()

    // 隐藏主窗口并记录 show 事件，验证后续唤醒确实把窗口重新显示出来。
    await electronApp.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
      if (!mainWindow) throw new Error('未找到主窗口')
      ;(globalThis as Record<string, unknown>).__ztoolsE2EShowCount = 0
      mainWindow.on('show', () => {
        const current = (globalThis as Record<string, unknown>).__ztoolsE2EShowCount as number
        ;(globalThis as Record<string, unknown>).__ztoolsE2EShowCount = current + 1
      })
      mainWindow.hide()
    })
    await expect
      .poll(() =>
        electronApp!.evaluate(({ BrowserWindow }) => {
          const mainWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
          return mainWindow?.isVisible() ?? false
        })
      )
      .toBe(false)

    // 用同一 Electron 二进制和同一隔离环境派生第二实例，携带命令行唤起参数。
    const secondInstance = spawn(electronPath, [projectRoot, '--ztools-wake'], {
      cwd: projectRoot,
      env: testEnv,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    // 第二实例应因单实例锁快速退出且退出码为 0，不常驻进程。
    const secondExitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        secondInstance.kill()
        resolve(null)
      }, 10_000)
      secondInstance.on('close', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    expect(secondExitCode).toBe(0)

    // 原实例收到 second-instance 事件后应重新显示主窗口。
    await expect
      .poll(() =>
        electronApp!.evaluate(({ BrowserWindow }) => {
          const mainWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
          return mainWindow?.isVisible() ?? false
        })
      )
      .toBe(true)
    const showCount = await electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__ztoolsE2EShowCount as number
    )
    expect(showCount).toBeGreaterThanOrEqual(1)
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
