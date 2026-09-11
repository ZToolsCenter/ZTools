import { timingSafeEqual } from 'node:crypto'
import {
  createOrcaPkceAttempt,
  exchangeOrcaAuthCode,
  buildOrcaAuthorizeUrl,
  isOrcaScopeSatisfied,
  startOrcaLoopbackListener,
  OrcaAuthError,
  ORCAROUTER_DEFAULT_SCOPE,
  type OrcaCredentialResult,
  type OrcaEndpointConfig,
  type OrcaFetch,
  type OrcaLoopbackListener,
  type OrcaPkceAttempt,
  type OrcaPkceFlow
} from './orcaAuth.js'

/** 凭据来源：手填 API Key，或 OAuth 2.0 + PKCE 授权。 */
export type OrcaCredentialSource = 'api-key' | 'pkce'

/** 凭据状态；`needsReauth` 表示上游已拒绝该代次凭据。 */
export type OrcaCredentialStatus = 'active' | 'needsReauth'

/**
 * 一条已持久化的 OrcaRouter 凭据。
 *
 * 两种认证入口最终都只产生这一个普通 OrcaRouter API key。
 */
export interface OrcaCredential {
  source: OrcaCredentialSource
  key: string
  scope: string
  userId?: string
  /** 单调递增的代次；迟到的失败不得污染重新登录后的新凭据。 */
  generation: number
  status: OrcaCredentialStatus
  updatedAt: number
}

/** 读取/写入/清除凭据的最小存储接口，由宿主现有密钥存储实现。 */
export interface OrcaCredentialStore {
  /**
   * 读取当前凭据。
   * @returns 已保存的凭据；未登录时返回 null
   */
  read(): OrcaCredential | null
  /**
   * 写入凭据。
   * @param credential 待保存的凭据
   * @returns 无返回值
   */
  write(credential: OrcaCredential): void
  /**
   * 清除凭据。
   * @returns 无返回值
   */
  clear(): void
}

/**
 * 凭据获取输入：两种认证方式各自所需的字段。
 *
 * 调用方通过 `source` 选择 adapter；两条路径返回同一种 `OrcaCredentialResult`。
 */
export type OrcaCredentialAcquireInput =
  | { source: 'api-key'; key: string; scope?: string }
  | { source: 'pkce'; attemptId: string; code: string }

/**
 * 凭据获取接口：两种认证方式都是它的一个 adapter。
 *
 * provider 请求、模型目录与各 AI 入口只消费 `OrcaCredentialResult`，
 * 不关心凭据来自手填还是 PKCE。
 */
export interface OrcaCredentialAdapter {
  readonly source: OrcaCredentialSource
  /**
   * 获取一份新的 OrcaRouter 凭据。
   * @param input adapter 特有的输入
   * @returns 与下游无关的统一凭据结果
   */
  acquire(input: OrcaCredentialAcquireInput): Promise<OrcaCredentialResult>
}

/**
 * 将 API key 文本按键名脱敏，供日志与错误信息使用。
 * @param key 待脱敏的密钥
 * @returns 只保留首尾少量字符的脱敏文本；空值返回空串
 */
export function maskOrcaKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 10) return '***'
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`
}

/**
 * 校验手填 API Key 的基本格式，只拦截明显输入错误。
 *
 * `sk-orca-` 前缀不是凭据有效的证明，这里不做任何联网校验。
 *
 * @param key 用户输入的密钥
 * @returns 校验错误；通过时返回 null
 */
export function validateOrcaApiKeyInput(key: string): string | null {
  const trimmed = key.trim()
  if (!trimmed) return '请填写 OrcaRouter API Key'
  if (/\s/.test(trimmed)) return 'API Key 不能包含空格'
  return null
}

/**
 * API Key adapter：把用户手填的密钥规范化为统一凭据结果。
 */
export class OrcaApiKeyAdapter implements OrcaCredentialAdapter {
  public readonly source: OrcaCredentialSource = 'api-key'

  /**
   * 把用户手填的密钥规范化为统一凭据结果。
   * @param input 含 API Key 的获取输入
   * @returns 统一凭据结果
   * @throws 输入为空、含空白字符或来源不匹配时抛出 OrcaAuthError
   */
  public async acquire(input: OrcaCredentialAcquireInput): Promise<OrcaCredentialResult> {
    if (input.source !== 'api-key') {
      throw new OrcaAuthError('invalid_response', 'API Key adapter 收到了不匹配的凭据来源')
    }
    const error = validateOrcaApiKeyInput(input.key)
    if (error) throw new OrcaAuthError('invalid_response', error)
    return { key: input.key.trim(), scope: input.scope ?? ORCAROUTER_DEFAULT_SCOPE }
  }
}

/** PKCE 登录的进行中状态；verifier 只存在于主进程内存。 */
export interface OrcaPkceSession {
  attempt: OrcaPkceAttempt
  /** 用户需要打开或复制的授权地址。 */
  authorizeUrl: string
  /** loopback 流程在后台等待回调并完成兑换的 Promise。 */
  pending: Promise<OrcaCredentialResult> | null
  listener: OrcaLoopbackListener | null
  controller: AbortController
  /** 是否已终止（成功、失败或取消）。已终止的会话保留结果供 UI 读取一次。 */
  settled: boolean
}

/** 已终止会话的保留上限，防止长期运行堆积。 */
const MAX_SETTLED_SESSIONS = 8

/**
 * PKCE adapter：驱动 authorize → callback/一次性代码 → exchange → persist。
 */
export class OrcaPkceAdapter implements OrcaCredentialAdapter {
  public readonly source: OrcaCredentialSource = 'pkce'
  private readonly config: OrcaEndpointConfig
  private readonly appName: string
  private readonly fetchImpl: OrcaFetch | undefined
  private sessions = new Map<string, OrcaPkceSession>()

  /**
   * @param config 已解析的认证与推理端点
   * @param appName 同意页展示的应用名
   * @param fetchImpl 可注入的 fetch 实现，便于测试
   */
  constructor(config: OrcaEndpointConfig, appName = 'ZTools', fetchImpl?: OrcaFetch) {
    this.config = config
    this.appName = appName
    this.fetchImpl = fetchImpl
  }

  /**
   * 通过统一接口完成一次 PKCE 兑换。
   * @param input 含会话 ID 与授权码的获取输入
   * @returns 统一凭据结果
   * @throws 来源不匹配、会话失效或上游拒绝时抛出 OrcaAuthError
   */
  public async acquire(input: OrcaCredentialAcquireInput): Promise<OrcaCredentialResult> {
    if (input.source !== 'pkce') {
      throw new OrcaAuthError('invalid_response', 'PKCE adapter 收到了不匹配的凭据来源')
    }
    return this.complete(input.attemptId, input.code)
  }

  /**
   * 开始一次 PKCE 登录：新建新鲜 verifier/state，并返回用户需要访问的授权地址。
   *
   * @param options 流程类型与 loopback 流程使用的浏览器打开回调
   * @returns 会话 ID 与授权地址
   */
  public async start(options: {
    flow: OrcaPkceFlow
    openBrowser?: (url: string) => void
  }): Promise<{ attemptId: string; authorizeUrl: string }> {
    let listener: OrcaLoopbackListener | null = null
    if (options.flow === 'loopback') {
      // 先监听再打开浏览器，保证授权地址中的端口与真实端口一致。
      listener = await startOrcaLoopbackListener()
    }

    const attempt = createOrcaPkceAttempt(options.flow, listener ?? undefined)
    attempt.authorizeUrl = buildOrcaAuthorizeUrl(attempt, this.config, this.appName)
    const controller = new AbortController()

    const session: OrcaPkceSession = {
      attempt,
      authorizeUrl: attempt.authorizeUrl,
      pending: null,
      listener,
      controller,
      settled: false
    }

    if (listener) {
      const pending = listener
        .waitForCode(controller.signal)
        .then((code) =>
          exchangeOrcaAuthCode({
            code: code.trim(),
            attempt,
            config: this.config,
            fetchImpl: this.fetchImpl
          })
        )
        .then((result) => {
          session.settled = true
          listener?.close()
          this.trimSettledSessions()
          return result
        })
      session.pending = pending
      // UI 可能稍后才读取结果（例如回调先于订阅到达）；提前绑定防御性处理，
      // 避免一次正常的失败被上报成未处理的 Promise rejection。
      void pending.catch(() => {
        session.settled = true
        listener?.close()
        this.trimSettledSessions()
      })
    }

    this.sessions.set(attempt.attemptId, session)
    return { attemptId: attempt.attemptId, authorizeUrl: attempt.authorizeUrl }
  }

  /**
   * 使用用户提供的一次性代码完成兑换（Flow B，或 loopback 流程的手工粘贴）。
   *
   * @param attemptId 会话 ID
   * @param code 授权页显示的授权码
   * @returns 统一凭据结果
   * @throws 会话不存在、已结束或上游拒绝时抛出 OrcaAuthError
   */
  public async complete(attemptId: string, code: string): Promise<OrcaCredentialResult> {
    const session = this.sessions.get(attemptId)
    if (!session) {
      throw new OrcaAuthError('expired_or_used', '授权会话已失效，请重新登录')
    }
    const trimmed = code.trim()
    if (!trimmed) throw new OrcaAuthError('invalid_response', '请填写授权码')

    const result = await exchangeOrcaAuthCode({
      code: trimmed,
      attempt: session.attempt,
      config: this.config,
      fetchImpl: this.fetchImpl
    })
    // 授权码一次性使用：无论成败都终止会话，避免同一授权码被再次兑换。
    session.settled = true
    this.release(attemptId)
    return result
  }

  /**
   * 等待 loopback 回调完成兑换。
   * @param attemptId 会话 ID
   * @returns 统一凭据结果
   */
  public async waitForCallback(attemptId: string): Promise<OrcaCredentialResult> {
    // 已终止的会话保留结果，使回调先于 UI 订阅到达时仍能读到同一次登录的结果。
    const pending = this.sessions.get(attemptId)?.pending
    if (!pending) {
      throw new OrcaAuthError('invalid_response', '当前授权方式没有回调等待')
    }
    return pending
  }

  /**
   * 修剪已终止的旧会话，避免长期运行堆积。
   * @returns 无返回值
   */
  private trimSettledSessions(): void {
    const settled = Array.from(this.sessions.entries()).filter(([, session]) => session.settled)
    const excess = this.sessions.size - MAX_SETTLED_SESSIONS
    for (let index = 0; index < excess && index < settled.length; index += 1) {
      const [attemptId, session] = settled[index]
      session.listener?.close()
      this.sessions.delete(attemptId)
    }
  }

  /**
   * 取消一次进行中的登录，释放监听器与等待。
   * @param attemptId 会话 ID
   * @returns 无返回值
   */
  public cancel(attemptId: string): void {
    const session = this.sessions.get(attemptId)
    if (!session) return
    session.settled = true
    session.controller.abort()
    session.listener?.close()
    this.sessions.delete(attemptId)
  }

  /**
   * 结束会话并释放资源；重复调用安全。
   * @param attemptId 会话 ID
   * @returns 无返回值
   */
  private release(attemptId: string): void {
    const session = this.sessions.get(attemptId)
    if (!session) return
    session.listener?.close()
    this.sessions.delete(attemptId)
  }

  /**
   * 清除所有进行中的会话。
   * @returns 无返回值
   */
  public dispose(): void {
    for (const attemptId of Array.from(this.sessions.keys())) this.cancel(attemptId)
  }

  /** 当前进行中的会话数量，供测试与状态展示使用。 */
  public get pendingCount(): number {
    return this.sessions.size
  }
}

/**
 * 统一持久化两种认证入口产出的凭据。
 *
 * 每次写入都会递增代次，使迟到的异步失败无法影响新凭据。
 *
 * @param store 凭据存储
 * @param source 凭据来源
 * @param result adapter 返回的凭据结果
 * @param requiredScope 当前用途要求的最小 scope
 * @returns 已持久化的凭据
 * @throws 实际授予的 scope 不满足要求时抛出 OrcaAuthError
 */
export function persistOrcaCredential(
  store: OrcaCredentialStore,
  source: OrcaCredentialSource,
  result: OrcaCredentialResult,
  requiredScope: string = ORCAROUTER_DEFAULT_SCOPE
): OrcaCredential {
  // 只接受服务端实际授予、且满足当前用途的 scope，不把请求 scope 当成已授权 scope。
  if (result.scope && !isOrcaScopeSatisfied(result.scope, requiredScope)) {
    throw new OrcaAuthError(
      'scope_unsatisfied',
      `授予的授权范围是“${result.scope}”，无法满足当前用途`
    )
  }

  const previous = store.read()
  const credential: OrcaCredential = {
    source,
    key: result.key,
    scope: result.scope || requiredScope,
    userId: result.userId,
    generation: (previous?.generation ?? 0) + 1,
    status: 'active',
    updatedAt: Date.now()
  }
  store.write(credential)
  return credential
}

/**
 * 标记指定代次的凭据需要重新认证。
 *
 * 只有代次完全匹配时才会生效，避免迟到的失败污染重新登录后的新凭据。
 *
 * @param store 凭据存储
 * @param generation 发出被拒请求时使用的凭据代次
 * @returns 是否实际标记了当前凭据
 */
export function markOrcaCredentialNeedsReauth(
  store: OrcaCredentialStore,
  generation: number
): boolean {
  const current = store.read()
  if (!current || current.generation !== generation || current.status === 'needsReauth') {
    return false
  }
  // 只标记状态，不删除旧密钥：登录成功前删除会把可恢复失败变成不可逆的账号丢失。
  store.write({ ...current, status: 'needsReauth' })
  return true
}

/**
 * 判断上游 401 是否应触发重新认证而不是重试或刷新。
 * @param status 上游 HTTP 状态码
 * @returns 是否为需要重新认证的终态
 */
export function isOrcaReauthStatus(status: number): boolean {
  return status === 401
}

/**
 * 恒定时间比较两个字符串，供需要额外校验的调用方复用。
 * @param left 待比较值
 * @param right 期望值
 * @returns 完全一致时返回 true
 */
export function orcaSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}
