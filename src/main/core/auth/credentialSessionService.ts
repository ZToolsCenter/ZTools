import { httpRequest } from '../../utils/httpRequest.js'
import lmdbInstance from '../lmdb/lmdbInstance'
import { coordinateTokenRefresh } from '../sync/tokenRefreshCoordinator'

export interface CredentialSession {
  serverUrl: string
  username: string
  token: string
  refreshToken?: string
}

export type CredentialRefreshResult =
  | { status: 'refreshed' | 'reused'; session: CredentialSession }
  | { status: 'invalid'; session: CredentialSession }
  | { status: 'unavailable'; session: CredentialSession | null; error?: unknown }

type CredentialInvalidatedListener = (session: CredentialSession) => void

/**
 * 为一个固定存储文档提供凭据读取、更新、清理和 refresh token 轮换能力。
 */
export class CredentialSessionService {
  private listeners = new Set<CredentialInvalidatedListener>()

  /**
   * 创建凭据会话服务。
   * @param documentId 用于持久化会话的 LMDB 文档 ID。
   * @returns 初始化后的凭据会话服务。
   */
  constructor(private documentId: string) {}

  /**
   * 读取当前凭据会话。
   * @returns 已保存的凭据；不存在或读取失败时返回 null。
   */
  async load(): Promise<CredentialSession | null> {
    try {
      const doc = await lmdbInstance.promises.get(this.documentId)
      return this.normalize(doc?.data)
    } catch {
      return null
    }
  }

  /**
   * 同步读取当前凭据会话，供同步插件 API 等同步调用方使用。
   * @returns 已保存的凭据；不存在或读取失败时返回 null。
   */
  loadSync(): CredentialSession | null {
    try {
      return this.normalize(lmdbInstance.get(this.documentId)?.data)
    } catch {
      return null
    }
  }

  /**
   * 保存完整凭据会话，并在 revision 冲突时重新读取后重试。
   * @param session 要保存的服务器、用户名和 token。
   * @returns 持久化完成后的凭据会话。
   * @throws 连续冲突或存储写入失败时抛出错误。
   */
  async save(session: CredentialSession): Promise<CredentialSession> {
    const normalized = this.normalize(session)
    if (!normalized) throw new Error('凭据会话不完整')

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentDoc = await lmdbInstance.promises.get(this.documentId)
      const result = await lmdbInstance.promises.put({
        _id: this.documentId,
        _rev: currentDoc?._rev,
        data: normalized
      })
      if (result?.ok) return normalized
      if (result?.name !== 'conflict') {
        throw new Error(result?.message || '保存凭据失败')
      }
    }
    throw new Error('保存凭据冲突，请重试')
  }

  /**
   * 仅在凭据仍指向预期旧地址时迁移服务器地址，并保留并发更新的账号与 token。
   * @param expectedServerUrl 当前存储中预期的旧服务器地址。
   * @param nextServerUrl 要写入的新服务器地址。
   * @returns 迁移后的凭据；会话已被删除时返回 null。
   * @throws 参数为空或存储写入失败时抛出错误。
   */
  async migrateServerUrl(
    expectedServerUrl: string,
    nextServerUrl: string
  ): Promise<CredentialSession | null> {
    if (!expectedServerUrl || !nextServerUrl) throw new Error('凭据服务器地址不能为空')

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentDoc = await lmdbInstance.promises.get(this.documentId)
      const current = this.normalize(currentDoc?.data)
      // 会话已切换地址或被删除时，禁止用旧快照覆盖最新状态。
      if (!current || current.serverUrl !== expectedServerUrl) return current

      const migrated = { ...current, serverUrl: nextServerUrl }
      const result = await lmdbInstance.promises.put({
        _id: this.documentId,
        _rev: currentDoc?._rev,
        data: migrated
      })
      if (result?.ok) return migrated
      if (result?.name !== 'conflict') {
        throw new Error(result?.message || '迁移凭据服务器地址失败')
      }
    }

    // 连续冲突时使用最新会话，由调用方决定是否继续迁移。
    return this.load()
  }

  /**
   * 清空当前凭据但保留服务器和用户名，供界面展示重新登录目标。
   * @param options 清理选项；主动注销可关闭凭据失效通知。
   * @returns 清理后的会话；原会话不存在时返回 null。
   */
  async clear(options: { notifyInvalidated?: boolean } = {}): Promise<CredentialSession | null> {
    const current = await this.load()
    if (!current) return null
    return this.persistClearedSession(current, options.notifyInvalidated !== false)
  }

  /**
   * 仅在访问令牌仍与失败请求一致时清空会话。
   * @param expectedAccessToken 被服务端拒绝的访问令牌快照。
   * @returns 清理后的会话，或已经变化的当前会话。
   */
  clearRejectedAccessToken(expectedAccessToken: string): Promise<CredentialSession | null> {
    return this.clearIfCurrent('', expectedAccessToken)
  }

  /**
   * 仅在 refresh token 仍与失败请求一致时清空会话。
   * @param expectedRefreshToken 被服务端拒绝的 refresh token 快照。
   * @returns 清理后的会话，或已经变化的当前会话。
   */
  clearRejectedRefreshToken(expectedRefreshToken: string): Promise<CredentialSession | null> {
    return this.clearIfCurrent(expectedRefreshToken)
  }

  /**
   * 监听凭据被服务端确认失效的事件。
   * @param listener 凭据清理后的监听函数。
   * @returns 用于取消监听的清理函数。
   */
  onInvalidated(listener: CredentialInvalidatedListener): () => void {
    this.listeners.add(listener)
    return (): void => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 使用当前 refresh token 换发凭据，并保护并发刷新和账号切换边界。
   * @param expectedRefreshToken 调用方准备使用的 refresh token；省略时使用最新值。
   * @returns 刷新、复用、失效或暂时不可用结果。
   */
  async refresh(expectedRefreshToken?: string): Promise<CredentialRefreshResult> {
    const latest = await this.load()
    if (!latest?.serverUrl) return { status: 'unavailable', session: latest }

    const refreshToken = expectedRefreshToken || latest.refreshToken
    if (!refreshToken) {
      const cleared = latest.token
        ? await this.clearIfCurrent('', latest.token)
        : await this.persistClearedSession(latest)
      return { status: 'invalid', session: cleared || latest }
    }

    // 会话已被其他请求轮换或切换时直接复用最新凭据。
    if (latest.refreshToken !== refreshToken) {
      return { status: 'reused', session: latest }
    }

    let tokens: { token: string; refreshToken: string } | null
    try {
      tokens = await coordinateTokenRefresh(refreshToken, async () => {
        const response = await httpRequest(
          `${this.serverUrlToHttp(latest.serverUrl)}/api/auth/refresh`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
            validateStatus: () => true
          }
        )
        if (response.status === 401) return null
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Refresh token request failed with status ${response.status}`)
        }
        const data =
          typeof response.data === 'string' ? this.safeParseJSON(response.data) : response.data
        if (!data?.token || !data?.refreshToken) {
          throw new Error('Refresh token response is incomplete')
        }
        return { token: data.token, refreshToken: data.refreshToken }
      })
    } catch (error) {
      const current = await this.load()
      if (current?.refreshToken && current.refreshToken !== refreshToken) {
        return { status: 'reused', session: current }
      }
      return { status: 'unavailable', session: current, error }
    }

    if (!tokens) {
      const current = await this.load()
      if (current?.refreshToken && current.refreshToken !== refreshToken) {
        return { status: 'reused', session: current }
      }
      const cleared = await this.clearIfCurrent(refreshToken)
      if (cleared?.refreshToken && cleared.refreshToken !== refreshToken) {
        return { status: 'reused', session: cleared }
      }
      return { status: 'invalid', session: cleared || current || latest }
    }

    return this.persistRefreshedSession(refreshToken, tokens)
  }

  /**
   * 仅在会话仍匹配请求快照时清空 token，避免覆盖新登录。
   * @param expectedRefreshToken 预期仍在存储中的 refresh token。
   * @param expectedAccessToken 无 refresh token 时用于保护旧访问令牌的快照。
   * @returns 清理后的会话，或已经变化的当前会话。
   */
  private async clearIfCurrent(
    expectedRefreshToken: string,
    expectedAccessToken?: string
  ): Promise<CredentialSession | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentDoc = await lmdbInstance.promises.get(this.documentId)
      const current = this.normalize(currentDoc?.data)
      if (
        !current ||
        (current.refreshToken || '') !== expectedRefreshToken ||
        (expectedAccessToken !== undefined && current.token !== expectedAccessToken)
      ) {
        return current
      }
      const cleared = { ...current, token: '', refreshToken: '' }
      const result = await lmdbInstance.promises.put({
        _id: this.documentId,
        _rev: currentDoc?._rev,
        data: cleared
      })
      if (result?.ok) {
        this.notifyInvalidated(cleared)
        return cleared
      }
      if (result?.name !== 'conflict') throw new Error(result?.message || '清理凭据失败')
    }
    return this.load()
  }

  /**
   * 保存显式退出产生的空 token 会话，并按选项通知监听者。
   * @param current 清理前的当前会话。
   * @param notifyInvalidated 是否通知凭据失效监听器。
   * @returns 清理后的会话。
   */
  private async persistClearedSession(
    current: CredentialSession,
    notifyInvalidated = true
  ): Promise<CredentialSession> {
    const cleared = await this.save({ ...current, token: '', refreshToken: '' })
    if (notifyInvalidated) this.notifyInvalidated(cleared)
    return cleared
  }

  /**
   * 在 refresh token 未变化时写入换发结果。
   * @param expectedRefreshToken 本轮被服务端消费的 refresh token。
   * @param tokens 服务端返回的新 token 对。
   * @returns 刷新成功、复用其他写入或暂时不可用结果。
   */
  private async persistRefreshedSession(
    expectedRefreshToken: string,
    tokens: { token: string; refreshToken: string }
  ): Promise<CredentialRefreshResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentDoc = await lmdbInstance.promises.get(this.documentId)
      const current = this.normalize(currentDoc?.data)
      if (!current || current.refreshToken !== expectedRefreshToken) {
        return current
          ? { status: 'reused', session: current }
          : { status: 'unavailable', session: null }
      }
      const next = { ...current, token: tokens.token, refreshToken: tokens.refreshToken }
      const result = await lmdbInstance.promises.put({
        _id: this.documentId,
        _rev: currentDoc?._rev,
        data: next
      })
      if (result?.ok) return { status: 'refreshed', session: next }
      if (result?.name !== 'conflict') {
        return {
          status: 'unavailable',
          session: current,
          error: new Error(result?.message || '保存刷新凭据失败')
        }
      }
    }
    return { status: 'unavailable', session: await this.load() }
  }

  /**
   * 将未知存储值规范化为凭据会话。
   * @param value 存储中读取的未知数据。
   * @returns 字段有效的会话；数据不完整时返回 null。
   */
  private normalize(value: unknown): CredentialSession | null {
    if (!value || typeof value !== 'object') return null
    const source = value as Partial<CredentialSession>
    const serverUrl = typeof source.serverUrl === 'string' ? source.serverUrl : ''
    const username = typeof source.username === 'string' ? source.username : ''
    if (!serverUrl || !username) return null
    return {
      serverUrl,
      username,
      token: typeof source.token === 'string' ? source.token : '',
      refreshToken: typeof source.refreshToken === 'string' ? source.refreshToken : ''
    }
  }

  /**
   * 隔离执行所有凭据失效监听器。
   * @param session 已清空 token 的会话。
   * @returns 无返回值。
   */
  private notifyInvalidated(session: CredentialSession): void {
    for (const listener of this.listeners) {
      try {
        listener(session)
      } catch (error) {
        console.error('[CredentialSession] 凭据失效监听器执行失败:', error)
      }
    }
  }

  /**
   * 将 WebSocket 服务地址转换为 HTTP API 地址。
   * @param serverUrl WebSocket 服务地址。
   * @returns 对应的 HTTP 或 HTTPS 地址。
   */
  private serverUrlToHttp(serverUrl: string): string {
    return serverUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')
  }

  /**
   * 安全解析服务端可能返回的 JSON 字符串。
   * @param raw 待解析的 JSON 文本。
   * @returns 解析结果；解析失败时返回 null。
   */
  private safeParseJSON(raw: string): any {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
}
