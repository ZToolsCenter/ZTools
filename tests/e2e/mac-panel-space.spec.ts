import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

/**
 * 经由现有 IPC 唤起主窗口并读取真实 Electron 窗口状态。
 * @param application 当前使用隔离数据目录的 Electron 实例。
 * @returns 主窗口可见性、透明度和父子关系。
 */
async function summonMainWindow(application: ElectronApplication): Promise<{
  visible: boolean
  opacity: number
  parentId: number | null
}> {
  return await application.evaluate(({ BrowserWindow, ipcMain }) => {
    const main = BrowserWindow.getAllWindows().find(
      (win) => win.getTitle() === 'ZTools' && win.getBounds().width > 1
    )
    if (!main) throw new Error('未找到主窗口')
    // 通过产品现有入口测试隐藏后唤起，避免绕开 WindowManager 的迁移流程。
    main.hide()
    ipcMain.emit('super-panel:show-main-window', { sender: main.webContents })
    return {
      visible: main.isVisible(),
      opacity: main.getOpacity(),
      parentId: main.getParentWindow()?.id ?? null
    }
  })
}

/**
 * 经由拖动窗口使用的入口设置记忆位置，固定本用例的目标显示器。
 * @param application 当前使用隔离数据目录的 Electron 实例。
 * @returns 主窗口应保持的坐标。
 */
async function setRememberedPosition(application: ElectronApplication): Promise<number[]> {
  return await application.evaluate(({ BrowserWindow, ipcMain, screen }) => {
    const main = BrowserWindow.getAllWindows().find(
      (win) => win.getTitle() === 'ZTools' && win.getBounds().width > 1
    )!
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea
    // 固定定位所读的光标坐标，无需移动系统光标，也不影响其它应用。
    screen.getCursorScreenPoint = () => ({
      x: x + Math.floor(width / 2),
      y: y + Math.floor(height / 2)
    })
    const targetX = x + Math.max(0, Math.floor((width - main.getBounds().width) / 2))
    const targetY = y + Math.floor(height / 4)
    ipcMain.emit('set-window-position', { sender: main.webContents }, targetX, targetY)
    return [targetX, targetY]
  })
}

/**
 * 等待透明锚点释放后读取主窗口位置，覆盖正式显示后才发生的原生偏移。
 * @param application 当前使用隔离数据目录的 Electron 实例。
 * @returns 没有锚点残留时的主窗口坐标。
 */
async function readPositionAfterAnchorRelease(application: ElectronApplication): Promise<number[]> {
  let position: number[] = []
  await expect
    .poll(async () => {
      const { anchors, mainPosition } = await application.evaluate(({ BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows()
        const anchors = windows.filter((win) => {
          const [width, height] = win.getSize()
          return width === 1 && height === 1
        }).length
        const main = windows.find(
          (win) => win.getTitle() === 'ZTools' && win.getBounds().width > 1
        )!
        return { anchors, mainPosition: main.getPosition() }
      })
      position = mainPosition
      return anchors
    })
    .toBe(0)
  return position
}

/**
 * 启动独立前台应用，模拟用户在其它应用的全屏 Space 呼出 ZTools。
 * @param dataRoot 本用例的临时数据目录。
 * @returns 前台测试应用。
 * @throws 写入测试入口或启动 Electron 失败时抛出原始错误。
 */
async function launchFullscreenFixture(dataRoot: string): Promise<ElectronApplication> {
  const scriptPath = path.join(dataRoot, 'space-fixture.cjs')
  // 前台应用也使用隔离目录，不与宿主共享应用状态。
  await fs.writeFile(
    scriptPath,
    `
    const { app, BrowserWindow } = require('electron')
    app.setPath('userData', ${JSON.stringify(path.join(dataRoot, 'fixture-data'))})
    app.whenReady().then(() => {
      const win = new BrowserWindow({ width: 700, height: 500 })
      win.loadURL('data:text/html,<h1>Space regression fixture</h1>')
    })
  `
  )
  return await electron.launch({ args: [scriptPath], cwd: projectRoot })
}

/**
 * 等待前台应用完成原生全屏切换。
 * @param fixture 本用例的独立前台应用。
 * @param fullscreen 是否进入全屏 Space。
 * @returns 全屏切换完成后结束的 Promise。
 */
async function setFixtureFullscreen(
  fixture: ElectronApplication,
  fullscreen: boolean
): Promise<void> {
  await fixture.evaluate(async ({ BrowserWindow }, enabled) => {
    const win = BrowserWindow.getAllWindows()[0]
    // 进入全屏前让测试应用位于前台，复现真实应用间切换。
    if (enabled) {
      win.show()
      win.focus()
    }
    await new Promise<void>((resolve) => {
      win.once(enabled ? 'enter-full-screen' : 'leave-full-screen', () => resolve())
      win.setFullScreen(enabled)
    })
  }, fullscreen)
}

test('macOS 反复唤起后主窗口位置稳定、仍可输入且不遗留 Space 锚点', async ({
  browserName: _browserName
}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'macOS Space 回归验证')
  test.setTimeout(60_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-mac-space-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let application: ElectronApplication | undefined
  let fixture: ElectronApplication | undefined

  try {
    // 仅启动源码 Electron，数据与旧数据均隔离，不使用真实 ~/.ztools。
    await fs.mkdir(legacyRoot, { recursive: true })
    application = await electron.launch({
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
    const page = await application.firstWindow()
    const input = page.locator('.search-input')
    await expect(input).toBeVisible()

    const rememberedPosition = await setRememberedPosition(application)
    // 等待拖动位置的防抖保存，覆盖偏移被记忆并带入下一次唤起的路径。
    await page.waitForTimeout(550)
    for (let cycle = 0; cycle < 5; cycle++) {
      // 验证系统层可见性、窗口清理和真实键盘输入，不能只检查宿主 DOM。
      expect(await summonMainWindow(application)).toEqual({
        visible: true,
        opacity: 1,
        parentId: null
      })
      await expect(input).toBeFocused()
      // 等原生动画和防抖保存收尾，避免只看见 show() 同步返回时的正确坐标。
      await page.waitForTimeout(550)
      expect(await readPositionAfterAnchorRelease(application)).toEqual(rememberedPosition)
      await input.fill('')
      await input.press('x')
      await expect(input).toHaveValue('x')
    }

    fixture = await launchFullscreenFixture(dataRoot)
    await fixture.firstWindow()
    for (let cycle = 0; cycle < 2; cycle++) {
      // 每次退出后重新创建全屏 Space，覆盖旧 Space 已失效的场景。
      await setFixtureFullscreen(fixture, true)
      expect(await summonMainWindow(application)).toEqual({
        visible: true,
        opacity: 1,
        parentId: null
      })
      expect(
        await fixture.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isFullScreen()
        )
      ).toBe(true)
      await expect(input).toBeFocused()
      // 全屏 Space 激活动画完成后再输入，避免异步 focus-search 清空测试刚填入的值。
      await page.waitForTimeout(350)
      await readPositionAfterAnchorRelease(application)
      await input.fill('fullscreen')
      await expect(input).toHaveValue('fullscreen')
      await setFixtureFullscreen(fixture, false)
    }

    // 等待正文搜索结果稳定后截取可见区域。
    await input.fill('通用设置')
    await expect(
      page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first()
    ).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('mac-space-search.png') })
  } finally {
    // 关闭测试窗口并清理本用例创建的数据目录。
    await fixture?.close()
    await application?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
