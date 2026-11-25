import { expect, test, _electron as electron } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const settingsUrl = 'http://127.0.0.1:15177'

test('macOS 的 ⌘Q 隐藏窗口或结束插件，系统退出请求正常结束进程', async () => {
  test.skip(process.platform !== 'darwin', '仅验证 macOS 的菜单快捷键和原生退出')
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-mac-quit-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let child: ChildProcess | undefined

  try {
    await fs.mkdir(legacyRoot)
    const electronApp = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...process.env,
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_SETTING_DEV_SERVER_URL: settingsUrl
      }
    })
    child = electronApp.process()
    const page = await electronApp.firstWindow()
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()

    // 默认菜单仍保留退出项，⌘Q 由搜索窗口或插件接收。
    const quitAccelerator = await electronApp.evaluate(({ Menu }) => {
      return Menu.getApplicationMenu()?.items[0]?.submenu?.items.find(
        (item) => item.role === 'quit'
      )?.accelerator
    })
    expect(quitAccelerator).toBe('')
    const mainWindow = await electronApp.browserWindow(page)

    // 等待插件正文就绪，再向它自己的 WebContents 发送 ⌘Q。
    await searchInput.fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect(page.locator('.plugin-tag')).toBeVisible()
    await expect
      .poll(() =>
        electronApp.evaluate(async ({ webContents }, url) => {
          const plugin = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith(url))
          if (!plugin || plugin.isLoading()) return ''
          return await plugin.executeJavaScript('document.body?.innerText || ""')
        }, settingsUrl)
      )
      .toContain('插件内 ESC 直接隐藏')
    await electronApp.evaluate(({ webContents }, url) => {
      const plugin = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith(url))
      if (!plugin) throw new Error('未找到设置插件视图')
      plugin.sendInputEvent({ type: 'keyDown', keyCode: 'Q', modifiers: ['meta'] })
    }, settingsUrl)
    await expect(page.locator('.plugin-tag')).toHaveCount(0)
    expect(await mainWindow.evaluate((window) => window.isVisible())).toBe(true)

    // 再按 ⌘Q 隐藏搜索窗口，覆盖应用留在后台时收到退出请求的场景。
    expect(
      await mainWindow.evaluate(async (window) => {
        const hidden = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('⌘Q 未隐藏主窗口')), 5_000)
          window.once('hide', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Q', modifiers: ['meta'] })
        await hidden
        return window.isVisible()
      })
    ).toBe(false)

    // 通过 AppKit 的 terminate: 退出隔离实例并检查退出码。
    await electronApp.evaluate(({ Menu }) => {
      // 恢复主窗口在正常模式下的关闭拦截，验证退出路径确实放行。
      delete process.env.ZTOOLS_E2E
      setImmediate(() => Menu.sendActionToFirstResponder('terminate:'))
    })
    await expect.poll(() => child?.exitCode).toBe(0)
    expect(child.signalCode).toBeNull()
  } finally {
    // 测试失败时只回收自己启动的隔离进程。
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
