<template>
  <BaseDialog
    :visible="visible"
    :title="title"
    max-width="420px"
    @update:visible="emit('update:visible', $event)"
    @close="handleCancel"
  >
    <template #icon>
      <div class="dialog-icon" :class="`dialog-icon-${type}`">
        <svg v-if="type === 'warning'" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor" />
        </svg>
        <svg v-else-if="type === 'danger'" width="24" height="24" viewBox="0 0 24 24" fill="none">
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
    </template>

    <p class="dialog-message">{{ message }}</p>
    <div v-if="extraItems.length > 0" class="dialog-extra">
      <label v-for="item in extraItems" :key="item.id" class="dialog-extra-item">
        <input
          type="checkbox"
          :checked="currentExtraValues[item.id] ?? false"
          @change="handleExtraChange(item.id, $event)"
        />
        <span>{{ item.message }}</span>
      </label>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="handleCancel">{{ cancelText }}</button>
      <button class="btn" :class="confirmButtonClass" @click="handleConfirm">
        {{ confirmText }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseDialog } from '../BaseDialog'
import type { ConfirmExtraItem } from '../Toast'

interface Props {
  visible: boolean
  title?: string
  message: string
  type?: 'info' | 'warning' | 'danger'
  confirmText?: string
  cancelText?: string
  extra?: ConfirmExtraItem[]
  extraValues?: Record<string, boolean>
}

const props = withDefaults(defineProps<Props>(), {
  title: '确认操作',
  type: 'info',
  confirmText: '确定',
  cancelText: '取消'
})

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'update:extraValues', value: Record<string, boolean>): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const extraItems = computed(() => props.extra ?? [])
const currentExtraValues = computed(() => props.extraValues ?? {})

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

const handleExtraChange = (id: string, event: Event): void => {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  emit('update:extraValues', {
    ...currentExtraValues.value,
    [id]: target.checked
  })
}
</script>

<style scoped>
.dialog-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border: 2px solid;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
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

.dialog-message {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
  white-space: pre-wrap;
}

.dialog-extra {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialog-extra-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-color);
  cursor: pointer;
}

.dialog-extra-item input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--primary-color);
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
</style>
