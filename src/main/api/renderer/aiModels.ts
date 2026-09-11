import { ipcMain } from 'electron'
import aiProviderService from '../../core/aiProviderService.js'
import officialAIService from '../../core/officialAIService.js'
import { resolveOrcaEndpoints, OrcaAuthError } from '../../core/provider/orcaAuth.js'
import { OrcaApiKeyAdapter, OrcaPkceAdapter } from '../../core/provider/orcaCredentials.js'
import { AI_PROVIDER_PRESETS } from '../../../shared/aiProviderShared.js'
import type {
  AiModelDiscoveryRequest,
  AiModelDiscoveryResult,
  AiProviderCredentialView,
  AiProviderInput,
  AiProviderMutationResult,
  AiProviderStore,
  AiRemoteModel,
  OfficialAiProviderStatus
} from '../../../shared/aiProviderShared.js'

/** PKCE 登录的状态快照；供设置界面展示进度与授权地址。 */
export interface OrcaLoginState {
  attemptId: string
  authorizeUrl: string
  /** loopback 流程由主进程自动完成；oob 流程需要用户粘贴授权码。 */
  flow: 'loopback' | 'oob'
}

/** PKCE 登录的统一返回结构。 */
export interface OrcaLoginResult {
  success: boolean
  data?: { attemptId: string; authorizeUrl: string; flow: 'loopback' | 'oob' }
  error?: string
}

/**
 * AI 供应商管理 API，供主渲染进程和内置设置插件复用。
 */
class AiModelsAPI {
  /** 主进程持有的 PKCE adapter；verifier 只存在于主进程内存。 */
  private pkceAdapter: OrcaPkceAdapter | null = null

  /**
   * 初始化 AI 供应商管理 IPC。
   * @returns 无返回值
   */
  public init(): void {
    this.setupIPC()
  }

  /**
   * 懒加载 PKCE adapter，端点在首次使用时解析一次。
   * @returns 当前进程使用的 PKCE adapter
   */
  private getPkceAdapter(): OrcaPkceAdapter {
    if (!this.pkceAdapter) {
      this.pkceAdapter = new OrcaPkceAdapter(resolveOrcaEndpoints(), 'ZTools')
    }
    return this.pkceAdapter
  }

  /**
   * 注册主渲染进程使用的 AI 供应商管理通道。
   * @returns 无返回值
   */
  private setupIPC(): void {
    ipcMain.handle('ai-providers:get-all', () => this.getAllProviders())
    ipcMain.handle('ai-providers:get-official', () => this.getOfficialProvider())
    ipcMain.handle('ai-providers:get-presets', () => this.getPresets())
    ipcMain.handle('ai-providers:get-credential', (_event, providerId: string) =>
      this.getCredential(providerId)
    )
    ipcMain.handle('ai-providers:add', (_event, provider: AiProviderInput) =>
      this.addProvider(provider)
    )
    ipcMain.handle('ai-providers:update', (_event, provider: AiProviderInput) =>
      this.updateProvider(provider)
    )
    ipcMain.handle('ai-providers:delete', (_event, providerId: string) =>
      this.deleteProvider(providerId)
    )
    ipcMain.handle('ai-providers:set-enabled', (_event, providerId: string, enabled: boolean) =>
      this.setProviderEnabled(providerId, enabled)
    )
    ipcMain.handle('ai-providers:fetch-models', (_event, apiUrl: string, apiKey: string) =>
      this.fetchModels(apiUrl, apiKey)
    )
    ipcMain.handle('ai-providers:discover-models', (_event, request: AiModelDiscoveryRequest) =>
      this.discoverModels(request)
    )
    ipcMain.handle('ai-providers:orca-login-start', (_event, flow: 'loopback' | 'oob') =>
      this.startOrcaLogin(flow)
    )
    ipcMain.handle('ai-providers:orca-login-complete', (_event, attemptId: string, code: string) =>
      this.completeOrcaLogin(attemptId, code)
    )
    ipcMain.handle(
      'ai-providers:orca-login-wait',
      (_event, attemptId: string, providerId?: string) =>
        this.waitForOrcaLogin(attemptId, providerId)
    )
    ipcMain.handle('ai-providers:orca-login-cancel', (_event, attemptId: string) =>
      this.cancelOrcaLogin(attemptId)
    )
    ipcMain.handle(
      'ai-providers:orca-apply-api-key',
      (_event, providerId: string, apiKey: string) => this.applyOrcaApiKey(providerId, apiKey)
    )
    ipcMain.handle('ai-providers:orca-clear-credential', (_event, providerId: string) =>
      this.clearCredential(providerId)
    )
    ipcMain.handle(
      'ai-providers:orca-mark-reauth',
      (_event, providerId: string, generation: number) =>
        this.markCredentialNeedsReauth(providerId, generation)
    )
  }

  /**
   * 获取完整的 AI 供应商配置。
   * @returns 当前供应商文档
   */
  public getAllProviders(): AiProviderStore {
    return aiProviderService.getStore()
  }

  /**
   * 获取可用的供应商预设（含 OrcaRouter 具名条目）。
   * @returns 预设注册表
   */
  public getPresets(): typeof AI_PROVIDER_PRESETS {
    return AI_PROVIDER_PRESETS
  }

  /**
   * 获取只读的 ZTools 官方模型及当前登录状态。
   * @returns 官方供应商状态
   */
  public async getOfficialProvider(): Promise<OfficialAiProviderStatus> {
    return officialAIService.getProviderStatus()
  }

  /**
   * 添加一个 AI 供应商。
   * @param provider 供应商连接信息和已选模型
   * @returns 操作结果及最新供应商文档
   */
  public addProvider(provider: AiProviderInput): AiProviderMutationResult {
    return aiProviderService.addProvider(provider)
  }

  /**
   * 更新一个 AI 供应商。
   * @param provider 带内部 ID 的供应商配置
   * @returns 操作结果及最新供应商文档
   */
  public updateProvider(provider: AiProviderInput): AiProviderMutationResult {
    return aiProviderService.updateProvider(provider)
  }

  /**
   * 删除供应商及其已选模型。
   * @param providerId 供应商内部 ID
   * @returns 操作结果及最新供应商文档
   */
  public deleteProvider(providerId: string): AiProviderMutationResult {
    return aiProviderService.deleteProvider(providerId)
  }

  /**
   * 开启或关闭指定 AI 供应商。
   * @param providerId 供应商内部 ID
   * @param enabled 是否允许插件发现和调用该供应商
   * @returns 操作结果及最新供应商文档
   */
  public setProviderEnabled(providerId: string, enabled: boolean): AiProviderMutationResult {
    return aiProviderService.setProviderEnabled(providerId, enabled)
  }

  /**
   * 拉取 OpenAI 兼容供应商公开的模型列表。
   * @param apiUrl 供应商接口基础地址
   * @param apiKey 供应商 API 密钥
   * @returns 远端模型摘要列表
   * @throws 供应商拒绝请求、超时或返回异常时抛出错误
   */
  public async fetchModels(apiUrl: string, apiKey: string): Promise<AiRemoteModel[]> {
    return aiProviderService.fetchRemoteModels(apiUrl, apiKey)
  }

  /**
   * 按入口能力发现供应商模型；OrcaRouter 走能力过滤目录。
   * @param request 供应商地址、入口能力与要求模态
   * @returns 与入口匹配的模型列表及降级状态
   * @throws 非 OrcaRouter 供应商请求失败时抛出错误
   */
  public async discoverModels(request: AiModelDiscoveryRequest): Promise<AiModelDiscoveryResult> {
    return aiProviderService.discoverModels(request)
  }

  /**
   * 读取供应商凭据的公开视图（脱敏）。
   * @param providerId 供应商内部 ID
   * @returns 不含密钥本体的凭据状态
   */
  public getCredential(providerId: string): AiProviderCredentialView {
    return aiProviderService.getCredential(providerId)
  }

  /**
   * 开始一次 OrcaRouter PKCE 登录。
   * @param flow 回调入口形态；loopback 需要本机可监听端口
   * @returns 授权地址与会话 ID
   */
  public async startOrcaLogin(flow: 'loopback' | 'oob'): Promise<OrcaLoginResult> {
    try {
      const result = await this.getPkceAdapter().start({ flow })
      return { success: true, data: { ...result, flow } }
    } catch (cause) {
      return { success: false, error: this.describeAuthError(cause) }
    }
  }

  /**
   * 用授权码完成 PKCE 兑换并写入供应商凭据。
   * @param attemptId 会话 ID
   * @param code 授权码
   * @param providerId 目标供应商内部 ID；缺省时尝试写入预设供应商
   * @returns 操作结果及最新供应商文档
   */
  public async completeOrcaLogin(
    attemptId: string,
    code: string,
    providerId?: string
  ): Promise<AiProviderMutationResult> {
    try {
      const result = await this.getPkceAdapter().acquire({ source: 'pkce', attemptId, code })
      return this.applyCredential(providerId, 'pkce', result)
    } catch (cause) {
      return { success: false, error: this.describeAuthError(cause) }
    }
  }

  /**
   * 等待 loopback 回调完成兑换并写入供应商凭据。
   * @param attemptId 会话 ID
   * @param providerId 目标供应商内部 ID；缺省时写入默认供应商
   * @returns 操作结果及最新供应商文档
   */
  public async waitForOrcaLogin(
    attemptId: string,
    providerId?: string
  ): Promise<AiProviderMutationResult> {
    try {
      const result = await this.getPkceAdapter().waitForCallback(attemptId)
      return this.applyCredential(providerId, 'pkce', result)
    } catch (cause) {
      return { success: false, error: this.describeAuthError(cause) }
    }
  }

  /**
   * 取消一次进行中的 PKCE 登录，释放监听器与等待。
   * @param attemptId 会话 ID
   * @returns 操作是否被接受
   */
  public cancelOrcaLogin(attemptId: string): { success: boolean } {
    this.getPkceAdapter().cancel(attemptId)
    return { success: true }
  }

  /**
   * 通过 API Key adapter 保存手填密钥。
   * @param providerId 目标供应商内部 ID
   * @param apiKey 用户填写的密钥
   * @returns 操作结果及最新供应商文档
   */
  public async applyOrcaApiKey(
    providerId: string,
    apiKey: string
  ): Promise<AiProviderMutationResult> {
    try {
      const acquired = await new OrcaApiKeyAdapter().acquire({ source: 'api-key', key: apiKey })
      return this.applyCredential(providerId, 'api-key', acquired)
    } catch (cause) {
      return { success: false, error: this.describeAuthError(cause) }
    }
  }

  /**
   * 清除供应商凭据（退出登录）。
   * @param providerId 供应商内部 ID
   * @returns 操作结果及最新供应商文档
   */
  public clearCredential(providerId: string): AiProviderMutationResult {
    return aiProviderService.clearCredential(providerId)
  }

  /**
   * 将指定代次的凭据标记为需要重新认证。
   * @param providerId 供应商内部 ID
   * @param generation 发出被拒请求时使用的凭据代次
   * @returns 操作结果及最新供应商文档
   */
  public markCredentialNeedsReauth(
    providerId: string,
    generation: number
  ): AiProviderMutationResult {
    return aiProviderService.markCredentialNeedsReauth(providerId, generation)
  }

  /**
   * 把统一凭据结果写入目标供应商。
   * @param providerId 目标供应商内部 ID
   * @param source 凭据来源
   * @param result adapter 返回的凭据结果
   * @returns 操作结果及最新供应商文档
   */
  private applyCredential(
    providerId: string | undefined,
    source: 'api-key' | 'pkce',
    result: { key: string; scope: string; userId?: string }
  ): AiProviderMutationResult {
    const targetId = providerId ?? aiProviderService.getStore().providers[0]?.id
    if (!targetId) return { success: false, error: '请先创建一个 OrcaRouter 供应商' }
    return aiProviderService.applyCredentialResult(targetId, source, result)
  }

  /**
   * 将认证错误转换为可操作的提示，且不泄漏任何凭据或响应正文。
   * @param cause 捕获到的错误
   * @returns 可安全展示的错误信息
   */
  private describeAuthError(cause: unknown): string {
    if (cause instanceof OrcaAuthError) return cause.message
    return cause instanceof Error ? cause.message : 'OrcaRouter 登录失败'
  }
}

export default new AiModelsAPI()
