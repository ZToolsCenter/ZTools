<template>
  <DetailPanel title="插件详情" @back="emit('back')">
    <div class="detail-content">
      <div class="detail-header">
        <img
          v-if="plugin.logo"
          :src="plugin.logo"
          class="detail-icon"
          alt="插件图标"
          draggable="false"
        />
        <div v-else class="detail-icon placeholder">🧩</div>
        <div class="detail-title">
          <div class="detail-name">{{ plugin.name }}</div>
          <div class="detail-version">v{{ plugin.version }}</div>
        </div>
        <div class="detail-actions">
          <template v-if="plugin.installed">
            <button
              v-if="canUpgrade"
              class="btn btn-md btn-warning"
              :disabled="isLoading"
              @click="emit('upgrade')"
            >
              <div v-if="isLoading" class="btn-loading">
                <div class="spinner"></div>
              </div>
              <span v-else>升级到 v{{ plugin.version }}</span>
            </button>
            <button v-else class="btn btn-md" @click="emit('open')">打开</button>
          </template>
          <button
            v-else
            class="btn btn-icon"
            title="下载"
            :disabled="isLoading"
            @click="emit('download')"
          >
            <div v-if="isLoading" class="spinner"></div>
            <svg
              v-else
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
          </button>
        </div>
      </div>
    </div>

    <div class="detail-desc">{{ plugin.description || '暂无描述' }}</div>

    <div class="detail-section">
      <div class="detail-section-title">指令列表</div>
      <div v-if="plugin.features && plugin.features.length > 0" class="feature-list">
        <div v-for="feature in plugin.features" :key="feature.code" class="feature-item">
          <div class="feature-title">{{ feature.explain || feature.code }}</div>
          <div class="cmd-list">
            <span
              v-for="cmd in feature.cmds"
              :key="cmdKey(cmd)"
              class="cmd-chip"
              :class="isMatchCmd(cmd) ? `type-${cmdType(cmd)}` : ''"
            >
              <span class="cmd-text">{{ cmdLabel(cmd) }}</span>
              <span v-if="isMatchCmd(cmd)" class="cmd-badge">{{ cmdTypeBadge(cmd) }}</span>
            </span>
          </div>
        </div>
      </div>
      <div v-else class="empty-feature">暂无指令</div>
    </div>
  </DetailPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DetailPanel from '../common/DetailPanel.vue'

interface PluginFeature {
  code: string
  explain?: string
  cmds?: any[]
}

interface PluginItem {
  name: string
  version?: string
  description?: string
  logo?: string
  features?: PluginFeature[]
  installed?: boolean
  localVersion?: string
}

const props = defineProps<{
  plugin: PluginItem
  isLoading?: boolean
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'open'): void
  (e: 'download'): void
  (e: 'upgrade'): void
}>()

// 版本比较函数
function compareVersions(v1: string, v2: string): number {
  if (!v1 || !v2) return 0
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  const len = Math.max(parts1.length, parts2.length)

  for (let i = 0; i < len; i++) {
    const num1 = parts1[i] || 0
    const num2 = parts2[i] || 0
    if (num1 < num2) return -1
    if (num1 > num2) return 1
  }
  return 0
}

// 判断是否可以升级
const canUpgrade = computed(() => {
  if (!props.plugin.installed || !props.plugin.localVersion || !props.plugin.version) return false
  return compareVersions(props.plugin.localVersion, props.plugin.version) < 0
})

function cmdLabel(cmd: any): string {
  if (cmd && typeof cmd === 'object') {
    return cmd.label
  }
  return String(cmd)
}

function cmdKey(cmd: any): string {
  if (cmd && typeof cmd === 'object') {
    return cmd.label
  }
  return String(cmd)
}

function isMatchCmd(cmd: any): boolean {
  return !!(cmd && typeof cmd === 'object' && (cmd.type === 'regex' || cmd.type === 'over'))
}

function cmdType(cmd: any): 'regex' | 'over' | null {
  if (isMatchCmd(cmd)) return cmd.type
  return null
}

function cmdTypeBadge(cmd: any): string {
  if (!isMatchCmd(cmd)) return ''
  return cmd.type === 'regex' ? '正则' : '任意文本'
}
</script>

<style scoped>
.detail-content {
  padding: 16px;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

.detail-actions {
  margin-left: auto;
}

.detail-actions .btn {
  min-width: 60px;
}

/* 按钮 loading 状态 */
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

/* 升级按钮中的 spinner */
.btn-warning .spinner {
  border-top-color: var(--text-on-primary);
  border-right-color: var(--text-on-primary);
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
}

.detail-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-color);
}

.detail-version {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 4px 8px;
  background: var(--active-bg);
  border-radius: 6px;
}

.detail-desc {
  margin-top: 12px;
  font-size: 14px;
  color: var(--text-secondary);
  margin-left: 10px;
  margin-right: 10px;
}

.detail-section {
  margin-top: 20px;
  margin-left: 10px;
  margin-right: 10px;
}

.detail-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 10px;
  margin-left: 10px;
  margin-right: 10px;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feature-item {
  border-radius: 8px;
  padding: 12px;
  background: var(--card-bg);
  transition: all 0.2s;
}

.feature-item:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.feature-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 8px;
}

.cmd-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cmd-chip {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-color);
  background: var(--active-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  transition: all 0.2s;
}

.cmd-chip:hover {
  background: var(--hover-bg);
}

.cmd-text {
  line-height: 1;
}

.cmd-badge {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
}

/* 匹配指令类型标识色 */
.cmd-chip.type-regex .cmd-badge {
  color: var(--purple-color);
  background: var(--purple-light-bg);
  border-color: var(--purple-border);
}

.cmd-chip.type-over .cmd-badge {
  color: var(--success-color);
  background: var(--success-light-bg);
  border-color: var(--success-border);
}

.empty-feature {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 12px;
}
</style>
