import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('节省模式支持修改秒数、取消倒计时并重建可搜索的主窗口', async () => {
  test.setTimeout(60000)
  const root = path.resolve(__dirname, '../..')
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-window-sleep-'))
  const legacy = path.join(data, 'legacy')
  await fs.mkdir(legacy)
  const instance = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      ZTOOLS_E2E: '1',
      ZTOOLS_DATA_ROOT: data,
      ZTOOLS_LEGACY_USER_DATA_PATH: legacy,
      ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
    }
  })
  try {
    const page = await instance.firstWindow()
    const host = await instance.browserWindow(page)
    const oldPid = await host.evaluate((win) => win.webContents.getOSProcessId())
    const input = page.locator('.search-input')
    await input.fill('通用设置')
    await page.locator('.app-item,.list-item').filter({ hasText: '通用设置' }).first().click()
    /**
     * 在实际设置视图上操作表单，避免误用宿主页面。
     * @param source 设置页面中执行的脚本。
     * @returns 插件页面返回的值。
     */
    const settingsScript = (source: string) =>
      instance.evaluate(async ({ webContents }, script) => {
        const view = webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith('http://127.0.0.1:15177'))
        return view?.executeJavaScript(script)
      }, source)
    const toggle = 'document.querySelector(\'input[aria-label="隐藏主窗口后节省模式"]\')'
    const seconds = 'document.querySelector(\'input[aria-label="隐藏后等待时间"]\')'
    await expect.poll(() => settingsScript(toggle + '?.checked')).toBe(false)
    expect(await settingsScript('!!' + seconds)).toBe(false)
    await settingsScript(toggle + '.click()')
    await expect.poll(() => settingsScript(seconds + '?.value')).toBe('60')
    await settingsScript(
      `const field = ${seconds}; field.value = '1'; field.dispatchEvent(new Event('change', { bubbles: true }))`
    )
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.ztools.dbGet('settings-general')).mainWindowSleepSeconds
        )
      )
      .toBe(1)

    // 已挂载的插件即使宿主隐藏也应完整保留。
    await page.evaluate(() => window.ztools.hideWindow())
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(await host.evaluate((win) => win.isDestroyed())).toBe(false)
    await instance.evaluate(({ app }) => app.emit('second-instance', {}, [], '', {}))
    await page.locator('.plugin-tag-close').click()
    await expect(page.locator('.plugin-tag')).toHaveCount(0)
    await input.fill('')
    await page.evaluate(() => window.ztools.hideWindow())
    await instance.evaluate(({ app }) => app.emit('second-instance', {}, [], '', {}))
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(await host.evaluate((win) => win.isVisible())).toBe(true)

    // 重建应遵守「从不清空」，保留主界面原有搜索词。
    await page.evaluate(async () => {
      const saved = await window.ztools.dbGet('settings-general')
      await window.ztools.dbPut('settings-general', { ...saved, autoClear: 'never' })
    })
    await input.fill('快捷键')
    await page.locator('.app-item,.list-item').filter({ hasText: '快捷键' }).first().waitFor()
    // 在后台确认旧 PID 消失，避免只验证窗口被隐藏。
    await page.evaluate(() => window.ztools.hideWindow())
    await expect
      .poll(() =>
        instance.evaluate(({ app }, pid) => app.getAppMetrics().some((p) => p.pid === pid), oldPid)
      )
      .toBe(false)
    const hostUrl = page.url()
    await instance.evaluate(({ app }) => app.emit('second-instance', {}, [], '', {}))
    await expect.poll(() => instance.windows().some((p) => p.url() === hostUrl)).toBe(true)
    const next = instance.windows().find((p) => p.url() === hostUrl)!
    await expect(next.locator('.search-input')).toBeFocused()
    await expect(next.locator('.search-input')).toHaveValue('快捷键')
    await next.locator('.search-input').fill('通用设置')
    await next.locator('.app-item,.list-item').filter({ hasText: '通用设置' }).first().click()
    await expect(next.locator('.plugin-tag')).toBeVisible()
    // 缓存设置页必须能重新挂到新窗口。
    expect(
      await instance.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((win) => win.contentView.children.length > 0)
      )
    ).toBe(true)
    await expect.poll(() => settingsScript(toggle + '?.checked')).toBe(true)
    expect(await settingsScript(seconds + '.value')).toBe('1')
    await settingsScript(toggle + '.click()')
    await expect
      .poll(() =>
        next.evaluate(
          async () => (await window.ztools.dbGet('settings-general')).mainWindowSleepEnabled
        )
      )
      .toBe(false)
    await next.locator('.plugin-tag-close').click()
    await next.evaluate(() => window.ztools.hideWindow())
    // 关闭节省模式后，超过已保存的秒数也应保留同一窗口。
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(next.isClosed()).toBe(false)

    // 已过期限的隐藏窗口在插件退出时即可释放，无需再唤醒一次。
    await instance.evaluate(({ app }) => app.emit('second-instance', {}, [], '', {}))
    await next.locator('.search-input').fill('通用设置')
    await next.locator('.app-item,.list-item').filter({ hasText: '通用设置' }).first().click()
    await expect(next.locator('.plugin-tag')).toBeVisible()
    await settingsScript(toggle + '.click()')
    await next.evaluate(() => window.ztools.hideWindow())
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(next.isClosed()).toBe(false)
    await next.evaluate(() => window.ztools.hidePlugin())
    await expect.poll(() => next.isClosed()).toBe(true)
  } finally {
    await instance.close()
    await fs.rm(data, { recursive: true, force: true })
  }
})
