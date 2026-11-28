import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
/** 授权弹窗页面 URL 中的标记（弹窗 HTML meta 名） */
const POPUP_URL_MARKER = 'ztools-internal-api-request-dialog'
const SETTINGS_URL_MARKER = '127.0.0.1:15177'
const PLUGIN_URL_MARKER = 'e2e-refresh-plugin'
/** 弹窗 URL 的 HTML 中也含插件名，插件页面需要用入口文件路径区分 */
const PLUGIN_PAGE_MARKER = `${PLUGIN_URL_MARKER}/index.html`

/**
 * 在目标 WebContents 中执行页面脚本，未找到或仍在加载时返回 null 供轮询。
 * @param electronApp 当前 Electron 测试应用。
 * @param urlFragment 目标页面 URL 中的唯一片段。
 * @param source 要在页面内执行的脚本。
 * @returns 页面脚本返回值。
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

test('弹窗展示期间插件追加申请时，弹窗刷新为合并后的完整申请', async ({
  browserName: _browserName
}) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-request-refresh-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginDir = path.join(dataRoot, 'plugins', PLUGIN_URL_MARKER)
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await fs.mkdir(pluginDir, { recursive: true })
  await fs.writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      name: PLUGIN_URL_MARKER,
      title: 'E2E 授权刷新插件',
      version: '1.0.0',
      description: '先申请一项高级 API，弹窗展示期间再追加申请',
      main: 'index.html',
      features: [{ code: PLUGIN_URL_MARKER, explain: 'E2E 授权刷新入口', cmds: ['e2e授权刷新'] }]
    }),
    'utf-8'
  )
  // 页面加载后只申请第一项，第二项由测试在弹窗已展示后追加。
  await fs.writeFile(
    path.join(pluginDir, 'index.html'),
    `<!DOCTYPE html>
<html>
  <body>
    <script>
      var requested = false
      var boot = setInterval(function () {
        if (requested || !window.ztools) return
        requested = true
        clearInterval(boot)
        window.ztools.requestInternalApiPermissions(['internal:db-get'], 'E2E 首次申请')
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
      .poll(() => executeInContents(electronApp!, SETTINGS_URL_MARKER, 'document.body.innerText'), {
        timeout: 15_000
      })
      .toContain('开机自动启动')

    // 采纳演示插件并从设置插件内启动它。
    const adoptResult = await executeInContents(
      electronApp,
      SETTINGS_URL_MARKER,
      `(async () => await window.ztools.internal.adoptPluginEntity(${JSON.stringify(pluginDir)}))()`
    )
    expect(adoptResult).toMatchObject({ success: true, adopted: true })
    await executeInContents(
      electronApp,
      SETTINGS_URL_MARKER,
      `(async () =>
        await window.ztools.internal.launch({
          path: ${JSON.stringify(pluginDir)},
          type: 'plugin',
          featureCode: '${PLUGIN_URL_MARKER}',
          name: 'e2e授权刷新',
          cmdType: 'text',
          param: { code: '${PLUGIN_URL_MARKER}' }
        }))()`
    )

    // 第一项申请弹出授权窗口，此时窗口里只有第一项。
    await expect
      .poll(
        async () =>
          (await executeInContents(electronApp!, POPUP_URL_MARKER, 'document.body.innerText')) ??
          '',
        { timeout: 20_000 }
      )
      .toContain('internal:db-get')
    expect(
      await executeInContents(electronApp, POPUP_URL_MARKER, 'document.body.innerText')
    ).not.toContain('internal:db-put')

    // 弹窗仍在展示时追加第二项申请，服务端会把两项合并保存。
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp!,
            PLUGIN_PAGE_MARKER,
            `(async () => {
              if (!window.ztools) return null
              const result = await window.ztools.requestInternalApiPermissions(
                ['internal:db-put'],
                'E2E 追加申请'
              )
              return result.status
            })()`
          ),
        { timeout: 15_000 }
      )
      .toBe('pending')

    // 弹窗应刷新为合并后的完整申请，否则用户批准时看不到追加项却会把它一并清掉。
    await expect
      .poll(
        async () =>
          (await executeInContents(electronApp!, POPUP_URL_MARKER, 'document.body.innerText')) ??
          '',
        { timeout: 10_000 }
      )
      .toContain('internal:db-put')

    // 批准弹窗展示的全部项目后，两项都应已授权且没有遗留的待审申请。
    await executeInContents(
      electronApp,
      POPUP_URL_MARKER,
      `document.querySelector('[data-testid="popup-approve"]').click()`
    )
    await expect
      .poll(
        async () =>
          JSON.parse(
            ((await executeInContents(
              electronApp!,
              PLUGIN_PAGE_MARKER,
              `(async () => JSON.stringify(await window.ztools.getInternalApiPermissions()))()`
            )) as string | null) ?? 'null'
          ),
        { timeout: 15_000 }
      )
      .toMatchObject({
        granted: expect.arrayContaining(['internal:db-get', 'internal:db-put']),
        pending: []
      })
  } finally {
    // 始终关闭隔离 Electron，并清理本用例创建的临时数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
