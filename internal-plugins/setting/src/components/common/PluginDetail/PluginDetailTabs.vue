<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { CommandTag, FeatureCard, MatchCommandDetailDialog, TagDropdown } from '@/components'
import { usePluginCommandActions } from '@/composables'
import type { DocItem, PluginItem, TabId, TabItem } from './types'

const props = defineProps<{
  plugin: PluginItem
  activeTab: TabId
  availableTabs: TabItem[]
  // README
  readmeLoading: boolean
  readmeError: string
  renderedMarkdown: string
  readmeContent: string
  // 插件数据
  docKeys: DocItem[]
  dataLoading: boolean
  dataError: string
  expandedDataId: string
  currentDocContent: any
  currentDocType: 'document' | 'attachment'
  isClearing: boolean
}>()

const emit = defineEmits<{
  (e: 'switch-tab', tabId: TabId): void
  (e: 'toggle-data-detail', item: DocItem): void
  (e: 'clear-all-data'): void
}>()

// 插件指令操作（打开 / 固定 / 快捷键 / 别名 / 禁用）+ 匹配指令详情弹窗。
// 仅对已安装（有 path）的插件生效；未安装的市场插件不渲染操作菜单。
const {
  loadAll,
  isCommandDisabled,
  getMenuItems,
  handleMenuSelect,
  handleMatchMenuSelect,
  closeMatchCommandDetail,
  selectedMatchCommand,
  selectedMatchCommandDisabled,
  toggleSelectedMatchCommandDisabled,
  cmdKey,
  normalizeCommand,
  isMatchCommand
} = usePluginCommandActions({
  getPluginName: () => props.plugin.name,
  getPluginPath: () => props.plugin.path,
  getPluginTitle: () => props.plugin.title || props.plugin.name
})

const pluginName = computed(() => props.plugin.name || '')
const hasCommandActions = computed(() => Boolean(props.plugin.path))

// 首次挂载 + 切换插件（组件实例被复用、onMounted 不再触发）时重新加载指令操作数据
onMounted(() => {
  if (hasCommandActions.value) {
    void loadAll()
  }
})

watch(
  () => props.plugin.path,
  (newPath, oldPath) => {
    if (newPath && newPath !== oldPath) {
      void loadAll()
    }
  }
)

function formatJsonData(data: any): string {
  if (!data) return ''
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return dateStr
  }
}
</script>

<template>
  <div class="tab-container">
    <div class="tab-header">
      <button
        v-for="tab in availableTabs"
        :key="tab.id"
        class="tab-button"
        :class="{ active: activeTab === tab.id }"
        @click="emit('switch-tab', tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="tab-content">
      <!-- 详情 Tab -->
      <div v-if="activeTab === 'detail'" class="tab-panel">
        <div v-if="readmeLoading" class="loading-container">
          <div class="spinner"></div>
          <span>加载中...</span>
        </div>
        <div v-else-if="readmeError" class="error-container">
          <span>{{ readmeError }}</span>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else-if="readmeContent" class="markdown-content" v-html="renderedMarkdown"></div>
        <div v-else class="empty-message">该插件暂无详情说明</div>
      </div>

      <!-- 指令列表 Tab -->
      <div v-if="activeTab === 'commands'" class="tab-panel">
        <div v-if="plugin.features && plugin.features.length > 0" class="feature-list">
          <FeatureCard v-for="feature in plugin.features" :key="feature.code" :feature="feature">
            <template v-for="cmd in feature.cmds" :key="cmdKey(cmd)">
              <!-- 已安装：全部指令支持操作菜单 -->
              <TagDropdown
                v-if="hasCommandActions && isMatchCommand(cmd)"
                :menu-items="
                  getMenuItems(
                    isCommandDisabled(pluginName, feature.code, cmdKey(cmd), cmd.type || 'text'),
                    cmd.type,
                    pluginName,
                    feature.code,
                    cmdKey(cmd)
                  )
                "
                @select="(key) => handleMatchMenuSelect(key, feature, cmd)"
              >
                <CommandTag
                  :command="normalizeCommand(cmd)"
                  :disabled="
                    isCommandDisabled(pluginName, feature.code, cmdKey(cmd), cmd.type || 'text')
                  "
                  show-arrow
                />
              </TagDropdown>
              <TagDropdown
                v-else-if="hasCommandActions"
                :menu-items="
                  getMenuItems(
                    isCommandDisabled(pluginName, feature.code, cmdKey(cmd), cmd.type || 'text'),
                    cmd.type || 'text',
                    pluginName,
                    feature.code,
                    cmdKey(cmd)
                  )
                "
                @select="
                  (key) =>
                    handleMenuSelect(key, pluginName, feature.code, cmdKey(cmd), cmd.type || 'text')
                "
              >
                <CommandTag
                  :command="normalizeCommand(cmd)"
                  :disabled="
                    isCommandDisabled(pluginName, feature.code, cmdKey(cmd), cmd.type || 'text')
                  "
                  show-arrow
                />
              </TagDropdown>
              <!-- 未安装：纯展示 -->
              <CommandTag v-else :command="normalizeCommand(cmd)" />
            </template>
          </FeatureCard>
        </div>
        <div v-else class="empty-message">暂无指令</div>
      </div>

      <!-- 数据 Tab -->
      <div v-if="activeTab === 'data'" class="tab-panel">
        <div v-if="dataLoading" class="loading-container">
          <div class="spinner"></div>
          <span>加载中...</span>
        </div>
        <div v-else-if="dataError" class="error-container">
          <span>{{ dataError }}</span>
        </div>
        <div v-else-if="docKeys && docKeys.length > 0" class="data-container">
          <div class="data-header-actions">
            <button
              class="btn btn-sm btn-danger"
              :disabled="isClearing"
              @click="emit('clear-all-data')"
            >
              {{ isClearing ? '清除中...' : '清除全部数据' }}
            </button>
          </div>
          <div class="data-list">
            <div
              v-for="item in docKeys"
              :key="item.key"
              class="card data-item"
              :class="{ expanded: expandedDataId === item.key }"
              @click="emit('toggle-data-detail', item)"
            >
              <div class="data-header">
                <span class="data-key">{{ item.key }}</span>
                <div class="data-header-right">
                  <span class="doc-type-badge" :class="`type-${item.type}`">
                    {{ item.type === 'document' ? '文档' : '附件' }}
                  </span>
                  <svg
                    class="expand-icon"
                    :class="{ rotated: expandedDataId === item.key }"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 18L15 12L9 6"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
              </div>
              <Transition name="expand">
                <div v-if="expandedDataId === item.key" class="data-content">
                  <div class="data-meta">
                    <div class="data-meta-item">
                      <span class="label">类型:</span>
                      <span class="value type-badge" :class="`type-${currentDocType}`">
                        {{ currentDocType === 'document' ? '文档' : '附件' }}
                      </span>
                    </div>
                    <div v-if="currentDocContent?._rev" class="data-meta-item">
                      <span class="label">版本:</span>
                      <span class="value">{{ currentDocContent._rev }}</span>
                    </div>
                    <div
                      v-if="currentDocContent?._updatedAt || currentDocContent?.updatedAt"
                      class="data-meta-item"
                    >
                      <span class="label">更新时间:</span>
                      <span class="value">{{
                        formatDate(currentDocContent._updatedAt || currentDocContent.updatedAt)
                      }}</span>
                    </div>
                  </div>
                  <div class="data-json">
                    <pre>{{ formatJsonData(currentDocContent) }}</pre>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </div>
        <div v-else class="empty-message">该插件暂无存储数据</div>
      </div>

      <!-- 额外 Tab 内容（留言等） -->
      <slot name="extra-tabs" />
    </div>

    <MatchCommandDetailDialog
      :visible="!!selectedMatchCommand"
      :command="selectedMatchCommand?.command"
      :disabled="selectedMatchCommandDisabled"
      show-toggle-disabled
      @close="closeMatchCommandDetail"
      @toggle-disabled="toggleSelectedMatchCommandDisabled"
    />
  </div>
</template>

<style scoped>
.tab-container {
  margin-top: 20px;
  margin-left: 10px;
  margin-right: 10px;
}

.tab-header {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--divider-color);
  margin-bottom: 16px;
}

.tab-button {
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  bottom: -1px;
}

.tab-button:hover {
  color: var(--text-color);
  background: var(--hover-bg);
}

.tab-button.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.tab-content {
  min-height: 200px;
}

.tab-panel {
  animation: fadeIn 0.2s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 12px;
  color: var(--text-secondary);
}

.error-container {
  color: var(--error-color);
}

.empty-message {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
  font-size: 14px;
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

/* Markdown 内容样式 */
.markdown-content {
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3) {
  margin-top: 1em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

.markdown-content :deep(h1) {
  font-size: 1.8em;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.3em;
}

.markdown-content :deep(h2) {
  font-size: 1.5em;
}

.markdown-content :deep(h3) {
  font-size: 1.2em;
}

.markdown-content :deep(p) {
  margin: 0.8em 0;
}

.markdown-content :deep(a) {
  color: var(--primary-color);
}

.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 1em 0;
}

.markdown-content :deep(code) {
  padding: 2px 6px;
  background: var(--card-bg);
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  padding: 12px;
  background: var(--card-bg);
  border-radius: 6px;
  overflow-x: auto;
  margin: 1em 0;
}

.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
  margin: 0.8em 0;
}

.markdown-content :deep(blockquote) {
  margin: 1em 0;
  padding: 0.5em 1em;
  border-left: 3px solid var(--primary-color);
  background: var(--card-bg);
  color: var(--text-secondary);
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  margin: 1em 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
}

.markdown-content :deep(th) {
  background: var(--card-bg);
  font-weight: 600;
}

/* 指令列表样式 */
.feature-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 数据容器 */
.data-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.data-header-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 4px;
}

.data-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.data-item {
  cursor: pointer;
  transition: all 0.2s;
  overflow: hidden;
}

.data-item:hover {
  background: var(--hover-bg);
}

.data-item.expanded {
  background: var(--active-bg);
}

.data-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  gap: 8px;
}

.data-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.data-key {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  font-family: monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expand-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
  transition: transform 0.2s;
}

.expand-icon.rotated {
  transform: rotate(90deg);
}

.data-content {
  padding: 0 14px 14px;
  border-top: 1px solid var(--divider-color);
}

.data-meta {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.data-meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.data-meta-item .label {
  color: var(--text-secondary);
  font-weight: 500;
}

.data-meta-item .value {
  color: var(--text-color);
  font-family: monospace;
}

.data-meta-item .value.type-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

.data-meta-item .value.type-badge.type-document {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.data-meta-item .value.type-badge.type-attachment {
  background: var(--purple-light-bg);
  color: var(--purple-color);
}

.doc-type-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.doc-type-badge.type-document {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.doc-type-badge.type-attachment {
  background: var(--purple-light-bg);
  color: var(--purple-color);
}

.data-json {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
}

.data-json pre {
  margin: 0;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-color);
  white-space: pre-wrap;
  word-break: break-all;
}

/* 展开/收起动画 */
.expand-enter-active,
.expand-leave-active {
  transition:
    max-height 0.3s ease,
    opacity 0.2s ease;
  max-height: 500px;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
