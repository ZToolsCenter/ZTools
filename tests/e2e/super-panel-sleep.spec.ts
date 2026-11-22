import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('超级面板按共用的隐藏期限独立回收，重新触发后可执行固定指令', async () => {
  test.skip(process.platform !== 'darwin' && process.platform !== 'win32', '需要原生鼠标监听入口')
  test.setTimeout(45000)
  const root = path.resolve(__dirname, '../..')
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-sleep-'))
  const legacy = path.join(data, 'legacy')
  const target = path.join(data, '面板测试.txt')
  let instance: ElectronApplication | undefined
  try {
    await fs.mkdir(legacy)
    await fs.writeFile(target, '')
    instance = await electron.launch({
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
    const app = instance
    const main = await app.firstWindow()
    await expect(main.locator('.search-input')).toBeVisible()
    // 截取隔离实例注册的鼠标回调，避免模拟全局按键、访问用户选区或打开文件。
    await app.evaluate(({ shell }, root) => {
      const platform = process.platform === 'darwin' ? 'mac' : 'win'
      const load = process.getBuiltinModule('node:module')!.createRequire(root + '/package.json')
      const native = load(root + '/resources/lib/' + platform + '/ztools_native.node')
      native.startMouseMonitor = (_button: string, _time: number, trigger: () => void) => {
        ;(globalThis as any).__triggerPanel = trigger
      }
      native.simulateKeyboardTap = () => true
      native.getActiveWindow = () => null
      shell.openPath = async (file) => {
        ;(globalThis as any).__openedFromPanel = file
        return ''
      }
    }, root)
    await main.evaluate(async (target) => {
      await window.ztools.dbPut('settings-general', { mainWindowSleepSeconds: 1 })
      await window.ztools.dbPut('local-shortcuts', [
        { name: '面板测试', path: target, type: 'file' }
      ])
      const command = (await window.ztools.commands.getCatalog()).find(
        (item) => item.path === target
      )!
      await window.ztools.pinToSuperPanel(command)
    }, target)
    await main.locator('.search-input').fill('通用设置')
    await main.locator('.app-item,.list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() =>
        app.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((w) => w.getURL().startsWith('http://127.0.0.1:15177'))
        )
      )
      .toBe(true)
    await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith('http://127.0.0.1:15177'))!
        .executeJavaScript(
          "window.ztools.internal.updateSuperPanelConfig({enabled:true, mouseButton:'middle', longPressMs:500})"
        )
    )
    await main.locator('.plugin-tag-close').click()

    /**
     * 通过正常的鼠标触发链取得面板，等待固定指令确实交付。
     * @returns 当前可见并已完成渲染的面板页面。
     */
    async function openPanel() {
      await app.evaluate(() => (globalThis as any).__triggerPanel())
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some(
              (w) => w.webContents.getURL().endsWith('/super-panel.html') && w.isVisible()
            )
          )
        )
        .toBe(true)
      const panel = app.windows().find((p) => p.url().endsWith('/super-panel.html'))!
      await expect(panel.locator('.grid-item').filter({ hasText: '面板测试' })).toBeVisible()
      return panel
    }

    const first = await openPanel()
    const original = await app.browserWindow(first)
    const pid = await original.evaluate((w) => w.webContents.getOSProcessId())
    await original.evaluate((w) => w.hide())
    await new Promise((resolve) => setTimeout(resolve, 1250))
    expect(first.isClosed()).toBe(false)

    // 已隐藏的面板按新设置调整期限：长延时保留窗口，缩短后回收旧进程。
    await app.evaluate(({ app }) => app.emit('second-instance', {}, [], '', {}))
    /**
     * 写入通用设置，触发两个窗口的设备配置监听。
     * @param seconds 隐藏后的等待秒数。
     * @returns 配置保存完成后结束的 Promise。
     */
    async function enableSleep(seconds: number): Promise<void> {
      await main.evaluate(async (seconds) => {
        const settings = await window.ztools.dbGet('settings-general')
        await window.ztools.dbPut('settings-general', {
          ...settings,
          mainWindowSleepEnabled: true,
          mainWindowSleepSeconds: seconds
        })
      }, seconds)
    }
    await enableSleep(60)
    await new Promise((resolve) => setTimeout(resolve, 1250))
    expect(first.isClosed()).toBe(false)
    await enableSleep(1)
    await expect
      .poll(() =>
        app.evaluate(({ app }, pid) => app.getAppMetrics().some((p) => p.pid === pid), pid)
      )
      .toBe(false)
    expect(first.isClosed()).toBe(true)

    const second = await openPanel()
    const current = await app.browserWindow(second)
    await current.evaluate((w) => w.hide())
    expect(await openPanel()).toBe(second)
    // 搜索主窗口可独立休眠，已重新显示的面板仍接收操作。
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/index.html'))
        ?.hide()
    })
    await expect.poll(() => main.isClosed()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 1250))
    expect(await current.evaluate((w) => w.isVisible())).toBe(true)
    await second.locator('.grid-item').filter({ hasText: '面板测试' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__openedFromPanel)).toBe(target)
    await expect.poll(() => second.isClosed()).toBe(true)
    const third = await openPanel()
    expect(third).not.toBe(second)
  } finally {
    await instance?.close()
    await fs.rm(data, { recursive: true, force: true })
  }
})
