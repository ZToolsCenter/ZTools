import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const SETTINGS_ORIGIN = 'http://127.0.0.1:15177'

/**
 * 在设置插件 WebContentsView 内执行一段页面脚本。
 * @param app 当前 Electron 实例。
 * @param script 要在设置插件页面中执行的 JavaScript。
 * @returns 页面脚本返回值。
 * @throws 未找到设置插件 WebContentsView 时抛出错误。
 */
async function executeInSettings(app: ElectronApplication, script: string): Promise<unknown> {
  return app.evaluate(
    async ({ webContents }, { source, origin }) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().startsWith(origin))
      if (!contents) throw new Error('未找到设置插件 WebContentsView')
      return contents.executeJavaScript(source)
    },
    { source: script, origin: SETTINGS_ORIGIN }
  )
}

/**
 * 读取设置插件当前显示的文本。
 * @param app 当前 Electron 实例。
 * @returns 页面文本，设置插件尚未打开时为空字符串。
 */
async function settingsText(app: ElectronApplication): Promise<string> {
  return executeInSettings(app, 'document.body.innerText').then(
    (text) => String(text),
    () => ''
  )
}

test('runs a scheduled command in the background at its time', async () => {
  test.setTimeout(90_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-scheduled-tasks-'))
  const pluginRoot = path.join(dataRoot, 'schedule-fixture')
  const payloadFile = path.join(dataRoot, 'payload.json')
  const plugin = {
    name: 'schedule-fixture',
    title: 'Schedule Fixture',
    version: '1.0.0',
    preload: 'preload.js',
    features: [{ code: 'ping', cmds: ['Scheduled Ping'] }]
  }
  let app: ElectronApplication | undefined
  await fs.mkdir(pluginRoot, { recursive: true })
  await fs.mkdir(path.join(dataRoot, 'legacy'), { recursive: true })
  await fs.writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify(plugin))
  // 无界面功能直接把进入参数写到文件，便于确认指令确实被调度器运行。
  await fs.writeFile(
    path.join(pluginRoot, 'preload.js'),
    `const save = action => require('node:fs').writeFileSync(${JSON.stringify(payloadFile)}, JSON.stringify(action))
window.exports = { ping: { mode: 'none', args: { enter: save } } }
`
  )

  try {
    app = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])
        ),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: path.join(dataRoot, 'legacy'),
        ZTOOLS_E2E: '1',
        ZTOOLS_SETTING_DEV_SERVER_URL: SETTINGS_ORIGIN
      }
    })
    const page = await app.firstWindow()
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await page.evaluate(
      async (plugin) => {
        const current = (await window.ztools.dbGet('plugins')) || []
        await window.ztools.dbPut('plugins', [...current, plugin])
      },
      { ...plugin, path: pluginRoot }
    )

    // 从搜索框直达设置插件的定时任务页面。
    await searchInput.fill('定时任务')
    await page.locator('.app-item, .list-item').filter({ hasText: '定时任务' }).first().click()
    await expect.poll(() => settingsText(app!), { timeout: 30_000 }).toContain('暂无定时任务')

    const saved = await executeInSettings(
      app,
      `window.ztools.internal.saveScheduledTask({
        name: '定时 Ping',
        target: 'schedule-fixture/Scheduled Ping',
        enabled: true,
        schedule: { kind: 'once', at: Date.now() + 3000 },
        catchUp: false
      })`
    )
    expect(saved).toMatchObject({ success: true })
    await expect.poll(() => settingsText(app!)).toContain('定时 Ping')
    await expect(fs.readFile(payloadFile, 'utf8')).rejects.toThrow()

    await expect
      .poll(
        async () => {
          try {
            return JSON.parse(await fs.readFile(payloadFile, 'utf8'))
          } catch {
            return null
          }
        },
        { timeout: 20_000 }
      )
      .toMatchObject({ code: 'ping', type: 'text' })

    // 单次任务运行后自动停用，结果写回任务记录。
    await expect
      .poll(() => executeInSettings(app!, 'window.ztools.internal.getScheduledTasks()'))
      .toMatchObject([
        { name: '定时 Ping', enabled: false, nextRunAt: null, lastRun: { status: 'success' } }
      ])

    // 定时启动与全局快捷键一样会切换到目标插件，返回搜索后重新进入页面确认列表展示本次结果。
    await page.locator('.plugin-tag-close').click()
    await searchInput.fill('定时任务')
    await page.locator('.app-item, .list-item').filter({ hasText: '定时任务' }).first().click()
    await expect.poll(() => settingsText(app!)).toMatch(/未计划 · 上次 .+ 成功/)
  } finally {
    await app?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
