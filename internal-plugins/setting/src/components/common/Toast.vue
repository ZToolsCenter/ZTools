<template>
  <Transition name="toast">
    <div v-if="visible" :class="['toast', `toast-${type}`]">
      <div class="toast-icon">
        <svg v-if="type === 'success'" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM8 15L3 10L4.41 8.59L8 12.17L15.59 4.58L17 6L8 15Z"
            fill="currentColor"
          />
        </svg>
        <svg v-else-if="type === 'error'" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM11 15H9V13H11V15ZM11 11H9V5H11V11Z"
            fill="currentColor"
          />
        </svg>
        <svg v-else-if="type === 'warning'" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M1 17H19L10 2L1 17ZM11 14H9V12H11V14ZM11 10H9V6H11V10Z" fill="currentColor" />
        </svg>
        <svg v-else width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM11 15H9V9H11V15ZM11 7H9V5H11V7Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div class="toast-content">{{ message }}</div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  message: string
  type?: 'success' | 'error' | 'warning' | 'info'
  duration?: number
  visible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  type: 'info',
  duration: 3000,
  visible: false
})

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const visible = ref(props.visible)
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.visible,
  (newVal) => {
    visible.value = newVal
    if (newVal && props.duration > 0) {
      // 清除之前的定时器
      if (timer) {
        clearTimeout(timer)
      }
      // 设置新的定时器
      timer = setTimeout(() => {
        visible.value = false
        emit('update:visible', false)
      }, props.duration)
    }
  }
)
</script>

<style scoped>
.toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 6px;
  border: 2px solid;
  z-index: 10000;
  max-width: 400px;
  font-size: 14px;
  font-weight: 500;
  user-select: none;
}

.toast-success {
  background: var(--success-light-bg);
  color: var(--success-color);
  border-color: color-mix(in srgb, var(--success-color), black 15%);
}

.toast-error {
  background: var(--danger-light-bg);
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color), black 15%);
}

.toast-warning {
  background: var(--warning-light-bg);
  color: var(--warning-color);
  border-color: color-mix(in srgb, var(--warning-color), black 15%);
}

.toast-info {
  background: var(--control-bg);
  color: var(--text-color);
  border-color: var(--control-border);
}

.toast-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toast-content {
  flex: 1;
  word-break: break-word;
}

/* 动画效果 */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}
</style>
