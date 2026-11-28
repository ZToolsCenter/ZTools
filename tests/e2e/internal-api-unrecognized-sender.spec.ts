import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

test('无法识别为插件的页面即使加载了宿主 preload 也不能调用高级 API', async ({
  browserName: _browserName
}) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-unrecognized-sender-'))
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

    // 构造一个既不是插件主视图、分离窗口，也不是插件子窗口的页面，并给它加载宿主 preload，
    // 模拟共享插件会话的 webview 等未登记页面。
    const result = await electronApp.evaluate(
      async ({ BrowserWindow }, preloadPath) => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preloadPath,
            contextIsolation: false,
            nodeIntegration: false,
            sandbox: false
          }
        })
        try {
          await win.loadURL('data:text/html,<body></body>')
          return await win.webContents.executeJavaScript(`
          (async () => {
            if (!window.ztools || !window.ztools.internal) return 'no-api'
            try {
              await window.ztools.internal.dbGet('settings-general')
              return 'ok'
            } catch (error) {
              return 'denied'
            }
          })()
        `)
        } finally {
          win.destroy()
        }
      },
      path.join(projectRoot, 'resources', 'preload.js')
    )

    expect(result).toBe('denied')
  } finally {
    // 始终关闭隔离 Electron，并清理本用例创建的临时数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
