import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

/**
 * 经由现有 IPC 唤起主窗口并读取真实 Electron 窗口状态。
 * @param application 当前使用隔离数据目录的 Electron 实例。
 * @returns 主窗口可见性、透明度、父子关系及遗留锚点数量。
 */
async function summonMainWindow(application: ElectronApplication): Promise<{
  visible: boolean
  opacity: number
  parentId: number | null
  anchors: number
}> {
  return await application.evaluate(({ BrowserWindow, ipcMain }) => {
    const main = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'ZTools')
    if (!main) throw new Error('未找到主窗口')
    // 通过产品现有入口测试隐藏后唤起，避免绕开 WindowManager 的迁移流程。
    main.hide()
    ipcMain.emit('super-panel:show-main-window', { sender: main.webContents })
    return {
      visible: main.isVisible(),
      opacity: main.getOpacity(),
      parentId: main.getParentWindow()?.id ?? null,
      anchors: BrowserWindow.getAllWindows().filter((win) => {
        const bounds = win.getBounds()
        return bounds.width === 1 && bounds.height === 1
      }).length
    }
  })
}

/**
 * 创建测试实例自己的全屏窗口，以验证全屏 Space 的进入与销毁。
 * @param application 当前隔离 Electron 实例。
 * @returns 已进入全屏的测试窗口 ID。
 */
async function createFullscreenFixture(application: ElectronApplication): Promise<number> {
  return await application.evaluate(async ({ BrowserWindow }) => {
    // 仅操作本测试进程的窗口，不修改用户已有应用的全屏状态。
    const fixture = new BrowserWindow({
      title: 'Space regression fixture',
      width: 700,
      height: 500
    })
    await fixture.loadURL('data:text/html,<h1>Space regression fixture</h1>')
    // 全屏转换必须由当前测试窗口持有原生焦点，避免其它测试面板阻止转换。
    fixture.show()
    fixture.focus()
    await new Promise<void>((resolve) => {
      fixture.once('enter-full-screen', () => resolve())
      fixture.setFullScreen(true)
    })
    return fixture.id
  })
}

test('macOS 反复唤起后主窗口仍可输入且不遗留 Space 锚点', async ({
  browserName: _browserName
}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'macOS Space 回归验证')
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-mac-space-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let application: ElectronApplication | undefined

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

    for (let cycle = 0; cycle < 5; cycle++) {
      // 验证系统层可见性、窗口清理和真实键盘输入，不能只检查宿主 DOM。
      expect(await summonMainWindow(application)).toEqual({
        visible: true,
        opacity: 1,
        parentId: null,
        anchors: 0
      })
      await expect(input).toBeFocused()
      // macOS 原生 show/fullscreen 动画会迟到地再次发布 focus-search，先等待其清空动作收尾。
      await page.waitForTimeout(350)
      await input.fill('')
      await input.press('x')
      await expect(input).toHaveValue('x')
    }

    for (let cycle = 0; cycle < 2; cycle++) {
      // 全屏 Space 销毁后再次创建，覆盖长期使用后旧 Space 已失效的场景。
      const fixtureId = await createFullscreenFixture(application)
      await expect
        .poll(() =>
          application!.evaluate(({ BrowserWindow }, id) => {
            const fixture = BrowserWindow.fromId(id)
            return fixture?.isFullScreen() && fixture.isVisible()
          }, fixtureId)
        )
        .toBe(true)
      expect(await summonMainWindow(application)).toEqual({
        visible: true,
        opacity: 1,
        parentId: null,
        anchors: 0
      })
      // 面板唤起后全屏窗口仍可见，防止唤起过程把系统切回普通桌面。
      expect(
        await application.evaluate(
          ({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.isVisible(),
          fixtureId
        )
      ).toBe(true)
      await expect(input).toBeFocused()
      // 全屏 Space 激活动画完成后再输入，避免异步 focus-search 清空测试刚填入的值。
      await page.waitForTimeout(350)
      await input.fill('fullscreen')
      await expect(input).toHaveValue('fullscreen')
      await application.evaluate(async ({ BrowserWindow }, id) => {
        const fixture = BrowserWindow.fromId(id)!
        await new Promise<void>((resolve) => {
          fixture.once('leave-full-screen', () => resolve())
          fixture.setFullScreen(false)
        })
        fixture.destroy()
      }, fixtureId)
    }

    // 等待正文搜索结果稳定后截取可见区域。
    await input.fill('通用设置')
    await expect(
      page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first()
    ).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('mac-space-search.png') })
  } finally {
    // 关闭测试窗口并清理本用例创建的数据目录。
    await application?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
