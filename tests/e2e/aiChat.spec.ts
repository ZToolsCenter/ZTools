import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const settingsUrlFragment = 'http://127.0.0.1:15177'

interface MockRequestRecord {
  url: string
  authorization: string
  apiKey: string
  body: Record<string, unknown>
}

interface MockAiServer {
  server: Server
  baseUrl: string
  requests: MockRequestRecord[]
}

/**
 * 读取请求正文并解析为 JSON 对象。
 * @param request Node HTTP 请求
 * @returns 解析后的请求对象
 * @throws 请求正文不是合法 JSON 时抛出错误
 */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

/**
 * 向 OpenAI 兼容流写入一个 SSE 数据事件。
 * @param response Node HTTP 响应
 * @param payload Chat Completions 流式分片
 * @returns 无返回值
 */
function writeSse(response: ServerResponse, payload: Record<string, unknown>): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

/**
 * 从请求消息中提取最后一条纯文本用户内容，用于选择模拟场景。
 * @param body Chat Completions 请求正文
 * @returns 最后一条用户消息文本
 */
function getLastUserText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const user = [...messages]
    .reverse()
    .find((message) => message && typeof message === 'object' && message.role === 'user') as
    | { content?: unknown }
    | undefined
  return typeof user?.content === 'string' ? user.content : ''
}

/**
 * 按测试场景返回推理、工具、截断、取消或并发响应。
 * @param request Node HTTP 请求
 * @param response Node HTTP 响应
 * @param requests 服务端收到的请求记录
 * @returns 响应结束后完成的 Promise
 */
async function handleMockAiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: MockRequestRecord[]
): Promise<void> {
  if (request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }

  const body = await readJsonBody(request)
  requests.push({
    url: request.url || '',
    authorization: String(request.headers.authorization || ''),
    apiKey: String(request.headers['x-api-key'] || ''),
    body
  })
  if (request.url === '/v1/messages') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    const messages = Array.isArray(body.messages) ? body.messages : []
    const hasToolResult = messages.some(
      (message) =>
        message &&
        typeof message === 'object' &&
        Array.isArray(message.content) &&
        message.content.some(
          (block: unknown) =>
            block &&
            typeof block === 'object' &&
            (block as { type?: unknown }).type === 'tool_result'
        )
    )
    const isToolReplay = JSON.stringify(messages).includes('anthropic-tool')
    if (isToolReplay && hasToolResult) {
      writeSse(response, {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Anthropic 工具完成' }
      })
      writeSse(response, { type: 'message_stop' })
      response.end()
      return
    }
    writeSse(response, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' }
    })
    writeSse(response, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Anthropic 分析' }
    })
    writeSse(response, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'anthropic-signature' }
    })
    if (isToolReplay) {
      writeSse(response, {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'call-anthropic', name: 'tool_probe' }
      })
      writeSse(response, {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"value":1}' }
      })
      writeSse(response, { type: 'content_block_stop', index: 1 })
      writeSse(response, {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 8 }
      })
      writeSse(response, { type: 'message_stop' })
      response.end()
      return
    }
    writeSse(response, {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'Anthropic 答案' }
    })
    writeSse(response, { type: 'message_stop' })
    response.end()
    return
  }
  if (request.url === '/v1/responses') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    const input = Array.isArray(body.input) ? body.input : []
    const hasToolOutput = input.some(
      (item) => item && typeof item === 'object' && item.type === 'function_call_output'
    )
    const isToolReplay = JSON.stringify(input).includes('responses-tool')
    if (isToolReplay && hasToolOutput) {
      writeSse(response, { type: 'response.output_text.delta', delta: 'Responses 工具完成' })
      writeSse(response, {
        type: 'response.completed',
        response: {
          id: 'resp-responses-second',
          status: 'completed',
          output: [
            {
              id: 'msg-responses-second',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Responses 工具完成' }]
            }
          ]
        }
      })
      response.end('data: [DONE]\n\n')
      return
    }
    writeSse(response, { type: 'response.reasoning_text.delta', delta: 'Responses 分析' })
    if (isToolReplay) {
      writeSse(response, {
        type: 'response.completed',
        response: {
          id: 'resp-responses-first',
          status: 'completed',
          output: [
            {
              id: 'rs-responses-first',
              type: 'reasoning',
              encrypted_content: 'responses-encrypted',
              summary: [{ type: 'summary_text', text: 'Responses 分析' }]
            },
            {
              id: 'fc-responses-first',
              type: 'function_call',
              call_id: 'call-responses',
              name: 'tool_probe',
              arguments: '{"value":1}'
            }
          ]
        }
      })
      response.end('data: [DONE]\n\n')
      return
    }
    writeSse(response, { type: 'response.output_text.delta', delta: 'Responses 答案' })
    writeSse(response, {
      type: 'response.completed',
      response: {
        id: 'resp-responses-single',
        status: 'completed',
        output: [
          {
            id: 'rs-responses-single',
            type: 'reasoning',
            encrypted_content: 'responses-single-encrypted',
            content: [{ type: 'reasoning_text', text: 'Responses 分析' }]
          },
          {
            id: 'msg-responses-single',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Responses 答案' }]
          }
        ]
      }
    })
    response.end('data: [DONE]\n\n')
    return
  }
  if (request.url !== '/v1/chat/completions') {
    response.writeHead(404).end()
    return
  }

  const prompt = getLastUserText(body)
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })

  if (prompt === 'abort') {
    writeSse(response, {
      choices: [{ index: 0, delta: { reasoning_content: '等待取消' }, finish_reason: null }]
    })
    return
  }

  if (prompt === 'truncated') {
    writeSse(response, {
      choices: [{ index: 0, delta: { content: '不完整' }, finish_reason: null }]
    })
    response.end('data: [DONE]\n\n')
    return
  }

  if (prompt.startsWith('concurrent-')) {
    await new Promise((resolve) => setTimeout(resolve, prompt.endsWith('a') ? 80 : 15))
    writeSse(response, {
      choices: [{ index: 0, delta: { content: prompt }, finish_reason: 'stop' }]
    })
    response.end('data: [DONE]\n\n')
    return
  }

  writeSse(response, {
    choices: [{ index: 0, delta: { reasoning_content: '先检查工具' }, finish_reason: null }]
  })
  writeSse(response, {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call-e2e',
              type: 'function',
              function: { name: 'tool_probe', arguments: '{"value":' }
            }
          ]
        },
        finish_reason: null
      }
    ]
  })
  writeSse(response, {
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] },
        finish_reason: 'tool_calls'
      }
    ],
    usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 }
  })
  response.end('data: [DONE]\n\n')
}

/**
 * 启动仅监听回环地址的 OpenAI 兼容模拟服务。
 * @returns 服务实例、基础地址和请求记录
 */
async function startMockAiServer(): Promise<MockAiServer> {
  const requests: MockRequestRecord[] = []
  const server = http.createServer((request, response) => {
    void handleMockAiRequest(request, response, requests).catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          error: { message: error instanceof Error ? error.message : '模拟服务失败' }
        })
      )
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法获取模拟 AI 服务端口')
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, requests }
}

/**
 * 创建用于验证公共 AI 桥接的最小开发插件。
 * @param pluginRoot 测试插件目录
 * @returns 插件清单绝对路径
 */
async function createTestPlugin(pluginRoot: string): Promise<string> {
  await fs.mkdir(pluginRoot, { recursive: true })
  await fs.copyFile(
    path.join(projectRoot, 'resources/icons/icon.png'),
    path.join(pluginRoot, 'logo.png')
  )
  await fs.writeFile(
    path.join(pluginRoot, 'plugin.json'),
    JSON.stringify(
      {
        name: 'ai-chat-e2e-plugin',
        title: 'AI Chat E2E',
        version: '1.0.0',
        main: 'index.html',
        preload: 'preload.js',
        logo: 'logo.png',
        features: [{ code: 'ai-chat-e2e', explain: 'AI Chat E2E', cmds: ['AI Chat E2E'] }]
      },
      null,
      2
    )
  )
  await fs.writeFile(path.join(pluginRoot, 'preload.js'), "'use strict'\n")
  await fs.writeFile(
    path.join(pluginRoot, 'index.html'),
    `<!doctype html><html><body data-e2e="ai-chat"><main>AI Chat E2E Ready</main><script>
window.caseResults = {}
window.toolExecutions = 0
window.tool_probe = () => { window.toolExecutions += 1; return 'unexpected' }
window.runAiCase = async (prompt, streamBatchIntervalMs = 0, providerLabel = '') => {
  const models = await window.ztools.allAiModels()
  const selectedModel = models.find((model) => model.providerLabel === providerLabel) || models[0]
  const events = []
  try {
    const request = window.ztools.aiChat({
      model: selectedModel?.value,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'function', function: { name: 'tool_probe', description: '测试工具', parameters: { type: 'object', properties: { value: { type: 'number' } } } } }],
      streamBatchIntervalMs
    }, (event) => events.push(event))
    window.activeAiRequest = request
    const result = await request
    return { models, events, result, toolExecutions: window.toolExecutions }
  } catch (error) {
    return { models, events, error: { name: error.name, code: error.code, status: error.status, message: error.message } }
  } finally {
    window.activeAiRequest = null
  }
}
window.runAiToolLoopCase = async (prompt, providerLabel) => {
  const models = await window.ztools.allAiModels()
  const selectedModel = models.find((model) => model.providerLabel === providerLabel)
  const tools = [{ type: 'function', function: { name: 'tool_probe', description: '测试工具', parameters: { type: 'object', properties: { value: { type: 'number' } } } } }]
  const firstEvents = []
  const first = await window.ztools.aiChat({
    model: selectedModel?.value,
    messages: [{ role: 'user', content: prompt }],
    tools
  }, (event) => firstEvents.push(event))
  const secondEvents = []
  const second = await window.ztools.aiChat({
    model: selectedModel?.value,
    messages: [
      { role: 'user', content: prompt },
      {
        role: 'assistant',
        content: first.content,
        reasoning_content: first.reasoning_content,
        tool_calls: first.tool_calls,
        replay_state: first.replay_state
      },
      { role: 'tool', content: '{"ok":true}', tool_call_id: first.tool_calls[0].id }
    ],
    tools
  }, (event) => secondEvents.push(event))
  return { first, firstEvents, second, secondEvents }
}
window.startAiCase = (prompt) => {
  window.caseResults[prompt] = null
  window.runAiCase(prompt).then((result) => { window.caseResults[prompt] = result })
  return true
}
</script></body></html>`
  )
  return path.join(pluginRoot, 'plugin.json')
}

/**
 * 创建不发起 AI 请求的对照插件，用于验证主窗口状态按插件隔离。
 * @param pluginRoot 对照插件目录
 * @returns 插件清单绝对路径
 */
async function createIdleTestPlugin(pluginRoot: string): Promise<string> {
  await fs.mkdir(pluginRoot, { recursive: true })
  await fs.copyFile(
    path.join(projectRoot, 'resources/icons/icon.png'),
    path.join(pluginRoot, 'logo.png')
  )
  await fs.writeFile(
    path.join(pluginRoot, 'plugin.json'),
    JSON.stringify(
      {
        name: 'ai-idle-e2e-plugin',
        title: 'AI Idle E2E',
        version: '1.0.0',
        main: 'index.html',
        preload: 'preload.js',
        logo: 'logo.png',
        features: [{ code: 'ai-idle-e2e', explain: 'AI Idle E2E', cmds: ['AI Idle E2E'] }]
      },
      null,
      2
    )
  )
  await fs.writeFile(path.join(pluginRoot, 'preload.js'), "'use strict'\n")
  await fs.writeFile(
    path.join(pluginRoot, 'index.html'),
    '<!doctype html><html><body data-e2e="ai-idle"><main>AI Idle E2E Ready</main></body></html>'
  )
  return path.join(pluginRoot, 'plugin.json')
}

/**
 * 在设置插件 WebContentsView 中执行受控脚本。
 * @param electronApp 隔离的 Electron 应用
 * @param source 页面脚本
 * @returns 页面脚本执行结果
 * @throws 设置插件尚未加载时抛出错误
 */
async function executeInSettings(
  electronApp: ElectronApplication,
  source: string
): Promise<unknown> {
  return electronApp.evaluate(async ({ webContents }, script) => {
    const contents = webContents.getAllWebContents().find((candidate) => {
      const url = candidate.getURL()
      return (
        url.startsWith('http://127.0.0.1:15177') ||
        url.includes('internal-plugins/setting/index.html')
      )
    })
    if (!contents) throw new Error('未找到设置插件 WebContentsView')
    return contents.executeJavaScript(script)
  }, source)
}

/**
 * 在临时 AI 测试插件 WebContentsView 中执行脚本。
 * @param electronApp 隔离的 Electron 应用
 * @param source 页面脚本
 * @returns 页面脚本执行结果
 * @throws 测试插件尚未加载时抛出错误
 */
async function executeInTestPlugin(
  electronApp: ElectronApplication,
  source: string
): Promise<unknown> {
  return electronApp.evaluate(async ({ webContents }, script) => {
    for (const contents of webContents.getAllWebContents()) {
      const matched = await contents
        .executeJavaScript(`document.body?.dataset?.e2e === 'ai-chat'`)
        .catch(() => false)
      if (matched) return contents.executeJavaScript(script)
    }
    throw new Error('未找到 AI Chat 测试插件 WebContentsView')
  }, source)
}

/**
 * 读取临时 AI 测试插件正文，供 Playwright 轮询视图创建和加载。
 * @param electronApp 隔离的 Electron 应用
 * @returns 测试插件正文；尚未创建视图时为空字符串
 */
async function readTestPluginText(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(async ({ webContents }) => {
    for (const contents of webContents.getAllWebContents()) {
      const matched = await contents
        .executeJavaScript(`document.body?.dataset?.e2e === 'ai-chat'`)
        .catch(() => false)
      if (matched) return contents.executeJavaScript('document.body.innerText')
    }
    return ''
  })
}

/**
 * 读取对照插件正文，供 Playwright 等待插件切换完成。
 * @param electronApp 隔离的 Electron 应用
 * @returns 对照插件正文；尚未创建视图时为空字符串
 */
async function readIdleTestPluginText(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(async ({ webContents }) => {
    for (const contents of webContents.getAllWebContents()) {
      const matched = await contents
        .executeJavaScript(`document.body?.dataset?.e2e === 'ai-idle'`)
        .catch(() => false)
      if (matched) return contents.executeJavaScript('document.body.innerText')
    }
    return ''
  })
}

/**
 * 读取设置插件当前正文，供 Playwright 轮询加载状态。
 * @param electronApp 隔离的 Electron 应用
 * @returns 设置插件正文；尚未加载时为空字符串
 */
async function readSettingsText(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => {
      const url = candidate.getURL()
      return (
        url.startsWith('http://127.0.0.1:15177') ||
        url.includes('internal-plugins/setting/index.html')
      )
    })
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body.innerText')
  })
}

/**
 * 关闭 HTTP 服务并等待监听资源完成释放。
 * @param server 待关闭服务
 * @returns 服务关闭后完成的 Promise
 */
async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

test('第三方插件通过宿主 aiChat 流式调用且自行管理工具循环', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-ai-chat-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'ai-chat-e2e-plugin')
  const idlePluginRoot = path.join(dataRoot, 'ai-idle-e2e-plugin')
  const mock = await startMockAiServer()
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  const pluginConfigPath = await createTestPlugin(pluginRoot)
  const idlePluginConfigPath = await createIdleTestPlugin(idlePluginRoot)

  try {
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
        ZTOOLS_SETTING_DEV_SERVER_URL: settingsUrlFragment
      }
    })

    const page = await electronApp.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() => readSettingsText(electronApp!), { timeout: 15_000 })
      .toContain('开机自动启动')

    // 供应商凭据只写入隔离宿主数据，测试插件只能发现公开模型能力。
    const providerResult = await executeInSettings(
      electronApp,
      `window.ztools.internal.aiProviders.add(${JSON.stringify({
        name: 'AI Chat E2E Provider',
        apiUrl: mock.baseUrl,
        apiKey: 'e2e-token',
        apiFormat: 'openai-chat',
        selectedModels: [
          {
            modelId: 'gpt-5-test',
            contextWindow: 131_072,
            inputModalities: ['text', 'image'],
            reasoning: {
              protocol: 'openai-compatible',
              efforts: { high: 'high' },
              defaultEffort: 'high',
              responseField: 'reasoning_content'
            }
          }
        ]
      })})`
    )
    expect(providerResult).toMatchObject({ success: true })

    // 模型配置完整展开到父级滚动区，避免编辑器内部形成第二层滚动。
    await executeInSettings(electronApp, `location.hash = '#/providers'; true`)
    await expect.poll(() => readSettingsText(electronApp!)).toContain('AI Chat E2E Provider')
    await executeInSettings(
      electronApp,
      `document.querySelector('.provider-item .icon-btn[title="编辑供应商"]')?.click(); true`
    )
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `(() => {
            const list = document.querySelector('.selected-model-list')
            const parent = document.querySelector('.editor-content')
            if (!list || !parent) return null
            return {
              listOverflowY: getComputedStyle(list).overflowY,
              listHasOwnScroll: list.scrollHeight > list.clientHeight,
              parentOverflowY: getComputedStyle(parent).overflowY
            }
          })()`
        )
      )
      .toMatchObject({
        listOverflowY: 'visible',
        listHasOwnScroll: false,
        parentOverflowY: 'auto'
      })

    const defaultReasoningControl = await executeInSettings(
      electronApp,
      `(() => {
        const labels = [...document.querySelectorAll('.reasoning-settings-grid label')]
        const label = labels.find((item) => item.querySelector('span')?.textContent?.trim() === '默认强度')
        const select = label?.querySelector('select')
        if (!select) throw new Error('未找到默认推理强度选择器')
        return {
          value: select.value,
          options: [...select.options].map((option) => ({ value: option.value, label: option.textContent?.trim() }))
        }
      })()`
    )
    expect(defaultReasoningControl).toEqual({
      value: 'high',
      options: [{ value: 'high', label: '高' }]
    })

    await executeInSettings(
      electronApp,
      `(() => {
        const select = document.querySelector('.model-capability-grid select')
        if (!select) throw new Error('未找到推理能力选择器')
        select.value = 'provider-default'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        document.querySelector('.editor-footer .btn-solid')?.click()
        return true
      })()`
    )
    await expect.poll(() => readSettingsText(electronApp!)).toContain('供应商已更新')
    const savedProvider = (await executeInSettings(
      electronApp,
      `window.ztools.internal.aiProviders.getAll()`
    )) as { data?: { providers?: Array<{ selectedModels?: Array<Record<string, unknown>> }> } }
    expect(savedProvider.data?.providers?.[0]?.selectedModels?.[0]).not.toHaveProperty('reasoning')
    await executeInSettings(
      electronApp,
      `document.querySelector('.provider-item .icon-btn[title="编辑供应商"]')?.click(); true`
    )
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `document.querySelector('.model-capability-grid select')?.value || ''`
        )
      )
      .toBe('provider-default')
    const restoredReasoning = await executeInSettings(
      electronApp,
      `(async () => {
        const result = await window.ztools.internal.aiProviders.getAll()
        const provider = result.data.providers[0]
        provider.selectedModels[0].reasoning = {
          protocol: 'openai-compatible',
          efforts: { high: 'high' },
          defaultEffort: 'high',
          responseField: 'reasoning_content'
        }
        return window.ztools.internal.aiProviders.update(provider)
      })()`
    )
    expect(restoredReasoning).toMatchObject({ success: true })

    const imported = await executeInSettings(
      electronApp,
      `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`
    )
    expect(imported, JSON.stringify(imported)).toMatchObject({
      success: true,
      pluginName: 'ai-chat-e2e-plugin'
    })
    expect(
      await executeInSettings(
        electronApp,
        `window.ztools.internal.installDevPlugin('ai-chat-e2e-plugin')`
      )
    ).toMatchObject({ success: true })
    expect(
      await executeInSettings(
        electronApp,
        `window.ztools.internal.importDevPlugin(${JSON.stringify(idlePluginConfigPath)})`
      )
    ).toMatchObject({ success: true, pluginName: 'ai-idle-e2e-plugin' })
    expect(
      await executeInSettings(
        electronApp,
        `window.ztools.internal.installDevPlugin('ai-idle-e2e-plugin')`
      )
    ).toMatchObject({ success: true })
    const plugins = (await executeInSettings(
      electronApp,
      'window.ztools.internal.getAllPlugins()'
    )) as Array<{ name?: string; path?: string; isDevelopment?: boolean }>
    const developmentPlugin = plugins.find(
      (plugin) => plugin.name === 'ai-chat-e2e-plugin__dev' && plugin.isDevelopment
    )
    const idleDevelopmentPlugin = plugins.find(
      (plugin) => plugin.name === 'ai-idle-e2e-plugin__dev' && plugin.isDevelopment
    )
    expect(
      await executeInSettings(
        electronApp,
        `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginRoot)}, type: 'plugin', name: 'AI Chat E2E', param: {payload: '', type: 'text', code: 'ai-chat-e2e'}})`
      )
    ).toMatchObject({ success: true })
    await expect
      .poll(() => readTestPluginText(electronApp!), { timeout: 15_000 })
      .toContain('AI Chat E2E Ready')

    const toolCase = (await executeInTestPlugin(
      electronApp,
      `window.runAiCase('tool', 50)`
    )) as Record<string, any>
    expect(toolCase.models).toHaveLength(1)
    expect(toolCase.models[0]).toMatchObject({
      label: 'AI Chat E2E Provider - gpt-5-test',
      contextWindow: 131_072,
      inputModalities: ['text', 'image']
    })
    expect(toolCase.models[0]).not.toHaveProperty('apiKey')
    expect(toolCase.models[0]).not.toHaveProperty('apiUrl')
    expect(toolCase.events.map((event: { type: string }) => event.type)).toEqual([
      'request',
      'reasoning',
      'reasoning_end',
      'tool_call',
      'usage'
    ])
    expect(
      toolCase.events.find((event: { type: string }) => event.type === 'tool_call')
    ).toMatchObject({
      id: 'call-e2e',
      name: 'tool_probe',
      argumentsDelta: '{"value":1}'
    })
    expect(toolCase.result).toMatchObject({
      reasoning_content: '先检查工具',
      finish_reason: 'tool_calls',
      usage: { total_tokens: 15 },
      tool_calls: [
        {
          id: 'call-e2e',
          function: { name: 'tool_probe', arguments: '{"value":1}' }
        }
      ]
    })
    expect(toolCase.toolExecutions).toBe(0)
    expect(mock.requests[0]).toMatchObject({ authorization: 'Bearer e2e-token' })
    expect(mock.requests[0].body).toMatchObject({
      model: 'gpt-5-test',
      reasoning_effort: 'high',
      stream: true
    })

    const truncated = (await executeInTestPlugin(
      electronApp,
      `window.runAiCase('truncated')`
    )) as Record<string, any>
    expect(truncated.error).toMatchObject({ code: 'STREAM_CLOSED' })

    await executeInTestPlugin(electronApp, `window.startAiCase('abort')`)
    await expect
      .poll(() => executeInTestPlugin(electronApp!, 'Boolean(window.activeAiRequest)'))
      .toBe(true)
    await expect(page.locator('.avatar-wrapper')).toHaveClass(/ai-active/)
    await expect(page.locator('.search-btn.plugin-logo')).toHaveCSS('border-radius', '50%')
    await expect(page.locator('.search-btn.plugin-logo')).toHaveCSS(
      'transition-property',
      'transform, box-shadow, border-radius'
    )
    await executeInTestPlugin(electronApp, 'window.activeAiRequest.abort(); true')
    await expect
      .poll(() => executeInTestPlugin(electronApp!, `window.caseResults.abort`), {
        timeout: 10_000
      })
      .toMatchObject({ error: { code: 'ABORTED' } })
    await expect(page.locator('.avatar-wrapper')).not.toHaveClass(/ai-active/)
    await expect(page.locator('.search-btn.plugin-logo')).toHaveCSS('border-radius', '6px')

    // 插件 A 的请求继续运行时，切到未请求的插件 B，主窗口不得复用 A 的动画状态。
    await executeInTestPlugin(electronApp, `window.startAiCase('abort')`)
    await expect(page.locator('.avatar-wrapper')).toHaveClass(/ai-active/)
    expect(
      await executeInSettings(
        electronApp,
        `window.ztools.internal.launch({path: ${JSON.stringify(idleDevelopmentPlugin?.path || idlePluginRoot)}, type: 'plugin', name: 'AI Idle E2E', param: {payload: '', type: 'text', code: 'ai-idle-e2e'}})`
      )
    ).toMatchObject({ success: true })
    await expect
      .poll(() => readIdleTestPluginText(electronApp!), { timeout: 15_000 })
      .toContain('AI Idle E2E Ready')
    await expect(page.locator('.avatar-wrapper')).not.toHaveClass(/ai-active/)

    // 切回插件 A 后恢复其请求动画，再分离并把现有状态迁移到独立标题栏。
    expect(
      await executeInSettings(
        electronApp,
        `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginRoot)}, type: 'plugin', name: 'AI Chat E2E', param: {payload: '', type: 'text', code: 'ai-chat-e2e'}})`
      )
    ).toMatchObject({ success: true })
    await expect(page.locator('.avatar-wrapper')).toHaveClass(/ai-active/)
    expect(await page.evaluate(() => (window as any).ztools.detachPlugin())).toMatchObject({
      success: true
    })
    await expect(page.locator('.avatar-wrapper')).not.toHaveClass(/ai-active/)
    await expect
      .poll(() =>
        electronApp!
          .windows()
          .some((candidate) => candidate.url().includes('detached-titlebar.html'))
      )
      .toBe(true)
    const detachedPage = electronApp
      .windows()
      .find((candidate) => candidate.url().includes('detached-titlebar.html'))
    expect(detachedPage).toBeDefined()
    await expect(detachedPage!.locator('.plugin-name')).toContainText('AI Chat E2E')
    await expect(detachedPage!.locator('.logo-container')).toHaveClass(/ai-active/)

    await executeInTestPlugin(electronApp, 'window.activeAiRequest.abort(); true')
    await expect
      .poll(() => executeInTestPlugin(electronApp!, `window.caseResults.abort`), {
        timeout: 10_000
      })
      .toMatchObject({ error: { code: 'ABORTED' } })
    await expect(detachedPage!.locator('.logo-container')).not.toHaveClass(/ai-active/)

    const concurrent = (await executeInTestPlugin(
      electronApp,
      `Promise.all([window.runAiCase('concurrent-a'), window.runAiCase('concurrent-b')])`
    )) as Array<Record<string, any>>
    expect(concurrent.map((item) => item.result?.content)).toEqual(['concurrent-a', 'concurrent-b'])

    // 新 aiChat 路径必须按供应商接口格式分派，不能继续固定走 Chat Completions。
    const protocolProviders = await executeInSettings(
      electronApp,
      `(async () => {
        const anthropic = await window.ztools.internal.aiProviders.add(${JSON.stringify({
          name: 'AI Chat Anthropic Provider',
          apiUrl: mock.baseUrl,
          apiKey: 'anthropic-token',
          apiFormat: 'anthropic-messages',
          selectedModels: [
            {
              modelId: 'claude-e2e',
              reasoning: {
                protocol: 'passthrough',
                efforts: { high: 'high' },
                defaultEffort: 'high',
                responseField: 'auto'
              }
            }
          ]
        })})
        const responses = await window.ztools.internal.aiProviders.add(${JSON.stringify({
          name: 'AI Chat Responses Provider',
          apiUrl: mock.baseUrl,
          apiKey: 'responses-token',
          apiFormat: 'openai-responses',
          selectedModels: [
            {
              modelId: 'gpt-responses-e2e',
              reasoning: {
                protocol: 'openai-compatible',
                efforts: { high: 'high' },
                defaultEffort: 'high',
                responseField: 'auto'
              }
            }
          ]
        })})
        return { anthropic, responses }
      })()`
    )
    expect(protocolProviders).toMatchObject({
      anthropic: { success: true },
      responses: { success: true }
    })

    const anthropicCase = (await executeInTestPlugin(
      electronApp,
      `window.runAiCase('anthropic', 0, 'AI Chat Anthropic Provider')`
    )) as Record<string, any>
    expect(anthropicCase.events.map((event: { type: string }) => event.type)).toEqual([
      'request',
      'reasoning',
      'reasoning_end',
      'content'
    ])
    expect(anthropicCase.result).toMatchObject({
      content: 'Anthropic 答案',
      reasoning_content: 'Anthropic 分析',
      finish_reason: 'stop'
    })

    const responsesCase = (await executeInTestPlugin(
      electronApp,
      `window.runAiCase('responses', 0, 'AI Chat Responses Provider')`
    )) as Record<string, any>
    expect(responsesCase.events.map((event: { type: string }) => event.type)).toEqual([
      'request',
      'reasoning',
      'reasoning_end',
      'content'
    ])
    expect(responsesCase.result).toMatchObject({
      content: 'Responses 答案',
      reasoning_content: 'Responses 分析',
      finish_reason: 'stop'
    })

    const anthropicToolLoop = (await executeInTestPlugin(
      electronApp,
      `window.runAiToolLoopCase('anthropic-tool', 'AI Chat Anthropic Provider')`
    )) as Record<string, any>
    expect(anthropicToolLoop.first).toMatchObject({
      finish_reason: 'tool_calls',
      tool_calls: [{ id: 'call-anthropic' }],
      replay_state: { apiFormat: 'anthropic-messages' }
    })
    expect(anthropicToolLoop.second).toMatchObject({
      content: 'Anthropic 工具完成',
      finish_reason: 'stop'
    })

    const responsesToolLoop = (await executeInTestPlugin(
      electronApp,
      `window.runAiToolLoopCase('responses-tool', 'AI Chat Responses Provider')`
    )) as Record<string, any>
    expect(responsesToolLoop.first).toMatchObject({
      finish_reason: 'tool_calls',
      tool_calls: [{ id: 'call-responses' }],
      replay_state: { apiFormat: 'openai-responses' }
    })
    expect(responsesToolLoop.second).toMatchObject({
      content: 'Responses 工具完成',
      finish_reason: 'stop'
    })

    expect(mock.requests.find((item) => item.url === '/v1/messages')).toMatchObject({
      apiKey: 'anthropic-token',
      body: {
        model: 'claude-e2e',
        max_tokens: 8192,
        stream: true,
        thinking: { type: 'enabled', budget_tokens: 7168 }
      }
    })
    expect(mock.requests.find((item) => item.url === '/v1/responses')).toMatchObject({
      authorization: 'Bearer responses-token',
      body: {
        model: 'gpt-responses-e2e',
        stream: true,
        reasoning: { effort: 'high', summary: 'auto' },
        include: ['reasoning.encrypted_content']
      }
    })

    const anthropicSecondRequest = mock.requests
      .filter((item) => item.url === '/v1/messages')
      .find((item) => JSON.stringify(item.body).includes('tool_result'))
    expect(anthropicSecondRequest?.body).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'thinking',
              thinking: 'Anthropic 分析',
              signature: 'anthropic-signature'
            }),
            expect.objectContaining({ type: 'tool_use', id: 'call-anthropic' })
          ])
        })
      ])
    })
    const responsesSecondRequest = mock.requests
      .filter((item) => item.url === '/v1/responses')
      .find((item) => JSON.stringify(item.body).includes('function_call_output'))
    expect(responsesSecondRequest?.body).toMatchObject({
      input: expect.arrayContaining([
        expect.objectContaining({
          id: 'rs-responses-first',
          type: 'reasoning',
          encrypted_content: 'responses-encrypted'
        }),
        expect.objectContaining({
          id: 'fc-responses-first',
          type: 'function_call',
          call_id: 'call-responses'
        }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call-responses',
          output: '{"ok":true}'
        })
      ])
    })
  } finally {
    // 先关闭 Electron 释放挂起请求，再关闭模拟服务和临时数据目录。
    await electronApp?.close()
    await closeServer(mock.server)
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
