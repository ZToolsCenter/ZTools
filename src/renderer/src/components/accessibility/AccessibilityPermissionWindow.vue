<template>
  <div class="startup-dialog-window" tabindex="0" @keydown.esc="quitApp">
    <div class="header window-drag-region">
      <img :src="logo" class="header-icon" draggable="false" />
      <div class="header-info">
        <div class="title">需要开启辅助功能权限</div>
        <div class="subtitle">ZTools 启动权限检查</div>
      </div>
    </div>

    <main class="content">
      <div class="message">
        <p>ZTools 需要辅助功能权限来响应快捷键并完成键盘与窗口操作。</p>
        <p>请在“系统设置 → 隐私与安全性 → 辅助功能”中允许 ZTools。</p>
      </div>
      <p class="reset-hint">若系统设置已开启但仍无法授权，可重置旧记录；应用重启后需要重新授权。</p>
      <div
        class="permission-status"
        :class="{ checking: isChecking, success: resetSucceeded, error: Boolean(resetError) }"
      >
        <span class="status-dot"></span>
        <span>{{ statusMessage }}</span>
      </div>
    </main>

    <footer class="footer">
      <button class="btn cancel" :disabled="isResetting" @click="quitApp">退出应用</button>
      <button
        class="btn cancel reset"
        :class="{ confirming: isConfirmingReset }"
        :disabled="isResetting"
        @click="resetPermission"
      >
        {{ resetButtonText }}
      </button>
      <button class="btn confirm" :disabled="isResetting" @click="openSettings">
        打开系统设置
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import logo from '../../assets/logo.png'

const isChecking = ref(false)
const isConfirmingReset = ref(false)
const isResetting = ref(false)
const resetSucceeded = ref(false)
const resetError = ref('')
let stopGrantedListener: (() => void) | undefined
let stopResetListener: (() => void) | undefined
let checkingTimer: number | undefined
let resetConfirmTimer: number | undefined

const statusMessage = computed(() => {
  if (resetSucceeded.value) return '权限记录已重置，正在重新启动 ZTools...'
  if (resetError.value) return resetError.value
  if (isResetting.value) return '正在重置辅助功能权限...'
  if (isConfirmingReset.value) return '再次点击“确认重置”将清除当前授权记录'
  if (isChecking.value) return '正在检测授权状态...'
  return '等待开启辅助功能权限'
})

const resetButtonText = computed(() => {
  if (isResetting.value) return '重置中...'
  return isConfirmingReset.value ? '确认重置' : '重置权限'
})

function showCheckingState(): void {
  window.clearTimeout(checkingTimer)
  isChecking.value = true
  checkingTimer = window.setTimeout(() => {
    isChecking.value = false
  }, 1000)
}

function openSettings(): void {
  resetError.value = ''
  showCheckingState()
  window.electron.ipcRenderer.send('accessibility-permission:open-settings')
}

function resetPermission(): void {
  if (isResetting.value) return

  if (!isConfirmingReset.value) {
    resetError.value = ''
    isConfirmingReset.value = true
    window.clearTimeout(resetConfirmTimer)
    resetConfirmTimer = window.setTimeout(() => {
      isConfirmingReset.value = false
    }, 5000)
    return
  }

  window.clearTimeout(resetConfirmTimer)
  window.clearTimeout(checkingTimer)
  isConfirmingReset.value = false
  isChecking.value = false
  isResetting.value = true
  resetError.value = ''
  window.electron.ipcRenderer.send('accessibility-permission:reset')
}

function quitApp(): void {
  window.electron.ipcRenderer.send('accessibility-permission:quit')
}

onMounted(() => {
  document.querySelector<HTMLElement>('.startup-dialog-window')?.focus()
  stopGrantedListener = window.electron.ipcRenderer.on('accessibility-permission:granted', () => {
    window.clearTimeout(checkingTimer)
    isChecking.value = true
  })
  stopResetListener = window.electron.ipcRenderer.on(
    'accessibility-permission:reset-result',
    (result: { success: boolean; error?: string }) => {
      isResetting.value = false
      resetSucceeded.value = result.success
      resetError.value = result.success ? '' : result.error || '重置辅助功能权限失败'
    }
  )
})

onBeforeUnmount(() => {
  window.clearTimeout(checkingTimer)
  window.clearTimeout(resetConfirmTimer)
  stopGrantedListener?.()
  stopResetListener?.()
})
</script>

<style src="../startupDialog.css"></style>

<style scoped>
.permission-status {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.035);
  font-size: 13px;
}

.reset-hint {
  margin: 12px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #f59e0b;
}

.permission-status.checking .status-dot {
  background: #3b82f6;
  animation: pulse 1s ease-in-out infinite;
}

.permission-status.success .status-dot {
  background: #10b981;
}

.permission-status.error .status-dot {
  background: #ef4444;
}

.reset {
  color: #dc2626;
}

.reset.confirming {
  color: #fff;
  background: #dc2626;
  border-color: #dc2626;
}

.reset.confirming:hover:not(:disabled) {
  color: #fff;
  background: #b91c1c;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-color-scheme: dark) {
  .permission-status {
    background: rgba(255, 255, 255, 0.05);
  }

  .reset {
    color: #f87171;
  }
}
</style>
