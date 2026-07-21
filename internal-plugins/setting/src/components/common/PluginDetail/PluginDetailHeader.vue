<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ProgressCircleButton from '@/components/common/ProgressCircleButton/ProgressCircleButton.vue'
import type { PluginDownloadState, PluginItem } from './types'

const props = defineProps<{
  plugin: PluginItem
  isLoading?: boolean
  downloadState?: PluginDownloadState
  canUpgrade: boolean
  showSize?: boolean
  showDownloadCount?: boolean
}>()

const emit = defineEmits<{
  (e: 'download'): void
  (e: 'upgrade'): void
}>()

// 本插件提供的 provider 能力标签（翻译 / OCR）。
// 仅对已安装插件展示，从主进程聚合后的 provider 列表中按 pluginName 过滤。
const providerTypes = ref<Array<'translation' | 'ocr'>>([])

async function loadProviderTypes(): Promise<void> {
  if (!props.plugin.installed || !props.plugin.name) {
    providerTypes.value = []
    return
  }
  try {
    const res = await window.ztools.internal.providers.getAll()
    if (res.success && Array.isArray(res.data)) {
      const types = new Set<'translation' | 'ocr'>()
      for (const entry of res.data) {
        if (entry.source === 'plugin' && entry.pluginName === props.plugin.name && entry.type) {
          types.add(entry.type)
        }
      }
      providerTypes.value = Array.from(types)
    } else {
      providerTypes.value = []
    }
  } catch {
    providerTypes.value = []
  }
}

watch(
  () => [props.plugin.name, props.plugin.installed],
  () => {
    loadProviderTypes()
  },
  { immediate: true }
)

const providerLabels = computed(() =>
  providerTypes.value.map((type) => ({
    type,
    label: type === 'translation' ? '翻译提供商' : 'OCR 提供商'
  }))
)

const formattedDownloadCount = computed(() =>
  Number(props.plugin.downloadCount || 0).toLocaleString('zh-CN')
)

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return `${mb.toFixed(2)} MB`
  }
  const kb = bytes / 1024
  return `${kb.toFixed(2)} KB`
}

function openHomepage(): void {
  if (props.plugin.homepage) {
    window.ztools.shellOpenExternal(props.plugin.homepage)
  }
}
</script>

<template>
  <div class="detail-content">
    <div class="detail-header">
      <!-- 左侧：图标 + 信息 -->
      <div class="detail-left">
        <img
          v-if="plugin.logo"
          :src="plugin.logo"
          class="detail-icon"
          alt="插件图标"
          draggable="false"
        />
        <div v-else class="detail-icon placeholder">🧩</div>
        <div class="detail-info">
          <div class="detail-title">
            <span class="detail-name">{{ plugin.title || plugin.name }}</span>
            <slot name="title-badge" />
            <span
              v-for="p in providerLabels"
              :key="p.type"
              class="provider-badge"
              :title="`本插件提供 ${p.label}（可在「设置 → 提供商」中启用）`"
            >
              {{ p.label }}
            </span>
          </div>
          <div class="detail-desc">{{ plugin.description || '暂无描述' }}</div>
        </div>
      </div>

      <!-- 右侧：按钮 -->
      <div class="detail-actions">
        <template v-if="plugin.installed">
          <button
            v-if="canUpgrade"
            class="upgrade-icon-btn"
            :title="`升级到 v${plugin.version}`"
            :disabled="isLoading"
            @click="emit('upgrade')"
          >
            <div v-if="isLoading" class="btn-loading">
              <div class="spinner"></div>
            </div>
            <svg
              v-else
              width="18"
              height="18"
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
        </template>
        <ProgressCircleButton
          v-else
          class="detail-download-btn"
          title="下载"
          :active-title="downloadState?.status === 'installing' ? '安装中' : '取消下载'"
          :size="36"
          :active="!!downloadState"
          :progress="downloadState?.progress ?? null"
          :disabled="downloadState?.status === 'installing' || (isLoading && !downloadState)"
          @click="emit('download')"
        >
          <svg
            width="20"
            height="20"
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

    <!-- App Store 风格的三栏信息 -->
    <div class="detail-meta">
      <div class="meta-item">
        <div class="meta-label">开发者</div>
        <div class="meta-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div
          v-if="plugin.author"
          class="meta-value"
          :class="{ clickable: plugin.homepage }"
          @click="openHomepage"
        >
          {{ plugin.author }}
        </div>
        <div v-else class="meta-value">未知</div>
      </div>

      <div class="meta-divider"></div>

      <div class="meta-item">
        <div class="meta-label">版本</div>
        <div class="meta-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M9 11L12 14L22 4"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M21 12V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H16"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div class="meta-value">{{ plugin.version || '-' }}</div>
      </div>

      <div v-if="showSize" class="meta-divider"></div>

      <div v-if="showSize" class="meta-item">
        <div class="meta-label">大小</div>
        <div class="meta-icon">
          <svg
            width="16"
            height="16"
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
        </div>
        <div class="meta-value">{{ formatSize(plugin.size) || '-' }}</div>
      </div>

      <div v-if="showDownloadCount" class="meta-divider"></div>

      <div v-if="showDownloadCount" class="meta-item">
        <div class="meta-label">下载量</div>
        <div class="meta-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 3V21H21"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M7 14L11 10L15 13L21 7"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div class="meta-value">{{ formattedDownloadCount }}</div>
      </div>

      <slot name="meta-extra" />
    </div>
  </div>
</template>

<style scoped>
.detail-content {
  padding: 16px;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.detail-left {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex: 1;
  min-width: 0;
}

.detail-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.detail-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.detail-actions .btn {
  min-width: 60px;
}

.upgrade-icon-btn {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.2s,
    opacity 0.2s;
}

.upgrade-icon-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.upgrade-icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.detail-download-btn {
  flex-shrink: 0;
}

.btn-loading {
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  width: 16px;
  height: 16px;
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

.detail-icon {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  object-fit: cover;
}

.detail-icon.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  font-size: 28px;
}

.detail-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.provider-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  color: #0891b2;
  background: rgba(8, 145, 178, 0.12);
  padding: 2px 8px;
  border-radius: 4px;
  line-height: 1.4;
}

.detail-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-color);
}

.detail-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 16px 0;
  margin-top: 16px;
  border-top: 1px solid var(--divider-color);
}

.meta-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.meta-icon {
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.meta-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.meta-value {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-color);
}

.meta-value.clickable {
  color: var(--primary-color);
  cursor: pointer;
  transition: opacity 0.2s;
}

.meta-value.clickable:hover {
  opacity: 0.7;
}

.meta-divider {
  width: 1px;
  height: 32px;
  background: var(--divider-color);
  flex-shrink: 0;
}
</style>
