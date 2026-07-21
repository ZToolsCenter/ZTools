<template>
  <div v-if="config.enabled" class="aliyun-captcha-host" aria-hidden="true">
    <div :id="elementId"></div>
    <button :id="buttonId" ref="buttonRef" type="button" tabindex="-1"></button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const captchaScriptUrl = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'

interface CaptchaConfig {
  enabled: boolean
  prefix?: string
  sceneId?: string
  encryptedSceneId?: string
  region?: string
}

interface PendingVerification<T = unknown> {
  business: (captchaVerifyParam?: string) => Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
  timeoutId: number
}

interface AliyunCaptchaInstance {
  show?: () => void
  hide?: () => void
  refresh?: () => void
}

interface AliyunCaptchaOptions {
  SceneId: string
  EncryptedSceneId?: string
  mode: 'popup' | 'embed'
  element: string
  button: string
  captchaVerifyCallback: (captchaVerifyParam: string) => Promise<{
    captchaResult: boolean
    bizResult: boolean
  }>
  onBizResultCallback: (bizResult: boolean) => void
  getInstance?: (instance: AliyunCaptchaInstance) => void
  fail?: (result: unknown) => void
  onError?: (errorInfo: { code?: string; msg?: string }) => void
  onClose?: () => void
  slideStyle?: {
    width: number
    height: number
  }
  language?: string
}

declare global {
  interface Window {
    AliyunCaptchaConfig?: {
      region: string
      prefix: string
    }
    initAliyunCaptcha?: (options: AliyunCaptchaOptions) => void
  }
}

const props = withDefaults(
  defineProps<{
    serverUrl?: string
  }>(),
  {
    serverUrl: 'wss://z-tools.top'
  }
)

let scriptPromise: Promise<void> | null = null
let pending: PendingVerification | null = null

const config = ref<CaptchaConfig>({ enabled: false })
const ready = ref(false)
const loadError = ref('')
const buttonRef = ref<HTMLButtonElement | null>(null)
const captchaInstance = ref<AliyunCaptchaInstance | null>(null)
const elementId = `aliyun-captcha-element-${Math.random().toString(36).slice(2)}`
const buttonId = `aliyun-captcha-button-${Math.random().toString(36).slice(2)}`

onMounted(() => {
  void bootstrap()
})

onBeforeUnmount(() => {
  rejectPending('验证码组件已卸载')
})

async function bootstrap(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncGetCaptchaConfig({ serverUrl: props.serverUrl })
    if (!result.success) {
      throw new Error(result.error || '验证码配置加载失败')
    }
    const nextConfig = result.config || { enabled: false }
    config.value = nextConfig
    if (!nextConfig.enabled) {
      ready.value = true
      return
    }
    if (!nextConfig.prefix || (!nextConfig.sceneId && !nextConfig.encryptedSceneId)) {
      throw new Error('验证码配置不完整')
    }
    window.AliyunCaptchaConfig = {
      region: nextConfig.region || 'cn',
      prefix: nextConfig.prefix
    }
    await loadCaptchaScript()
    if (!window.initAliyunCaptcha) {
      throw new Error('阿里云验证码脚本初始化失败')
    }
    window.initAliyunCaptcha({
      SceneId: nextConfig.sceneId || '',
      EncryptedSceneId: nextConfig.encryptedSceneId,
      mode: 'popup',
      element: `#${elementId}`,
      button: `#${buttonId}`,
      captchaVerifyCallback,
      onBizResultCallback() {
        // execute() 的 Promise 负责把业务结果返回给登录弹窗。
      },
      getInstance(instance) {
        captchaInstance.value = instance
        ready.value = true
      },
      fail(result) {
        console.warn('[AliyunCaptcha] verification failed', result)
      },
      onError(errorInfo) {
        rejectPending(errorInfo.msg || errorInfo.code || '验证码加载失败')
      },
      onClose() {
        rejectPending('已取消验证码验证')
      },
      slideStyle: { width: 360, height: 40 },
      language: 'cn'
    })
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '验证码加载失败'
  }
}

async function captchaVerifyCallback(captchaVerifyParam: string): Promise<{
  captchaResult: boolean
  bizResult: boolean
}> {
  if (!pending) return { captchaResult: false, bizResult: false }
  try {
    const result = await pending.business(captchaVerifyParam)
    window.clearTimeout(pending.timeoutId)
    pending.resolve(result)
    pending = null
    return { captchaResult: true, bizResult: true }
  } catch (err) {
    if (isCaptchaFailure(err)) {
      return { captchaResult: false, bizResult: false }
    }
    window.clearTimeout(pending.timeoutId)
    pending.reject(err)
    pending = null
    return { captchaResult: true, bizResult: false }
  }
}

function rejectPending(message: string): void {
  if (!pending) return
  window.clearTimeout(pending.timeoutId)
  pending.reject(new Error(message))
  pending = null
}

function execute<T>(business: (captchaVerifyParam?: string) => Promise<T>): Promise<T> {
  if (!config.value.enabled) return business()
  if (loadError.value) return Promise.reject(new Error(loadError.value))
  if (!ready.value) return Promise.reject(new Error('验证码正在加载，请稍后重试'))

  if (pending) {
    window.clearTimeout(pending.timeoutId)
    pending.reject(new Error('验证码验证已重新发起'))
  }

  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pending = null
      reject(new Error('验证码验证超时，请重试'))
    }, 120000)
    pending = { business, resolve: resolve as (value: unknown) => void, reject, timeoutId }
    buttonRef.value?.click()
  })
}

function loadCaptchaScript(): Promise<void> {
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${captchaScriptUrl}"]`)
    if (existing) {
      if (window.initAliyunCaptcha) {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('阿里云验证码脚本加载失败')), {
        once: true
      })
      return
    }

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = captchaScriptUrl
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('阿里云验证码脚本加载失败'))
    document.head.appendChild(script)
  })

  return scriptPromise
}

function isCaptchaFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '')
  return /captcha|验证码/i.test(message)
}

defineExpose({
  execute
})
</script>

<style scoped>
.aliyun-captcha-host {
  height: 0;
  overflow: hidden;
  pointer-events: none;
}
</style>
