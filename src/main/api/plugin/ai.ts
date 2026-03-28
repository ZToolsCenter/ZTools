import { ipcMain } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import OpenAI from 'openai'
import lmdbInstance from '../../core/lmdb/lmdbInstance'
import type { AiModel } from '../renderer/aiModels'
import detachedWindowManager from '../../core/detachedWindowManager'

/**
 * AI 选项
 */
export interface AiOption {
  model?: string // AI 模型，为空默认使用第一个配置的模型
  messages: Message[] // 消息列表
  tools?: Tool[] // 工具列表
}

/** 文本内容块 */
export interface TextContentPart {
  type: 'text'
  text: string
}

/** 图片内容块 */
export interface ImageContentPart {
  type: 'image_url'
  image_url: {
    url: string // URL 或 base64 data URI
    detail?: 'auto' | 'low' | 'high'
  }
}

/** 内容块联合类型 */
export type ContentPart = TextContentPart | ImageContentPart

/**
 * 消息
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' // 消息角色
  content?: string | ContentPart[] // 消息内容（支持纯文本或多模态内容块）
  reasoning_content?: string // 消息推理内容
  tool_calls?: ToolCall[] // 工具调用
  tool_call_id?: string // 工具调用 ID（role 为 tool 时使用）
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * 工具
 */
export interface Tool {
  type: 'function'
  function?: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
    }
    required?: string[]
  }
}
/** 工具调用循环最大轮次 */
const MAX_TOOL_ROUNDS = 25

/**
 * AI 调用 API（插件专用）- 基于 OpenAI SDK 直接调用
 * 直接控制消息格式，确保 reasoning_content 等非标准字段正确透传
 */
class PluginAiAPI {
  private pluginManager: PluginManager | null = null
  private mainWindow: Electron.BrowserWindow | null = null
  private abortControllers: Map<string, AbortController> = new Map()
  private clientCache: Map<string, OpenAI> = new Map()

  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  private setupIPC(): void {
    // 非流式调用 AI
    ipcMain.handle('plugin:ai-call', async (event, requestId: string, option: AiOption) => {
      try {
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          return { success: false, error: '无法获取插件信息' }
        }
        return await this.callAI(option, requestId, event.sender)
      } catch (error: unknown) {
        console.error('[AI] AI 调用失败:', error)
        this.notifyAiStatus('idle', event.sender)
        return { success: false, error: error instanceof Error ? error.message : '未知错误' }
      }
    })

    // 流式调用 AI
    ipcMain.handle('plugin:ai-call-stream', async (event, requestId: string, option: AiOption) => {
      try {
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          return { success: false, error: '无法获取插件信息' }
        }
        await this.callAIStream(option, requestId, event.sender, (chunk: Message) => {
          event.sender.send(`plugin:ai-stream-${requestId}`, chunk)
        })
        return { success: true }
      } catch (error: unknown) {
        console.error('[AI] AI 流式调用失败:', error)
        this.notifyAiStatus('idle', event.sender)
        return { success: false, error: error instanceof Error ? error.message : '未知错误' }
      }
    })
    // 中止 AI 调用
    ipcMain.handle('plugin:ai-abort', async (_event, requestId: string) => {
      try {
        this.abortAICall(requestId)
        return { success: true }
      } catch (error: unknown) {
        console.error('[AI] 中止 AI 调用失败:', error)
        return { success: false, error: error instanceof Error ? error.message : '未知错误' }
      }
    })

    // 获取所有可用 AI 模型
    ipcMain.handle('plugin:ai-all-models', async () => {
      try {
        const models = await this.getAllAiModels()
        return { success: true, data: models }
      } catch (error: unknown) {
        console.error('[AI] 获取 AI 模型列表失败:', error)
        return { success: false, error: error instanceof Error ? error.message : '未知错误' }
      }
    })

    // Function Calling - 调用插件函数
    ipcMain.handle('plugin:ai-call-function', async (event, functionName: string, args: string) => {
      try {
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          return { success: false, error: '无法获取插件信息' }
        }
        const result = await event.sender.executeJavaScript(`
          (async () => {
            if (typeof window.${functionName} === 'function') {
              const args = ${args};
              return await window.${functionName}(args);
            } else {
              throw new Error('函数 ${functionName} 不存在');
            }
          })()
        `)
        return { success: true, data: result }
      } catch (error: unknown) {
        console.error('[AI] 调用插件函数失败:', error)
        return { success: false, error: error instanceof Error ? error.message : '未知错误' }
      }
    })
  }
  private notifyAiStatus(
    status: 'idle' | 'sending' | 'receiving',
    webContents: Electron.WebContents
  ): void {
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(webContents)
    if (!pluginInfo) return

    const detachedWindows = detachedWindowManager.getAllWindows()
    for (const windowInfo of detachedWindows) {
      if (windowInfo.view.webContents === webContents) {
        if (windowInfo.window && !windowInfo.window.isDestroyed()) {
          windowInfo.window.webContents.send('ai-status-changed', status)
        }
        return
      }
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ai-status-changed', status)
    }
  }

  private async getAllAiModels(): Promise<
    Array<{ id: string; label: string; description: string; icon: string; cost: number }>
  > {
    try {
      const doc = await lmdbInstance.promises.get('ZTOOLS/ai-models')
      if (doc?.data && Array.isArray(doc.data)) {
        return (doc.data as AiModel[]).map((m) => ({
          id: m.id,
          label: m.label,
          description: m.description || '',
          icon: m.icon || '',
          cost: m.cost || 0
        }))
      }
      return []
    } catch {
      return []
    }
  }

  private async getModelConfig(modelId?: string): Promise<AiModel | null> {
    try {
      const doc = await lmdbInstance.promises.get('ZTOOLS/ai-models')
      if (doc?.data && Array.isArray(doc.data)) {
        const models: AiModel[] = doc.data
        return modelId ? models.find((m) => m.id === modelId) || null : models[0] || null
      }
      return null
    } catch {
      return null
    }
  }

  private createClient(modelConfig: AiModel): OpenAI {
    const cacheKey = `${modelConfig.id}:${modelConfig.apiKey}:${modelConfig.apiUrl}`
    if (!this.clientCache.has(cacheKey)) {
      this.clientCache.set(
        cacheKey,
        new OpenAI({
          apiKey: modelConfig.apiKey,
          baseURL: modelConfig.apiUrl
        })
      )
    }
    return this.clientCache.get(cacheKey)!
  }
  /**
   * 将 Message[] 转为 OpenAI SDK 格式
   * 关键：保留 assistant 消息的 reasoning_content，解决 DeepSeek thinking mode 报错
   */
  private convertMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === 'assistant') {
        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: msg.content || ''
        }
        if (msg.reasoning_content) {
          assistantMsg.reasoning_content = msg.reasoning_content
        }
        if (msg.tool_calls?.length) {
          assistantMsg.tool_calls = msg.tool_calls
        }
        return assistantMsg as unknown as OpenAI.ChatCompletionMessageParam
      }
      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: (typeof msg.content === 'string' ? msg.content : '') || '',
          tool_call_id: msg.tool_call_id || ''
        }
      }
      // user 消息：支持字符串或内容块数组（多模态）
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        return {
          role: 'user' as const,
          content: msg.content as OpenAI.ChatCompletionContentPart[]
        }
      }
      return {
        role: msg.role as 'system' | 'user',
        content: (typeof msg.content === 'string' ? msg.content : '') || ''
      }
    })
  }

  private convertTools(tools: Tool[]): OpenAI.ChatCompletionTool[] {
    return tools
      .filter((t) => t.function)
      .map((t) => ({
        type: 'function' as const,
        function: {
          name: t.function!.name,
          description: t.function!.description,
          parameters: t.function!.parameters as OpenAI.FunctionParameters
        }
      }))
  }

  private async executeToolCall(
    toolCall: { id: string; function: { name: string; arguments: string } },
    webContents: Electron.WebContents
  ): Promise<string> {
    try {
      const fnName = toolCall.function.name
      const argsStr = toolCall.function.arguments
      const result = await webContents.executeJavaScript(`
        (async () => {
          if (typeof window.${fnName} === 'function') {
            const args = ${argsStr};
            return await window.${fnName}(args);
          } else {
            throw new Error('函数 ${fnName} 不存在');
          }
        })()
      `)
      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (error) {
      return JSON.stringify({
        error: `工具执行失败: ${error instanceof Error ? error.message : '未知错误'}`
      })
    }
  }
  /**
   * 非流式调用 AI，自动处理工具调用循环
   */
  private async callAI(
    option: AiOption,
    requestId: string,
    webContents: Electron.WebContents
  ): Promise<{ success: boolean; data?: Message; error?: string }> {
    const modelConfig = await this.getModelConfig(option.model)
    if (!modelConfig) {
      return { success: false, error: '未找到 AI 模型配置，请先在设置中添加模型' }
    }

    const abortController = new AbortController()
    this.abortControllers.set(requestId, abortController)

    try {
      this.notifyAiStatus('sending', webContents)
      const client = this.createClient(modelConfig)
      const openaiTools = option.tools?.length ? this.convertTools(option.tools) : undefined
      const messages = [...option.messages]

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        this.notifyAiStatus(round === 0 ? 'sending' : 'receiving', webContents)

        const response = await client.chat.completions.create(
          {
            model: modelConfig.id,
            messages: this.convertMessages(messages),
            ...(openaiTools?.length ? { tools: openaiTools } : {})
          },
          { signal: abortController.signal }
        )

        const choice = response.choices[0]
        if (!choice) {
          this.notifyAiStatus('idle', webContents)
          return { success: true, data: { role: 'assistant', content: '' } }
        }

        const assistantMsg = choice.message
        // 提取 reasoning_content（DeepSeek 等模型的非标准字段）
        const reasoningContent = (assistantMsg as unknown as Record<string, unknown>)
          .reasoning_content as string | undefined

        // 没有工具调用，直接返回结果
        if (!assistantMsg.tool_calls?.length) {
          this.notifyAiStatus('idle', webContents)
          return {
            success: true,
            data: {
              role: 'assistant',
              content: assistantMsg.content || '',
              reasoning_content: reasoningContent
            }
          }
        }
        // 有工具调用：提取 function 类型的工具调用
        const fnToolCalls = assistantMsg.tool_calls
          .filter(
            (tc): tc is OpenAI.ChatCompletionMessageToolCall & { type: 'function' } =>
              tc.type === 'function'
          )
          .map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))

        messages.push({
          role: 'assistant',
          content: assistantMsg.content || '',
          reasoning_content: reasoningContent,
          tool_calls: fnToolCalls
        })

        // 执行所有工具调用并追加结果
        for (const tc of fnToolCalls) {
          const result = await this.executeToolCall(tc, webContents)
          messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
        }
      }

      // 超过最大轮次
      this.notifyAiStatus('idle', webContents)
      return { success: false, error: '工具调用轮次超过限制' }
    } catch (error: unknown) {
      this.notifyAiStatus('idle', webContents)
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'AI 调用已中止' }
      }
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    } finally {
      this.abortControllers.delete(requestId)
    }
  }
  /**
   * 流式调用 AI，自动处理工具调用循环
   * 流式过程中实时推送 content 和 reasoning_content 片段
   */
  private async callAIStream(
    option: AiOption,
    requestId: string,
    webContents: Electron.WebContents,
    onChunk: (chunk: Message) => void
  ): Promise<void> {
    const modelConfig = await this.getModelConfig(option.model)
    if (!modelConfig) {
      throw new Error('未找到 AI 模型配置，请先在设置中添加模型')
    }

    const abortController = new AbortController()
    this.abortControllers.set(requestId, abortController)

    try {
      this.notifyAiStatus('sending', webContents)
      const client = this.createClient(modelConfig)
      const openaiTools = option.tools?.length ? this.convertTools(option.tools) : undefined
      const messages = [...option.messages]

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        this.notifyAiStatus(round === 0 ? 'sending' : 'receiving', webContents)

        const stream = await client.chat.completions.create(
          {
            model: modelConfig.id,
            messages: this.convertMessages(messages),
            stream: true,
            ...(openaiTools?.length ? { tools: openaiTools } : {})
          },
          { signal: abortController.signal }
        )

        let fullContent = ''
        let fullReasoning = ''
        const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()

        this.notifyAiStatus('receiving', webContents)

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta
          if (!delta) continue
          // 处理 reasoning_content（DeepSeek thinking mode 流式片段）
          const deltaAny = delta as Record<string, unknown>
          const reasoningDelta = deltaAny.reasoning_content as string | undefined

          // 处理文本内容
          const contentDelta = delta.content || ''

          if (contentDelta || reasoningDelta) {
            fullContent += contentDelta
            fullReasoning += reasoningDelta || ''
            onChunk({
              role: 'assistant',
              content: contentDelta,
              reasoning_content: reasoningDelta
            })
          }

          // 累积工具调用片段
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCalls.get(tc.index)
              if (existing) {
                existing.arguments += tc.function?.arguments || ''
              } else {
                toolCalls.set(tc.index, {
                  id: tc.id || '',
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || ''
                })
              }
            }
          }
        }

        // 流结束，检查是否有工具调用
        if (toolCalls.size === 0) {
          this.notifyAiStatus('idle', webContents)
          return
        }
        // 有工具调用：将 assistant 消息（含 reasoning_content）加入历史
        const tcArray = Array.from(toolCalls.values()).map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
        messages.push({
          role: 'assistant',
          content: fullContent,
          reasoning_content: fullReasoning || undefined,
          tool_calls: tcArray
        })

        // 执行所有工具调用并追加结果
        for (const tc of tcArray) {
          const result = await this.executeToolCall(tc, webContents)
          messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
        }
      }

      this.notifyAiStatus('idle', webContents)
      throw new Error('工具调用轮次超过限制')
    } catch (error: unknown) {
      this.notifyAiStatus('idle', webContents)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('AI 调用已中止')
      }
      throw error
    } finally {
      this.abortControllers.delete(requestId)
    }
  }

  private abortAICall(requestId: string): void {
    const abortController = this.abortControllers.get(requestId)
    if (abortController) {
      abortController.abort()
      this.abortControllers.delete(requestId)
    }
  }

  public async formatTextForSuperPanel(
    text: string
  ): Promise<{ success: boolean; text?: string; error?: string }> {
    const modelConfig = await this.getModelConfig()
    if (!modelConfig) {
      return { success: false, error: '未找到 AI 模型配置，请先在设置中添加模型' }
    }

    try {
      const client = this.createClient(modelConfig)
      const response = await client.chat.completions.create({
        model: modelConfig.id,
        messages: [
          {
            role: 'system',
            content:
              '你是一个文本格式整理助手。请对用户提供的文本做最小化的 Markdown 格式修正：修复错误换行、合并被截断的句子、去除多余空行、统一标点间距。如果原文已有列表或标题结构，用对应的 Markdown 语法（- 或 #）规范化；如果原文是连续段落，保持段落形式不变，不得主动拆分或增加结构。严格保留所有原始文字内容和原有结构，不得增删、改写、重组任何内容，不得添加原文中不存在的表情（包括 emoji）。只返回整理后的文本，不要添加任何说明或解释。'
          },
          {
            role: 'user',
            content: text
          }
        ]
      })

      const result = response.choices[0]?.message?.content
      if (!result) {
        return { success: false, error: 'AI 返回结果为空' }
      }
      return { success: true, text: result.trim() }
    } catch (error: unknown) {
      console.error('[AI] 超级面板格式整理失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      }
    }
  }
}

// 导出单例
export default new PluginAiAPI()
