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

const projectRoot = path.resolve(__dirname, '../..')

/**
 * 等待主窗口完成原生隐藏，避免测试在系统可见状态尚未同步时马上重新显示。
 * @param electronApp 隔离的 ZTools Electron 实例。
 * @returns 隐藏事件完成后结束的 Promise。
 */
async function hidePanel(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(async ({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((win) => win.getSize()[0] > 1)!
    await new Promise<void>((resolve) => {
      main.once('hide', () => resolve())
      main.hide()
    })
  })
}

/**
 * 经由真实应用的二次启动入口唤出主窗口，检查本次新建的锚点在正式显示后解除挂接并释放。
 * @param electronApp 隔离的 ZTools Electron 实例。
 * @param page 主窗口渲染页面，用于等待本次唤出的焦点消息处理完成。
 * @returns 检查完成后结束的 Promise。
 */
async function summonIndependentPanel(electronApp: ElectronApplication, page: Page): Promise<void> {
  const previousFocusCount = await page.evaluate(() => (window as any).__macSpaceFocusCount)
  // 监听创建事件以取得本次锚点，避免在它延迟销毁时采样漏掉或误认上一轮窗口。
  const anchor = await electronApp.evaluate(({ app }) => {
    const created = new Promise<{ id: number; size: number[] }>((resolve) => {
      app.once('browser-window-created', (_event, win) => {
        resolve({ id: win.id, size: win.getSize() })
      })
    })
    app.emit('second-instance', {}, [])
    return created
  })
  expect(anchor.size).toEqual([1, 1])
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((win) => win.getSize()[0] > 1)
        return (
          main && {
            visible: main.isVisible(),
            focused: main.isFocused(),
            parentId: main.getParentWindow()?.id ?? null,
            opacity: main.getOpacity()
          }
        )
      })
    )
    .toEqual({ visible: true, focused: true, parentId: null, opacity: 1 })
  // 主进程可见状态先于渲染进程的清空搜索与聚焦消息，等待本次消息后再输入。
  await expect
    .poll(() => page.evaluate(() => (window as any).__macSpaceFocusCount))
    .toBeGreaterThan(previousFocusCount)
  await expect(page.locator('.search-input')).toBeFocused()
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id) === null, anchor.id)
    )
    .toBe(true)
}

test('macOS 全屏迁移后保持独立窗口显示与输入焦点', async () => {
  test.skip(process.platform !== 'darwin', '仅验证 macOS Space 与子窗口行为')
  test.setTimeout(60_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-mac-space-'))
  let electronApp: ElectronApplication | null = null
  let fullscreenApp: ElectronApplication | null = null

  try {
    // 测试宿主和全屏前台应用都只使用本次创建的数据目录。
    const legacyRoot = path.join(dataRoot, 'legacy')
    await fs.mkdir(legacyRoot, { recursive: true })
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
    await expect(page.locator('.search-input')).toBeVisible()
    await page.evaluate(() => {
      ;(window as any).__macSpaceFocusCount = 0
      ;(window as any).ztools.onFocusSearch(() => {
        ;(window as any).__macSpaceFocusCount++
      })
    })

    // 首次普通桌面唤出也必须保持独立窗口。
    await hidePanel(electronApp)
    await summonIndependentPanel(electronApp, page)
    await hidePanel(electronApp)

    const fixturePath = path.join(dataRoot, 'fullscreen-fixture.cjs')
    await fs.writeFile(
      fixturePath,
      `const { app, BrowserWindow } = require('electron')
app.setPath('userData', ${JSON.stringify(path.join(dataRoot, 'fixture-data'))})
app.whenReady().then(() => {
  const win = new BrowserWindow({ title: 'ZTools Fullscreen Fixture', width: 900, height: 600 })
  win.loadURL('data:text/html,<body style="background: navy; color: white">Fullscreen Space fixture</body>')
})
`
    )
    fullscreenApp = await electron.launch({ args: [fixturePath], cwd: projectRoot })
    await fullscreenApp.firstWindow()

    // 连续进入和退出两个全屏 Space，覆盖重复唤出及返回桌面后的输入焦点。
    for (let cycle = 0; cycle < 2; cycle++) {
      await fullscreenApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.show()
        win.focus()
        await new Promise<void>((resolve) => {
          win.once('enter-full-screen', () => resolve())
          win.setFullScreen(true)
        })
      })

      await summonIndependentPanel(electronApp, page)
      // 在同一个全屏 Space 内再次唤出，验证每轮独立完成迁移。
      await hidePanel(electronApp)
      await summonIndependentPanel(electronApp, page)
      await page.locator('.search-input').fill(`全屏 Space ${cycle + 1}`)
      await expect(page.locator('.search-input')).toHaveValue(`全屏 Space ${cycle + 1}`)

      await hidePanel(electronApp)
      await fullscreenApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        await new Promise<void>((resolve) => {
          win.once('leave-full-screen', () => resolve())
          win.setFullScreen(false)
        })
        win.focus()
      })
      await summonIndependentPanel(electronApp, page)
      await hidePanel(electronApp)
    }
  } finally {
    // 退出测试全屏应用，恢复桌面并清理本次隔离实例和目录。
    await fullscreenApp?.close()
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
