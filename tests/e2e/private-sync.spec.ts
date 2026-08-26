import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http, { type Server as HttpServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'

const projectRoot = path.resolve(__dirname, '../..')
const privateServerUrl = 'http://127.0.0.1:23618'

test('可以切换私有部署、登录并开启同步', async ({ browserName: _browserName }, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-private-sync-playwright-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const screenshotPath = testInfo.outputPath('private-sync-settings.png')
  const syncServer = await startPrivateSyncServer()
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    // 使用隔离目录启动 Electron，避免测试账号和同步配置进入真实用户数据。
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
    await executeInSettings(
      electronApp,
      `
      (async () => {
        await window.ztools.internal.accountSaveSession({
          username: 'official-user',
          token: ${JSON.stringify(createFutureJwt('official-user'))},
          refreshToken: ''
        })
        window.dispatchEvent(new CustomEvent('ztools-account-changed'))
      })()
    `
    )
    await waitForSettingsText(electronApp, 'official-user')
    await executeInSettings(
      electronApp,
      `
      [...document.querySelectorAll('.menu-item')]
        .find((item) => item.textContent?.includes('数据同步'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '使用 ZTools 官方同步服务')

    await executeInSettings(
      electronApp,
      `
      document.querySelector('[data-testid="sync-mode-private"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '切换同步服务')
    await executeInSettings(
      electronApp,
      `
      (() => {
        const button = Array.from(document.querySelectorAll('.dialog-overlay button'))
          .find((item) => item.textContent?.trim() === '切换到私有部署')
        if (!(button instanceof HTMLButtonElement)) throw new Error('未找到切换确认按钮')
        button.click()
      })()
    `
    )
    await waitForSettingsSelectorHidden(electronApp, '.dialog-overlay')
    await waitForSettingsText(electronApp, '服务器地址')

    // 切换页面会销毁同步设置组件，返回后必须从持久化 Profile 恢复私服选择。
    await executeInSettings(
      electronApp,
      `
      [...document.querySelectorAll('.menu-item')]
        .find((item) => item.textContent?.includes('通用设置'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '开机自动启动')
    await executeInSettings(
      electronApp,
      `
      [...document.querySelectorAll('.menu-item')]
        .find((item) => item.textContent?.includes('数据同步'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '服务器地址')
    const restoredSelection = await executeInSettings(
      electronApp,
      `
      ({
        privateSelected:
          document.querySelector('[data-testid="sync-mode-private"]')
            ?.getAttribute('aria-selected') === 'true',
        syncEnabled:
          document.querySelector('.header-toggle input[type="checkbox"]')?.checked === true
      })
    `
    )
    expect(restoredSelection).toEqual({ privateSelected: true, syncEnabled: false })

    // 通过原生 value setter 和 input 事件驱动 Vue v-model，覆盖真实表单交互链路。
    await fillSettingsInput(electronApp, 'private-sync-server', privateServerUrl)
    await fillSettingsInput(electronApp, 'private-sync-username', 'private-root')
    await fillSettingsInput(electronApp, 'private-sync-password', 'test-password')
    await executeInSettings(
      electronApp,
      `
      document.querySelector('[data-testid="private-sync-login"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '当前登录用户')
    await waitForSettingsText(electronApp, 'official-user')

    const loggedInView = await executeInSettings(
      electronApp,
      `
      ({
        hasSessionSummary: Boolean(document.querySelector('[data-testid="private-sync-session"]')),
        hasServerInput: Boolean(document.querySelector('[data-testid="private-sync-server"]')),
        hasUsernameInput: Boolean(document.querySelector('[data-testid="private-sync-username"]')),
        hasPasswordInput: Boolean(document.querySelector('[data-testid="private-sync-password"]')),
        server: document.querySelector('[data-testid="private-sync-current-server"]')?.textContent?.trim(),
        username: document.querySelector('[data-testid="private-sync-current-user"]')?.textContent?.trim()
      })
    `
    )
    expect(loggedInView).toEqual({
      hasSessionSummary: true,
      hasServerInput: false,
      hasUsernameInput: false,
      hasPasswordInput: false,
      server: 'ws://127.0.0.1:23618',
      username: 'private-root'
    })

    await executeInSettings(
      electronApp,
      `
      document.querySelector('.header-toggle input[type="checkbox"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '实时同步中')
    await waitForSettingsSelectorHidden(electronApp, '.toast')

    const screenshot = await captureSettingsPlugin(electronApp)
    await fs.writeFile(screenshotPath, screenshot)
    await testInfo.attach('private-sync-settings', {
      body: screenshot,
      contentType: 'image/png'
    })

    // 运行中注销必须关闭同步、保留私服选择，并恢复不含密码的登录表单。
    await executeInSettings(
      electronApp,
      `
      document.querySelector('[data-testid="private-sync-logout"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    `
    )
    await waitForSettingsText(electronApp, '注销私有同步服务器')
    await executeInSettings(
      electronApp,
      `
      (() => {
        const button = Array.from(document.querySelectorAll('.dialog-overlay button'))
          .find((item) => item.textContent?.trim() === '注销登录')
        if (!(button instanceof HTMLButtonElement)) throw new Error('未找到注销确认按钮')
        button.click()
      })()
    `
    )
    await waitForSettingsSelectorHidden(electronApp, '.dialog-overlay')
    await waitForSettingsText(electronApp, '登录服务器')

    const loggedOutView = await executeInSettings(
      electronApp,
      `
      ({
        privateSelected:
          document.querySelector('[data-testid="sync-mode-private"]')
            ?.getAttribute('aria-selected') === 'true',
        syncEnabled:
          document.querySelector('.header-toggle input[type="checkbox"]')?.checked === true,
        server: document.querySelector('[data-testid="private-sync-server"]')?.value,
        username: document.querySelector('[data-testid="private-sync-username"]')?.value,
        password: document.querySelector('[data-testid="private-sync-password"]')?.value
      })
    `
    )
    expect(loggedOutView).toEqual({
      privateSelected: true,
      syncEnabled: false,
      server: 'ws://127.0.0.1:23618',
      username: 'private-root',
      password: ''
    })
  } finally {
    // 始终关闭 Electron、临时服务和明确创建的隔离测试目录。
    await electronApp?.close()
    await stopHttpServer(syncServer)
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('个人中心确认删除账号后退出登录', async ({ browserName: _browserName }, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-account-delete-playwright-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const accountDirectory = path.join(
    dataRoot,
    'lmdb',
    'accounts',
    crypto.createHash('sha256').update('delete-account-user').digest('hex').slice(0, 16)
  )
  const screenshotPath = testInfo.outputPath('account-delete-confirmation.png')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    // 使用完全隔离的账号会话验证删除流程，不访问线上服务或真实用户数据。
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
    await executeInSettings(
      electronApp,
      `
      (async () => {
        await window.ztools.internal.accountSaveSession({
          username: 'delete-account-user',
          token: ${JSON.stringify(createFutureJwt('delete-account-user'))},
          refreshToken: ''
        })
        window.ztools.db.put({
          _id: 'PLUGIN/e2e/account-delete-marker',
          data: { account: 'delete-account-user' }
        })
        window.dispatchEvent(new CustomEvent('ztools-account-changed'))
      })()
    `
    )
    await expect(fs.stat(accountDirectory)).resolves.toBeTruthy()
    await waitForSettingsText(electronApp, 'delete-account-user')
    await executeInSettings(
      electronApp,
      `document.querySelector('.account-dock')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`
    )
    await waitForSettingsText(electronApp, '云同步用量')

    await executeInSettings(
      electronApp,
      `document.querySelector('[data-testid="delete-account"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`
    )
    await waitForSettingsText(electronApp, '云同步数据、评论及其他账号相关数据将被删除')
    await waitForSettingsDialogStable(electronApp)

    const screenshot = await captureSettingsPlugin(electronApp)
    await fs.writeFile(screenshotPath, screenshot)
    await testInfo.attach('account-delete-confirmation', {
      body: screenshot,
      contentType: 'image/png'
    })

    await executeInSettings(
      electronApp,
      `
      (() => {
        const button = Array.from(document.querySelectorAll('.dialog-overlay button'))
          .find((item) => item.textContent?.trim() === '永久删除')
        if (!(button instanceof HTMLButtonElement)) throw new Error('未找到永久删除确认按钮')
        button.click()
      })()
    `
    )
    await waitForSettingsText(electronApp, '开机自动启动')
    await waitForSettingsText(electronApp, '注册/登录 ZTools')

    const accountState = await executeInSettings(
      electronApp,
      `(async () => await window.ztools.internal.accountGetSession())()`
    )
    expect(accountState).toMatchObject({
      success: true,
      session: { username: 'delete-account-user', token: '', refreshToken: '' }
    })
    await expect(fs.stat(accountDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    // 始终关闭隔离 Electron，并且只清理本用例创建的数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('个人中心修改密码后退出登录并保留本地账号数据', async ({ browserName: _browserName }) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-account-password-playwright-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const accountDirectory = path.join(
    dataRoot,
    'lmdb',
    'accounts',
    crypto.createHash('sha256').update('change-password-user').digest('hex').slice(0, 16)
  )
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    // 使用隔离账号验证密码表单和本地退出流程，不触发线上密码修改请求。
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
    await executeInSettings(
      electronApp,
      `
      (async () => {
        await window.ztools.internal.accountSaveSession({
          username: 'change-password-user',
          token: ${JSON.stringify(createFutureJwt('change-password-user'))},
          refreshToken: ''
        })
        window.ztools.db.put({
          _id: 'PLUGIN/e2e/password-marker',
          data: { account: 'change-password-user' }
        })
        window.dispatchEvent(new CustomEvent('ztools-account-changed'))
      })()
    `
    )
    await expect(fs.stat(accountDirectory)).resolves.toBeTruthy()
    await waitForSettingsText(electronApp, 'change-password-user')
    await executeInSettings(
      electronApp,
      `document.querySelector('.account-dock')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`
    )
    await waitForSettingsText(electronApp, '云同步用量')

    await executeInSettings(
      electronApp,
      `document.querySelector('[data-testid="change-password"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`
    )
    await waitForSettingsText(electronApp, '修改成功后，所有设备都会退出登录')
    await fillSettingsInput(electronApp, 'current-password', 'old-password')
    await fillSettingsInput(electronApp, 'new-password', 'new-password')
    await fillSettingsInput(electronApp, 'confirm-password', 'new-password')
    await executeInSettings(
      electronApp,
      `document.querySelector('[data-testid="submit-password-change"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`
    )
    await waitForSettingsText(electronApp, '开机自动启动')
    await waitForSettingsText(electronApp, '注册/登录 ZTools')

    const accountState = await executeInSettings(
      electronApp,
      `(async () => await window.ztools.internal.accountGetSession())()`
    )
    expect(accountState).toMatchObject({
      success: true,
      session: { username: 'change-password-user', token: '', refreshToken: '' }
    })
    await expect(fs.stat(accountDirectory)).resolves.toBeTruthy()
  } finally {
    // 始终关闭 Electron，并清理当前用例创建的隔离数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

/**
 * 启动满足登录、checkpoint、空数据拉取和心跳流程的最小同步服务。
 * @returns 已开始监听测试端口的 HTTP 服务。
 */
async function startPrivateSyncServer(): Promise<HttpServer> {
  const server = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/api/auth') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          isNew: false,
          token: createFutureJwt('private-root'),
          refreshToken: 'private-refresh-token'
        })
      )
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
  })
  const websocketServer = new WebSocketServer({ server })
  websocketServer.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.type === 'auth') {
        socket.send(
          JSON.stringify({
            type: 'auth_ok',
            serverSeq: 0,
            serverInstanceId: 'e2e-private-server',
            protocolVersion: 2,
            syncEpoch: 1,
            features: { snapshotPull: true, revisionRetention: true }
          })
        )
      } else if (message.type === 'get_checkpoint') {
        socket.send(JSON.stringify({ type: 'checkpoint', checkpoint: null }))
      } else if (message.type === 'pull') {
        socket.send(
          JSON.stringify({
            type: 'changes',
            changes: [],
            seq: 0,
            snapshot: true,
            reset: true,
            syncEpoch: 1
          })
        )
      } else if (message.type === 'put_checkpoint') {
        socket.send(JSON.stringify({ type: 'checkpoint_ok', checkpoint: message.checkpoint }))
      } else if (message.type === 'push') {
        socket.send(JSON.stringify({ type: 'push_ok', seq: 0 }))
      } else if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }))
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(23618, '127.0.0.1', resolve)
  })
  return server
}

/**
 * 创建仅供客户端有效期判断使用的未来过期 JWT。
 * @param uid 测试账号标识。
 * @returns 三段式 JWT 字符串。
 */
function createFutureJwt(uid: string): string {
  /**
   * 将 JWT JSON 段编码为 base64url。
   * @param value 要编码的 JWT 段对象。
   * @returns base64url 编码字符串。
   */
  const encode = (value: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ uid, exp: 4_102_444_800 })}.signature`
}

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
 * 等待设置插件中的指定元素从页面移除，防止测试绕过仍然可见的模态遮罩。
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
 * 等待设置插件确认弹窗完成进入动画并恢复交互，确保截图包含稳定对话框。
 * @param electronApp 当前 Electron 测试应用。
 * @returns 弹窗视觉状态稳定后的 Promise。
 */
async function waitForSettingsDialogStable(electronApp: ElectronApplication): Promise<void> {
  await expect
    .poll(
      () =>
        executeInSettings(
          electronApp,
          `
          (() => {
            const overlay = document.querySelector('.dialog-overlay')
            if (!(overlay instanceof HTMLElement)) return false
            const style = getComputedStyle(overlay)
            return style.opacity === '1' && style.pointerEvents !== 'none'
          })()
        `
        ),
      { timeout: 15_000 }
    )
    .toBe(true)
}

/**
 * 填写设置插件内的输入框并触发 Vue 的 input 事件。
 * @param electronApp 当前 Electron 测试应用。
 * @param testId 输入框的 data-testid。
 * @param value 要填写的值。
 * @returns 输入事件分发完成后的 Promise。
 */
async function fillSettingsInput(
  electronApp: ElectronApplication,
  testId: string,
  value: string
): Promise<void> {
  await executeInSettings(
    electronApp,
    `
      (() => {
        const input = document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)})
        if (!(input instanceof HTMLInputElement)) throw new Error('未找到输入框')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, ${JSON.stringify(value)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()
    `
  )
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

/**
 * 关闭测试 HTTP 服务并等待端口完成释放。
 * @param server 要关闭的 HTTP 服务。
 * @returns 服务关闭后的 Promise。
 */
async function stopHttpServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
}
