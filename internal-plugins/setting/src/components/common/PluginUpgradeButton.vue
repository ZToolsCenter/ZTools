<script setup lang="ts">
import { computed } from 'vue'
import type { PluginDownloadState } from './PluginDetail/types'
import ProgressCircleButton from './ProgressCircleButton/ProgressCircleButton.vue'

const props = defineProps<{
  version?: string
  loading?: boolean
  disabled?: boolean
  downloadState?: PluginDownloadState
}>()
const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

/**
 * 校验升级进度并限制为圆环可显示的百分比。
 * @returns 0 到 100 的进度，未知进度返回 null。
 */
const progress = computed(() => {
  // 未获取下载总量时使用共享圆环的等待动画。
  const value = props.downloadState?.progress
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : null
})
/**
 * 为升级按钮生成与下载按钮一致的阶段提示与无障碍说明。
 * @returns 当前升级状态说明。
 */
const statusText = computed(() => {
  return props.downloadState?.status === 'installing' ? '安装中' : '取消下载'
})
</script>

<template>
  <div class="upgrade-control">
    <ProgressCircleButton
      type="button"
      class="upgrade-icon-btn"
      :size="36"
      :active="!!loading"
      :progress="progress"
      :title="`升级到 v${version}`"
      :active-title="statusText"
      :aria-label="loading ? statusText : `升级到 v${version}`"
      :aria-busy="!!loading"
      :disabled="disabled || downloadState?.status === 'installing' || (loading && !downloadState)"
      @click="emit('click', $event)"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M12 19V5"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M5 12L12 5L19 12"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M5 21H19"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </ProgressCircleButton>
  </div>
</template>

<style scoped>
.upgrade-control {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--primary-color);
}

.upgrade-icon-btn :deep(.center-icon svg) {
  /* 升级箭头保持与插件市场详情一致的 18px 尺寸。 */
  width: 18px;
  height: 18px;
}
</style>
