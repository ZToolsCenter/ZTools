<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { BaseDialog, useToast } from '@/components'

interface MarketSourceConfig {
  type: 'official' | 'github' | 'cdn'
  url?: string
  branch?: string
  pluginsDir?: string
  token?: string
}

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved'): void
}>()

const { success, error } = useToast()

const sourceType = ref<MarketSourceConfig['type']>('official')
const url = ref('')
const branch = ref('main')
const pluginsDir = ref('plugins')
const token = ref('')
const isSaving = ref(false)

/** 预设的 GitHub 仓库 */
const GITHUB_PRESETS = [{ label: 'ZToolsCenter 官方插件库', value: 'ZToolsCenter/ZTools-plugins' }]

/**
 * 从主进程加载当前市场源配置。
 * 读取失败时静默回退到官方源默认值。
 */
async function loadConfig(): Promise<void> {
  try {
    const config = await window.ztools.internal.getMarketSourceConfig()
    sourceType.value = config.type || 'official'
    url.value = config.url || ''
    branch.value = config.branch || 'main'
    pluginsDir.value = config.pluginsDir || 'plugins'
    token.value = config.token || ''
  } catch {
    // 默认值已在 ref 初始化时设置
  }
}

/**
 * 保存市场源配置到主进程并通知父组件刷新市场数据。
 * 保存失败时弹出错误提示，不关闭对话框以便用户修正。
 */
async function handleSave(): Promise<void> {
  if (sourceType.value === 'github' && !url.value.trim()) {
    error('请输入 GitHub 仓库地址')
    return
  }
  if (sourceType.value === 'cdn' && !url.value.trim()) {
    error('请输入 CDN 清单 URL')
    return
  }

  isSaving.value = true
  try {
    const config: MarketSourceConfig = {
      type: sourceType.value,
      url: sourceType.value === 'official' ? undefined : url.value.trim(),
      branch: sourceType.value === 'github' ? branch.value.trim() || 'main' : undefined,
      pluginsDir: sourceType.value === 'github' ? pluginsDir.value.trim() || 'plugins' : undefined,
      token: sourceType.value === 'github' && token.value.trim() ? token.value.trim() : undefined
    }
    const result = await window.ztools.internal.setMarketSourceConfig(config)
    if (result.success) {
      success('市场源已切换，正在刷新...')
      emit('saved')
      emit('update:visible', false)
    } else {
      error('保存失败')
    }
  } catch (e) {
    error(e instanceof Error ? e.message : '保存失败')
  } finally {
    isSaving.value = false
  }
}

/**
 * 选择 GitHub 预设仓库时自动填充地址字段。
 * @param presetValue - 预设仓库的 owner/repo 值
 */
function applyPreset(presetValue: string): void {
  url.value = presetValue
}

onMounted(loadConfig)
</script>

<template>
  <BaseDialog
    :visible="props.visible"
    title="市场源设置"
    subtitle="选择插件来源，切换后将刷新市场数据"
    max-width="480px"
    @update:visible="emit('update:visible', $event)"
    @close="emit('update:visible', false)"
  >
    <div class="source-form">
      <!-- 源类型选择 -->
      <div class="source-type-options">
        <button
          type="button"
          class="type-option"
          :class="{ active: sourceType === 'official' }"
          @click="sourceType = 'official'"
        >
          <span class="type-icon">🏪</span>
          <span class="type-name">官方市场</span>
          <span class="type-desc">ZTools 官方插件市场</span>
        </button>
        <button
          type="button"
          class="type-option"
          :class="{ active: sourceType === 'github' }"
          @click="sourceType = 'github'"
        >
          <span class="type-icon">🐙</span>
          <span class="type-name">GitHub 仓库</span>
          <span class="type-desc">从 GitHub 仓库获取插件</span>
        </button>
        <button
          type="button"
          class="type-option"
          :class="{ active: sourceType === 'cdn' }"
          @click="sourceType = 'cdn'"
        >
          <span class="type-icon">🌐</span>
          <span class="type-name">CDN 清单</span>
          <span class="type-desc">从自定义 CDN 获取插件</span>
        </button>
      </div>

      <!-- GitHub 配置 -->
      <template v-if="sourceType === 'github'">
        <label class="field-label">仓库地址</label>
        <input
          v-model="url"
          class="input"
          type="text"
          placeholder="owner/repo 或 https://github.com/owner/repo"
        />
        <div class="presets">
          <span class="presets-label">快捷选择：</span>
          <button
            v-for="preset in GITHUB_PRESETS"
            :key="preset.value"
            type="button"
            class="btn btn-sm"
            @click="applyPreset(preset.value)"
          >
            {{ preset.label }}
          </button>
        </div>
        <div class="field-row">
          <div class="field-col">
            <label class="field-label">分支</label>
            <input v-model="branch" class="input" type="text" placeholder="main" />
          </div>
          <div class="field-col">
            <label class="field-label">插件目录</label>
            <input v-model="pluginsDir" class="input" type="text" placeholder="plugins" />
          </div>
        </div>
        <label class="field-label">
          GitHub Token
          <span class="field-hint">（可选，私有仓库或提高速率限制）</span>
        </label>
        <input v-model="token" class="input" type="password" placeholder="ghp_xxxxxxxxxxxx" />
      </template>

      <!-- CDN 配置 -->
      <template v-if="sourceType === 'cdn'">
        <label class="field-label">清单 URL</label>
        <input
          v-model="url"
          class="input"
          type="text"
          placeholder="https://your-cdn.com/plugins/manifest.json"
        />
        <p class="field-hint">
          格式：{{ '{' }} "plugins": [{{ '{' }} "name": "...", "version": "...", "downloadUrl":
          "..." {{ '}' }}] {{ '}' }}
        </p>
      </template>

      <!-- 官方源提示 -->
      <div v-if="sourceType === 'official'" class="notice">
        使用 ZTools 官方插件市场，提供完整的插件分类、推荐和评论功能。
      </div>
    </div>

    <template #footer>
      <button class="btn" type="button" @click="emit('update:visible', false)">取消</button>
      <button class="btn btn-solid" type="button" :disabled="isSaving" @click="handleSave">
        {{ isSaving ? '保存中...' : '保存并刷新' }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.source-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.source-type-options {
  display: flex;
  gap: 8px;
}

.type-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  border: 2px solid var(--control-border);
  border-radius: 8px;
  background: var(--control-bg);
  cursor: pointer;
  transition: all 0.2s;
}

.type-option:hover {
  border-color: var(--primary-color);
}

.type-option.active {
  border-color: var(--primary-color);
  background: var(--primary-light-bg);
}

.type-icon {
  font-size: 20px;
}

.type-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.type-desc {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
}

.field-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.field-row {
  display: flex;
  gap: 12px;
}

.field-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.presets {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.presets-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.notice {
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--primary-light-bg);
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
