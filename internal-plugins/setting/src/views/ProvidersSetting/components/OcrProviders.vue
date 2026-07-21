<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from '@/components'

interface ProviderEntry {
  id: string
  type: 'ocr'
  label: string
  description: string
  source: 'builtin' | 'plugin'
  pluginName?: string
  pluginPath?: string
  pluginLogo?: string
}

interface ProviderSettings {
  enabled: Partial<Record<'ocr', string[]>>
  defaultId: Partial<Record<'ocr', string>>
  params: Record<string, Record<string, unknown>>
}

const { success, error } = useToast()

const providers = ref<ProviderEntry[]>([])
const settings = ref<ProviderSettings>({ enabled: {}, defaultId: {}, params: {} })
const loading = ref(true)

const enabledIds = computed(() => new Set(settings.value.enabled.ocr || []))
const defaultId = computed(() => settings.value.defaultId.ocr)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [allRes, setRes] = await Promise.all([
      window.ztools.internal.providers.getAll('ocr'),
      window.ztools.internal.providers.getSettings()
    ])
    if (allRes.success && allRes.data) providers.value = allRes.data
    if (setRes.success && setRes.data) settings.value = setRes.data
  } catch (err) {
    console.error('加载 OCR 提供商失败:', err)
    error('加载 OCR 提供商失败')
  } finally {
    loading.value = false
  }
}

function isEnabled(p: ProviderEntry): boolean {
  return enabledIds.value.has(p.id)
}

function isDefault(p: ProviderEntry): boolean {
  return defaultId.value === p.id
}

async function handleToggle(p: ProviderEntry, enabled: boolean): Promise<void> {
  try {
    const res = await window.ztools.internal.providers.setEnabled(p.id, enabled)
    if (res.success && res.data) {
      settings.value = res.data
      success(enabled ? '已启用' : '已禁用')
    } else {
      error(res.error || '操作失败')
    }
  } catch (err) {
    console.error('切换 OCR 提供商失败:', err)
    error('操作失败')
  }
}

async function handleSetDefault(p: ProviderEntry): Promise<void> {
  try {
    const res = await window.ztools.internal.providers.setDefault('ocr', p.id)
    if (res.success && res.data) {
      settings.value = res.data
      success(`已设为默认：${p.label}`)
    } else {
      error(res.error || '操作失败')
    }
  } catch (err) {
    console.error('设置默认 OCR 提供商失败:', err)
    error('操作失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="content-panel">
    <div class="scrollable-content">
      <!-- 插件 OCR 提供商列表 -->
      <div v-if="providers.length > 0" class="provider-list">
        <div v-for="p in providers" :key="p.id" class="card provider-item">
          <div class="provider-info">
            <div class="provider-header">
              <img
                v-if="p.pluginLogo"
                :src="p.pluginLogo"
                class="provider-logo"
                alt=""
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <h3 class="card-title">{{ p.label }}</h3>
              <span class="source-badge plugin-badge">插件</span>
              <span v-if="p.pluginName" class="plugin-name">来自：{{ p.pluginName }}</span>
            </div>
            <p v-if="p.description" class="card-desc">{{ p.description }}</p>
          </div>
          <div class="provider-actions">
            <button
              class="text-btn"
              :class="{ 'text-btn-active': isDefault(p) }"
              :disabled="!isEnabled(p)"
              @click="handleSetDefault(p)"
            >
              {{ isDefault(p) ? '默认' : '设为默认' }}
            </button>
            <label class="toggle toggle-sm">
              <input
                type="checkbox"
                :checked="isEnabled(p)"
                @change="handleToggle(p, ($event.target as HTMLInputElement).checked)"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!loading && providers.length === 0" class="empty-state">
        <div class="i-z-scan empty-icon font-size-64px" />
        <div class="empty-text">暂无 OCR 提供商</div>
        <div class="empty-hint">安装支持 OCR 的插件即可接入，安装后会在此列出</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}
.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.provider-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
}
.provider-item:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.provider-info {
  flex: 1;
  min-width: 0;
}
.provider-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0;
}
.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}
.provider-logo {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  object-fit: contain;
  flex-shrink: 0;
}
.plugin-name {
  font-size: 11px;
  color: var(--text-secondary);
}
.source-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1;
}
.plugin-badge {
  color: #0891b2;
  background: rgba(8, 145, 178, 0.12);
}
.provider-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 16px;
  flex-shrink: 0;
}
.text-btn {
  font-size: 12px;
  padding: 5px 10px;
  border: 1px solid var(--divider-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.text-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.text-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.text-btn-active {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: var(--primary-light-bg);
}
.toggle-sm {
  display: flex;
  align-items: center;
  width: 36px;
  height: 20px;
  margin: 0;
}
.toggle-sm .toggle-slider {
  border-radius: 20px;
}
.toggle-sm .toggle-slider::before {
  width: 12px;
  height: 12px;
}
.toggle-sm input:checked + .toggle-slider::before {
  transform: translateX(16px);
}
.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
  pointer-events: none;
}
.empty-icon {
  color: var(--text-secondary);
  opacity: 0.3;
  margin-bottom: 16px;
}
.empty-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 8px;
}
.empty-hint {
  font-size: 14px;
  color: var(--text-secondary);
}
</style>
