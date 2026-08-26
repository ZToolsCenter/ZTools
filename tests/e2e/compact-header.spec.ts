import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const settingsUrlFragments = ['http://127.0.0.1:15177', 'internal-plugins/setting/index.html']

interface MainWindowLayoutSnapshot {
  windowHeight: number
  pluginBounds: Electron.Rectangle | null
}

interface DetachedWindowLayoutSnapshot {
  windowHeight: number
  minimumHeight: number
  pluginBounds: Electron.Rectangle | null
}

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
 * 读取主窗口及当前插件 WebContentsView 的布局快照。
 * @param electronApp 当前隔离 Electron 应用实例。
 * @returns 主窗口高度和插件视图边界。
 */
async function readMainWindowLayout(
  electronApp: ElectronApplication
): Promise<MainWindowLayoutSnapshot> {
  return await electronApp.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find(
      (window) => window.getTitle() === 'ZTools'
    )
    if (!mainWindow) throw new Error('未找到 ZTools 主窗口')

    const pluginView = mainWindow.contentView.children[0]
    return {
      windowHeight: mainWindow.getContentBounds().height,
      pluginBounds: pluginView?.getBounds() || null
    }
  })
}

/**
 * 读取当前分离窗口及其插件 WebContentsView 的布局快照。
 * @param electronApp 当前隔离 Electron 应用实例。
 * @returns 分离窗口高度和插件视图边界；窗口尚未创建时返回 null。
 */
async function readDetachedWindowLayout(
  electronApp: ElectronApplication
): Promise<DetachedWindowLayoutSnapshot | null> {
  return await electronApp.evaluate(({ BrowserWindow }) => {
    const detachedWindow = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('detached-titlebar.html')
    )
    if (!detachedWindow) return null

    const pluginView = detachedWindow.contentView.children[0]
    return {
      windowHeight: detachedWindow.getContentBounds().height,
      minimumHeight: detachedWindow.getMinimumSize()[1],
      pluginBounds: pluginView?.getBounds() || null
    }
  })
}

test('紧凑顶部栏同时作用于搜索页和插件页并可持久化', async ({
  browserName: _browserName
}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-compact-header-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const settingsScreenshotPath = testInfo.outputPath('compact-header-setting.png')
  const pluginHeaderScreenshotPath = testInfo.outputPath('compact-header-plugin.png')
  const detachedHeaderScreenshotPath = testInfo.outputPath('compact-header-detached.png')
  const searchScreenshotPath = testInfo.outputPath('compact-header-search.png')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    let page = await electronApp.firstWindow()
    const searchBox = page.locator('.search-box')
    const searchInput = page.locator('.search-input')

    // 首次启动应保持标准顶部栏，避免改变历史用户默认布局。
    await expect(searchInput).toBeVisible()
    await expect(searchBox).toHaveCSS('height', '58px')

    // 进入通用设置并等待正文稳定内容出现。
    await searchInput.fill('通用设置')
    const settingsResult = page
      .locator('.app-item, .list-item')
      .filter({ hasText: '通用设置' })
      .first()
    await expect(settingsResult).toBeVisible()
    await settingsResult.click()
    await expect
      .poll(() => readSettingsText(electronApp!), { timeout: 15_000 })
      .toContain('紧凑顶部栏')

    const standardLayout = await readMainWindowLayout(electronApp)
    expect(standardLayout.pluginBounds?.y).toBe(58)

    // 通过真实设置控件切换，确保 Vue 保存和内部 IPC 链路同时生效。
    const checked = await executeInSettings(
      electronApp,
      `(() => {
        const item = Array.from(document.querySelectorAll('.setting-item'))
          .find((element) => element.textContent?.includes('紧凑顶部栏'))
        const input = item?.querySelector('input[type="checkbox"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('未找到紧凑顶部栏开关')
        input.click()
        return input.checked
      })()`
    )
    expect(checked).toBe(true)

    await expect(searchBox).toHaveCSS('height', '44px')
    const pluginTag = page.locator('.plugin-tag')
    await expect(pluginTag).toHaveCSS('height', '32px')
    const compactHeaderSpacing = await page.evaluate(() => {
      const header = document.querySelector('.search-box')
      const tag = document.querySelector('.plugin-tag')
      const avatar = document.querySelector('.avatar-container')
      if (
        !(header instanceof HTMLElement) ||
        !(tag instanceof HTMLElement) ||
        !(avatar instanceof HTMLElement)
      ) {
        throw new Error('未找到主窗口顶部栏、插件胶囊或头像')
      }

      // 使用实际渲染边界验证胶囊在紧凑顶部栏中垂直居中。
      const headerRect = header.getBoundingClientRect()
      const tagRect = tag.getBoundingClientRect()
      const avatarRect = avatar.getBoundingClientRect()
      return {
        left: tagRect.left - headerRect.left,
        right: headerRect.right - avatarRect.right,
        top: tagRect.top - headerRect.top,
        bottom: headerRect.bottom - tagRect.bottom
      }
    })
    expect(compactHeaderSpacing.left).toBe(8)
    expect(compactHeaderSpacing.right).toBe(8)
    expect(compactHeaderSpacing.top).toBe(6)
    expect(compactHeaderSpacing.bottom).toBe(6)
    const pluginHeaderScreenshot = await page.screenshot({
      path: pluginHeaderScreenshotPath,
      clip: { x: 0, y: 0, width: 800, height: 44 }
    })
    await testInfo.attach('compact-header-plugin', {
      body: pluginHeaderScreenshot,
      contentType: 'image/png'
    })
    await expect
      .poll(() => readMainWindowLayout(electronApp!))
      .toEqual({
        windowHeight: standardLayout.windowHeight - 14,
        pluginBounds: {
          ...standardLayout.pluginBounds!,
          y: 44
        }
      })
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `window.ztools.internal.dbGet('settings-general')
            .then((settings) => settings?.compactMainWindowHeader)`
        )
      )
      .toBe(true)

    await executeInSettings(
      electronApp,
      `(async () => {
        const item = Array.from(document.querySelectorAll('.setting-item'))
          .find((element) => element.textContent?.includes('紧凑顶部栏'))
        if (!(item instanceof HTMLElement)) throw new Error('未找到紧凑顶部栏设置项')
        const panel = item.closest('.content-panel')
        if (!(panel instanceof HTMLElement)) throw new Error('未找到通用设置滚动容器')
        const itemRect = item.getBoundingClientRect()
        const panelRect = panel.getBoundingClientRect()
        panel.scrollTop +=
          itemRect.top - panelRect.top - panel.clientHeight / 2 + itemRect.height / 2
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        await new Promise((resolve) => setTimeout(resolve, 350))
      })()`
    )

    // 设置插件截图只截取当前可见 WebContentsView，验证控件已完成绘制。
    const settingsPluginBase64 = await electronApp.evaluate(
      async ({ webContents }, urlFragments) => {
        const settingsContents = webContents
          .getAllWebContents()
          .find((contents) => urlFragments.some((fragment) => contents.getURL().includes(fragment)))
        if (!settingsContents) throw new Error('未找到内置设置插件 WebContentsView')
        return (await settingsContents.capturePage()).toPNG().toString('base64')
      },
      settingsUrlFragments
    )
    const settingsScreenshot = Buffer.from(settingsPluginBase64, 'base64')
    expect(settingsScreenshot.byteLength).toBeGreaterThan(5_000)
    await fs.writeFile(settingsScreenshotPath, settingsScreenshot)
    await testInfo.attach('compact-header-setting', {
      body: settingsScreenshot,
      contentType: 'image/png'
    })

    // 返回主搜索页后仍应保持紧凑布局。
    await page.locator('.plugin-tag-close').click()
    await expect(searchInput).toBeVisible()
    await expect(searchBox).toHaveCSS('height', '44px')
    await expect(searchInput).toHaveCSS('height', '38px')
    const searchScreenshot = await page.screenshot({ path: searchScreenshotPath })
    await testInfo.attach('compact-header-search', {
      body: searchScreenshot,
      contentType: 'image/png'
    })

    // 再次进入设置并分离，验证新窗口直接使用紧凑标题栏。
    await searchInput.fill('通用设置')
    const detachedSettingsResult = page
      .locator('.app-item, .list-item')
      .filter({ hasText: '通用设置' })
      .first()
    await expect(detachedSettingsResult).toBeVisible()
    await detachedSettingsResult.click()
    await expect
      .poll(() => readSettingsText(electronApp!), { timeout: 15_000 })
      .toContain('紧凑顶部栏')
    expect(await page.evaluate(() => window.ztools.detachPlugin())).toMatchObject({
      success: true
    })
    await expect
      .poll(() =>
        electronApp!
          .windows()
          .some((candidate) => candidate.url().includes('detached-titlebar.html'))
      )
      .toBe(true)
    const detachedPage = electronApp
      .windows()
      .find((candidate) => candidate.url().includes('detached-titlebar.html'))
    expect(detachedPage).toBeDefined()
    const detachedTitlebar = detachedPage!.locator('.titlebar')
    await expect(detachedTitlebar).toHaveCSS('height', '40px')
    await expect(detachedPage!.locator('.logo-container')).toHaveCSS('height', '30px')
    const compactDetachedLayout = await readDetachedWindowLayout(electronApp)
    expect(compactDetachedLayout?.minimumHeight).toBe(40)
    expect(compactDetachedLayout?.pluginBounds?.y).toBe(40)

    const detachedHeaderScreenshot = await detachedPage!.screenshot({
      path: detachedHeaderScreenshotPath,
      clip: { x: 0, y: 0, width: 800, height: 40 }
    })
    await testInfo.attach('compact-header-detached', {
      body: detachedHeaderScreenshot,
      contentType: 'image/png'
    })

    // 运行时来回切换时只改变标题栏和窗口总高度，插件正文高度保持不变。
    expect(
      await executeInSettings(
        electronApp,
        'window.ztools.internal.setCompactMainWindowHeader(false)'
      )
    ).toMatchObject({ success: true })
    await expect(detachedTitlebar).toHaveCSS('height', '52px')
    await expect
      .poll(() => readDetachedWindowLayout(electronApp!))
      .toEqual({
        windowHeight: compactDetachedLayout!.windowHeight + 12,
        minimumHeight: 52,
        pluginBounds: {
          ...compactDetachedLayout!.pluginBounds!,
          y: 52
        }
      })
    expect(
      await executeInSettings(
        electronApp,
        'window.ztools.internal.setCompactMainWindowHeader(true)'
      )
    ).toMatchObject({ success: true })
    await expect(detachedTitlebar).toHaveCSS('height', '40px')
    await expect.poll(() => readDetachedWindowLayout(electronApp!)).toEqual(compactDetachedLayout)

    // 使用同一隔离数据目录重启，验证创建窗口时直接恢复紧凑高度。
    await electronApp.close()
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    page = await electronApp.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    await expect(page.locator('.search-box')).toHaveCSS('height', '44px')
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
