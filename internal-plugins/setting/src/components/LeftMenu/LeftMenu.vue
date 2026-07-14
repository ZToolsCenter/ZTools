<script setup lang="ts">
import defaultAvatar from '@/assets/image/default.png'
import { AccountLoginDialog, BaseDialog, useToast } from '@/components'
import {
  ACCOUNT_CHANGED_EVENT,
  ONLINE_SYNC_SERVER_URL,
  loginZToolsAccount,
  notifyAccountChanged,
  promptDefaultDataImportAfterLogin
} from '@/composables/useZToolsAccount'
import { MenuRouterItemType } from '@/router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()
const { success, error, warning, confirm } = useToast()

const menuRoutes = ref<MenuRouterItemType[]>([] as MenuRouterItemType[])
const loggedIn = ref(false)
const username = ref('')
const nickname = ref('')
const avatar = ref(defaultAvatar)
const loginVisible = ref(false)
const profileVisible = ref(false)
const loggingIn = ref(false)
const loadingStats = ref(false)
const loginUsername = ref('')
const editingNickname = ref(false)
const nicknameInput = ref('')
const updatingNickname = ref(false)
let accountLoadVersion = 0
const stats = ref<{
  documentCount: number
  attachmentCount: number
  storageBytes: number
  monthlyTraffic: number
} | null>(null)

interface AccountProfileCache {
  uid: string
  nickname?: string
  avatarUrl?: string
  updatedAt: number
}

const displayName = computed(() => nickname.value || username.value || 'ZTools 用户')

// 设置激活菜单
const setActiveMenu = ({ name }: MenuRouterItemType): void => {
  router.replace({ name })
}

// 自动加载路由
const autoLoadRouter = (): void => {
  menuRoutes.value = router
    .getRoutes()
    .filter((item) => item.meta)
    .filter((item) => item.path.split('/').length <= 2)
    .filter((item) => item.meta.menu) as MenuRouterItemType[]
}

onMounted(() => {
  autoLoadRouter()
  void loadAccount()
  window.addEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
})

onBeforeUnmount(() => {
  window.removeEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
})

function handleAccountChanged(): void {
  void loadAccount()
}

async function loadAccount(): Promise<void> {
  const version = (accountLoadVersion += 1)
  try {
    const result = await window.ztools.internal.syncGetConfig()
    const config = result.success ? result.config : null
    const uid = config?.username || ''
    const isLoggedIn = Boolean(config?.token && config.serverUrl === ONLINE_SYNC_SERVER_URL && uid)
    if (version !== accountLoadVersion) return

    loginUsername.value = uid
    if (isLoggedIn) {
      const cachedProfile = await readCachedProfile(uid)
      if (version !== accountLoadVersion) return

      loggedIn.value = true
      applyProfile(cachedProfile, uid)
      void refreshProfile(uid, version)
      void loadCloudStats()
    } else {
      clearAccountState()
    }
  } catch {
    if (version === accountLoadVersion) clearAccountState()
  }
}

function profileCacheKey(uid: string): string {
  return `account-profile-cache:${uid}`
}

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
    // 缓存失败不影响账号主流程。
  }
}

function applyProfile(
  profile: AccountProfileCache | null,
  fallbackUid: string = username.value
): void {
  username.value = profile?.uid || fallbackUid
  nickname.value = profile?.nickname || ''
  avatar.value = profile?.avatarUrl || defaultAvatar
}

function clearAccountState(): void {
  loggedIn.value = false
  username.value = ''
  nickname.value = ''
  avatar.value = defaultAvatar
  stats.value = null
}

async function refreshProfile(
  expectedUid: string,
  version: number = accountLoadVersion
): Promise<void> {
  try {
    const result = await window.ztools.internal.syncGetAccountProfile()
    if (version !== accountLoadVersion) return
    if (result.success && result.profile) {
      const profile = {
        uid: result.profile.uid || expectedUid,
        nickname: result.profile.nickname || '',
        avatarUrl: result.profile.avatarUrl || '',
        updatedAt: Date.now()
      }
      if (profile.uid !== expectedUid) return
      applyProfile(profile, expectedUid)
      await writeCachedProfile(profile)
    }
  } catch {
    // 远端 profile 拉取失败时保留本地缓存展示，避免头像和昵称闪回默认值。
  }
}

async function loadCloudStats(): Promise<void> {
  loadingStats.value = true
  try {
    const result = await window.ztools.internal.syncGetAccountStats()
    if (result.success && result.stats) {
      stats.value = {
        documentCount: result.stats.documentCount || 0,
        attachmentCount: result.stats.attachmentCount || 0,
        storageBytes: result.stats.storageBytes || 0,
        monthlyTraffic: result.stats.monthlyTraffic || 0
      }
    } else {
      stats.value = null
    }
  } finally {
    loadingStats.value = false
  }
}

function openAccount(): void {
  if (loggedIn.value) {
    profileVisible.value = true
    void loadCloudStats()
  } else {
    loginVisible.value = true
  }
}

async function submitLogin(
  payload: { username: string; password: string; captchaVerifyParam?: string },
  controls?: { resolve: () => void; reject: (error: unknown) => void }
): Promise<void> {
  if (!payload.username || !payload.password) {
    warning('请填写用户名和密码')
    controls?.reject(new Error('请填写用户名和密码'))
    return
  }
  loggingIn.value = true
  try {
    const result = await loginZToolsAccount(payload)
    controls?.resolve()
    loginVisible.value = false
    loginUsername.value = payload.username
    success(result.isNew ? '账号创建成功' : '登录成功')
    await promptDefaultDataImportAfterLogin({ confirm, success, error })
    await loadAccount()
  } catch (err: any) {
    controls?.reject(err)
    error(err?.message || '登录失败')
  } finally {
    loggingIn.value = false
  }
}

async function handleGithubLoginSuccess(data: {
  token: string
  refreshToken: string
  username: string
  isNew: boolean
}): Promise<void> {
  try {
    // 保存配置（与账号密码登录相同的逻辑）
    const configResult = await window.ztools.internal.syncGetConfig()
    const currentConfig = configResult.success ? configResult.config : null

    await window.ztools.internal.syncSaveConfig({
      enabled: Boolean(currentConfig?.enabled),
      serverUrl: ONLINE_SYNC_SERVER_URL,
      token: data.token,
      refreshToken: data.refreshToken,
      syncInterval: currentConfig?.syncInterval || 30,
      username: data.username
    })

    // 关闭登录对话框
    loginVisible.value = false
    loginUsername.value = data.username

    // 显示成功提示
    success(`GitHub 登录成功！欢迎${data.isNew ? '注册' : '回来'}，${data.username}`)

    // 触发账号变更事件
    notifyAccountChanged()

    await promptDefaultDataImportAfterLogin({ confirm, success, error })

    // 加载账号信息
    await loadAccount()
  } catch (err: any) {
    console.error('[GitHub Login] 保存配置失败:', err)
    error(err?.message || 'GitHub 登录失败')
  }
}

async function changeAvatar(): Promise<void> {
  const result = await window.ztools.internal.selectImageFile()
  if (!result.success || !result.path) {
    if (result.error) error(result.error)
    return
  }
  const uploaded = await window.ztools.internal.syncUploadAccountAvatar(result.path)
  if (!uploaded.success || !uploaded.profile) {
    error(uploaded.error || '头像上传失败')
    return
  }
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

async function logout(): Promise<void> {
  try {
    await window.ztools.internal.syncStopAutoSync()
    await window.ztools.internal.syncSaveConfig({
      enabled: false,
      serverUrl: ONLINE_SYNC_SERVER_URL,
      token: '',
      refreshToken: '',
      syncInterval: 30,
      username: ''
    })
    accountLoadVersion += 1
    clearAccountState()
    profileVisible.value = false
    success('已退出登录')
    notifyAccountChanged()
  } catch (err: any) {
    error(err?.message || '退出登录失败')
  }
}

function startEditNickname(): void {
  nicknameInput.value = nickname.value || username.value
  editingNickname.value = true
}

function cancelEditNickname(): void {
  editingNickname.value = false
  nicknameInput.value = ''
}

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

    if (result.success && result.profile) {
      const profile = {
        uid: result.profile.uid || username.value,
        nickname: result.profile.nickname || newNickname,
        avatarUrl: result.profile.avatarUrl || avatar.value,
        updatedAt: Date.now()
      }
      applyProfile(profile, username.value)
      await writeCachedProfile(profile)
      editingNickname.value = false
      success('昵称已更新')
    } else {
      error(result.error || '更新昵称失败')
    }
  } catch (err: any) {
    error(err?.message || '更新昵称失败')
  } finally {
    updatingNickname.value = false
  }
}

function formatBytes(value?: number): string {
  const size = Number(value || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}
</script>

<template>
  <!-- 左侧菜单 -->
  <div class="settings-sidebar">
    <div class="menu-list">
      <div
        v-for="menuRoute in menuRoutes"
        :key="menuRoute.name"
        class="menu-item"
        :class="{ active: route.name === menuRoute.name }"
        @click="setActiveMenu(menuRoute)"
      >
        <div :class="menuRoute.meta?.menu?.icon ?? ''" class="menu-icon" style="font-size: 18px" />
        <span class="menu-label">{{ menuRoute.meta?.menu?.label ?? '' }}</span>
      </div>
    </div>

    <button class="account-dock" type="button" @click="openAccount">
      <img v-if="loggedIn" class="account-avatar" :src="avatar" alt="" />
      <div v-else class="account-avatar account-placeholder">
        <div class="i-z-cloud" />
      </div>
      <div class="account-info">
        <strong>{{ loggedIn ? displayName : '注册/登录 ZTools' }}</strong>
        <span>{{ loggedIn ? '查看个人中心' : '同步数据与评论互动' }}</span>
      </div>
    </button>

    <AccountLoginDialog
      v-model:visible="loginVisible"
      :username="loginUsername"
      :loading="loggingIn"
      @submit="submitLogin"
      @github-login-success="handleGithubLoginSuccess"
    />

    <BaseDialog v-model:visible="profileVisible" title="个人中心" max-width="420px">
      <div class="profile-dialog">
        <div class="profile-header">
          <button class="profile-avatar-btn" type="button" @click="changeAvatar">
            <img class="profile-avatar" :src="avatar" alt="" />
            <span>修改头像</span>
          </button>
          <div>
            <div class="profile-name">{{ displayName }}</div>
            <div class="profile-subtitle">ZTools 云同步账号</div>
          </div>
        </div>

        <div class="profile-info">
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
        </div>

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
      </div>

      <template #footer>
        <button type="button" class="btn-danger" @click="logout">退出登录</button>
        <button type="button" class="btn-secondary" @click="profileVisible = false">关闭</button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
/* 左侧菜单 */
.settings-sidebar {
  display: flex;
  flex-direction: column;
  width: 200px;
  height: 100%;
  border-right: 1px solid var(--divider-color);
  min-height: 0;
}

.menu-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 10px;
  padding: 8px;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 10px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-color);
  border-radius: 8px;
}

.menu-item:last-child {
  margin-bottom: 0;
}

.menu-item:hover {
  background: var(--hover-bg);
}

.menu-item.active {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.account-dock {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 0;
  border-radius: 8px;
  background: var(--card-bg, var(--bg-color));
  color: var(--text-color);
  cursor: pointer;
  padding: 10px;
  text-align: left;
  transition: all 0.2s;
}

.account-dock:hover {
  background: var(--hover-bg);
  border-color: color-mix(in srgb, var(--primary-color) 35%, var(--divider-color));
}

.account-avatar,
.profile-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--hover-bg);
}

.account-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  font-size: 18px;
}

.account-info {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.account-info strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.account-info span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 12px;
}

.profile-dialog {
  display: grid;
  gap: 14px;
}

.profile-name {
  font-size: 16px;
  font-weight: 600;
}

.btn-secondary,
.btn-danger {
  border: none;
  border-radius: 8px;
  cursor: pointer;
  padding: 8px 14px;
}

.btn-secondary {
  background: #edf7f3;
  color: #24332d;
}

.btn-danger {
  margin-right: auto;
  background: #fdecef;
  color: #d03050;
}

.profile-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.profile-avatar-btn {
  display: grid;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  padding: 0;
  text-align: center;
  font-size: 12px;
}

.profile-avatar {
  width: 56px;
  height: 56px;
}

.profile-subtitle {
  color: var(--text-secondary);
  font-size: 12px;
  margin-top: 4px;
}

.profile-info {
  display: grid;
  gap: 12px;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
}

.info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.info-label {
  color: var(--text-secondary);
  font-size: 13px;
  flex-shrink: 0;
}

.info-value {
  color: var(--text-primary);
  font-size: 14px;
}

.info-value-with-action {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-link {
  background: none;
  border: none;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 13px;
  padding: 0;
}

.btn-link:hover {
  text-decoration: underline;
}

.nickname-edit {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.nickname-edit input {
  flex: 1;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.nickname-edit input:focus {
  border-color: var(--primary-color);
}

.btn-sm {
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  white-space: nowrap;
}

.btn-primary.btn-sm {
  background: var(--primary-color);
  color: white;
}

.btn-primary.btn-sm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary.btn-sm {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-secondary.btn-sm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.stat-item {
  display: grid;
  gap: 4px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  padding: 10px;
}

.stat-item span {
  color: var(--text-secondary);
  font-size: 12px;
}

.stat-item strong {
  font-size: 16px;
}
</style>
