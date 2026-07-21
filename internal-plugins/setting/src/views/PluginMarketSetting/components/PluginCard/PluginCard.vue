<script setup lang="ts">
import { AdaptiveIcon } from '@/components'
import ProgressCircleButton from '@/components/common/ProgressCircleButton/ProgressCircleButton.vue'
import type { Plugin, PluginDownloadState } from '../types'

defineProps<{
  plugin: Plugin
  installingPlugin: string | null
  canUpgrade: boolean
  downloadState?: PluginDownloadState
}>()

defineEmits<{
  (e: 'click'): void
  (e: 'open'): void
  (e: 'download'): void
  (e: 'upgrade'): void
}>()
</script>
<template>
  <div class="card plugin-card" :title="plugin.description" @click="$emit('click')">
    <div class="plugin-icon">
      <AdaptiveIcon
        :src="plugin.logo ?? ''"
        class="plugin-logo-img"
        alt="icon"
        loading="lazy"
        decoding="async"
        draggable="false"
      />
    </div>
    <div class="plugin-info">
      <div class="plugin-name">{{ plugin.title || plugin.name }}</div>
      <div class="plugin-description" :title="plugin.description">
        {{ plugin.description }}
      </div>
    </div>
    <div class="plugin-action">
      <template v-if="plugin.installed">
        <button
          v-if="canUpgrade"
          class="icon-btn upgrade-btn"
          :title="`升级到 v${plugin.version}`"
          :disabled="installingPlugin === plugin.name"
          @click.stop="$emit('upgrade')"
        >
          <div v-if="installingPlugin === plugin.name" class="btn-loading">
            <div class="spinner"></div>
          </div>
          <svg
            v-else
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
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
        </button>
        <button v-else class="icon-btn open-btn" title="打开" @click.stop="$emit('open')">
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
      </template>
      <ProgressCircleButton
        v-else
        class="download-btn"
        title="下载"
        :active-title="downloadState?.status === 'installing' ? '安装中' : '取消下载'"
        :active="!!downloadState"
        :progress="downloadState?.progress ?? null"
        :disabled="
          downloadState?.status === 'installing' ||
          (!!installingPlugin && installingPlugin !== plugin.name)
        "
        @click.stop="$emit('download')"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
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
    </div>
  </div>
</template>

<style scoped>
.plugin-card {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 0;
}

.plugin-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.plugin-icon {
  flex-shrink: 0;
  margin-right: 12px;
}

.plugin-logo-img {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  object-fit: cover;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-description {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-action {
  flex-shrink: 0;
  margin-left: 10px;
}

/* 图标按钮颜色样式 */
.open-btn {
  color: var(--primary-color);
}

.open-btn:hover:not(:disabled),
.upgrade-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.upgrade-btn {
  color: var(--primary-color);
}

.download-btn {
  color: var(--primary-color);
}

.download-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

/* 按钮 loading 状态 */
.btn-loading {
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-right-color: currentColor;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
