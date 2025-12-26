<template>
  <Transition name="dialog">
    <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
      <div class="dialog-container" @click.stop>
        <div class="dialog-header">
          <div class="dialog-icon" :class="`dialog-icon-${type}`">
            <svg v-if="type === 'warning'" width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor" />
            </svg>
            <svg
              v-else-if="type === 'danger'"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                fill="currentColor"
              />
            </svg>
            <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                fill="currentColor"
              />
            </svg>
          </div>
          <h3 class="dialog-title">{{ title }}</h3>
        </div>

        <div class="dialog-content">
          <p class="dialog-message">{{ message }}</p>
        </div>

        <div class="dialog-footer">
          <button class="btn btn-secondary" @click="handleCancel">{{ cancelText }}</button>
          <button class="btn" :class="confirmButtonClass" @click="handleConfirm">
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  visible: boolean
  title?: string
  message: string
  type?: 'info' | 'warning' | 'danger'
  confirmText?: string
  cancelText?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '确认操作',
  type: 'info',
  confirmText: '确定',
  cancelText: '取消'
})

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const confirmButtonClass = computed(() => {
  if (props.type === 'danger') return 'btn-danger'
  if (props.type === 'warning') return 'btn-warning'
  return 'btn-primary'
})

const handleConfirm = (): void => {
  emit('confirm')
  emit('update:visible', false)
}

const handleCancel = (): void => {
  emit('cancel')
  emit('update:visible', false)
}

const handleOverlayClick = (): void => {
  handleCancel()
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
}

.dialog-container {
  background: var(--bg-color);
  border: 2px solid var(--control-border);
  border-radius: 6px;
  width: 90%;
  max-width: 420px;
  overflow: hidden;
  user-select: none;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--divider-color);
}

.dialog-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid;
}

.dialog-icon-info {
  background: var(--control-bg);
  color: var(--primary-color);
  border-color: var(--control-border);
}

.dialog-icon-warning {
  background: var(--warning-light-bg);
  color: var(--warning-color);
  border-color: color-mix(in srgb, var(--warning-color), black 15%);
}

.dialog-icon-danger {
  background: var(--danger-light-bg);
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color), black 15%);
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0;
}

.dialog-content {
  padding: 16px 20px;
}

.dialog-message {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
  white-space: pre-wrap;
}

.dialog-footer {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--divider-color);
}

.btn {
  flex: 1;
  padding: 8px 16px;
  border: 2px solid;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  outline: none;
}

.btn-secondary {
  background: var(--control-bg);
  color: var(--text-color);
  border-color: var(--control-border);
}

.btn-secondary:hover {
  background: var(--primary-light-bg);
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
  color: var(--primary-color);
}

.btn-primary {
  background: var(--control-bg);
  color: var(--primary-color);
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
}

.btn-primary:hover {
  background: var(--primary-light-bg);
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
  color: var(--primary-color);
}

.btn-warning {
  background: var(--control-bg);
  color: var(--warning-color);
  border-color: color-mix(in srgb, var(--warning-color), black 15%);
}

.btn-warning:hover {
  background: var(--warning-light-bg);
  border-color: color-mix(in srgb, var(--warning-color), black 15%);
  color: var(--warning-color);
}

.btn-danger {
  background: var(--control-bg);
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color), black 15%);
}

.btn-danger:hover {
  background: var(--danger-light-bg);
  border-color: color-mix(in srgb, var(--danger-color), black 15%);
  color: var(--danger-color);
}

/* 动画效果 */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s;
}

.dialog-enter-active .dialog-container,
.dialog-leave-active .dialog-container {
  transition: all 0.2s;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog-container {
  transform: scale(0.9);
}

.dialog-leave-to .dialog-container {
  transform: scale(0.9);
}
</style>
