<script setup lang="ts">
import defaultAvatar from '@/assets/image/default.png'
import { AccountLoginDialog, useToast } from '@/components'
import {
  ACCOUNT_CHANGED_EVENT,
  loginZToolsAccount,
  notifyAccountChanged,
  promptDefaultDataImportAfterLogin
} from '@/composables/useZToolsAccount'
import { MenuRouterItemType } from '@/router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAccountProfile, useNotificationCenter } from '@/composables'
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()
const { success, error, warning, confirm } = useToast()
const { unreadCount, unreadLabel } = useNotificationCenter()
const { state: accountProfile, refresh: refreshAccountProfile } = useAccountProfile()

const menuRoutes = ref<MenuRouterItemType[]>([] as MenuRouterItemType[])
const loginVisible = ref(false)
const loggingIn = ref(false)
const loginUsername = ref('')
let stopSyncStatusListener: (() => void) | null = null

const loggedIn = computed(() => accountProfile.loggedIn)
const avatar = computed(() => accountProfile.avatarUrl || defaultAvatar)
const displayName = computed(() => accountProfile.nickname || accountProfile.uid || 'ZTools 用户')

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
  void loadAccount(false)
  window.addEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
  stopSyncStatusListener =
    window.ztools.internal.onSyncStatusChanged?.((payload = {}) => {
      if (payload.credentialsInvalidated || payload.accountCredentialsInvalidated) {
        void loadAccount(true)
      }
    }) || null
})

onBeforeUnmount(() => {
  window.removeEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
  stopSyncStatusListener?.()
  stopSyncStatusListener = null
})

/**
 * 响应账号会话或资料变化并强制刷新共享状态。
 * @returns 无返回值
 */
function handleAccountChanged(): void {
  void loadAccount(true)
}

/**
 * 刷新共享账号资料，并在登录态失效时退出个人中心。
 * @param force 是否废弃正在执行的刷新并重新请求服务端
 * @returns 刷新完成后结束的 Promise
 */
async function loadAccount(force: boolean = false): Promise<void> {
  await refreshAccountProfile({ force })
  loginUsername.value = accountProfile.uid
  if (!accountProfile.loggedIn && route.name === 'Account') {
    // 登录态失效后离开账号页面，避免继续展示过期账号信息。
    await router.replace({ name: 'GeneralSetting' })
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

/**
 * 打开设置插件内的消息中心。
 * @returns 无返回值。
 */
function openNotifications(): void {
  void router.replace({ name: 'Notifications' })
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
    const saved = await window.ztools.internal.accountSaveSession({
      token: data.token,
      refreshToken: data.refreshToken,
      username: data.username
    })
    if (!saved.success) throw new Error(saved.error || '保存官方账号失败')

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

    <div
      class="sidebar-footer"
      :class="{ active: route.name === 'Account' || route.name === 'Notifications' }"
    >
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
      <button
        class="notification-dock"
        :class="{ active: route.name === 'Notifications' }"
        type="button"
        title="消息中心"
        @click="openNotifications"
      >
        <div class="i-z-bell" />
        <span v-if="unreadCount > 0" class="notification-badge">{{ unreadLabel }}</span>
      </button>
    </div>

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
  min-width: 0;
  flex: 1;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  padding: 10px;
  text-align: left;
  transition: all 0.2s;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 8px 8px;
  border-radius: 8px;
}

.sidebar-footer.active {
  background: var(--active-bg);
}

.sidebar-footer:not(.active):hover {
  background: var(--hover-bg);
}

.notification-dock {
  position: relative;
  flex: none;
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
}

.notification-dock:hover {
  background: transparent;
  color: var(--text-color);
}

.notification-dock.active {
  background: transparent;
  color: var(--primary-color);
}

.notification-badge {
  position: absolute;
  top: 1px;
  right: 0;
  min-width: 15px;
  height: 15px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bg-color);
  border-radius: 8px;
  background: #ef4444;
  color: white;
  padding: 0 3px;
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
}

.account-dock:hover {
  background: transparent;
  border-color: color-mix(in srgb, var(--primary-color) 35%, var(--divider-color));
}

.account-dock.active {
  background: transparent;
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
