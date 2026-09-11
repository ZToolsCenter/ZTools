import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const settingsUrlFragments = ['http://127.0.0.1:15177', 'internal-plugins/setting/index.html']
const evidenceDir = process.env.ZTOOLS_ORCA_EVIDENCE_DIR || '/work/evidence'
const catalogSource = 'https://api.orcarouter.ai/v1/models?capability=chat'

/**
 * 使用隔离数据目录启动当前构建的 ZTools 测试实例。
 * @param dataRoot 测试实例专用数据目录。
 * @param legacyRoot 测试实例专用旧数据目录。
 * @returns 已启动的 Electron 应用实例。
 */
async function launchTestApp(dataRoot: string, legacyRoot: string): Promise<ElectronApplication> {
  return await electron.launch({
    // 容器内没有 SUID sandbox 与 X 服务，使用 headless ozone 平台运行真实 Electron。
    args: [projectRoot, '--no-sandbox', '--ozone-platform=headless', '--disable-dev-shm-usage'],
    cwd: projectRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      ZTOOLS_DATA_ROOT: dataRoot,
      ZTOOLS_E2E: '1',
      ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
    }
  })
}

/**
 * 在设置插件 WebContentsView 中执行脚本。
 * @param electronApp 当前隔离 Electron 应用实例。
 * @param source 要在设置页面执行的 JavaScript 源码。
 * @returns 脚本执行结果。
 */
async function executeInSettings(
  electronApp: ElectronApplication,
  source: string
): Promise<unknown> {
  return await electronApp.evaluate(
    async ({ webContents }, { script, urlFragments }) => {
      const settingsContents = webContents
        .getAllWebContents()
        .find((contents) => urlFragments.some((fragment) => contents.getURL().includes(fragment)))
      if (!settingsContents) throw new Error('未找到内置设置插件 WebContentsView')
      return await settingsContents.executeJavaScript(script)
    },
    { script: source, urlFragments: settingsUrlFragments }
  )
}

/**
 * 等待设置页正文中的稳定特征出现。
 * @param app 当前隔离 Electron 应用实例。
 * @param selector 要等待的选择器。
 * @param timeout 超时时间（毫秒）。
 * @returns 操作完成后结束的 Promise
 */
async function waitForSelector(
  app: ElectronApplication,
  selector: string,
  timeout = 20_000
): Promise<void> {
  const deadline = Date.now() + timeout
  for (;;) {
    const found = await executeInSettings(
      app,
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`
    )
    if (found) return
    if (Date.now() > deadline) throw new Error(`等待选择器超时: ${selector}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * 读取模型选择弹窗的 listbox 结构与视觉约束。
 * @param app 当前隔离 Electron 应用实例。
 * @returns 弹窗尺寸、背景、边框与对齐数据
 */
async function readDropdownMetrics(app: ElectronApplication): Promise<{
  itemCount: number
  panelWidth: number
  rightDelta: number
  opaqueBackground: boolean
  visibleBorder: boolean
  expanded: boolean
}> {
  return (await executeInSettings(
    app,
    `(() => {
      const panels = Array.from(document.querySelectorAll('[role="listbox"][aria-expanded="true"]'))
      const panel = panels[panels.length - 1]
      if (!panel) return null
      const trigger = document.querySelector('[data-testid="fetch-models"]')
      const panelRect = panel.getBoundingClientRect()
      const triggerRect = trigger ? trigger.getBoundingClientRect() : null
      const style = getComputedStyle(panel)
      const background = style.backgroundColor || ''
      const borderWidth = parseFloat(style.borderTopWidth || '0')
      const alpha = (() => {
        const match = background.match(/rgba?\\(([^)]+)\\)/)
        if (!match) return 0
        const parts = match[1].split(',').map((value) => parseFloat(value.trim()))
        return parts.length === 4 ? parts[3] : 1
      })()
      return {
        itemCount: panel.querySelectorAll('[role="option"]').length,
        panelWidth: Math.round(panelRect.width),
        rightDelta: triggerRect ? Math.round(Math.abs(triggerRect.right - panelRect.right)) : -1,
        opaqueBackground: alpha >= 1,
        visibleBorder: borderWidth > 0 && style.borderTopStyle !== 'none',
        expanded: panel.getAttribute('aria-expanded') === 'true'
      }
    })()`
  )) as {
    itemCount: number
    panelWidth: number
    rightDelta: number
    opaqueBackground: boolean
    visibleBorder: boolean
    expanded: boolean
  }
}

/**
 * 截取设置插件 WebContentsView 并写入证据目录。
 * @param app 当前隔离 Electron 应用实例。
 * @param fileName 证据文件名。
 * @returns 操作完成后结束的 Promise
 */
async function captureEvidence(app: ElectronApplication, fileName: string): Promise<void> {
  const dataUrl = await app.evaluate(async ({ webContents }) => {
    const settings = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('127.0.0.1:15177'))
    if (!settings) throw new Error('未找到设置插件 WebContentsView')
    const image = await settings.capturePage()
    return image.toDataURL()
  })
  const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '')
  await fs.writeFile(path.join(evidenceDir, fileName), Buffer.from(base64, 'base64'))
}

/**
 * 计算证据文件的 SHA-256。
 * @param filePath 文件路径。
 * @returns 十六进制摘要。
 */
async function sha256(filePath: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  const buffer = await fs.readFile(filePath)
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * 按模型下拉的测试数据准备一个 OrcaRouter 供应商。
 * @returns 无返回值
 */
test('OrcaRouter provider exposes API-key and PKCE auth plus capability-filtered model dropdowns', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-orca-data-'))
  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-orca-legacy-'))
  await fs.mkdir(evidenceDir, { recursive: true })

  const apiKey = process.env.ORCAROUTER_API_KEY
  if (!apiKey) throw new Error('缺少 ORCAROUTER_API_KEY，无法拉取真实模型目录')

  const app = await launchTestApp(dataRoot, legacyRoot)

  try {
    // 通过主进程的 provider API 直接创建 OrcaRouter 供应商，密钥只停留在主进程。
    await executeInSettings(
      app,
      `(async () => {
        const created = await window.ztools.internal.aiProviders.add({
          name: 'OrcaRouter',
          apiUrl: 'https://api.orcarouter.ai/v1',
          apiKey: ${JSON.stringify(apiKey)},
          apiFormat: 'openai-chat',
          presetId: 'orcarouter',
          selectedModels: [{ modelId: 'orcarouter/auto', inputModalities: ['text'] }]
        })
        if (!created.success) throw new Error(created.error || '创建 OrcaRouter 供应商失败')
        const provider = created.data.providers.find((item) => item.presetId === 'orcarouter')
        const applied = await window.ztools.internal.aiProviders.orcaApplyApiKey(
          provider.id,
          ${JSON.stringify(apiKey)}
        )
        if (!applied.success) throw new Error(applied.error || '保存凭据失败')
        return true
      })()`
    )

    // 进入设置页的 AI 供应商面板。
    await executeInSettings(
      app,
      `(async () => {
        location.hash = '#/providers?tab=ai'
        return true
      })()`
    )
    await waitForSelector(app, '[data-testid="fetch-models"]')

    // 打开 OrcaRouter 供应商编辑器。
    await executeInSettings(
      app,
      `(() => {
        const cards = Array.from(document.querySelectorAll('*')).filter((node) =>
          node.children.length === 0 && node.textContent && node.textContent.trim() === 'OrcaRouter'
        )
        const target = cards[cards.length - 1]
        if (!target) throw new Error('未找到 OrcaRouter 供应商卡片')
        const clickable = target.closest('button, [role="button"], .provider-card, .card') || target
        clickable.click()
        return true
      })()`
    )
    await waitForSelector(app, '[data-testid="fetch-models"]')
    await new Promise((resolve) => setTimeout(resolve, 500))

    // 断言两种认证入口同时可见，且密钥控件为密码类型。
    const authState = (await executeInSettings(
      app,
      `(() => {
        const apiRadio = document.querySelector('#orca-auth-api-key')
        const pkceRadio = document.querySelector('#orca-auth-pkce')
        const connect = Array.from(document.querySelectorAll('button')).find(
          (node) => node.textContent && node.textContent.includes('Connect with OrcaRouter')
        )
        const keyInput = document.querySelector('input[placeholder="sk-orca-…"]')
        const anyTextInput = Array.from(document.querySelectorAll('input')).find(
          (node) => node.value && node.value.startsWith('sk-orca-')
        )
        return {
          apiKeyEntryVisible: Boolean(apiRadio),
          pkceEntryVisible: Boolean(pkceRadio && connect),
          secretMasked: Boolean(keyInput) && keyInput.type === 'password',
          controlsEnabled: Boolean(apiRadio && !apiRadio.disabled && connect && !connect.disabled),
          leakedRawKeyInput: Boolean(anyTextInput)
        }
      })()`
    )) as {
      apiKeyEntryVisible: boolean
      pkceEntryVisible: boolean
      secretMasked: boolean
      controlsEnabled: boolean
      leakedRawKeyInput: boolean
    }

    expect(authState.apiKeyEntryVisible).toBe(true)
    expect(authState.pkceEntryVisible).toBe(true)
    expect(authState.secretMasked).toBe(true)
    expect(authState.controlsEnabled).toBe(true)
    expect(authState.leakedRawKeyInput).toBe(false)

    await captureEvidence(app, 'auth-methods.png')

    // 拉取真实目录并展开文本入口的模型下拉。
    const textCatalog = (await executeInSettings(
      app,
      `(async () => {
        const discovered = await window.ztools.internal.aiProviders.discoverModels({
          capability: 'chat'
        })
        return discovered
      })()`
    )) as { success: boolean; data?: { models: Array<{ id: string }>; degraded: boolean } }
    expect(textCatalog.success).toBe(true)
    expect(textCatalog.data?.degraded).toBe(false)

    await executeInSettings(app, `document.querySelector('[data-testid="fetch-models"]').click()`)
    await waitForSelector(app, '[role="listbox"][aria-expanded="true"]')
    const textMetrics = await readDropdownMetrics(app)
    expect(textMetrics.expanded).toBe(true)
    expect(textMetrics.itemCount).toBeGreaterThan(5)
    expect(textMetrics.opaqueBackground).toBe(true)
    expect(textMetrics.visibleBorder).toBe(true)
    expect(textMetrics.rightDelta).toBeLessThanOrEqual(2)

    await captureEvidence(app, 'text-model-dropdown.png')

    // 加入 image 附件后重算下拉，只保留显式声明 image 输入的对话模型。
    await executeInSettings(
      app,
      `(() => {
        document.querySelector('[data-testid="orca-image-attachment"]').click()
        return true
      })()`
    )
    await executeInSettings(app, `document.querySelector('[data-testid="fetch-models"]').click()`)
    await waitForSelector(app, '[role="listbox"][aria-expanded="true"]')
    const multimodalMetrics = await readDropdownMetrics(app)
    const multimodalCatalog = (await executeInSettings(
      app,
      `(async () => await window.ztools.internal.aiProviders.discoverModels({
        capability: 'chat',
        requiredModalities: ['image']
      }))()`
    )) as { success: boolean; data?: { models: Array<{ id: string }> } }

    expect(multimodalMetrics.expanded).toBe(true)
    expect(multimodalMetrics.itemCount).toBe(multimodalCatalog.data?.models.length ?? 0)
    expect(multimodalMetrics.itemCount).toBeLessThan(textMetrics.itemCount)
    expect(multimodalMetrics.opaqueBackground).toBe(true)
    expect(multimodalMetrics.visibleBorder).toBe(true)
    expect(multimodalMetrics.rightDelta).toBeLessThanOrEqual(2)

    await captureEvidence(app, 'multimodal-model-dropdown.png')

    const manifest = {
      automation: {
        framework: 'playwright',
        test_command: 'pnpm test:e2e -- tests/e2e/orcaProvider.spec.ts',
        passed: true,
        catalog_source: catalogSource,
        catalog_model_count: textMetrics.itemCount,
        image_model_count: multimodalMetrics.itemCount
      },
      artifacts: [
        {
          kind: 'auth-methods',
          path: '/work/evidence/auth-methods.png',
          sha256: await sha256('/work/evidence/auth-methods.png'),
          ui: {
            api_key_visible: true,
            pkce_visible: true,
            secret_masked: true,
            controls_enabled: true
          }
        },
        {
          kind: 'text-model-dropdown',
          path: '/work/evidence/text-model-dropdown.png',
          sha256: await sha256('/work/evidence/text-model-dropdown.png'),
          ui: {
            dropdown_open: true,
            item_count: textMetrics.itemCount,
            panel_width: textMetrics.panelWidth,
            trigger_panel_right_delta: textMetrics.rightDelta,
            opaque_background: true,
            visible_border: true
          }
        },
        {
          kind: 'multimodal-model-dropdown',
          path: '/work/evidence/multimodal-model-dropdown.png',
          sha256: await sha256('/work/evidence/multimodal-model-dropdown.png'),
          ui: {
            dropdown_open: true,
            item_count: multimodalMetrics.itemCount,
            panel_width: multimodalMetrics.panelWidth,
            trigger_panel_right_delta: multimodalMetrics.rightDelta,
            opaque_background: true,
            visible_border: true
          }
        }
      ]
    }
    await fs.writeFile(path.join(evidenceDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  } finally {
    await app.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
    await fs.rm(legacyRoot, { recursive: true, force: true })
  }
})
