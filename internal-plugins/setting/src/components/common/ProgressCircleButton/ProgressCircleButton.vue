<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    active?: boolean
    progress?: number | null
    disabled?: boolean
    title?: string
    activeTitle?: string
    size?: number
  }>(),
  {
    active: false,
    progress: null,
    disabled: false,
    title: '',
    activeTitle: '',
    size: 32
  }
)

const radius = 10
const circumference = 2 * Math.PI * radius

const normalizedProgress = computed(() => {
  if (typeof props.progress !== 'number' || !Number.isFinite(props.progress)) return null
  return Math.min(100, Math.max(0, props.progress))
})

const dashOffset = computed(() => {
  const progress = normalizedProgress.value ?? 0
  return circumference * (1 - progress / 100)
})
</script>

<template>
  <button
    class="progress-circle-button"
    :class="{ active, indeterminate: active && normalizedProgress === null }"
    :style="{ '--button-size': `${size}px` }"
    :title="active ? activeTitle || title : title"
    :aria-label="active ? activeTitle || title : title"
    :aria-busy="active"
    :disabled="disabled"
  >
    <svg class="progress-ring" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle class="progress-track" cx="12" cy="12" :r="radius" fill="none" stroke-width="2" />
      <circle
        class="progress-value"
        cx="12"
        cy="12"
        :r="radius"
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
      />
    </svg>

    <span v-if="active" class="center-icon cancel-icon" aria-hidden="true">
      <span></span>
      <span></span>
    </span>
    <span v-else class="center-icon">
      <slot />
    </span>
  </button>
</template>

<style scoped>
.progress-circle-button {
  --button-size: 32px;
  width: var(--button-size);
  height: var(--button-size);
  min-width: var(--button-size);
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition:
    background 0.2s,
    opacity 0.2s;
}

.progress-circle-button:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.progress-circle-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.progress-ring {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%) rotate(-90deg);
  pointer-events: none;
}

.progress-track,
.progress-value {
  opacity: 0;
  stroke: currentColor;
  transition:
    opacity 0.2s,
    stroke-dashoffset 0.18s ease;
}

.progress-track {
  opacity: 0;
  stroke: var(--divider-color);
}

.progress-circle-button.active .progress-track {
  opacity: 1;
}

.progress-circle-button.active .progress-value {
  opacity: 1;
}

.progress-circle-button.indeterminate .progress-ring {
  animation: ring-spin 1s linear infinite;
}

.progress-circle-button.indeterminate .progress-value {
  stroke-dasharray: 18 63;
  stroke-dashoffset: 0;
}

.center-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.center-icon :deep(svg) {
  width: 14px;
  height: 14px;
}

.cancel-icon span {
  width: 9px;
  height: 1.8px;
  border-radius: 999px;
  background: currentColor;
  position: absolute;
}

.cancel-icon span:first-child {
  transform: rotate(45deg);
}

.cancel-icon span:last-child {
  transform: rotate(-45deg);
}

@keyframes ring-spin {
  to {
    transform: translate(-50%, -50%) rotate(270deg);
  }
}
</style>
