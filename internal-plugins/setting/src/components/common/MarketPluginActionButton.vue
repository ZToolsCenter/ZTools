<script setup lang="ts">
import ProgressCircleButton from './ProgressCircleButton/ProgressCircleButton.vue'
import type { PluginDownloadState } from './PluginDetail/types'

defineProps<{
  installed: boolean
  disabled?: boolean
  unavailable?: boolean
  downloadState?: PluginDownloadState
}>()
defineEmits<{ open: []; download: [] }>()
</script>

<template>
  <button
    v-if="installed"
    type="button"
    aria-label="打开"
    class="icon-btn open-btn"
    title="打开"
    @click.stop="$emit('open')"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
  </button>
  <ProgressCircleButton
    v-else
    class="download-btn"
    :title="unavailable ? '暂无下载' : '下载'"
    :active-title="downloadState?.status === 'installing' ? '安装中' : '取消下载'"
    :active="!!downloadState"
    :progress="downloadState?.progress ?? null"
    :disabled="
      unavailable || disabled || (!!downloadState && downloadState.status !== 'downloading')
    "
    @click.stop="$emit('download')"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M7 10L12 15L17 10"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M12 15V3"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </ProgressCircleButton>
</template>

<style scoped>
/* 图标按钮颜色样式 */
.open-btn {
  color: var(--primary-color);
}

.open-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.download-btn {
  color: var(--primary-color);
}

.download-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}
</style>
