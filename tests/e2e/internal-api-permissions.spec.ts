import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
/** 授权弹窗页面 URL 中的标记（弹窗 HTML meta 名） */
const POPUP_URL_MARKER = 'ztools-internal-api-request-dialog'

test('高级 API 权限：设置页审批、实体采纳与授权管理', async ({
  browserName: _browserName
}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-internal-api-perms-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  // 预置一个待采纳的插件实体，验证 adoptPluginEntity 登记链路
  const adoptPluginDir = path.join(dataRoot, 'plugins', 'e2e-adopt-demo')
  const screenshotPath = testInfo.outputPath('internal-api-permissions.png')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await fs.mkdir(adoptPluginDir, { recursive: true })
  await fs.writeFile(
    path.join(adoptPluginDir, 'plugin.json'),
    JSON.stringify({
      name: 'e2e-adopt-demo',
      title: 'E2E 采纳演示插件',
      version: '1.0.0',
      description: '用于验证实体采纳 API',
      main: 'index.html',
      features: [{ code: 'e2e-adopt-demo', explain: 'E2E 采纳演示入口', cmds: ['e2e采纳演示'] }]
    }),
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

    await openSettingsPlugin(electronApp)

    // 完全授权插件（设置插件自身）调用申请入口应直接返回 granted，不产生待审条目。
    const requestResult = await executeInSettings(
      electronApp,
      `
      (async () =>
        await window.ztools.requestInternalApiPermissions(
          ['internal:db-get', 'internal:db-put'],
          'E2E 冒烟'
        ))()
    `
    )
    expect(requestResult).toMatchObject({ success: true, status: 'granted' })

    // 需求 1：notify-plugins-changed 通道可用并返回成功。
    const notifyResult = await executeInSettings(
      electronApp,
      `(async () => await window.ztools.internal.notifyPluginsChanged())()`
    )
    expect(notifyResult).toMatchObject({ success: true })

    // 需求 3：采纳已存在的实体目录并登记到注册表；重复采纳为 no-op。
    const adoptFirst = await executeInSettings(
      electronApp,
      `(async () => await window.ztools.internal.adoptPluginEntity(${JSON.stringify(adoptPluginDir)}))()`
    )
    expect(adoptFirst).toMatchObject({ success: true, adopted: true })
    expect(adoptFirst.plugin).toMatchObject({ name: 'e2e-adopt-demo' })
    const adoptAgain = await executeInSettings(
      electronApp,
      `(async () => await window.ztools.internal.adoptPluginEntity(${JSON.stringify(adoptPluginDir)}))()`
    )
    expect(adoptAgain).toMatchObject({ success: true, adopted: false })
    const registryPlugins = await executeInSettings(
      electronApp,
      `(async () => await window.ztools.internal.dbGet('plugins'))()`
    )
    expect((registryPlugins as any[]).some((plugin) => plugin?.name === 'e2e-adopt-demo')).toBe(
      true
    )

    // 直接写入数据库的待审申请不经过申请 IPC，不应触发授权弹窗。
    await executeInSettings(
      electronApp,
      `
      (async () => {
        const settings = (await window.ztools.internal.dbGet('settings-general')) || {}
        settings.internalApiPendingRequests = {
          'e2e-demo-sync': {
            apis: ['internal:db-get', 'internal:db-put'],
            reason: '同步插件登记已安装列表',
            requestedAt: Date.now()
          }
        }
        await window.ztools.internal.dbPut('settings-general', settings)
      })()
    `
    )
    expect(await findPopupContents(electronApp)).toBeNull()

    // 打开「高级权限」页并等待待处理页签渲染完成。
    await executeInSettings(
      electronApp,
      `
      [...document.querySelectorAll('.menu-item')]
        .find((item) => item.textContent?.includes('高级权限'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '待处理')
    await waitForSettingsText(electronApp, 'e2e-demo-sync')
    await waitForSettingsText(electronApp, '同步插件登记已安装列表')

    // 申请胶囊默认全选；取消其中一项以验证部分批准。
    const checkedCount = await executeInSettings(
      electronApp,
      `
      document.querySelectorAll('.api-pill input:checked').length
    `
    )
    expect(checkedCount).toBe(2)
    await executeInSettings(
      electronApp,
      `
      (() => {
        const checkbox = document.querySelector('.api-pill input[value="internal:db-put"]')
        if (!(checkbox instanceof HTMLInputElement)) throw new Error('未找到待取消的申请项')
        checkbox.click()
      })()
    `
    )

    // 批准剩余申请项并在风险确认弹窗中确认。
    await executeInSettings(
      electronApp,
      `
      document.querySelector('[data-testid="approve-request"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '已知风险，批准')
    await executeInSettings(
      electronApp,
      `
      (() => {
        const button = Array.from(document.querySelectorAll('.dialog-overlay button'))
          .find((item) => item.textContent?.trim() === '已知风险，批准')
        if (!(button instanceof HTMLButtonElement)) throw new Error('未找到批准确认按钮')
        button.click()
      })()
    `
    )
    await waitForSettingsSelectorHidden(electronApp, '.dialog-overlay')

    // 审批结果：切换到「已授权」页签后可见授权卡片。
    await executeInSettings(
      electronApp,
      `
      document.querySelector('[data-testid="permission-tab-granted"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '已授权')
    await expect
      .poll(
        () =>
          executeInSettings(
            electronApp,
            `
            [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
              .some((card) => card.textContent?.includes('e2e-demo-sync'))
          `
          ),
        { timeout: 15_000 }
      )
      .toBe(true)

    // 硬编码可信插件（setting / system / 开发者插件）始终完全授权，不出现在授权列表。
    const trustedCardVisible = await executeInSettings(
      electronApp,
      `
      [...document.querySelectorAll('[data-testid="permission-grant-card"]')].some((card) =>
        /setting|system|ztools-developer-plugin/.test(card.textContent ?? '')
      )
    `
    )
    expect(trustedCardVisible).toBe(false)

    const approvedState = await executeInSettings(
      electronApp,
      `
      (async () => {
        const settings = await window.ztools.internal.dbGet('settings-general')
        return {
          granted: settings?.customInternalApiPermissions?.['e2e-demo-sync'] ?? [],
          pendingKeys: Object.keys(settings?.internalApiPendingRequests ?? {})
        }
      })()
    `
    )
    expect(approvedState).toEqual({
      granted: ['internal:db-get'],
      pendingKeys: []
    })

    // 展开授权卡片，确认 API 标签位于标签滚动列表中、操作按钮行在其下方常驻。
    await executeInSettings(
      electronApp,
      `
      (() => {
        const card = [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
          .find((item) => item.textContent?.includes('e2e-demo-sync'))
        const head = card?.querySelector('.plugin-head')
        if (!(head instanceof HTMLElement)) throw new Error('未找到授权卡片头部')
        head.click()
      })()
    `
    )
    await expect
      .poll(() =>
        executeInSettings(
          electronApp,
          `
          (() => {
            const card = [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
              .find((item) => item.textContent?.includes('e2e-demo-sync'))
            const tagList = card?.querySelector('.api-tag-list')
            const addRow = card?.querySelector('.grant-add-row')
            return Boolean(
              tagList?.textContent?.includes('internal:db-get') && addRow?.textContent
            )
          })()
        `
        )
      )
      .toBe(true)

    // 整体停用授权：开关关闭后停用名单落库，卡片进入停用态。
    await executeInSettings(
      electronApp,
      `
      (() => {
        const card = [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
          .find((item) => item.textContent?.includes('e2e-demo-sync'))
        const toggle = card?.querySelector('[data-testid="grant-toggle"]')
        if (!(toggle instanceof HTMLInputElement)) throw new Error('未找到授权开关')
        toggle.click()
      })()
    `
    )
    await expect
      .poll(
        () =>
          executeInSettings(
            electronApp,
            `
            (async () =>
              ((await window.ztools.internal.dbGet('settings-general'))
                ?.customInternalApiDisabledPlugins ?? []))()
          `
          ),
        { timeout: 15_000 }
      )
      .toContain('e2e-demo-sync')
    await waitForSettingsText(electronApp, '已停用 · 1 个 API')

    // 重新开启授权：停用名单清空，卡片恢复启用态。
    await executeInSettings(
      electronApp,
      `
      (() => {
        const card = [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
          .find((item) => item.textContent?.includes('e2e-demo-sync'))
        const toggle = card?.querySelector('[data-testid="grant-toggle"]')
        if (!(toggle instanceof HTMLInputElement)) throw new Error('未找到授权开关')
        toggle.click()
      })()
    `
    )
    await expect
      .poll(
        () =>
          executeInSettings(
            electronApp,
            `
            (async () =>
              ((await window.ztools.internal.dbGet('settings-general'))
                ?.customInternalApiDisabledPlugins ?? []))()
          `
          ),
        { timeout: 15_000 }
      )
      .toEqual([])

    // 等待界面按最新数据重绘（卡片解除停用弱化态）后再截图，避免竞态导致截图与数据不一致。
    await expect
      .poll(
        () =>
          executeInSettings(
            electronApp,
            `
            (() => {
              const card = [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
                .find((item) => item.textContent?.includes('e2e-demo-sync'))
              return Boolean(card && !card.classList.contains('is-disabled'))
            })()
          `
          ),
        { timeout: 15_000 }
      )
      .toBe(true)

    // 等待操作 toast（3s 自动消失）收起，保证截图画面干净。
    await expect
      .poll(() => executeInSettings(electronApp, `Boolean(document.querySelector('.toast'))`))
      .toBe(false)

    const screenshot = await captureSettingsPlugin(electronApp)
    await fs.writeFile(screenshotPath, screenshot)
    await testInfo.attach('internal-api-permissions', {
      body: screenshot,
      contentType: 'image/png'
    })

    // ==================== 完全授权插件：手动授权弹窗授予、展示全部通道并支持降级 ====================
    // 通过手动授权弹窗开启「授予全部高级 API」（完全授权入口已从通用设置移入本页）。
    await executeInSettings(
      electronApp,
      `
      document.querySelector('[data-testid="manual-grant-open"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await executeInSettings(
      electronApp,
      `
      (() => {
        const input = document.querySelector('[data-testid="manual-plugin-name"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('未找到插件名输入框')
        input.value = 'e2e-full-plugin'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const toggle = document.querySelector('[data-testid="manual-full-access"]')
        if (!(toggle instanceof HTMLInputElement)) throw new Error('未找到完全授权开关')
        toggle.click()
      })()
    `
    )
    await executeInSettings(
      electronApp,
      `
      document.querySelector('[data-testid="manual-add-grant"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    // 风险确认弹窗中确认授予全部高级 API。
    await executeInSettings(
      electronApp,
      `
      (() => {
        const button = Array.from(document.querySelectorAll('.dialog-overlay button'))
          .find((item) => item.textContent?.trim() === '已知风险，继续授权')
        if (!(button instanceof HTMLButtonElement)) throw new Error('未找到授权确认按钮')
        button.click()
      })()
    `
    )
    await waitForSettingsSelectorHidden(electronApp, '.dialog-overlay')

    // 完全授权落库且卡片带徽章出现在「已授权」页签（权限广播触发自动刷新）。
    await expect
      .poll(
        () =>
          executeInSettings(
            electronApp,
            `
            (() => {
              const card = [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
                .find((item) => item.textContent?.includes('e2e-full-plugin'))
              return Boolean(card && card.textContent?.includes('完全授权'))
            })()
          `
          ),
        { timeout: 15_000 }
      )
      .toBe(true)

    // 展开后列出全部已注册通道标签。
    await executeInSettings(
      electronApp,
      `
      (() => {
        const card = [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
          .find((item) => item.textContent?.includes('e2e-full-plugin'))
        const head = card?.querySelector('.plugin-head')
        if (!(head instanceof HTMLElement)) throw new Error('未找到完全授权卡片头部')
        head.click()
      })()
    `
    )
    // 展开后列出全部已注册通道：标签列表自身内部滚动，「移除全部」按钮行固定在其下方可见。
    await expect
      .poll(() =>
        executeInSettings(
          electronApp,
          `
          (() => {
            const card = [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
              .find((item) => item.textContent?.includes('e2e-full-plugin'))
            const tagList = card?.querySelector('.api-tag-list')
            const addRow = card?.querySelector('.grant-add-row')
            if (!(tagList instanceof HTMLElement) || !(addRow instanceof HTMLElement)) return false
            return Boolean(
              tagList.textContent?.includes('internal:db-get') &&
                tagList.textContent?.includes('internal:db-put') &&
                tagList.scrollHeight > tagList.clientHeight &&
                tagList.getBoundingClientRect().bottom <= addRow.getBoundingClientRect().top
            )
          })()
        `
        )
      )
      .toBe(true)

    // 截取完全授权插件展开态（全部通道标签 + 受限滚动区）。
    // 等待授权操作 toast 收起后再截图，保证展开区画面干净。
    await expect
      .poll(() => executeInSettings(electronApp, `Boolean(document.querySelector('.toast'))`))
      .toBe(false)
    const fullAccessScreenshot = await captureSettingsPlugin(electronApp)
    await testInfo.attach('internal-api-permissions-full-access', {
      body: fullAccessScreenshot,
      contentType: 'image/png'
    })
    await fs.writeFile(
      testInfo.outputPath('internal-api-permissions-full-access.png'),
      fullAccessScreenshot
    )

    // 移除一个通道：完全授权降级为按通道授权，保留其余全部通道。
    await executeInSettings(
      electronApp,
      `
      (() => {
        const card = [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
          .find((item) => item.textContent?.includes('e2e-full-plugin'))
        const tag = [...(card?.querySelectorAll('.api-tag') ?? [])].find((item) =>
          item.textContent?.includes('internal:db-put')
        )
        const remove = tag?.querySelector('.api-tag-remove')
        if (!(remove instanceof HTMLButtonElement)) throw new Error('未找到待移除的通道标签')
        remove.click()
      })()
    `
    )
    await expect
      .poll(
        () =>
          executeInSettings(
            electronApp,
            `
            (async () => {
              const grants = await window.ztools.internal.getInternalApiGrants()
              const settings = await window.ztools.internal.dbGet('settings-general')
              const granted = settings?.customInternalApiPermissions?.['e2e-full-plugin'] ?? []
              return Boolean(
                !(settings?.customInternalApiPluginNames ?? []).includes('e2e-full-plugin') &&
                  granted.includes('internal:db-get') &&
                  !granted.includes('internal:db-put') &&
                  granted.length === grants.channels.length - 1
              )
            })()
          `
          ),
        { timeout: 15_000 }
      )
      .toBe(true)

    // 移除全部授权后授权卡片消失，名单恢复为空。
    await executeInSettings(
      electronApp,
      `
      document.querySelector('[data-testid="grant-remove-all"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '移除插件授权')
    await executeInSettings(
      electronApp,
      `
      (() => {
        const button = Array.from(document.querySelectorAll('.dialog-overlay button'))
          .find((item) => item.textContent?.trim() === '移除')
        if (!(button instanceof HTMLButtonElement)) throw new Error('未找到移除确认按钮')
        button.click()
      })()
    `
    )
    await waitForSettingsSelectorHidden(electronApp, '.dialog-overlay')
    await expect
      .poll(
        () =>
          executeInSettings(
            electronApp,
            `
            [...document.querySelectorAll('[data-testid="permission-grant-card"]')]
              .some((card) => card.textContent?.includes('e2e-demo-sync'))
          `
          ),
        { timeout: 15_000 }
      )
      .toBe(false)
    // e2e-demo-sync 的按通道授权被清空；降级后的 e2e-full-plugin 条目保留。
    const clearedState = await executeInSettings(
      electronApp,
      `
      (async () => (await window.ztools.internal.dbGet('settings-general'))?.customInternalApiPermissions ?? {})()
    `
    )
    expect(clearedState).not.toHaveProperty('e2e-demo-sync')
    expect(clearedState).toHaveProperty('e2e-full-plugin')
  } finally {
    // 始终关闭隔离 Electron，并清理本用例创建的临时数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('插件申请高级 API 时立即弹出授权窗口并可部分批准', async ({
  browserName: _browserName
}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-internal-api-popup-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginDir = path.join(dataRoot, 'plugins', 'e2e-popup-plugin')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await fs.mkdir(pluginDir, { recursive: true })
  await fs.writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      name: 'e2e-popup-plugin',
      title: 'E2E 弹窗授权插件',
      version: '1.0.0',
      description: '加载后立即申请高级 API 权限',
      main: 'index.html',
      features: [{ code: 'e2e-popup-plugin', explain: 'E2E 弹窗授权入口', cmds: ['e2e弹窗授权'] }]
    }),
    'utf-8'
  )
  // 插件页面加载后发起授权申请，获批后轮询自身授权状态并实测按通道鉴权。
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
        window.ztools
          .requestInternalApiPermissions(
            ['internal:db-get', 'internal:db-put'],
            'E2E 弹窗授权验证'
          )
          .then(function (result) {
            document.body.setAttribute('data-request-status', result.status)
            var poll = setInterval(function () {
              window.ztools.getInternalApiPermissions().then(function (state) {
                var hasGet = state.granted.indexOf('internal:db-get') >= 0
                var hasPut = state.granted.indexOf('internal:db-put') >= 0
                if (!hasGet || hasPut) return
                clearInterval(poll)
                document.body.setAttribute('data-grant-state', 'partial-ok')
                window.ztools.internal
                  .dbGet('settings-general')
                  .then(function () {
                    document.body.setAttribute('data-call-get', 'ok')
                  })
                  .catch(function () {
                    document.body.setAttribute('data-call-get', 'denied')
                  })
                window.ztools.internal
                  .dbPut('e2e-popup-probe', 1)
                  .then(function () {
                    document.body.setAttribute('data-call-put', 'ok')
                  })
                  .catch(function () {
                    document.body.setAttribute('data-call-put', 'denied')
                  })
              })
            }, 200)
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

    await openSettingsPlugin(electronApp)

    // 采纳演示插件并从设置插件内启动它（启动后设置视图会被替换）。
    const adoptResult = await executeInSettings(
      electronApp,
      `(async () => await window.ztools.internal.adoptPluginEntity(${JSON.stringify(pluginDir)}))()`
    )
    expect(adoptResult).toMatchObject({ success: true, adopted: true })
    await executeInSettings(
      electronApp,
      `(async () =>
        await window.ztools.internal.launch({
          path: ${JSON.stringify(pluginDir)},
          type: 'plugin',
          featureCode: 'e2e-popup-plugin',
          name: 'e2e弹窗授权',
          cmdType: 'text',
          param: { code: 'e2e-popup-plugin' }
        }))()`
    )

    // 等待插件页面发起申请并弹出授权窗口。
    const pluginContents = await waitForPluginContents(electronApp, 'e2e-popup-plugin')
    await expect
      .poll(
        async () =>
          (await pluginContents.executeJavaScript(
            'document.body.getAttribute("data-request-status")'
          )) || '',
        { timeout: 15_000 }
      )
      .toBe('pending')

    const popupContents = await waitForPopup(electronApp)
    const popupText = await popupContents.executeJavaScript('document.body.innerText')
    expect(popupText).toContain('e2e-popup-plugin')
    expect(popupText).toContain('internal:db-get')
    expect(popupText).toContain('internal:db-put')
    expect(popupText).toContain('E2E 弹窗授权验证')

    // 截取授权弹窗与插件页面（仅可见区域，直接以附件保存到测试输出目录）。
    await testInfo.attach('internal-api-request-popup', {
      body: Buffer.from(
        await electronApp.evaluate(async ({ webContents }, marker) => {
          const popup = webContents.getAllWebContents().find((c) => c.getURL().includes(marker))
          return (await popup.capturePage()).toPNG().toString('base64')
        }, POPUP_URL_MARKER),
        'base64'
      ),
      contentType: 'image/png'
    })
    await testInfo.attach('internal-api-popup-plugin', {
      body: Buffer.from(
        await electronApp.evaluate(async ({ webContents }) => {
          const plugin = webContents
            .getAllWebContents()
            .find((c) => c.getURL().includes('e2e-popup-plugin'))
          return (await plugin.capturePage()).toPNG().toString('base64')
        }),
        'base64'
      ),
      contentType: 'image/png'
    })

    // 默认全选时应能直接批准，不应依赖后续 change 事件初始化按钮。
    expect(
      await popupContents.executeJavaScript(`
        (() => {
          const approve = document.querySelector('[data-testid="popup-approve"]')
          return approve instanceof HTMLButtonElement && !approve.disabled
        })()
      `)
    ).toBe(true)

    // 在弹窗中取消一项申请实现部分批准，然后批准。
    await popupContents.executeJavaScript(`
      (() => {
        const checkbox = document.querySelector('.api-chip input[value="internal:db-put"]')
        if (!(checkbox instanceof HTMLInputElement)) throw new Error('未找到弹窗申请项')
        checkbox.click()
        const approve = document.querySelector('[data-testid="popup-approve"]')
        if (!(approve instanceof HTMLButtonElement)) throw new Error('未找到批准按钮')
        approve.click()
      })()
    `)

    // 批准后弹窗自动关闭。
    await expect
      .poll(() => findPopupContents(electronApp).then((contents) => contents === null), {
        timeout: 15_000
      })
      .toBe(true)

    // 插件侧验证：部分授权生效，且按通道鉴权（db-get 可用、db-put 拒绝）。
    await expect
      .poll(
        () =>
          pluginContents.executeJavaScript(
            'document.body.getAttribute("data-grant-state")'
          ) as Promise<string | null>,
        { timeout: 15_000 }
      )
      .toBe('partial-ok')
    await expect
      .poll(
        () =>
          pluginContents.executeJavaScript(
            'document.body.getAttribute("data-call-get")'
          ) as Promise<string | null>,
        { timeout: 15_000 }
      )
      .toBe('ok')
    await expect
      .poll(
        () =>
          pluginContents.executeJavaScript(
            'document.body.getAttribute("data-call-put")'
          ) as Promise<string | null>,
        { timeout: 15_000 }
      )
      .toBe('denied')
  } finally {
    // 始终关闭隔离 Electron，并清理本用例创建的临时数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

/**
 * 从主搜索窗口打开内置设置插件，并等待插件正文加载完成。
 * @param electronApp 当前 Electron 测试应用。
 * @returns 设置插件可交互后的 Promise。
 */
async function openSettingsPlugin(electronApp: ElectronApplication): Promise<void> {
  const page = await electronApp.firstWindow()
  const searchInput = page.locator('.search-input')
  await expect(searchInput).toBeVisible()
  await searchInput.fill('通用设置')
  const result = page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first()
  await expect(result).toBeVisible()
  await result.click()
  await waitForSettingsText(electronApp, '开机自动启动')
}

/**
 * 在设置插件 WebContentsView 内执行一段页面脚本。
 * @param electronApp 当前 Electron 测试应用。
 * @param script 要在设置插件页面中执行的 JavaScript。
 * @returns 页面脚本返回值。
 * @throws 未找到设置插件 WebContentsView 时抛出错误。
 */
async function executeInSettings(
  electronApp: ElectronApplication,
  script: string
): Promise<unknown> {
  return electronApp.evaluate(async ({ webContents }, source) => {
    const pluginContents = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
    if (!pluginContents) throw new Error('未找到设置插件 WebContentsView')
    return pluginContents.executeJavaScript(source)
  }, script)
}

/** 可在目标 WebContents 中执行页面脚本的句柄 */
interface ContentsHandle {
  executeJavaScript: (source: string) => Promise<unknown>
}

/**
 * 查找授权弹窗的 WebContents（不存在时返回 null）。
 * @param electronApp 当前 Electron 测试应用。
 * @returns 弹窗 WebContents 或 null。
 */
async function findPopupContents(electronApp: ElectronApplication): Promise<unknown> {
  return electronApp.evaluate(({ webContents }, marker) => {
    return (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes(marker)) ?? null
    )
  }, POPUP_URL_MARKER)
}

/**
 * 等待授权弹窗出现并返回其脚本执行句柄。
 * @param electronApp 当前 Electron 测试应用。
 * @returns 弹窗 WebContents 执行句柄。
 * @throws 超时未出现时抛出错误。
 */
async function waitForPopup(electronApp: ElectronApplication): Promise<ContentsHandle> {
  await expect
    .poll(() => findPopupContents(electronApp).then((contents) => contents !== null), {
      timeout: 15_000
    })
    .toBe(true)
  return {
    executeJavaScript: (source: string) =>
      electronApp.evaluate(
        async ({ webContents }, payload) => {
          const popup = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().includes(payload.marker))
          if (!popup) throw new Error('未找到授权弹窗 WebContents')
          return popup.executeJavaScript(payload.source)
        },
        { marker: POPUP_URL_MARKER, source }
      )
  }
}

/**
 * 等待指定插件页面的 WebContents 出现并加载完成。
 * @param electronApp 当前 Electron 测试应用。
 * @param nameFragment 插件 URL 中的路径片段。
 * @returns 插件页面的脚本执行句柄。
 * @throws 超时未出现时抛出错误。
 */
async function waitForPluginContents(
  electronApp: ElectronApplication,
  nameFragment: string
): Promise<ContentsHandle> {
  await expect
    .poll(
      () =>
        electronApp.evaluate(
          ({ webContents }, fragment) =>
            webContents
              .getAllWebContents()
              .some((contents) => contents.getURL().includes(fragment) && !contents.isLoading()),
          nameFragment
        ),
      { timeout: 15_000 }
    )
    .toBe(true)
  return {
    executeJavaScript: (source: string) =>
      electronApp.evaluate(
        async ({ webContents }, payload) => {
          const plugin = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().includes(payload.fragment))
          if (!plugin) throw new Error('未找到插件 WebContents')
          return plugin.executeJavaScript(payload.source)
        },
        { fragment: nameFragment, source }
      )
  }
}

/**
 * 等待设置插件正文出现稳定文本。
 * @param electronApp 当前 Electron 测试应用。
 * @param expected 预期出现的正文文本。
 * @returns 文本出现后的 Promise。
 */
async function waitForSettingsText(
  electronApp: ElectronApplication,
  expected: string
): Promise<void> {
  await expect
    .poll(
      () =>
        electronApp.evaluate(async ({ webContents }) => {
          const pluginContents = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
          if (!pluginContents || pluginContents.isLoading()) return ''
          return pluginContents.executeJavaScript('document.body.innerText')
        }),
      { timeout: 15_000 }
    )
    .toContain(expected)
}

/**
 * 等待设置插件中的指定元素从页面移除。
 * @param electronApp 当前 Electron 测试应用。
 * @param selector 要等待消失的 CSS 选择器。
 * @returns 元素消失后的 Promise。
 */
async function waitForSettingsSelectorHidden(
  electronApp: ElectronApplication,
  selector: string
): Promise<void> {
  await expect
    .poll(
      () =>
        executeInSettings(
          electronApp,
          `Boolean(document.querySelector(${JSON.stringify(selector)}))`
        ),
      { timeout: 15_000 }
    )
    .toBe(false)
}

/**
 * 单独截取设置插件 WebContentsView 的当前可见区域。
 * @param electronApp 当前 Electron 测试应用。
 * @returns PNG 图片字节。
 */
async function captureSettingsPlugin(electronApp: ElectronApplication): Promise<Buffer> {
  const base64 = await electronApp.evaluate(async ({ webContents }) => {
    const pluginContents = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:15177'))
    if (!pluginContents) throw new Error('未找到设置插件 WebContentsView')
    return (await pluginContents.capturePage()).toPNG().toString('base64')
  })
  return Buffer.from(base64, 'base64')
}
