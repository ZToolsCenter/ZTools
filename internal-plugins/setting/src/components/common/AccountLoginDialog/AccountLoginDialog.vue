<template>
  <BaseDialog
    :visible="visible"
    title="ZTools 账号注册/登录"
    subtitle="同步数据、插件评论和个人配置"
    max-width="430px"
    @update:visible="emit('update:visible', $event)"
    @close="emit('cancel')"
  >
    <template #icon>
      <div class="login-logo">
        <img src="/logo.png" alt="" />
      </div>
    </template>

    <form class="login-form" @submit.prevent="handleSubmit">
      <label>
        <span>用户名</span>
        <input
          v-model.trim="form.username"
          type="text"
          autocomplete="username"
          placeholder="输入用户名"
        />
      </label>
      <label>
        <span>密码</span>
        <input
          v-model="form.password"
          type="password"
          autocomplete="current-password"
          placeholder="输入密码"
        />
      </label>
    </form>
    <AliyunCaptcha ref="captchaRef" />

    <div class="login-divider">
      <span>或</span>
    </div>

    <div class="oauth-section">
      <button
        type="button"
        class="github-login-btn"
        :disabled="loading || githubLoading"
        @click="handleGithubLogin"
      >
        <svg class="github-mark" viewBox="0 0 496 512" aria-hidden="true">
          <path
            d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"
          />
        </svg>
        <span>{{ githubLoading ? '等待 GitHub 授权...' : '使用 GitHub 登录' }}</span>
      </button>
      <p v-if="githubMessage" class="github-message" :class="{ error: githubError }">
        {{ githubMessage }}
      </p>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" @click="handleCancel">取消</button>
      <button type="button" class="btn-primary" :disabled="loading" @click="handleSubmit">
        {{ loading ? '提交中...' : '注册/登录' }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ONLINE_SYNC_SERVER_URL } from '@/composables/useZToolsAccount'
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import { BaseDialog } from '../BaseDialog'
import AliyunCaptcha from './AliyunCaptcha.vue'

interface Props {
  visible: boolean
  username?: string
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  username: '',
  loading: false
})

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (
    e: 'submit',
    value: { username: string; password: string; captchaVerifyParam?: string },
    controls: {
      resolve: () => void
      reject: (error: unknown) => void
    }
  ): void
  (
    e: 'github-login-success',
    value: {
      token: string
      refreshToken: string
      username: string
      isNew: boolean
    }
  ): void
  (e: 'cancel'): void
}>()

const captchaRef = ref<InstanceType<typeof AliyunCaptcha> | null>(null)
const githubLoading = ref(false)
const githubMessage = ref('')
const githubError = ref(false)
let githubPollTimer: ReturnType<typeof setTimeout> | null = null
const form = reactive({
  username: '',
  password: ''
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    form.username = props.username || ''
    form.password = ''
    githubMessage.value = ''
    githubError.value = false
  },
  { immediate: true }
)

watch(
  () => props.username,
  (username) => {
    if (props.visible && !form.username) {
      form.username = username || ''
    }
  }
)

const handleSubmit = async (): Promise<void> => {
  if (props.loading) return
  const submit = (captchaVerifyParam?: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      emit(
        'submit',
        {
          username: form.username,
          password: form.password,
          captchaVerifyParam
        },
        { resolve, reject }
      )
    })

  try {
    if (!form.username || !form.password) {
      await submit()
      return
    }

    const execute =
      captchaRef.value?.execute ??
      ((business: (captchaVerifyParam?: string) => Promise<void>) => business())
    await execute(submit)
  } catch {
    // 登录结果由父组件的 toast 展示；这里不重复提示。
  }
}

const clearGithubPollTimer = (): void => {
  if (!githubPollTimer) return
  clearTimeout(githubPollTimer)
  githubPollTimer = null
}

const pollGithubStatus = async (sessionId: string, deadline: number): Promise<void> => {
  if (!githubLoading.value) return
  if (Date.now() > deadline) {
    githubLoading.value = false
    githubError.value = true
    githubMessage.value = 'GitHub 授权已超时，请重新发起登录'
    return
  }

  try {
    const result = await window.ztools.internal.syncGithubPollStatus({
      serverUrl: ONLINE_SYNC_SERVER_URL,
      sessionId
    })

    if (result.success && result.status === 'success' && result.token && result.username) {
      githubLoading.value = false
      githubMessage.value = ''
      emit('github-login-success', {
        token: result.token,
        refreshToken: result.refreshToken || '',
        username: result.username,
        isNew: Boolean(result.isNew)
      })
      return
    }

    if (!result.success) {
      githubLoading.value = false
      githubError.value = true
      githubMessage.value = result.error || 'GitHub 登录失败'
      return
    }
  } catch (error: any) {
    githubLoading.value = false
    githubError.value = true
    githubMessage.value = error?.message || 'GitHub 登录失败'
    return
  }

  githubPollTimer = setTimeout(() => {
    void pollGithubStatus(sessionId, deadline)
  }, 1500)
}

const handleGithubLogin = async (): Promise<void> => {
  if (props.loading || githubLoading.value) return
  clearGithubPollTimer()
  githubLoading.value = true
  githubError.value = false
  githubMessage.value = '正在打开浏览器，请在 GitHub 完成授权'

  try {
    const session = await window.ztools.internal.syncGithubInitSession({
      serverUrl: ONLINE_SYNC_SERVER_URL
    })
    if (!session.success || !session.sessionId) {
      throw new Error(session.error || '初始化 GitHub 登录失败')
    }

    const opened = await window.ztools.internal.syncGithubOpenBrowser({
      serverUrl: ONLINE_SYNC_SERVER_URL,
      sessionId: session.sessionId
    })
    if (!opened.success) {
      throw new Error(opened.error || '打开 GitHub 登录页面失败')
    }

    await window.ztools.hideMainWindow(false)
    githubMessage.value = '等待 GitHub 授权完成...'
    const expiresInMs = Math.max(30, Number(session.expiresIn || 300)) * 1000
    void pollGithubStatus(session.sessionId, Date.now() + expiresInMs)
  } catch (error: any) {
    githubLoading.value = false
    githubError.value = true
    githubMessage.value = error?.message || 'GitHub 登录失败'
  }
}

const handleCancel = (): void => {
  githubLoading.value = false
  clearGithubPollTimer()
  emit('cancel')
  emit('update:visible', false)
}

onBeforeUnmount(() => {
  clearGithubPollTimer()
})
</script>

<style scoped>
.oauth-section {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.github-login-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 44px;
  border: 1px solid rgba(31, 35, 40, 0.14);
  border-radius: 12px;
  background: #24292f;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    opacity 0.16s ease;
  box-shadow: 0 10px 24px rgba(36, 41, 47, 0.18);
}

.github-login-btn:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(36, 41, 47, 0.24);
}

.github-login-btn:not(:disabled):active {
  transform: translateY(0);
}

.github-login-btn:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.github-mark {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  fill: currentColor;
}

.github-message {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.github-message.error {
  color: #d03050;
}

.login-divider {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 16px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.login-divider::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(142, 167, 174, 0.22);
}

.login-divider span {
  position: relative;
  padding: 0 10px;
  background: color-mix(in srgb, var(--bg-color, #fff) 90%, transparent);
}

.login-form {
  display: grid;
  gap: 16px;
}

.login-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 50%;
  background: rgba(19, 24, 26, 0.94);
  box-shadow:
    0 10px 26px rgba(30, 62, 72, 0.22),
    0 0 0 4px rgba(255, 255, 255, 0.24);
}

.login-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.login-form label {
  display: grid;
  gap: 8px;
  color: rgba(61, 72, 76, 0.82);
  font-size: 13px;
  font-weight: 500;
}

.login-form input {
  box-sizing: border-box;
  width: 100%;
  height: 44px;
  border: 1px solid rgba(142, 167, 174, 0.38);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--text-primary, #222222);
  outline: none;
  padding: 0 14px;
  font-size: 14px;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.7),
    0 1px 2px rgba(42, 73, 84, 0.05);
}

.login-form input::placeholder {
  color: rgba(83, 95, 101, 0.55);
}

.login-form input:focus {
  border-color: var(--primary-color);
  background: rgba(255, 255, 255, 0.9);
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--primary-color) 16%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.btn-primary,
.btn-secondary {
  min-width: 86px;
  min-height: 40px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  padding: 9px 18px;
  font-size: 14px;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    background-color 0.16s ease,
    opacity 0.16s ease;
}

.btn-primary {
  background: var(--primary-color);
  color: #fff;
  box-shadow: 0 10px 24px color-mix(in srgb, var(--primary-color) 26%, transparent);
}

.btn-primary:not(:disabled):hover,
.btn-secondary:hover {
  transform: translateY(-1px);
}

.btn-primary:not(:disabled):active,
.btn-secondary:active {
  transform: translateY(0);
}

.btn-primary:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.btn-secondary {
  border: 1px solid rgba(255, 255, 255, 0.58);
  background: color-mix(in srgb, var(--primary-color) 11%, rgba(255, 255, 255, 0.72));
  color: rgba(39, 57, 56, 0.88);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.62);
}

@media (prefers-color-scheme: dark) {
  .login-form label {
    color: rgba(224, 235, 237, 0.82);
  }

  .login-form input {
    border-color: rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.08);
    color: rgba(245, 248, 249, 0.94);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .login-form input::placeholder {
    color: rgba(220, 228, 230, 0.48);
  }

  .login-form input:focus {
    background: rgba(255, 255, 255, 0.12);
  }

  .btn-secondary {
    border-color: rgba(255, 255, 255, 0.12);
    background: color-mix(in srgb, var(--primary-color) 16%, rgba(255, 255, 255, 0.08));
    color: rgba(235, 244, 244, 0.9);
  }
}
</style>
