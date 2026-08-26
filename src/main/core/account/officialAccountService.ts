import { OFFICIAL_SYNC_SERVER_URL, isOfficialSyncServerUrl } from '../../../shared/syncServerUrl'
import {
  CredentialSessionService,
  type CredentialRefreshResult,
  type CredentialSession
} from '../auth/credentialSessionService'

export const OFFICIAL_ACCOUNT_DOCUMENT_ID = 'AUTH/official-account'

const service = new CredentialSessionService(OFFICIAL_ACCOUNT_DOCUMENT_ID)

/**
 * 读取设备级 ZTools 官方账号会话。
 * @returns 官方账号凭据；未登录时返回 null。
 */
export async function loadOfficialAccountSession(): Promise<CredentialSession | null> {
  const storedSession = await service.load()
  const normalizedSession = normalizeOfficialSession(storedSession)
  if (!storedSession || !normalizedSession) return null
  if (storedSession.serverUrl === OFFICIAL_SYNC_SERVER_URL) return normalizedSession

  try {
    // 旧官方域名已通过白名单校验，仅替换地址并保留当前最新 token。
    return normalizeOfficialSession(
      await service.migrateServerUrl(storedSession.serverUrl, OFFICIAL_SYNC_SERVER_URL)
    )
  } catch (error) {
    // 迁移回写失败不应让当前登录态立即掉线，后续读取会再次尝试。
    console.warn('[OfficialAccount] 迁移官方账号服务器地址失败:', error)
    return normalizedSession
  }
}

/**
 * 同步读取设备级 ZTools 官方账号会话。
 * @returns 官方账号凭据；未登录时返回 null。
 */
export function loadOfficialAccountSessionSync(): CredentialSession | null {
  return normalizeOfficialSession(service.loadSync())
}

/**
 * 保存官方账号登录或 OAuth 返回的 token。
 * @param input 官方账号用户名和 token。
 * @returns 持久化后的官方账号会话。
 */
export function saveOfficialAccountSession(input: {
  username: string
  token: string
  refreshToken?: string
}): Promise<CredentialSession> {
  return service.save({
    serverUrl: OFFICIAL_SYNC_SERVER_URL,
    username: input.username.trim(),
    token: input.token,
    refreshToken: input.refreshToken || ''
  })
}

/**
 * 清空官方账号 token，但不修改任何同步配置或私服凭据。
 * @returns 清理后的官方账号会话。
 */
export function clearOfficialAccountSession(): Promise<CredentialSession | null> {
  return service.clear()
}

/**
 * 仅在访问令牌仍匹配失败请求时清空官方账号会话。
 * @param expectedAccessToken 被服务端拒绝的访问令牌快照。
 * @returns 清理后的会话，或已变化的当前会话。
 */
export function clearOfficialRejectedAccessToken(
  expectedAccessToken: string
): Promise<CredentialSession | null> {
  return service.clearRejectedAccessToken(expectedAccessToken)
}

/**
 * 刷新官方账号 token。
 * @param expectedRefreshToken 调用方持有的 refresh token 快照。
 * @returns 官方账号刷新结果。
 */
export async function refreshOfficialAccountTokens(
  expectedRefreshToken?: string
): Promise<CredentialRefreshResult> {
  const session = await loadOfficialAccountSession()
  if (!session) return { status: 'unavailable', session: null }
  return service.refresh(expectedRefreshToken)
}

/**
 * 监听官方账号凭据失效。
 * @param listener 凭据清理后的监听函数。
 * @returns 用于取消监听的函数。
 */
export function onOfficialAccountInvalidated(
  listener: (session: CredentialSession) => void
): () => void {
  return service.onInvalidated(listener)
}

/**
 * 将当前或受信任历史官方地址的会话统一到当前官方地址。
 * @param session 待校验的设备级账号会话。
 * @returns 指向当前官方服务的会话；来源不可信时返回 null。
 */
function normalizeOfficialSession(session: CredentialSession | null): CredentialSession | null {
  if (!session || !isOfficialSyncServerUrl(session.serverUrl)) return null
  return { ...session, serverUrl: OFFICIAL_SYNC_SERVER_URL }
}
