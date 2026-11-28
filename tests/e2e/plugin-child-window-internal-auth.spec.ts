import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

/**
 * 在目标 WebContents 中执行页面脚本，并在未找到时抛错。
 * @param electronApp 当前 Electron 测试应用。
 * @param urlFragment 目标页面 URL 中的唯一片段。
 * @param source 要在页面内执行的脚本。
 * @returns 页面脚本返回值。
 * @throws 未找到匹配的 WebContents 时抛出错误。
 */
async function executeInContents(
  electronApp: ElectronApplication,
  urlFragment: string,
  source: string
): Promise<unknown> {
  return electronApp.evaluate(
    async ({ webContents }, payload) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().includes(payload.urlFragment) && !item.isLoading())
      if (!contents) return null
      return contents.executeJavaScript(payload.source)
    },
    { urlFragment, source }
  )
}

/**
 * 启动隔离实例，让插件创建子窗口并探测其中的高级 API 可用性。
 * @param grantFullAccess 是否在启动插件前把它加入完全授权名单。
 * @returns 子窗口内 internal.dbGet 的调用结果与授权状态中的 fullAccess。
 */
async function probeChildWindow(
  grantFullAccess: boolean
): Promise<{ internalCall: unknown; fullAccess: unknown }> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-child-window-auth-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginDir = path.join(dataRoot, 'plugins', 'e2e-child-window-plugin')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await fs.mkdir(pluginDir, { recursive: true })
  await fs.writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      name: 'e2e-child-window-plugin',
      title: 'E2E 子窗口鉴权插件',
      version: '1.0.0',
      description: '主视图创建子窗口并在其中探测高级 API',
      main: 'index.html',
      features: [
        { code: 'e2e-child-window-plugin', explain: 'E2E 子窗口入口', cmds: ['e2e子窗口鉴权'] }
      ]
    }),
    'utf-8'
  )
  // 主视图只负责创建子窗口，探测逻辑全部放在子窗口页面里。
  await fs.writeFile(
    path.join(pluginDir, 'index.html'),
    `<!DOCTYPE html>
<html>
  <body>
    <script>
      var created = false
      var boot = setInterval(function () {
        if (created || !window.ztools) return
        created = true
        clearInterval(boot)
        window.ztools.createBrowserWindow('child.html', { show: false })
      }, 100)
    </script>
  </body>
</html>`,
    'utf-8'
  )
  await fs.writeFile(
    path.join(pluginDir, 'child.html'),
    `<!DOCTYPE html>
<html>
  <body>
    <script>
      var probed = false
      var boot = setInterval(function () {
        if (probed || !window.ztools) return
        probed = true
        clearInterval(boot)
        if (!window.ztools.internal) {
          document.body.setAttribute('data-internal-call', 'no-api')
          return
        }
        window.ztools.internal
          .dbGet('settings-general')
          .then(function () {
            document.body.setAttribute('data-internal-call', 'ok')
          })
          .catch(function () {
            document.body.setAttribute('data-internal-call', 'denied')
          })
        window.ztools.getInternalApiPermissions().then(function (state) {
          document.body.setAttribute('data-full-access', String(state.fullAccess))
        })
      }, 100)
    </script>
  </body>
</html>`,
    'utf-8'
  )

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

    // 从主搜索窗口打开设置插件，等待其正文稳定出现。
    const page = await electronApp.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() => executeInContents(electronApp!, '127.0.0.1:15177', 'document.body.innerText'), {
        timeout: 15_000
      })
      .toContain('开机自动启动')

    // 采纳演示插件并从设置插件内启动它；默认情况下该插件没有任何高级 API 授权。
    const adoptResult = await executeInContents(
      electronApp,
      '127.0.0.1:15177',
      `(async () => await window.ztools.internal.adoptPluginEntity(${JSON.stringify(pluginDir)}))()`
    )
    expect(adoptResult).toMatchObject({ success: true, adopted: true })
    if (grantFullAccess) {
      // 授权名单由设置页管理，这里直接写入同一份设置，模拟用户手动授予完全授权。
      await executeInContents(
        electronApp,
        '127.0.0.1:15177',
        `(async () => {
          const settings = (await window.ztools.internal.dbGet('settings-general')) || {}
          settings.customInternalApiPluginNames = ['e2e-child-window-plugin']
          await window.ztools.internal.dbPut('settings-general', settings)
        })()`
      )
    }
    await executeInContents(
      electronApp,
      '127.0.0.1:15177',
      `(async () =>
        await window.ztools.internal.launch({
          path: ${JSON.stringify(pluginDir)},
          type: 'plugin',
          featureCode: 'e2e-child-window-plugin',
          name: 'e2e子窗口鉴权',
          cmdType: 'text',
          param: { code: 'e2e-child-window-plugin' }
        }))()`
    )

    // 等待子窗口页面加载完成并写出探测结果。
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp!,
            'child.html',
            'document.body.getAttribute("data-internal-call")'
          ),
        { timeout: 20_000 }
      )
      .not.toBeNull()

    // 授权状态的查询是异步写入的，等它出现后再一并读取。
    await expect
      .poll(() =>
        executeInContents(
          electronApp!,
          'child.html',
          'document.body.getAttribute("data-full-access")'
        )
      )
      .not.toBeNull()
    return {
      internalCall: await executeInContents(
        electronApp,
        'child.html',
        'document.body.getAttribute("data-internal-call")'
      ),
      fullAccess: await executeInContents(
        electronApp,
        'child.html',
        'document.body.getAttribute("data-full-access")'
      )
    }
  } finally {
    // 始终关闭隔离 Electron，并清理本用例创建的临时数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
}

test('未授权插件创建的子窗口不能调用高级 API', async ({ browserName: _browserName }) => {
  // 子窗口属于未授权插件：高级 API 必须被拒绝，授权状态也不得声明完全授权。
  expect(await probeChildWindow(false)).toEqual({ internalCall: 'denied', fullAccess: 'false' })
})

test('已完全授权插件创建的子窗口沿用该授权', async ({ browserName: _browserName }) => {
  // 授权跟随插件而不是窗口类型，已授权插件的子窗口不能因此被误伤。
  expect(await probeChildWindow(true)).toEqual({ internalCall: 'ok', fullAccess: 'true' })
})
