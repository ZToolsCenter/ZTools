<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ProgressCircleButton from '@/components/common/ProgressCircleButton/ProgressCircleButton.vue'
import PluginUpgradeButton from '@/components/common/PluginUpgradeButton.vue'
import type { PluginDownloadState, PluginItem } from './types'

const props = defineProps<{
  plugin: PluginItem
  isLoading?: boolean
  downloadState?: PluginDownloadState
  canUpgrade: boolean
  showSize?: boolean
  showDownloadCount?: boolean
  showSourceBadge: boolean
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

const repositoryUrl = computed(() => {
  if (props.plugin.sourceType !== 'open_source' || !props.plugin.name) return ''
  return `https://github.com/ZToolsCenter/ZTools-plugins/tree/main/plugins/${encodeURIComponent(props.plugin.name)}`
})

function openRepository(): void {
  if (repositoryUrl.value) {
    window.ztools.shellOpenExternal(repositoryUrl.value)
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
              v-if="showSourceBadge"
              class="source-badge"
              :class="{ 'source-badge--closed': plugin.sourceType === 'closed_source' }"
            >
              {{
                plugin.sourceLabel ||
                (plugin.sourceType === 'closed_source' ? '闭源插件' : '开源插件')
              }}
            </span>
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
        <button
          v-if="repositoryUrl"
          type="button"
          class="repository-btn"
          title="查看插件仓库"
          aria-label="查看插件仓库"
          @click="openRepository"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.834 2.809 1.304 3.495.997.108-.775.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.215 0 1.6-.015 2.89-.015 3.285 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
            />
          </svg>
        </button>
        <template v-if="plugin.installed">
          <PluginUpgradeButton
            v-if="canUpgrade"
            :version="plugin.version"
            :loading="isLoading"
            :download-state="downloadState"
            @click="emit('upgrade')"
          />
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

.repository-btn {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.2s,
    color 0.2s;
}

.repository-btn:hover,
.repository-btn:focus-visible {
  background: var(--primary-light-bg);
  color: var(--primary-color);
  outline: none;
}

.detail-download-btn {
  flex-shrink: 0;
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

.source-badge {
  display: inline-block;
  border-radius: 4px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--primary-color) 30%, transparent);
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 500;
}

.source-badge--closed {
  border-color: color-mix(in srgb, var(--warning-color) 35%, transparent);
  background: color-mix(in srgb, var(--warning-color) 12%, transparent);
  color: var(--warning-color);
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
