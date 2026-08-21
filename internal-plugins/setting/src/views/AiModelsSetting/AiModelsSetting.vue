<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from '@/components'
import { weightedSearch } from '@/utils'
import { AiProviderEditor } from './components'
import { useZtoolsSubInput } from '@/composables'
import type { AiProvider, AiProviderInput, AiProviderStore } from '@shared/aiProviderShared'
import { AI_API_FORMAT_OPTIONS } from '@shared/aiProviderShared'

const { success, error, confirm } = useToast()
const store = ref<AiProviderStore>({ version: 2, providers: [] })
const loading = ref(true)
const isWorking = ref(false)
const showEditor = ref(false)
const editingProvider = ref<AiProvider | null>(null)
const { value: searchQuery } = useZtoolsSubInput('', '搜索 AI 供应商或模型...')

const filteredProviders = computed(() =>
  weightedSearch(store.value.providers, searchQuery.value || '', [
    { value: (provider) => provider.name, weight: 10 },
    { value: (provider) => provider.apiUrl, weight: 6 },
    {
      value: (provider) => provider.selectedModels.map((model) => model.modelId).join(' '),
      weight: 4
    }
  ])
)

/**
 * 从主进程加载完整的 AI 供应商文档。
 * @returns 操作完成后结束的 Promise
 */
async function loadProviders(): Promise<void> {
  loading.value = true
  try {
    const result = await window.ztools.internal.aiProviders.getAll()
    if (result.success && result.data) {
      store.value = result.data
    } else {
      error(result.error || '加载 AI 供应商失败')
    }
  } catch (cause) {
    console.error('加载 AI 供应商失败:', cause)
    error('加载 AI 供应商失败')
  } finally {
    loading.value = false
  }
}

/**
 * 打开新建供应商编辑面板。
 * @returns 无返回值
 */
function showAddEditor(): void {
  editingProvider.value = null
  showEditor.value = true
}

/**
 * 打开指定供应商的编辑面板。
 * @param provider 要编辑的供应商
 * @returns 无返回值
 */
function handleEdit(provider: AiProvider): void {
  editingProvider.value = provider
  showEditor.value = true
}

/**
 * 关闭供应商编辑面板并清理编辑目标。
 * @returns 无返回值
 */
function closeEditor(): void {
  showEditor.value = false
  editingProvider.value = null
}

/**
 * 新建或更新供应商，并在成功后刷新列表。
 * @param provider 供应商连接信息和已选模型
 * @returns 操作完成后结束的 Promise
 */
async function handleSave(provider: AiProviderInput): Promise<void> {
  if (!provider.name.trim() || !provider.apiUrl.trim() || !provider.apiKey.trim()) {
    error('请填写供应商名称、API 地址和密钥')
    return
  }
  if (provider.selectedModels.length === 0) {
    error('请至少选择一个模型')
    return
  }

  isWorking.value = true
  try {
    const result = provider.id
      ? await window.ztools.internal.aiProviders.update(provider)
      : await window.ztools.internal.aiProviders.add(provider)
    if (!result.success) {
      error(result.error || '保存供应商失败')
      return
    }

    success(provider.id ? '供应商已更新' : '供应商已添加')
    await loadProviders()
    closeEditor()
  } catch (cause) {
    console.error('保存 AI 供应商失败:', cause)
    error('保存供应商失败')
  } finally {
    isWorking.value = false
  }
}

/**
 * 确认后删除供应商及其全部模型。
 * @param provider 要删除的供应商
 * @returns 操作完成后结束的 Promise
 */
async function handleDelete(provider: AiProvider): Promise<void> {
  const confirmed = await confirm({
    message: `确定删除“${provider.name}”及其 ${provider.selectedModels.length} 个模型吗？`,
    title: '删除供应商',
    type: 'warning'
  })
  if (!confirmed) return

  isWorking.value = true
  try {
    const result = await window.ztools.internal.aiProviders.delete(provider.id)
    if (!result.success) {
      error(result.error || '删除供应商失败')
      return
    }
    success('供应商已删除')
    await loadProviders()
  } catch (cause) {
    console.error('删除 AI 供应商失败:', cause)
    error('删除供应商失败')
  } finally {
    isWorking.value = false
  }
}

/**
 * 开启或关闭供应商，并同步主进程返回的最新配置。
 * @param provider 要修改状态的供应商
 * @param enabled 是否允许插件发现和调用该供应商
 * @returns 操作完成后结束的 Promise
 */
async function handleToggleProvider(provider: AiProvider, enabled: boolean): Promise<void> {
  if (provider.enabled === enabled) return

  isWorking.value = true
  try {
    const result = await window.ztools.internal.aiProviders.setEnabled(provider.id, enabled)
    if (!result.success) {
      error(result.error || '更新供应商状态失败')
      return
    }
    if (result.data) store.value = result.data
    success(enabled ? '供应商已开启' : '供应商已关闭')
  } catch (cause) {
    console.error('更新 AI 供应商状态失败:', cause)
    error('更新供应商状态失败')
  } finally {
    isWorking.value = false
  }
}

/**
 * 将 API 密钥转换为适合列表展示的掩码。
 * @param apiKey 完整 API 密钥
 * @returns 掩码后的密钥
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '********'
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
}

/**
 * 将接口格式枚举值转换为展示用标签。
 * @param apiFormat 供应商接口格式
 * @returns 格式标签
 */
function formatLabel(apiFormat: AiProvider['apiFormat']): string {
  return (
    AI_API_FORMAT_OPTIONS.find((option) => option.value === apiFormat)?.label ||
    'OpenAI Chat Completions'
  )
}

onMounted(loadProviders)
</script>

<template>
  <div class="content-panel">
    <Transition name="list-slide">
      <div v-show="!showEditor" class="scrollable-content">
        <div class="panel-header">
          <div class="summary">
            <strong>{{ store.providers.length }}</strong>
            <span>个供应商</span>
            <span class="summary-divider" />
            <strong>{{
              store.providers.reduce((sum, item) => sum + item.selectedModels.length, 0)
            }}</strong>
            <span>个模型</span>
          </div>
          <button class="btn btn-solid" @click="showAddEditor">添加供应商</button>
        </div>

        <div class="provider-list">
          <article
            v-for="provider in filteredProviders"
            :key="provider.id"
            class="card provider-item"
            :class="{ 'provider-disabled': !provider.enabled }"
          >
            <header class="provider-header">
              <div class="provider-identity">
                <h3>{{ provider.name }}</h3>
                <div class="provider-url">{{ provider.apiUrl }}</div>
              </div>
              <div class="provider-actions">
                <label
                  class="provider-toggle"
                  :title="provider.enabled ? '关闭供应商' : '开启供应商'"
                >
                  <span class="provider-status">{{ provider.enabled ? '已开启' : '未开启' }}</span>
                  <span class="toggle toggle-sm">
                    <input
                      type="checkbox"
                      :checked="provider.enabled"
                      :disabled="isWorking"
                      @change="
                        handleToggleProvider(provider, ($event.target as HTMLInputElement).checked)
                      "
                    />
                    <span class="toggle-slider" />
                  </span>
                </label>
                <button
                  class="icon-btn"
                  title="编辑供应商"
                  :disabled="isWorking"
                  @click="handleEdit(provider)"
                >
                  <div class="i-z-settings font-size-16px" />
                </button>
                <button
                  class="icon-btn delete-button"
                  title="删除供应商"
                  :disabled="isWorking"
                  @click="handleDelete(provider)"
                >
                  <div class="i-z-trash font-size-16px" />
                </button>
              </div>
            </header>

            <div class="provider-meta">
              <span>{{ provider.selectedModels.length }} 个模型</span>
              <span>{{ formatLabel(provider.apiFormat) }}</span>
              <span>{{ maskApiKey(provider.apiKey) }}</span>
            </div>

            <div class="model-tags">
              <code v-for="model in provider.selectedModels" :key="model.ref" class="model-tag">
                {{ model.modelId }}
              </code>
            </div>
          </article>

          <div v-if="!loading && store.providers.length === 0" class="empty-state provider-empty">
            <div class="i-z-brain empty-icon font-size-64px" />
            <div class="empty-text">暂无 AI 供应商</div>
            <div class="empty-hint">添加供应商后选择需要使用的模型</div>
          </div>

          <div
            v-else-if="!loading && filteredProviders.length === 0"
            class="empty-state compact-empty"
          >
            <div class="empty-text">没有匹配的供应商或模型</div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="slide">
      <AiProviderEditor
        v-if="showEditor"
        :editing-provider="editingProvider"
        @back="closeEditor"
        @save="handleSave"
      />
    </Transition>
  </div>
</template>

<style scoped>
.content-panel {
  position: relative;
  height: 100%;
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

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.summary {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 12px;
}

.summary strong {
  color: var(--text-color);
  font-size: 14px;
}

.summary-divider {
  width: 1px;
  height: 12px;
  margin: 0 5px;
  background: var(--divider-color);
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-item {
  padding: 16px;
}

.provider-item:hover {
  border-color: color-mix(in srgb, var(--primary-color), transparent 35%);
}

.provider-disabled .provider-identity,
.provider-disabled .provider-meta,
.provider-disabled .model-tags {
  opacity: 0.52;
}

.provider-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.provider-identity {
  flex: 1;
  min-width: 0;
}

.provider-identity h3 {
  margin: 0 0 4px;
  color: var(--text-color);
  font-size: 15px;
  font-weight: 600;
}

.provider-url {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.provider-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-right: 5px;
  cursor: pointer;
}

.provider-status {
  min-width: 36px;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: right;
}

.toggle-sm {
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

.provider-actions .icon-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.provider-actions .delete-button:hover:not(:disabled) {
  background: var(--danger-light-bg);
  color: var(--danger-color);
}

.provider-meta {
  display: flex;
  gap: 14px;
  margin: 13px 0 8px;
  color: var(--text-secondary);
  font-size: 11px;
}

.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding-top: 3px;
}

.model-tag {
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--control-border);
  border-radius: 4px;
  background: var(--control-bg);
  overflow-wrap: anywhere;
  color: var(--text-color);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.provider-empty {
  position: absolute;
  inset: 0;
  padding: 20px;
  pointer-events: none;
}

.empty-icon {
  margin-bottom: 16px;
  color: var(--text-secondary);
  opacity: 0.3;
}

.empty-text {
  margin-bottom: 8px;
  color: var(--text-color);
  font-size: 16px;
  font-weight: 500;
}

.empty-hint {
  color: var(--text-secondary);
  font-size: 14px;
}

.compact-empty {
  min-height: 180px;
}

.list-slide-enter-active,
.list-slide-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.15s ease;
}

.list-slide-enter-from,
.list-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

@media (max-width: 650px) {
  .scrollable-content {
    padding: 14px;
  }

  .provider-status {
    display: none;
  }
}
</style>
