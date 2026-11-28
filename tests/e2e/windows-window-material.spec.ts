import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('Windows 主窗口、分离标题栏及插件页面使用实际宿主材质', async () => {
  test.skip(process.platform !== 'win32', 'Windows 专属材质')
  const windowsBuild = Number(os.release().split('.')[2])
  const expectedMaterial = windowsBuild >= 22000 ? 'acrylic' : 'none'
  const transparent = 'rgba(0, 0, 0, 0)'
  const solid = /^rgb\((244, 244, 244|48, 49, 51)\)$/
  const root = path.resolve(__dirname, '../..')
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-win-material-'))
  const legacy = path.join(data, 'legacy')
  const settingsUrl = 'http://127.0.0.1:15177'
  let instance: ElectronApplication | undefined
  try {
    // 启动源码项目和真实设置视图，使用隔离的宿主与旧数据目录。
    await fs.mkdir(legacy)
    const app = await electron.launch({
      args: [root],
      cwd: root,
      env: {
        ...process.env,
        ZTOOLS_E2E: '1',
        ZTOOLS_DATA_ROOT: data,
        ZTOOLS_LEGACY_USER_DATA_PATH: legacy,
        ZTOOLS_SETTING_DEV_SERVER_URL: settingsUrl
      }
    })
    instance = app

    /**
     * 从设置 WebContentsView 读取实际样式和两个材质查询结果。
     * @param simulateAcrylic 仅模拟页面样式分支，不请求系统材质。
     * @returns 设置正文加载后返回实际宿主状态和计算样式，尚未就绪时返回 undefined。
     */
    const readSettingsMaterial = (simulateAcrylic = false) =>
      app.evaluate(
        async ({ webContents }, { url, simulate }) => {
          const view = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(url))
          return view?.executeJavaScript(`(async () => {
          if (!document.body?.innerText.includes('开机自动启动')) return undefined
          const dataset = document.documentElement.dataset
          const material = dataset.material
          const panel = document.querySelector('.content-panel')
          const internal = await window.ztools.internal.getWindowMaterial()
          if (${simulate}) dataset.material = 'acrylic'
          const background = getComputedStyle(document.body).backgroundColor
          const panelBackground = getComputedStyle(panel).backgroundColor
          if (${simulate}) dataset.material = material
          return {
            material,
            internal,
            theme: window.ztools.getThemeInfo().windowMaterial,
            showWindowOpacity: getComputedStyle(document.querySelector('.window-opacity-setting')).display !== 'none',
            background,
            panelBackground
          }
        })()`)
        },
        { url: settingsUrl, simulate: simulateAcrylic }
      )

    const expectedBackground =
      expectedMaterial === 'acrylic' ? transparent : expect.stringMatching(solid)
    const expectedSettings = {
      material: expectedMaterial,
      internal: expectedMaterial,
      theme: expectedMaterial,
      showWindowOpacity: expectedMaterial !== 'acrylic',
      background: expectedBackground,
      panelBackground: expectedBackground
    }

    const page = await app.firstWindow()
    const mainRoot = page.locator('html')
    await expect(mainRoot).toHaveAttribute('data-material', expectedMaterial)
    if (expectedMaterial === 'acrylic') {
      // 关闭 Playwright 默认浅色模拟，检查 Electron 真实传给页面的主题。
      await page.emulateMedia({ colorScheme: null })
      // 检查真实搜索文档的亮暗叠色，确保不再用额外的伪元素绘制。
      await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = 'light'
      })
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(245, 245, 247, 0.72)')
      await expect(page.locator('body')).toHaveCSS('opacity', '1')
      await expect(page.locator('#acrylic-overlay-style')).toHaveCount(0)
      await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = 'dark'
      })
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(22, 22, 22, 0.72)')
      await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = 'system'
      })
    }

    const searchInput = page.locator('.search-input')
    const settingsResult = page
      .locator('.app-item,.list-item')
      .filter({ hasText: '通用设置' })
      .first()
    if (windowsBuild >= 22621) {
      const mainWindow = await app.browserWindow(page)
      const header = page.locator('.search-box')
      /**
       * 读取窗口边界、渲染视口和顶部栏内容边界，避免仅检查 DOM 元素是否存在。
       * @returns 主窗口当前的位置和尺寸，以及顶部栏是否能完整显示所需的高度。
       */
      const readGeometry = async () => ({
        bounds: await mainWindow.evaluate((host) => host.getBounds()),
        viewportHeight: await page.evaluate(() => innerHeight),
        headerBottom: await header.evaluate((element) => element.getBoundingClientRect().bottom)
      })

      await expect(searchInput).toBeVisible()
      await expect(header).toHaveCSS('height', '58px')
      // 分数 DPI 下，Electron 将物理像素换算成 DIP 时可能出现微小的边界舍入。
      const rounding = (await page.evaluate(() => Number.isInteger(devicePixelRatio))) ? 0 : 2
      const initial = await readGeometry()
      expect(initial.viewportHeight).toBeGreaterThanOrEqual(initial.headerBottom)
      expect(initial.bounds.height).toBeGreaterThanOrEqual(initial.headerBottom)

      // 使用搜索栏现有的拖拽交互，并确认每次都实际移动了原生窗口。
      let previous = initial.bounds
      for (let i = 0; i < 6; i++) {
        const direction = i % 2 === 0 ? 1 : -1
        await page.mouse.move(510, 11)
        await page.mouse.down()
        // 等待拖拽处理器异步读取起始位置并锁定尺寸。
        await page.evaluate(() => window.ztools.getWindowPosition())
        await page.mouse.move(510 + 32 * direction, 11 + 8 * direction, { steps: 8 })
        await page.mouse.up()
        await expect.poll(async () => (await readGeometry()).bounds.x).not.toBe(previous.x)
        const current = await readGeometry()
        expect(Math.abs(current.bounds.width - initial.bounds.width)).toBeLessThanOrEqual(rounding)
        expect(Math.abs(current.bounds.height - initial.bounds.height)).toBeLessThanOrEqual(
          rounding
        )
        expect(Math.abs(current.viewportHeight - initial.viewportHeight)).toBeLessThanOrEqual(
          rounding
        )
        expect(current.viewportHeight).toBeGreaterThanOrEqual(current.headerBottom)
        previous = current.bounds
      }
      await expect(mainRoot).toHaveAttribute('data-material', 'acrylic')

      // 用户不能拉伸窗口，但应用仍应按搜索结果自动展开和收起。
      await searchInput.fill('通用设置')
      await expect(settingsResult).toBeVisible()
      await expect
        .poll(async () => (await readGeometry()).viewportHeight)
        .toBeGreaterThan(initial.viewportHeight)
      await searchInput.clear()
      await expect(settingsResult).toHaveCount(0)
      await expect
        .poll(async () => (await readGeometry()).viewportHeight)
        .toBeLessThanOrEqual(initial.viewportHeight)
      const collapsed = await readGeometry()
      expect(collapsed.viewportHeight).toBeGreaterThanOrEqual(collapsed.headerBottom)
    }

    await searchInput.fill('通用设置')
    await settingsResult.click()
    await expect.poll(readSettingsMaterial).toEqual(expectedSettings)

    // 分离时沿用插件页面，查询和样式须一起切换到新宿主。
    const [detached] = await Promise.all([
      app.waitForEvent('window'),
      page.evaluate(() => window.ztools.detachPlugin())
    ])
    const detachedRoot = detached.locator('html')
    await expect(detachedRoot).toHaveAttribute('data-material', expectedMaterial)
    const acrylicTint = /^rgba\((245, 245, 247|22, 22, 22), 0\.72\)$/
    await expect(detached.locator('body')).toHaveCSS(
      'background-color',
      expectedMaterial === 'acrylic' ? acrylicTint : solid
    )
    await expect.poll(readSettingsMaterial).toEqual(expectedSettings)

    if (expectedMaterial === 'none') {
      // 旧系统不走原生 Accent，但仍可校验透明样式没有被正文容器覆盖。
      expect(await readSettingsMaterial(true)).toMatchObject({
        material: 'none',
        background: transparent,
        panelBackground: transparent
      })
    }
  } finally {
    // 仅清理本用例创建的临时目录。
    await instance?.close()
    await fs.rm(data, { recursive: true, force: true })
  }
})
