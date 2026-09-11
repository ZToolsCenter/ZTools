import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import http from 'node:http'

/**
 * OrcaRouter 的认证与推理使用不同的公开 origin。
 *
 * - 认证与授权码兑换固定在 `https://www.orcarouter.ai`；
 * - 推理与模型目录固定在 `https://api.orcarouter.ai/v1`。
 *
 * 两者都不允许通过替换 hostname 或盲目追加 `/v1` 互相推导。
 */
export const ORCAROUTER_DEFAULT_AUTH_BASE_URL = 'https://www.orcarouter.ai'
export const ORCAROUTER_DEFAULT_API_BASE_URL = 'https://api.orcarouter.ai/v1'

/** 授权页面路径；相对认证 origin 固定为 `/auth`。 */
export const ORCAROUTER_AUTHORIZE_PATH = '/auth'

/** 授权码兑换路径；相对认证 origin 固定为 `/api/v1/auth/keys`。 */
export const ORCAROUTER_KEY_EXCHANGE_PATH = '/api/v1/auth/keys'

/** 授权码有效期（毫秒），与文档的 10 分钟 TTL 对齐。 */
export const ORCAROUTER_AUTH_CODE_TTL_MS = 10 * 60 * 1000

/** PKCE 授权默认申请的授权范围。 */
export const ORCAROUTER_DEFAULT_SCOPE = 'api'

/** 目录与交换请求允许持有的最大响应字节数，防止异常响应耗尽内存。 */
const MAX_AUTH_RESPONSE_BYTES = 64 * 1024

/** 单次认证尝试允许的最长等待时间。 */
const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60 * 1000

/** 认证失败的可分类原因，供界面给出可操作提示。 */
export type OrcaAuthFailure =
  | 'denied'
  | 'state_mismatch'
  | 'timeout'
  | 'cancelled'
  | 'expired_or_used'
  | 'challenge_rejected'
  | 'scope_unsatisfied'
  | 'rate_limited'
  | 'forbidden'
  | 'network'
  | 'invalid_response'
  | 'insecure_origin'

/**
 * 认证流程错误。
 *
 * 消息中只包含可安全展示的分类与状态码，永远不包含 verifier、授权码或密钥。
 */
export class OrcaAuthError extends Error {
  /** 分类后的失败原因。 */
  public readonly failure: OrcaAuthFailure
  /** 上游 HTTP 状态码；非 HTTP 失败时为 undefined。 */
  public readonly status?: number

  /**
   * @param failure 失败分类
   * @param message 可安全展示的说明
   * @param status 上游 HTTP 状态码
   */
  constructor(failure: OrcaAuthFailure, message: string, status?: number) {
    super(message)
    this.name = 'OrcaAuthError'
    this.failure = failure
    this.status = status
  }
}

/** 已解析的 OrcaRouter 端点配置。 */
export interface OrcaEndpointConfig {
  /** 认证 origin，例如 `https://www.orcarouter.ai`。 */
  authBaseUrl: string
  /** 推理 origin（含 `/v1`），例如 `https://api.orcarouter.ai/v1`。 */
  apiBaseUrl: string
}

/**
 * 判断地址是否为 loopback（HTTP 降级唯一允许的场景）。
 * @param url 已解析的地址
 * @returns 主机是否为 localhost、127.0.0.1 或 [::1]
 */
function isLoopbackHost(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/**
 * 规范化并校验单个 origin：非 loopback 必须使用 HTTPS。
 * @param raw 用户或环境变量提供的地址
 * @param fallback 缺省时使用的官方地址
 * @param label 出错信息中使用的字段名
 * @returns 去掉尾部斜杠后的 origin
 * @throws 地址非法或非 loopback 使用 HTTP 时抛出 OrcaAuthError
 */
export function normalizeOrcaOrigin(
  raw: string | undefined,
  fallback: string,
  label: string
): string {
  const value = (raw ?? '').trim() || fallback
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new OrcaAuthError('insecure_origin', `${label} 不是合法地址`)
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed))) {
    throw new OrcaAuthError('insecure_origin', `${label} 必须使用 HTTPS（仅 loopback 允许 HTTP）`)
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

/**
 * 按优先级解析认证与推理 origin。
 *
 * 优先级：显式 `ORCA_AUTH_BASE_URL` / `ORCA_API_BASE_URL` > 共享 `ORCA_BASE_URL` > 官方默认值。
 * 共享值只作为 self-hosted 的兜底，推理地址在其后追加 `/v1`（若尚未包含）。
 *
 * @param env 读取环境变量的映射，默认使用 process.env
 * @returns 已校验的认证与推理端点
 * @throws 地址非法或非 loopback 使用 HTTP 时抛出 OrcaAuthError
 */
export function resolveOrcaEndpoints(
  env: Record<string, string | undefined> = process.env
): OrcaEndpointConfig {
  const shared = (env.ORCA_BASE_URL ?? '').trim()
  const authRaw = (env.ORCA_AUTH_BASE_URL ?? '').trim() || shared
  const apiRaw = (env.ORCA_API_BASE_URL ?? '').trim()

  const authBaseUrl = normalizeOrcaOrigin(
    authRaw || undefined,
    ORCAROUTER_DEFAULT_AUTH_BASE_URL,
    'ORCA_AUTH_BASE_URL'
  )

  let apiBaseUrl: string
  if (apiRaw) {
    apiBaseUrl = normalizeOrcaOrigin(apiRaw, ORCAROUTER_DEFAULT_API_BASE_URL, 'ORCA_API_BASE_URL')
  } else if (shared) {
    // 共享 origin 只追加一次 `/v1`，避免把已有版本段重复拼接。
    const origin = normalizeOrcaOrigin(shared, ORCAROUTER_DEFAULT_API_BASE_URL, 'ORCA_BASE_URL')
    apiBaseUrl = /\/v1$/.test(origin) ? origin : `${origin}/v1`
  } else {
    apiBaseUrl = ORCAROUTER_DEFAULT_API_BASE_URL
  }

  return { authBaseUrl, apiBaseUrl }
}

/**
 * 以无 padding 的 base64url 编码二进制数据。
 * @param input 待编码数据
 * @returns 去掉 `=` 填充的 base64url 字符串
 */
export function toBase64Url(input: Buffer): string {
  return input.toString('base64url')
}

/**
 * 生成一次授权尝试使用的新鲜 PKCE 材料。
 *
 * verifier 与 state 均来自加密 RNG，且每次调用都重新生成。
 * @returns verifier、其 S256 challenge 与 state
 */
export function createPkceMaterial(): { verifier: string; challenge: string; state: string } {
  const verifier = toBase64Url(randomBytes(32))
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest())
  const state = toBase64Url(randomBytes(16))
  return { verifier, challenge, state }
}

/** 回调入口形态：loopback 监听，或需要用户复制的一次性代码。 */
export type OrcaPkceFlow = 'loopback' | 'oob'

/** 一次进行中的授权尝试（不持久化，仅驻留内存）。 */
export interface OrcaPkceAttempt {
  /** 本次尝试的唯一标识，用于让迟到的响应失效。 */
  attemptId: string
  flow: OrcaPkceFlow
  verifier: string
  state: string
  challenge: string
  /** loopback 流程的 `http://127.0.0.1:<port>/cb`，oob 流程固定为 `oob`。 */
  callbackUrl: string
  /** 需要用户打开或复制的授权地址。 */
  authorizeUrl: string
  createdAt: number
}

/** 已获得的 OrcaRouter 凭据。 */
export interface OrcaCredentialResult {
  /** 下游推理统一使用的普通 OrcaRouter API key。 */
  key: string
  /** 服务端返回的账号标识（若提供）。 */
  userId?: string
  /** 服务端实际授予的 scope。 */
  scope: string
}

/**
 * 构造授权地址。
 *
 * 始终发送 `code_challenge_method=S256`：即使带真实 callback_url，用户仍可能在同意页选择
 * “显示代码”，因此不允许使用 `plain`。verifier 绝不进入该地址。
 *
 * @param attempt 本次授权尝试的材料
 * @param config 已解析的端点配置
 * @param appName 同意页展示的应用名
 * @param scope 申请范围，默认 `api`
 * @returns 完整的授权地址
 */
export function buildOrcaAuthorizeUrl(
  attempt: OrcaPkceAttempt,
  config: OrcaEndpointConfig,
  appName: string,
  scope: string = ORCAROUTER_DEFAULT_SCOPE
): string {
  const url = new URL(ORCAROUTER_AUTHORIZE_PATH, config.authBaseUrl)
  url.searchParams.set('callback_url', attempt.callbackUrl)
  url.searchParams.set('code_challenge', attempt.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', attempt.state)
  url.searchParams.set('app_name', appName)
  url.searchParams.set('scope', scope)
  return url.toString()
}

/**
 * 校验交换响应中实际授予的 scope 是否满足当前用途。
 * @param granted 服务端返回的 scope
 * @param required 当前用途要求的最小 scope
 * @returns 满足要求时返回 true
 */
export function isOrcaScopeSatisfied(granted: string, required: string): boolean {
  return granted.trim() === required
}

/**
 * 将交换失败映射为可分类的 OrcaAuthError。
 * @param status HTTP 状态码
 * @param body 已读取的响应正文
 * @returns 分类后的认证错误
 */
function mapExchangeFailure(status: number, body: string): OrcaAuthError {
  // 上游错误正文可能回显请求内容；这里只保留状态语义，绝不透传原文。
  void body
  if (status === 400) {
    return new OrcaAuthError('challenge_rejected', '授权码校验方式被拒绝，请重新登录', status)
  }
  if (status === 403) {
    return new OrcaAuthError('expired_or_used', '授权码无效、已过期或已被使用，请重新登录', status)
  }
  if (status === 429) {
    return new OrcaAuthError('rate_limited', '登录过于频繁，请稍后再试', status)
  }
  return new OrcaAuthError('invalid_response', `授权码兑换失败（HTTP ${status}）`, status)
}

/** 执行一次受限读取的 fetch 依赖；便于测试注入。 */
export type OrcaFetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * 使用授权码与 verifier 兑换普通 OrcaRouter API key。
 *
 * 请求固定发往认证 origin 的 `/api/v1/auth/keys`；错误中不包含响应正文与凭据。
 *
 * @param options 兑换所需的授权码、尝试材料与端点配置
 * @returns 已授予的凭据结果
 * @throws 网络失败、响应非法或上游拒绝时抛出 OrcaAuthError
 */
export async function exchangeOrcaAuthCode(options: {
  code: string
  attempt: OrcaPkceAttempt
  config: OrcaEndpointConfig
  fetchImpl?: OrcaFetch
  timeoutMs?: number
}): Promise<OrcaCredentialResult> {
  const { code, attempt, config } = options
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as OrcaFetch)
  const timeoutMs = options.timeoutMs ?? 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(
      new URL(ORCAROUTER_KEY_EXCHANGE_PATH, config.authBaseUrl).toString(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: attempt.verifier,
          code_challenge_method: 'S256'
        }),
        signal: controller.signal
      }
    )

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw mapExchangeFailure(response.status, body)
    }

    const payload = (await response.json()) as { key?: unknown; user_id?: unknown; scope?: unknown }
    const key = typeof payload.key === 'string' ? payload.key.trim() : ''
    if (!key) {
      throw new OrcaAuthError('invalid_response', '授权码兑换未返回可用密钥')
    }
    return {
      key,
      userId: typeof payload.user_id === 'string' ? payload.user_id : undefined,
      scope: typeof payload.scope === 'string' ? payload.scope : ''
    }
  } catch (cause) {
    if (cause instanceof OrcaAuthError) throw cause
    // 网络中断或超时统一归类，避免把底层错误正文（可能含请求体）抛给调用方。
    throw new OrcaAuthError('network', '无法连接 OrcaRouter 认证服务')
  } finally {
    clearTimeout(timer)
  }
}

/** loopback 回调监听器。 */
export interface OrcaLoopbackListener {
  /** 实际监听的端口。 */
  port: number
  /** 回调地址。 */
  callbackUrl: string
  /** 设置本次尝试期望的 state，必须早于打开浏览器。 */
  setExpectedState(state: string): void
  /**
   * 等待浏览器回调并返回授权码。
   * @param signal 用于显式取消等待的信号
   * @returns 授权码
   */
  waitForCode(signal?: AbortSignal): Promise<string>
  /** 关闭监听器；重复调用安全。 */
  close(): void
}

/**
 * 在 127.0.0.1 上启动一次性回调监听器。
 *
 * 监听在打开浏览器之前完成，确保授权地址中的端口与真实端口一致。
 *
 * @param timeoutMs 未收到回调时的等待上限
 * @returns 已就绪的监听器
 */
export async function startOrcaLoopbackListener(
  timeoutMs: number = DEFAULT_AUTH_TIMEOUT_MS
): Promise<OrcaLoopbackListener> {
  let settled = false
  let expectedState = ''
  let resolveCode: (code: string) => void = () => undefined
  let rejectCode: (error: Error) => void = () => undefined
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/cb') {
      res.writeHead(404).end()
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<p>OrcaRouter 已连接，可以关闭此页面。</p>')

    if (settled) return
    settled = true

    const returnedState = url.searchParams.get('state') ?? ''
    // 恒定时间比较 state：这是阻止他人页面把授权码投递到本监听器的唯一防线。
    if (!safeEqual(returnedState, expectedState)) {
      rejectCode(new OrcaAuthError('state_mismatch', '授权回调校验失败，请重新登录'))
      return
    }
    const error = url.searchParams.get('error')
    if (error) {
      rejectCode(
        error === 'access_denied'
          ? new OrcaAuthError('denied', '已取消 OrcaRouter 授权')
          : new OrcaAuthError('invalid_response', 'OrcaRouter 授权未完成')
      )
      return
    }
    const code = url.searchParams.get('code') ?? ''
    if (!code) {
      rejectCode(new OrcaAuthError('invalid_response', '授权回调缺少授权码'))
      return
    }
    resolveCode(code)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const port = (server.address() as { port: number }).port

  return {
    port,
    callbackUrl: `http://127.0.0.1:${port}/cb`,
    setExpectedState(state: string): void {
      expectedState = state
    },
    waitForCode(signal?: AbortSignal): Promise<string> {
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        rejectCode(new OrcaAuthError('timeout', 'OrcaRouter 授权超时，请重试'))
      }, timeoutMs)
      const onAbort = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        rejectCode(new OrcaAuthError('cancelled', '已取消 OrcaRouter 授权'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const settledPromise = codePromise.finally(() => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      })
      // 消费者可能稍后才 await（例如回调先于 UI 订阅到达）；提前绑定防御性处理，
      // 避免一次正常的拒绝被上报成未处理的 Promise rejection。
      void settledPromise.catch(() => undefined)
      return settledPromise
    },
    close(): void {
      settled = true
      server.close()
    }
  }
}

/**
 * 恒定时间比较两个 UTF-8 字符串。
 * @param left 待比较值
 * @param right 期望值
 * @returns 完全一致时返回 true
 */
export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

/**
 * 创建一次授权尝试：生成新鲜材料并（按流程）准备回调地址。
 * @param flow 回调入口形态
 * @param listener loopback 流程已就绪的监听器
 * @returns 可直接用于构造授权地址的尝试对象
 */
export function createOrcaPkceAttempt(
  flow: OrcaPkceFlow,
  listener?: OrcaLoopbackListener
): OrcaPkceAttempt {
  const material = createPkceMaterial()
  const callbackUrl = flow === 'loopback' ? (listener?.callbackUrl ?? 'oob') : 'oob'
  if (flow === 'loopback') listener?.setExpectedState(material.state)
  return {
    attemptId: randomUUID(),
    flow,
    verifier: material.verifier,
    state: material.state,
    challenge: material.challenge,
    callbackUrl,
    authorizeUrl: '',
    createdAt: Date.now()
  }
}

/** 受长度限制的响应读取，避免异常响应占用过多内存。 */
export async function readBoundedText(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer.slice(0, MAX_AUTH_RESPONSE_BYTES)).toString('utf8')
}
