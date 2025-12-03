<template>
  <!-- 覆盖内容区的详情面板（无遮罩） -->
  <div class="plugin-detail-panel">
    <div class="detail-topbar">
      <button class="back-btn" aria-label="返回" title="返回" @click="emit('back')">
        <Icon name="back" size="18" />
      </button>
      <div class="topbar-title">插件详情</div>
    </div>

    <div class="detail-content">
      <div class="detail-header">
        <img v-if="plugin.logo" :src="plugin.logo" class="detail-icon" alt="插件图标" />
        <div v-else class="detail-icon placeholder">🧩</div>
        <div class="detail-title">
          <div class="detail-name">{{ plugin.name }}</div>
          <div class="detail-version">v{{ plugin.version }}</div>
        </div>
        <div class="detail-actions">
          <button class="open-btn" @click="emit('open')">打开</button>
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
  </div>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'

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
}

defineProps<{ plugin: PluginItem }>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'open'): void
}>()

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
/* 覆盖内容区的详情面板 */
.plugin-detail-panel {
  position: absolute;
  inset: 0;
  background: #ffffff;
  z-index: 10;
  display: flex;
  flex-direction: column;
}

.detail-topbar {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid #e5e7eb;
}

.back-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  font-size: 18px;
  cursor: pointer;
}

.back-btn:hover {
  background: #f3f4f6;
}

.topbar-title {
  font-size: 14px;
  color: #6b7280;
}

.detail-content {
  padding: 16px;
  overflow: auto;
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

.open-btn {
  padding: 6px 16px;
  border: 1px solid var(--primary-color);
  border-radius: 6px;
  background: var(--bg-color);
  color: var(--primary-color);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.open-btn:hover {
  background: var(--primary-color);
  color: var(--text-on-primary);
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
  background: #f3f4f6;
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
  color: #111827;
}

.detail-version {
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
  padding: 4px 8px;
  background: #f3f4f6;
  border-radius: 6px;
}

.detail-desc {
  margin-top: 12px;
  font-size: 14px;
  color: #374151;
}

.detail-section {
  margin-top: 20px;
}

.detail-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 10px;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feature-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
}

.feature-title {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
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
  color: #374151;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
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
  border: 1px solid #e5e7eb;
}

/* 匹配指令类型标识色 */
.cmd-chip.type-regex .cmd-badge {
  color: #8b5cf6;
  background: #f3e8ff;
  border-color: #d8b4fe;
}

.cmd-chip.type-over .cmd-badge {
  color: #10b981;
  background: #ecfdf5;
  border-color: #a7f3d0;
}

.empty-feature {
  font-size: 13px;
  color: #6b7280;
}
</style>
