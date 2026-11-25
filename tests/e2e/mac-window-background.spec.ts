import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('macOS 窗口 RGBA 背景色按主题实时应用、保存并恢复默认', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 专属设置')
  const root = path.resolve(__dirname, '../..')
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-mac-window-background-'))
  const legacy = path.join(data, 'legacy')
  let instance: ElectronApplication | undefined
  try {
    // 用独立设备数据库验证旧设置缺省时的行为，避免读取或修改真实配置。
    await fs.mkdir(legacy)
    const app = await electron.launch({
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
    instance = app
    const page = await app.firstWindow()
    const background = page.locator('html')

    /**
     * 在 Electron 的设置插件视图中读取或操作表单。
     * @param source 设置视图内执行的脚本。
     * @returns 设置视图的脚本执行结果。
     */
    const settingsScript = (source: string): Promise<unknown> =>
      app.evaluate(async ({ webContents }, script) => {
        const view = webContents.getAllWebContents().find((contents) => {
          return contents.getURL().startsWith('http://127.0.0.1:15177')
        })
        return view?.executeJavaScript(script)
      }, source)

    /**
     * 模拟选色或移动滑块，可选择停留在预览阶段。
     * @param fieldId 色盘或滑块的元素 ID。
     * @param value 对应输入值。
     * @param confirm 是否同时确认输入并触发保存。
     * @returns 输入事件处理完成后结束的 Promise。
     */
    const changePickerInput = async (
      fieldId: string,
      value: string,
      confirm = true
    ): Promise<void> => {
      await settingsScript(`(() => {
        const field = document.getElementById(${JSON.stringify(fieldId)})
        field.value = ${JSON.stringify(value)}
        field.dispatchEvent(new Event('input', { bubbles: true }))
        if (${confirm}) field.dispatchEvent(new Event('change', { bubbles: true }))
      })()`)
    }

    /**
     * 读取设备数据库中已确认保存的主题背景色。
     * @returns 设备配置中的背景色记录。
     */
    const readSavedBackground = () =>
      page.evaluate(async () => {
        const settings = await window.ztools.dbGet('settings-general')
        return settings?.macWindowBackground
      })

    // Playwright 可为每个页面锁定媒体环境，直接测试宿主所用的颜色方案媒体查询。
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(background).toHaveCSS('--bg-color', '#f4f4f45c')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(background).toHaveCSS('--bg-color', '#3031335c')

    // 旧版只保存六位色值，读取时仍应保留原先的默认 Alpha。
    await page.evaluate(async () => {
      const settings = await window.ztools.dbGet('settings-general')
      await window.ztools.dbPut('settings-general', {
        ...settings,
        macWindowBackground: { dark: '#293846' }
      })
    })
    await expect(background).toHaveCSS('--bg-color', '#293846ab')

    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item,.list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() => settingsScript("document.getElementById('mac-window-background-light')?.value"))
      .toBe('#f4f4f4')
    expect(
      await settingsScript("document.getElementById('mac-window-background-dark')?.value")
    ).toBe('#293846')
    expect(
      await settingsScript("document.getElementById('mac-window-background-dark-alpha')?.value")
    ).toBe('171')

    // 分离后在设置插件的真实表单中编辑，同时验证两个已打开的宿主窗口。
    const [detached] = await Promise.all([
      app.waitForEvent('window'),
      page.evaluate(() => window.ztools.detachPlugin())
    ])
    await detached.emulateMedia({ colorScheme: 'dark' })
    await expect(detached.locator('html')).toHaveCSS('--titlebar-bg', '#293846ab')
    await changePickerInput('mac-window-background-dark', '#142638')
    await expect.poll(readSavedBackground).toEqual({ light: '#f4f4f45c', dark: '#142638ab' })

    // 模拟持续移动滑块，检查两个窗口在确认前更新，且设备配置仍保留原值。
    await changePickerInput('mac-window-background-dark-alpha', '64', false)
    await expect(background).toHaveCSS('--bg-color', '#14263840')
    await changePickerInput('mac-window-background-dark-alpha', '128', false)
    await expect(background).toHaveCSS('--bg-color', '#14263880')
    await expect(detached.locator('html')).toHaveCSS('--titlebar-bg', '#14263880')
    expect(await readSavedBackground()).toEqual({ light: '#f4f4f45c', dark: '#142638ab' })
    await settingsScript(`
      document.getElementById('mac-window-background-dark-alpha')
        .dispatchEvent(new Event('change', { bubbles: true }))
    `)
    await expect.poll(readSavedBackground).toEqual({ light: '#f4f4f45c', dark: '#14263880' })

    await page.emulateMedia({ colorScheme: 'light' })
    await detached.emulateMedia({ colorScheme: 'light' })
    await expect(background).toHaveCSS('--bg-color', '#f4f4f45c')
    await changePickerInput('mac-window-background-light-alpha', '0')
    await expect(background).toHaveCSS('--bg-color', '#f4f4f400')
    await changePickerInput('mac-window-background-light', '#f0e0d0')
    await expect(background).toHaveCSS('--bg-color', '#f0e0d000')
    await expect(detached.locator('html')).toHaveCSS('--titlebar-bg', '#f0e0d000')

    // 重新加载宿主文档后，仅靠持久化配置恢复两种颜色。
    await page.reload()
    await expect(background).toHaveCSS('--bg-color', '#f0e0d000')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(background).toHaveCSS('--bg-color', '#14263880')

    // 两行均使用无边框、透明底色的 SVG 重置图标。
    const resetButtonStyle = {
      border: '0px',
      background: 'rgba(0, 0, 0, 0)',
      hasSvgMask: true,
      iconWidth: 20
    }
    expect(
      await settingsScript(`
        Array.from(document.querySelectorAll('.mac-background-opacity + button'), (button) => {
          const style = getComputedStyle(button)
          const icon = button.querySelector('.i-z-reset')
          return {
            border: style.borderWidth,
            background: style.backgroundColor,
            hasSvgMask: icon && getComputedStyle(icon).maskImage.includes('data:image/svg+xml'),
            iconWidth: icon?.getBoundingClientRect().width
          }
        })
      `)
    ).toEqual([resetButtonStyle, resetButtonStyle])

    // 暗色按钮紧跟不透明度控件，重置后仍保留亮色的自定义值。
    await detached.emulateMedia({ colorScheme: 'dark' })
    await settingsScript(`
      document.querySelector('.mac-background-opacity + button[aria-label="恢复暗黑模式窗口背景色默认值"]')
        .click()
    `)
    await expect(background).toHaveCSS('--bg-color', '#3031335c')
    await expect(detached.locator('html')).toHaveCSS('--titlebar-bg', '#3031335c')
    await expect.poll(readSavedBackground).toEqual({ light: '#f0e0d000', dark: '#3031335c' })

    await page.emulateMedia({ colorScheme: 'light' })
    await detached.emulateMedia({ colorScheme: 'light' })
    await expect(background).toHaveCSS('--bg-color', '#f0e0d000')
    await settingsScript(`
      document.querySelector('.mac-background-opacity + button[aria-label="恢复明亮模式窗口背景色默认值"]')
        .click()
    `)
    await expect(background).toHaveCSS('--bg-color', '#f4f4f45c')
    await expect(detached.locator('html')).toHaveCSS('--titlebar-bg', '#f4f4f45c')
    await expect.poll(readSavedBackground).toEqual({ light: '#f4f4f45c', dark: '#3031335c' })
    expect(
      await settingsScript(
        "Array.from(document.querySelectorAll('.mac-background-opacity span:last-child'), (span) => span.textContent.trim())"
      )
    ).toEqual(['36%', '36%'])
  } finally {
    await instance?.close()
    await fs.rm(data, { recursive: true, force: true })
  }
})
