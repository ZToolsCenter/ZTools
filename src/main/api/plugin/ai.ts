import { ipcMain } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import detachedWindowManager from '../../core/detachedWindowManager'
import aiProviderService, { type ResolvedAiModel } from '../../core/aiProviderService.js'
import { createAdapter } from './aiProtocol/adapters'
import {
  normalizeAiModelCapabilities,
  type AiModelChoice
} from '../../../shared/aiProviderShared.js'
import {
  normalizeAiChatFailure,
  streamSingleAiProtocolChat,
  type AiChatEvent,
  type AiChatOption,
  type AiChatReplayState,
  type AiChatResult
} from '../../core/aiChatTransport.js'
import { createAiChatEventBatcher } from '../../core/aiChatEventBatcher.js'
import aiRequestStatusTracker from '../../core/aiRequestStatusTracker.js'
import type { AiRequestStatus, AiRequestStatusChange } from '../../../shared/aiRequestStatus.js'

/**
 * AI 选项
 */
export interface AiOption {
  model?: string // allAiModels 返回的 id 或 value，为空使用首个已开启供应商的首个模型
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
  replay_state?: AiChatReplayState // 宿主生成的协议私有回放状态
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

  /**
   * 绑定主窗口和插件管理器，并注册插件侧 AI IPC。
   * @param mainWindow ZTools 主窗口
   * @param pluginManager 插件运行时管理器
   * @returns 无返回值
   */
  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  /**
   * 注册模型调用、停止、模型发现和工具回调相关 IPC 通道。
   * @returns 无返回值
   */
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
        this.notifyAiStatus('idle', event.sender, requestId)
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
        this.notifyAiStatus('idle', event.sender, requestId)
        return { success: false, error: error instanceof Error ? error.message : '未知错误' }
      }
    })
    // 单轮流式调用只负责协议传输，不执行模型生成的工具。
    ipcMain.handle('plugin:ai-chat', async (event, requestId: string, option: AiChatOption) => {
      const eventName = `plugin:ai-chat-event-${requestId}`
      const eventBatcher = createAiChatEventBatcher(option?.streamBatchIntervalMs, (chatEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(eventName, chatEvent)
      })
      try {
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: '无法获取插件信息' }
          }
        }
        return await this.callSingleAIChat(option, requestId, event.sender, eventBatcher.push)
      } catch (error: unknown) {
        console.error('[AI] AI 单轮调用失败:', error)
        this.notifyAiStatus('idle', event.sender, requestId)
        return { success: false, error: normalizeAiChatFailure(error) }
      } finally {
        // 请求结束、异常和主动中止都先发布尾部增量，再发送投递完成哨兵。
        eventBatcher.flush()
        // invoke 结果可能先于普通 send 事件抵达；哨兵用于插件侧等待流事件全部入队。
        if (!event.sender.isDestroyed()) {
          event.sender.send(eventName, { type: '__ztools_ai_chat_delivery_end__' })
        }
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
  /**
   * 更新请求状态，并把带插件身份的聚合状态发送给可展示该插件的窗口。
   * @param status 当前请求状态
   * @param webContents 发起请求的插件页面
   * @param requestId 当前 AI 请求标识
   * @returns 无返回值
   */
  private notifyAiStatus(
    status: AiRequestStatus,
    webContents: Electron.WebContents,
    requestId: string
  ): void {
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(webContents)
    if (!pluginInfo) return

    const change: AiRequestStatusChange = {
      pluginName: pluginInfo.name,
      pluginPath: pluginInfo.path,
      status: aiRequestStatusTracker.update(webContents.id, requestId, status)
    }

    // 主窗口保存所有缓存插件的状态，由渲染层按当前插件路径选择展示。
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ai-status-changed', change)
    }

    const detachedWindows = detachedWindowManager.getAllWindows()
    for (const windowInfo of detachedWindows) {
      if (windowInfo.view.webContents === webContents) {
        if (windowInfo.window && !windowInfo.window.isDestroyed()) {
          windowInfo.window.webContents.send('ai-status-changed', change)
        }
        return
      }
    }
  }

  /**
   * 获取供插件构建选择器的全部已启用 AI 模型。
   * @returns 带供应商展示信息的模型条目
   */
  private async getAllAiModels(): Promise<AiModelChoice[]> {
    return aiProviderService.getModelChoices()
  }

  /**
   * 将插件选择值解析为供应商连接和真实远端模型。
   * @param modelRef 插件传入的公开 ID、稳定 value 或历史兼容 ID
   * @returns 已解析的模型调用配置；没有配置时返回 null
   * @throws 旧式远端模型 ID 同时匹配多个供应商时抛出歧义错误
   */
  private async getModelConfig(modelRef?: string): Promise<ResolvedAiModel | null> {
    return aiProviderService.resolveModel(modelRef)
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
   * @param option 插件提交的模型、消息和工具选项
   * @param requestId 当前 AI 请求的唯一 ID
   * @param webContents 发起调用的插件页面
   * @returns AI 调用结果
   * @throws 模型选择值存在供应商歧义时抛出错误
   */
  private async callAI(
    option: AiOption,
    requestId: string,
    webContents: Electron.WebContents
  ): Promise<{ success: boolean; data?: Message; error?: string }> {
    const resolvedModel = await this.getModelConfig(option.model)
    if (!resolvedModel) {
      return { success: false, error: '未找到 AI 模型配置，请先在设置中添加模型' }
    }

    const abortController = new AbortController()
    this.abortControllers.set(requestId, abortController)

    try {
      this.notifyAiStatus('sending', webContents, requestId)
      // 按供应商配置的接口格式选择适配器，统一工具调用循环。
      const adapter = createAdapter(resolvedModel.provider)
      const tools = option.tools?.length ? option.tools : undefined
      const messages = [...option.messages]

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        this.notifyAiStatus(round === 0 ? 'sending' : 'receiving', webContents, requestId)

        const turn = await adapter.complete(
          { model: resolvedModel.model.modelId, messages, tools },
          abortController.signal
        )

        // 没有工具调用，直接返回结果。
        if (turn.toolCalls.length === 0) {
          this.notifyAiStatus('idle', webContents, requestId)
          return {
            success: true,
            data: {
              role: 'assistant',
              content: turn.content,
              reasoning_content: turn.reasoningContent
            }
          }
        }

        // 记录助手回复（含 reasoning_content 与工具调用）后执行工具。
        messages.push({
          role: 'assistant',
          content: turn.content,
          reasoning_content: turn.reasoningContent,
          tool_calls: turn.toolCalls,
          replay_state: turn.replayState
        })

        for (const toolCall of turn.toolCalls) {
          const result = await this.executeToolCall(toolCall, webContents)
          messages.push({ role: 'tool', content: result, tool_call_id: toolCall.id })
        }
      }

      // 超过最大轮次
      this.notifyAiStatus('idle', webContents, requestId)
      return { success: false, error: '工具调用轮次超过限制' }
    } catch (error: unknown) {
      this.notifyAiStatus('idle', webContents, requestId)
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'AI 调用已中止' }
      }
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    } finally {
      this.abortControllers.delete(requestId)
    }
  }

  /**
   * 执行一次由插件管理工具循环的流式请求。
   * @param option 单轮消息、工具和生成参数
   * @param requestId 当前请求唯一标识
   * @param webContents 发起请求的插件页面
   * @param onEvent 单轮流式事件接收器
   * @returns 成功时返回完整助手响应，失败时返回结构化错误
   */
  private async callSingleAIChat(
    option: AiChatOption,
    requestId: string,
    webContents: Electron.WebContents,
    onEvent: (event: AiChatEvent) => void
  ): Promise<
    | { success: true; data: AiChatResult }
    | { success: false; error: ReturnType<typeof normalizeAiChatFailure> }
  > {
    // 在解析供应商前拒绝空请求，确保插件始终收到可路由的稳定错误码。
    if (!option || !Array.isArray(option.messages) || option.messages.length === 0) {
      return {
        success: false,
        error: {
          name: 'Error',
          code: 'INVALID_REQUEST',
          message: 'AI 消息列表不能为空'
        }
      }
    }
    if (!requestId || this.abortControllers.has(requestId)) {
      return {
        success: false,
        error: {
          name: 'Error',
          code: 'INVALID_REQUEST',
          message: requestId ? 'AI 请求标识已在使用中' : 'AI 请求标识不能为空'
        }
      }
    }

    const resolvedModel = await this.getModelConfig(option.model)
    if (!resolvedModel) {
      return {
        success: false,
        error: {
          name: 'Error',
          code: 'NOT_FOUND',
          message: '未找到 AI 模型配置，请先在设置中添加模型'
        }
      }
    }

    const abortController = new AbortController()
    this.abortControllers.set(requestId, abortController)
    const timeout = Math.min(
      300_000,
      Math.max(5_000, Math.round(Number(option.timeout) || 120_000))
    )
    const capabilities = normalizeAiModelCapabilities(resolvedModel.model)
    let timedOut = false
    const timeoutHandle = setTimeout(() => {
      timedOut = true
      abortController.abort()
    }, timeout)
    try {
      // 请求标识先于网络调用发布，确保插件可以立即停止。
      this.notifyAiStatus('sending', webContents, requestId)
      onEvent({ type: 'request', requestId })
      const requestOption: AiChatOption = {
        ...option,
        // 能力与协议映射只能来自宿主模型配置，插件仅可选择公开的档位 ID。
        modelReasoning: capabilities.reasoning,
        reasoningEffort: option.reasoningEffort ?? option.reasoning?.effort
      }
      /**
       * 将协议传输事件转发给插件并同步宿主接收状态。
       * @param event 当前协议产生的统一流式事件
       * @returns 无返回值
       */
      const emitEvent = (event: AiChatEvent): void => {
        this.notifyAiStatus('receiving', webContents, requestId)
        onEvent(event)
      }
      // 三种协议均通过统一 adapter 传输，保证请求字段与流式事件语义一致。
      const result = await streamSingleAiProtocolChat(
        createAdapter(resolvedModel.provider, timeout),
        resolvedModel.model.modelId,
        requestOption,
        abortController.signal,
        emitEvent
      )
      return { success: true, data: result }
    } catch (error: unknown) {
      if (timedOut) {
        const timeoutError = new Error(`AI 请求在 ${timeout}ms 后超时`) as Error & {
          normalizedCode?: string
        }
        timeoutError.normalizedCode = 'TIMEOUT'
        return { success: false, error: normalizeAiChatFailure(timeoutError) }
      }
      return { success: false, error: normalizeAiChatFailure(error) }
    } finally {
      // 只清理本次请求，其他会话的并发请求继续运行。
      clearTimeout(timeoutHandle)
      this.abortControllers.delete(requestId)
      this.notifyAiStatus('idle', webContents, requestId)
    }
  }
  /**
   * 流式调用 AI，自动处理工具调用循环
   * 流式过程中实时推送 content 和 reasoning_content 片段
   * @param option 插件提交的模型、消息和工具选项
   * @param requestId 当前 AI 请求的唯一 ID
   * @param webContents 发起调用的插件页面
   * @param onChunk 接收流式消息片段的回调
   * @returns 调用完成后结束的 Promise
   * @throws 模型无效、调用中止或远端请求失败时抛出错误
   */
  private async callAIStream(
    option: AiOption,
    requestId: string,
    webContents: Electron.WebContents,
    onChunk: (chunk: Message) => void
  ): Promise<void> {
    const resolvedModel = await this.getModelConfig(option.model)
    if (!resolvedModel) {
      throw new Error('未找到 AI 模型配置，请先在设置中添加模型')
    }

    const abortController = new AbortController()
    this.abortControllers.set(requestId, abortController)

    try {
      this.notifyAiStatus('sending', webContents, requestId)
      // 按供应商配置的接口格式选择适配器，统一工具调用循环。
      const adapter = createAdapter(resolvedModel.provider)
      const tools = option.tools?.length ? option.tools : undefined
      const messages = [...option.messages]

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        this.notifyAiStatus(round === 0 ? 'sending' : 'receiving', webContents, requestId)

        // 首个增量到达时切换为接收状态，与既有 UX 保持一致。
        let receivingNotified = false
        const turn = await adapter.stream(
          { model: resolvedModel.model.modelId, messages, tools },
          abortController.signal,
          (delta) => {
            if (!receivingNotified) {
              receivingNotified = true
              this.notifyAiStatus('receiving', webContents, requestId)
            }
            onChunk({
              role: 'assistant',
              content: delta.content ?? '',
              reasoning_content: delta.reasoningContent
            })
          }
        )

        // 流结束且无工具调用，本轮直接结束。
        if (turn.toolCalls.length === 0) {
          this.notifyAiStatus('idle', webContents, requestId)
          return
        }

        // 将助手回复（含 reasoning_content）加入历史后执行工具调用。
        messages.push({
          role: 'assistant',
          content: turn.content,
          reasoning_content: turn.reasoningContent,
          tool_calls: turn.toolCalls,
          replay_state: turn.replayState
        })

        for (const toolCall of turn.toolCalls) {
          const result = await this.executeToolCall(toolCall, webContents)
          messages.push({ role: 'tool', content: result, tool_call_id: toolCall.id })
        }
      }

      this.notifyAiStatus('idle', webContents, requestId)
      throw new Error('工具调用轮次超过限制')
    } catch (error: unknown) {
      this.notifyAiStatus('idle', webContents, requestId)
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
}

// 导出单例
export default new PluginAiAPI()
