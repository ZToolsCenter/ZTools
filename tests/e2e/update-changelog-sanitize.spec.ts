import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

test('更新日志渲染前会消毒，恶意标签与事件属性不会执行', async ({ browserName: _browserName }) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-update-changelog-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null
  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    // 使用隔离数据目录启动，避免读写真实 ~/.ztools。
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

    // 以与真实更新窗口相同的 preload 和页面创建窗口，再模拟主进程下发带恶意内容的更新日志。
    const result = await electronApp.evaluate(
      async ({ BrowserWindow }, { preloadPath, pagePath }) => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preloadPath,
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false
          }
        })
        try {
          await win.loadFile(pagePath)
          const changelog = [
            '**加粗内容** [官网](https://example.com)',
            '<img src="x" onerror="window.__changelogXss = 1">',
            '<script>window.__changelogXss = 2</script>',
            '<a href="javascript:window.__changelogXss = 3">恶意链接</a>'
          ].join('\n\n')

          // 等待更新页面注册监听后再发送，避免消息先于渲染进程订阅到达。
          for (let attempt = 0; attempt < 50; attempt += 1) {
            const ready = await win.webContents.executeJavaScript(
              `Boolean(document.querySelector('.update-window'))`
            )
            if (ready) break
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          win.webContents.send('update-info', {
            version: '9.9.9',
            changelog,
            sources: []
          })

          // 等待 Markdown 渲染完成，并留出时间让可能存在的 onerror 触发。
          for (let attempt = 0; attempt < 50; attempt += 1) {
            const rendered = await win.webContents.executeJavaScript(
              `Boolean(document.querySelector('.changelog strong'))`
            )
            if (rendered) break
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          await new Promise((resolve) => setTimeout(resolve, 500))

          return await win.webContents.executeJavaScript(`({
            hasStrong: Boolean(document.querySelector('.changelog strong')),
            linkHref: document.querySelector('.changelog a[href^="https://"]')?.getAttribute('href') ?? null,
            xss: window.__changelogXss ?? null,
            hasOnerror: Boolean(document.querySelector('.changelog [onerror]')),
            hasScript: Boolean(document.querySelector('.changelog script')),
            hasJavascriptHref: Array.from(document.querySelectorAll('.changelog a')).some((a) =>
              (a.getAttribute('href') ?? '').toLowerCase().startsWith('javascript:')
            )
          })`)
        } finally {
          win.destroy()
        }
      },
      {
        preloadPath: path.join(projectRoot, 'out', 'preload', 'index.js'),
        pagePath: path.join(projectRoot, 'out', 'renderer', 'updater.html')
      }
    )

    // 正常的 Markdown 与外部链接必须保留，危险内容必须被移除且没有执行。
    expect(result.hasStrong).toBe(true)
    expect(result.linkHref).toBe('https://example.com')
    expect(result.xss).toBeNull()
    expect(result.hasOnerror).toBe(false)
    expect(result.hasScript).toBe(false)
    expect(result.hasJavascriptHref).toBe(false)
  } finally {
    // 始终关闭隔离 Electron，并清理本用例创建的临时数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
