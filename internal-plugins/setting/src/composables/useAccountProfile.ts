import { readonly, reactive } from 'vue'

export interface AccountProfile {
  uid: string
  nickname: string
  avatarUrl: string
  updatedAt: number
}

interface AccountProfileState extends AccountProfile {
  loggedIn: boolean
  loading: boolean
  error: string
}

interface RefreshAccountProfileOptions {
  force?: boolean
}

const state = reactive<AccountProfileState>({
  loggedIn: false,
  uid: '',
  nickname: '',
  avatarUrl: '',
  updatedAt: 0,
  loading: false,
  error: ''
})

let refreshVersion = 0
let activeRefresh: Promise<boolean> | null = null

/**
 * 生成指定账号的设备级资料缓存键。
 * @param uid 账号唯一标识
 * @returns 本地数据库缓存键
 */
function profileCacheKey(uid: string): string {
  return `account-profile-cache:${uid}`
}

/**
 * 将未知资料规范化为字段完整的账号资料。
 * @param value 待规范化的服务端或缓存资料
 * @param fallbackUid 资料缺少账号标识时使用的兜底值
 * @returns 字段完整的账号资料
 */
function normalizeProfile(value: unknown, fallbackUid: string): AccountProfile {
  const source = value && typeof value === 'object' ? (value as Partial<AccountProfile>) : {}
  return {
    uid: typeof source.uid === 'string' && source.uid ? source.uid : fallbackUid,
    nickname: typeof source.nickname === 'string' ? source.nickname : '',
    avatarUrl: typeof source.avatarUrl === 'string' ? source.avatarUrl : '',
    updatedAt:
      typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)
        ? source.updatedAt
        : Date.now()
  }
}

/**
 * 读取指定账号的设备级资料缓存。
 * @param uid 账号唯一标识
 * @returns 可用的资料缓存；不存在或读取失败时返回 null
 */
async function readCachedProfile(uid: string): Promise<AccountProfile | null> {
  if (!uid) return null
  try {
    const cached = await window.ztools.internal.dbGet(profileCacheKey(uid))
    if (!cached || typeof cached !== 'object') return null
    return normalizeProfile(cached, uid)
  } catch (error) {
    console.warn('[AccountProfile] 读取本地资料缓存失败:', error)
    return null
  }
}

/**
 * 将账号资料写入设备级缓存，供设置页下次打开时立即展示。
 * @param profile 要持久化的账号资料
 * @returns 缓存写入完成后结束的 Promise
 */
async function writeCachedProfile(profile: AccountProfile): Promise<void> {
  if (!profile.uid) return
  try {
    await window.ztools.internal.dbPut(profileCacheKey(profile.uid), profile)
  } catch (error) {
    // 缓存失败不改变服务端资料已经生效的结果。
    console.warn('[AccountProfile] 写入本地资料缓存失败:', error)
  }
}

/**
 * 将资料应用到共享响应式状态。
 * @param profile 要应用的账号资料
 * @returns 无返回值
 */
function applyProfile(profile: AccountProfile): void {
  state.loggedIn = true
  state.uid = profile.uid
  state.nickname = profile.nickname
  state.avatarUrl = profile.avatarUrl
  state.updatedAt = profile.updatedAt
  state.error = ''
}

/**
 * 执行一次账号会话校验、缓存加载和服务端资料刷新。
 * @returns 刷新成功或当前未登录时返回 true，请求失败时返回 false
 */
async function performRefresh(): Promise<boolean> {
  const version = (refreshVersion += 1)
  state.loading = true
  try {
    // 先确认当前设备的官方账号，避免把旧账号请求结果应用到新会话。
    const sessionResult = await window.ztools.internal.accountGetSession()
    const session = sessionResult.success ? sessionResult.session : null
    const uid = typeof session?.username === 'string' ? session.username : ''
    if (!session?.token || !uid) {
      if (version === refreshVersion) clearAccountProfile()
      return true
    }

    // 首次加载该账号时先应用设备缓存，远端结果随后覆盖。
    const cached = await readCachedProfile(uid)
    if (version !== refreshVersion) return false
    if (state.uid !== uid || !state.loggedIn) {
      applyProfile(cached || normalizeProfile(null, uid))
    }

    const result = await window.ztools.internal.syncGetAccountProfile()
    if (version !== refreshVersion) return false
    if (!result.success || !result.profile) {
      state.error = result.error || '获取账号资料失败'
      console.warn('[AccountProfile] 刷新远端资料失败:', state.error)
      return false
    }

    const profile = normalizeProfile(result.profile, uid)
    if (profile.uid !== uid) {
      state.error = '服务端账号资料与当前登录账号不一致'
      console.warn('[AccountProfile] 忽略账号不匹配的远端资料')
      return false
    }

    // 服务端是账号资料的权威来源，成功后同时更新界面和设备缓存。
    applyProfile(profile)
    await writeCachedProfile(profile)
    return true
  } catch (error) {
    if (version === refreshVersion) {
      state.error = error instanceof Error ? error.message : '获取账号资料失败'
      console.warn('[AccountProfile] 刷新账号资料异常:', error)
    }
    return false
  } finally {
    if (version === refreshVersion) state.loading = false
  }
}

/**
 * 刷新当前登录账号资料，并合并同一时刻的非强制刷新请求。
 * @param options 刷新控制选项；force 为 true 时废弃较早请求并重新读取服务端
 * @returns 刷新成功或当前未登录时返回 true，请求失败时返回 false
 */
export function refreshAccountProfile(
  options: RefreshAccountProfileOptions = {}
): Promise<boolean> {
  if (!options.force && activeRefresh) return activeRefresh

  const request = performRefresh()
  activeRefresh = request
  void request.finally(() => {
    // 较早请求结束时不得清除仍在执行的新请求引用。
    if (activeRefresh === request) activeRefresh = null
  })
  return request
}

/**
 * 应用服务端已经确认的资料修改，并使所有设置页消费者立即更新。
 * @param value 服务端返回的账号资料
 * @param fallbackUid 资料缺少账号标识时使用的当前账号
 * @returns 设备缓存写入完成后结束的 Promise
 */
export async function updateAccountProfile(value: unknown, fallbackUid: string): Promise<void> {
  const profile = normalizeProfile(value, fallbackUid)
  if (!profile.uid) return

  // 本机写操作已由服务端确认，废弃更早的读取结果以免发生状态回滚。
  refreshVersion += 1
  activeRefresh = null
  state.loading = false
  applyProfile(profile)
  await writeCachedProfile(profile)
}

/**
 * 清空共享账号资料状态，并使正在执行的旧请求失效。
 * @returns 无返回值
 */
export function clearAccountProfile(): void {
  refreshVersion += 1
  activeRefresh = null
  state.loggedIn = false
  state.uid = ''
  state.nickname = ''
  state.avatarUrl = ''
  state.updatedAt = 0
  state.loading = false
  state.error = ''
}

/**
 * 获取设置插件内共享的只读账号资料状态。
 * @returns 账号资料状态以及刷新、更新和清理操作
 */
export function useAccountProfile(): {
  state: Readonly<AccountProfileState>
  refresh: typeof refreshAccountProfile
  update: typeof updateAccountProfile
  clear: typeof clearAccountProfile
} {
  return {
    state: readonly(state),
    refresh: refreshAccountProfile,
    update: updateAccountProfile,
    clear: clearAccountProfile
  }
}
