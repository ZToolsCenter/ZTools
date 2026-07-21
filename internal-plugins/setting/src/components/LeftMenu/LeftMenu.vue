<script setup lang="ts">
import defaultAvatar from '@/assets/image/default.png'
import { AccountLoginDialog, useToast } from '@/components'
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
const loggingIn = ref(false)
const loginUsername = ref('')
let accountLoadVersion = 0

interface AccountProfileCache {
  uid: string
  nickname?: string
  avatarUrl?: string
  updatedAt: number
}

const displayName = computed(() => nickname.value || username.value || 'ZTools 用户')

/**
 * 切换右侧设置页面。
 * @param item 要切换到的菜单路由项
 * @returns 无返回值
 */
const setActiveMenu = (item: MenuRouterItemType): void => {
  // 菜单导航直接替换右侧路由内容。
  router.replace({ name: item.name })
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

/**
 * 清理当前账号展示状态，并在当前页面失效时回到通用设置。
 * @returns 无返回值
 */
function clearAccountState(): void {
  // 登录态失效后离开账号页面，避免继续展示过期账号信息。
  if (route.name === 'Account') {
    void router.replace({ name: 'GeneralSetting' })
  }
  loggedIn.value = false
  username.value = ''
  nickname.value = ''
  avatar.value = defaultAvatar
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

/**
 * 根据当前登录状态打开个人中心路由或登录对话框。
 * @returns 无返回值
 */
function openAccount(): void {
  if (loggedIn.value) {
    // 已登录账号直接切换右侧路由内容，不创建覆盖层。
    void router.replace({ name: 'Account' })
  } else {
    // 未登录时仍需通过对话框完成账号认证。
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

    <button
      class="account-dock"
      :class="{ active: route.name === 'Account' }"
      type="button"
      @click="openAccount"
    >
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

.account-dock.active {
  background: var(--active-bg);
  color: var(--primary-color);
}

.account-avatar {
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
</style>
