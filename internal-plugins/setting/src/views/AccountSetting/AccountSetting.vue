<script setup lang="ts">
import defaultAvatar from '@/assets/image/default.png'
import { useToast } from '@/components'
import { ONLINE_SYNC_SERVER_URL, notifyAccountChanged } from '@/composables/useZToolsAccount'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

interface AccountProfileCache {
  uid: string
  nickname?: string
  avatarUrl?: string
  updatedAt: number
}

const router = useRouter()
const { success, error, warning } = useToast()

const username = ref('')
const nickname = ref('')
const avatar = ref(defaultAvatar)
const loadingProfile = ref(true)
const loadingStats = ref(false)
const editingNickname = ref(false)
const nicknameInput = ref('')
const updatingNickname = ref(false)
const stats = ref<{
  documentCount: number
  attachmentCount: number
  storageBytes: number
  monthlyTraffic: number
} | null>(null)

const displayName = computed(() => nickname.value || username.value || 'ZTools 用户')

onMounted(() => {
  void loadAccount()
})

/**
 * 生成指定账号的本地资料缓存键。
 * @param uid 账号唯一标识
 * @returns 本地数据库缓存键
 */
function profileCacheKey(uid: string): string {
  return `account-profile-cache:${uid}`
}

/**
 * 读取指定账号的本地资料缓存。
 * @param uid 账号唯一标识
 * @returns 账号资料缓存；不存在或读取失败时返回 null
 */
async function readCachedProfile(uid: string): Promise<AccountProfileCache | null> {
  if (!uid) return null

  try {
    const cached = await window.ztools.internal.dbGet(profileCacheKey(uid))
    if (!cached || typeof cached !== 'object') return null

    return {
      uid: typeof cached.uid === 'string' ? cached.uid : uid,
      nickname: typeof cached.nickname === 'string' ? cached.nickname : '',
      avatarUrl: typeof cached.avatarUrl === 'string' ? cached.avatarUrl : '',
      updatedAt: Number(cached.updatedAt || 0)
    }
  } catch {
    return null
  }
}

/**
 * 持久化账号资料缓存，供侧边栏和个人中心快速展示。
 * @param profile 要写入的账号资料
 * @returns 缓存写入完成后结束的 Promise
 */
async function writeCachedProfile(profile: AccountProfileCache): Promise<void> {
  if (!profile.uid) return

  try {
    await window.ztools.internal.dbPut(profileCacheKey(profile.uid), {
      uid: profile.uid,
      nickname: profile.nickname || '',
      avatarUrl: profile.avatarUrl || '',
      updatedAt: profile.updatedAt || Date.now()
    })
  } catch {
    // 本地缓存失败不阻断资料更新和账号操作。
  }
}

/**
 * 将账号资料应用到当前页面状态。
 * @param profile 要展示的账号资料
 * @param fallbackUid 资料缺少账号标识时使用的兜底值
 * @returns 无返回值
 */
function applyProfile(profile: AccountProfileCache | null, fallbackUid: string): void {
  username.value = profile?.uid || fallbackUid
  nickname.value = profile?.nickname || ''
  avatar.value = profile?.avatarUrl || defaultAvatar
}

/**
 * 校验登录状态并加载个人中心所需资料。
 * @returns 资料加载完成后结束的 Promise
 */
async function loadAccount(): Promise<void> {
  loadingProfile.value = true

  try {
    // 个人中心只允许当前 ZTools 云同步账号访问。
    const result = await window.ztools.internal.syncGetConfig()
    const config = result.success ? result.config : null
    const uid = config?.username || ''
    const isLoggedIn = Boolean(config?.token && config.serverUrl === ONLINE_SYNC_SERVER_URL && uid)
    if (!isLoggedIn) {
      await router.replace({ name: 'GeneralSetting' })
      return
    }

    // 先使用本地缓存完成首屏，再并行刷新远端资料和统计数据。
    const cachedProfile = await readCachedProfile(uid)
    applyProfile(cachedProfile, uid)
    await Promise.allSettled([refreshProfile(uid), loadCloudStats()])
  } catch (err: unknown) {
    console.error('加载个人中心失败:', err)
    error('加载个人中心失败')
  } finally {
    loadingProfile.value = false
  }
}

/**
 * 从服务端刷新账号资料并更新本地缓存。
 * @param expectedUid 当前页面预期加载的账号标识
 * @returns 资料刷新完成后结束的 Promise
 */
async function refreshProfile(expectedUid: string): Promise<void> {
  try {
    const result = await window.ztools.internal.syncGetAccountProfile()
    if (!result.success || !result.profile) return

    const profile = {
      uid: result.profile.uid || expectedUid,
      nickname: result.profile.nickname || '',
      avatarUrl: result.profile.avatarUrl || '',
      updatedAt: Date.now()
    }
    if (profile.uid !== expectedUid) return

    // 仅应用当前账号的返回结果，避免账号切换期间写入错位资料。
    applyProfile(profile, expectedUid)
    await writeCachedProfile(profile)
  } catch {
    // 远端刷新失败时继续使用本地缓存，个人中心仍保持可用。
  }
}

/**
 * 加载当前账号的云存储与流量统计。
 * @returns 统计加载完成后结束的 Promise
 */
async function loadCloudStats(): Promise<void> {
  loadingStats.value = true

  try {
    const result = await window.ztools.internal.syncGetAccountStats()
    if (!result.success || !result.stats) {
      stats.value = null
      return
    }

    stats.value = {
      documentCount: result.stats.documentCount || 0,
      attachmentCount: result.stats.attachmentCount || 0,
      storageBytes: result.stats.storageBytes || 0,
      monthlyTraffic: result.stats.monthlyTraffic || 0
    }
  } finally {
    loadingStats.value = false
  }
}

/**
 * 选择并上传新的账号头像。
 * @returns 头像选择与上传完成后结束的 Promise
 */
async function changeAvatar(): Promise<void> {
  // 先由主进程选择本地图片，再交给同步服务上传。
  const selected = await window.ztools.internal.selectImageFile()
  if (!selected.success || !selected.path) {
    if (selected.error) error(selected.error)
    return
  }

  const uploaded = await window.ztools.internal.syncUploadAccountAvatar(selected.path)
  if (!uploaded.success || !uploaded.profile) {
    error(uploaded.error || '头像上传失败')
    return
  }

  // 上传成功后同步当前页面、本地缓存和侧边栏账号信息。
  const profile = {
    uid: uploaded.profile.uid || username.value,
    nickname: uploaded.profile.nickname || nickname.value,
    avatarUrl: uploaded.profile.avatarUrl || '',
    updatedAt: Date.now()
  }
  applyProfile(profile, username.value)
  await writeCachedProfile(profile)
  notifyAccountChanged()
  success('账号头像已更新')
}

/**
 * 退出当前账号并返回通用设置页面。
 * @returns 退出流程完成后结束的 Promise
 */
async function logout(): Promise<void> {
  try {
    // 先停止同步任务，再清空持久化登录凭据。
    await window.ztools.internal.syncStopAutoSync()
    await window.ztools.internal.syncSaveConfig({
      enabled: false,
      serverUrl: ONLINE_SYNC_SERVER_URL,
      token: '',
      refreshToken: '',
      syncInterval: 30,
      username: ''
    })

    notifyAccountChanged()
    success('已退出登录')
    await router.replace({ name: 'GeneralSetting' })
  } catch (err: unknown) {
    error(err instanceof Error ? err.message : '退出登录失败')
  }
}

/**
 * 进入昵称编辑状态并填充当前昵称。
 * @returns 无返回值
 */
function startEditNickname(): void {
  nicknameInput.value = nickname.value || username.value
  editingNickname.value = true
}

/**
 * 取消昵称编辑并清空临时输入。
 * @returns 无返回值
 */
function cancelEditNickname(): void {
  editingNickname.value = false
  nicknameInput.value = ''
}

/**
 * 保存当前输入的新昵称并同步账号资料缓存。
 * @returns 昵称保存完成后结束的 Promise
 */
async function saveNickname(): Promise<void> {
  const newNickname = nicknameInput.value.trim()
  if (!newNickname) {
    warning('昵称不能为空')
    return
  }

  if (newNickname === nickname.value) {
    editingNickname.value = false
    return
  }

  try {
    updatingNickname.value = true

    // 提交前重新读取令牌，避免使用已过期或已退出的账号状态。
    const config = await window.ztools.internal.syncGetConfig()
    if (!config.success || !config.config?.token) {
      error('未登录，无法修改昵称')
      return
    }

    const result = await window.ztools.internal.syncUpdateNickname({
      serverUrl: config.config.serverUrl,
      token: config.config.token,
      nickname: newNickname
    })
    if (!result.success || !result.profile) {
      error(result.error || '更新昵称失败')
      return
    }

    // 保存服务端最终资料，并通知侧边栏更新展示名称。
    const profile = {
      uid: result.profile.uid || username.value,
      nickname: result.profile.nickname || newNickname,
      avatarUrl: result.profile.avatarUrl || avatar.value,
      updatedAt: Date.now()
    }
    applyProfile(profile, username.value)
    await writeCachedProfile(profile)
    editingNickname.value = false
    notifyAccountChanged()
    success('昵称已更新')
  } catch (err: unknown) {
    error(err instanceof Error ? err.message : '更新昵称失败')
  } finally {
    updatingNickname.value = false
  }
}

/**
 * 将字节数格式化为适合界面展示的容量文本。
 * @param value 要格式化的字节数
 * @returns 带容量单位的文本
 */
function formatBytes(value?: number): string {
  const size = Number(value || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}
</script>

<template>
  <div class="content-panel">
    <div v-if="loadingProfile" class="loading-state">加载中...</div>
    <div v-else class="account-page">
      <section class="profile-overview">
        <button class="avatar-button" type="button" @click="changeAvatar">
          <img class="profile-avatar" :src="avatar" alt="" />
          <span>修改头像</span>
        </button>
        <div class="profile-heading">
          <strong>{{ displayName }}</strong>
          <span>ZTools 云同步账号</span>
        </div>
      </section>

      <section class="profile-info" aria-label="账号资料">
        <div class="info-item">
          <span class="info-label">用户名</span>
          <span class="info-value">{{ username }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">昵称</span>
          <div v-if="!editingNickname" class="info-value-with-action">
            <span class="info-value">{{ nickname || username }}</span>
            <button type="button" class="btn-link" @click="startEditNickname">修改</button>
          </div>
          <div v-else class="nickname-edit">
            <input
              v-model="nicknameInput"
              type="text"
              placeholder="输入昵称"
              maxlength="50"
              @keyup.enter="saveNickname"
              @keyup.esc="cancelEditNickname"
            />
            <button
              type="button"
              class="btn-primary btn-sm"
              :disabled="updatingNickname"
              @click="saveNickname"
            >
              {{ updatingNickname ? '保存中...' : '保存' }}
            </button>
            <button
              type="button"
              class="btn-secondary btn-sm"
              :disabled="updatingNickname"
              @click="cancelEditNickname"
            >
              取消
            </button>
          </div>
        </div>
      </section>

      <section class="usage-section">
        <h2>云同步用量</h2>
        <div class="stats-grid">
          <div class="stat-item">
            <span>云空间占用</span>
            <strong>{{ loadingStats ? '加载中' : formatBytes(stats?.storageBytes) }}</strong>
          </div>
          <div class="stat-item">
            <span>文档数量</span>
            <strong>{{ stats?.documentCount || 0 }}</strong>
          </div>
          <div class="stat-item">
            <span>附件数量</span>
            <strong>{{ stats?.attachmentCount || 0 }}</strong>
          </div>
          <div class="stat-item">
            <span>本月流量</span>
            <strong>{{ formatBytes(stats?.monthlyTraffic) }}</strong>
          </div>
        </div>
      </section>

      <footer class="profile-actions">
        <button type="button" class="btn-danger" @click="logout">退出登录</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.content-panel {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 20px;
  background: var(--bg-color);
}

.account-page {
  width: min(100%, 820px);
  margin: 0 auto;
}

.loading-state {
  display: grid;
  min-height: 160px;
  place-items: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.profile-overview {
  display: flex;
  align-items: center;
  gap: 18px;
  padding-bottom: 28px;
}

.avatar-button {
  display: grid;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  padding: 0;
  font-size: 12px;
}

.profile-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--hover-bg);
}

.profile-heading {
  display: grid;
  gap: 5px;
}

.profile-heading strong {
  color: var(--text-color);
  font-size: 20px;
}

.profile-heading span {
  color: var(--text-secondary);
  font-size: 13px;
}

.profile-info {
  border-top: 1px solid var(--divider-color);
}

.info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 58px;
  border-bottom: 1px solid var(--divider-color);
}

.info-label {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.info-value {
  color: var(--text-color);
  font-size: 14px;
  overflow-wrap: anywhere;
}

.info-value-with-action,
.nickname-edit {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.btn-link {
  border: 0;
  background: none;
  color: var(--primary-color);
  cursor: pointer;
  padding: 0;
  font-size: 13px;
}

.nickname-edit {
  flex: 1;
}

.nickname-edit input {
  width: min(260px, 100%);
  border: 1px solid var(--divider-color);
  border-radius: 6px;
  outline: none;
  padding: 7px 10px;
  background: var(--control-bg);
  color: var(--text-color);
  font-size: 13px;
}

.nickname-edit input:focus {
  border-color: var(--primary-color);
}

.btn-sm,
.btn-danger {
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-sm {
  padding: 7px 12px;
  font-size: 13px;
}

.btn-primary {
  background: var(--primary-color);
  color: var(--text-on-primary);
}

.btn-secondary {
  background: var(--control-bg);
  color: var(--text-color);
}

.btn-sm:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.usage-section {
  padding: 28px 0;
}

.usage-section h2 {
  margin: 0 0 14px;
  color: var(--primary-color);
  font-size: 14px;
  font-weight: 600;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.stat-item {
  display: grid;
  gap: 5px;
  min-height: 82px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  padding: 16px;
}

.stat-item span {
  color: var(--text-secondary);
  font-size: 12px;
}

.stat-item strong {
  color: var(--text-color);
  font-size: 18px;
}

.profile-actions {
  padding-top: 20px;
  border-top: 1px solid var(--divider-color);
}

.btn-danger {
  padding: 9px 16px;
  background: #fdecef;
  color: #d03050;
}

@media (prefers-color-scheme: dark) {
  .btn-danger {
    background: rgba(208, 48, 80, 0.18);
    color: #ff8098;
  }
}

@media (max-width: 760px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .nickname-edit {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
