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

/**
 * 触发主窗口的失焦隐藏，再通过与全局唤醒共用的 showWindow 路径显示。
 * @param electronApp 当前使用隔离数据目录的 Electron 实例。
 * @returns 窗口重新显示且 Space 锚点释放后结束的 Promise。
 */
async function blurAndWakeMainWindow(electronApp: ElectronApplication): Promise<void> {
  // E2E 默认抑制失焦隐藏，只在测试的 blur 事件期间启用产品处理逻辑。
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find(
          (win) => win.getTitle() === 'ZTools' && win.getBounds().width > 1
        )!
        if (!main.isVisible()) return false
        const e2eMode = process.env.ZTOOLS_E2E
        delete process.env.ZTOOLS_E2E
        try {
          main.emit('blur')
        } finally {
          if (e2eMode !== undefined) process.env.ZTOOLS_E2E = e2eMode
        }
        return main.isVisible()
      })
    )
    .toBe(false)

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.emit('super-panel:show-main-window', {})
  })

  // 原生唤醒可能在动画期间补发 show 事件，等迁移收尾再检查最终焦点。
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows()
        const hasAnchor = windows.some((win) => {
          const [width, height] = win.getSize()
          return width === 1 && height === 1
        })
        const main = windows.find((win) => win.getTitle() === 'ZTools' && win.getBounds().width > 1)
        return !hasAnchor && main?.isVisible() === true
      })
    )
    .toBe(true)
}

/**
 * 读取键盘当前交给主窗口宿主页还是插件正文。
 * @param electronApp 当前使用隔离数据目录的 Electron 实例。
 * @returns 当前获得焦点的 WebContents 类型。
 */
async function readKeyboardTarget(
  electronApp: ElectronApplication
): Promise<'host' | 'plugin' | null> {
  return await electronApp.evaluate(({ BrowserWindow, webContents }) => {
    const main = BrowserWindow.getAllWindows().find(
      (win) => win.getTitle() === 'ZTools' && win.getBounds().width > 1
    )!
    if (!main.isVisible()) return null
    const focused = webContents.getFocusedWebContents()
    if (!focused) return null
    if (focused === main.webContents) return 'host'
    if (focused.getURL().startsWith('http://127.0.0.1:15177')) return 'plugin'
    return null
  })
}

test('插件保留在主窗口时，失焦唤醒会恢复顶部输入或插件正文的键盘焦点', async () => {
  test.skip(process.platform !== 'darwin', '验证 macOS Space 迁移后的焦点恢复')
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-wake-focus-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | undefined

  try {
    await fs.mkdir(legacyRoot, { recursive: true })
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const page = await electronApp.firstWindow()
    const input = page.locator('.search-input')
    await expect(input).toBeVisible()
    await input.fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => readSettingsText(electronApp!)).toContain('开机自动启动')

    // 用插件 API 同时切换原生 WebContents 焦点和 DOM 焦点，避免只验证 Playwright 的页面焦点。
    expect(
      await executeInSettings(electronApp, "window.ztools.setSubInput(() => {}, '唤醒焦点', true)")
    ).toBe(true)
    await expect.poll(() => readKeyboardTarget(electronApp!)).toBe('host')
    await input.fill('保留插件输入')
    await expect(input).toBeFocused()

    await blurAndWakeMainWindow(electronApp)
    await expect.poll(() => readKeyboardTarget(electronApp!)).toBe('host')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('保留插件输入')

    // 即使顶部输入框仍可见，也不能覆盖用户最后选择的插件正文焦点。
    expect(await executeInSettings(electronApp, 'window.ztools.subInputBlur()')).toBe(true)
    await expect.poll(() => readKeyboardTarget(electronApp!)).toBe('plugin')
    await blurAndWakeMainWindow(electronApp)
    await expect.poll(() => readKeyboardTarget(electronApp!)).toBe('plugin')
    await expect(input).toHaveValue('保留插件输入')
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
