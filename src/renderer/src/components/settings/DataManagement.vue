<template>
  <div class="data-management">
    <!-- 主内容：插件列表 -->
    <Transition name="list-slide">
      <div v-show="currentLevel === 'main'" class="main-content">
        <div v-if="isLoaded && pluginDataList.length === 0" class="empty">
          <p>暂无插件数据</p>
        </div>

        <div v-else-if="isLoaded && pluginDataList.length > 0" class="plugin-list">
          <div
            v-for="pluginData in pluginDataList"
            :key="pluginData.pluginName"
            class="card plugin-card"
          >
            <img
              v-if="pluginData.logo"
              :src="pluginData.logo"
              class="plugin-icon"
              alt="插件图标"
              draggable="false"
            />
            <div v-else class="plugin-icon-placeholder">
              <Icon name="plugin" :size="24" />
            </div>

            <div class="plugin-info">
              <h3 class="plugin-name">{{ pluginData.pluginName }}</h3>
              <span class="doc-count"
                >{{ pluginData.docCount }} 个文档 / {{ pluginData.attachmentCount }} 个附件</span
              >
            </div>

            <button
              class="icon-btn"
              title="查看文档"
              @click="viewPluginDocs(pluginData.pluginName)"
            >
              <Icon name="search" :size="14" />
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 二级页面：文档列表 -->
    <DetailPanel
      v-show="currentLevel === 'docList'"
      :title="`${currentPluginName} - 文档列表`"
      :class="docListAnimationClass"
      @back="closeDocListModal"
    >
      <div class="detail-header-actions">
        <button class="btn btn-danger" @click="handleClearData">
          <Icon name="trash" :size="16" />
          <span>清空所有数据</span>
        </button>
      </div>
      <div v-if="docKeys.length === 0" class="empty">暂无文档</div>
      <div v-else class="doc-list">
        <div
          v-for="docItem in docKeys"
          :key="docItem.key"
          class="card doc-card"
          :class="{ active: selectedDocKey === docItem.key }"
          @click="viewDocContent(docItem.key)"
        >
          <span class="doc-key">{{ docItem.key }}</span>
          <span class="doc-type-badge" :class="`type-${docItem.type}`">
            {{ docItem.type === 'document' ? '文档' : '附件' }}
          </span>
        </div>
      </div>
    </DetailPanel>

    <!-- 三级页面：文档详情 -->
    <Transition name="slide">
      <DetailPanel v-if="currentLevel === 'docDetail'" title="文档详情" @back="closeDocDetailModal">
        <div class="doc-detail-content">
          <div class="doc-key-display">
            <span class="label">Key:</span>
            <span class="value">{{ selectedDocKey }}</span>
          </div>
          <div class="doc-key-display">
            <span class="label">类型:</span>
            <span class="value type-badge" :class="`type-${currentDocType}`">
              {{ currentDocType === 'document' ? '文档' : '附件' }}
            </span>
          </div>
          <div class="doc-content">
            <pre>{{ formattedDocContent }}</pre>
          </div>
        </div>
      </DetailPanel>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DetailPanel from '../common/DetailPanel.vue'
import Icon from '../common/Icon.vue'

interface PluginData {
  pluginName: string
  docCount: number
  attachmentCount: number
  logo: string | null
}

interface DocItem {
  key: string
  type: 'document' | 'attachment'
}

// 页面层级类型
type PageLevel = 'main' | 'docList' | 'docDetail'

const pluginDataList = ref<PluginData[]>([])
const isLoaded = ref(false)
const currentLevel = ref<PageLevel>('main') // 当前页面层级
const currentPluginName = ref('')
const docKeys = ref<DocItem[]>([])
const selectedDocKey = ref('')
const currentDocContent = ref<any>(null)
const currentDocType = ref<'document' | 'attachment'>('document')
const docListAnimation = ref('slide') // 二级页面的动画名称，完全手动控制

// 二级页面的动画类
const docListAnimationClass = computed(() => {
  return `detail-animate-${docListAnimation.value}`
})

// 格式化文档内容
const formattedDocContent = computed(() => {
  if (!currentDocContent.value) return ''
  return JSON.stringify(currentDocContent.value, null, 2)
})

// 加载插件数据统计
async function loadPluginData(): Promise<void> {
  try {
    const result = await window.ztools.getPluginDataStats()
    if (result.success) {
      pluginDataList.value = result.data || []
    }
  } catch (error) {
    console.error('加载插件数据失败:', error)
  } finally {
    isLoaded.value = true
  }
}

// 查看插件文档
async function viewPluginDocs(pluginName: string): Promise<void> {
  currentPluginName.value = pluginName
  docListAnimation.value = 'slide' // 从一级进入二级，用 slide（从右进入）
  currentLevel.value = 'docList'

  try {
    const result = await window.ztools.getPluginDocKeys(pluginName)
    if (result.success) {
      docKeys.value = result.data || []
    }
  } catch (error) {
    console.error('加载文档列表失败:', error)
  }
}

// 查看文档内容
async function viewDocContent(key: string): Promise<void> {
  selectedDocKey.value = key
  docListAnimation.value = 'slide-reverse' // 进入三级，二级要向左离开
  currentLevel.value = 'docDetail'

  try {
    const result = await window.ztools.getPluginDoc(currentPluginName.value, key)
    if (result.success) {
      currentDocContent.value = result.data
      currentDocType.value = result.type || 'document'
    }
  } catch (error) {
    console.error('加载文档内容失败:', error)
  }
}

// 关闭文档列表弹窗
function closeDocListModal(): void {
  docListAnimation.value = 'slide' // 返回一级，用 slide（向右离开）
  currentLevel.value = 'main'
  currentPluginName.value = ''
  docKeys.value = []
  selectedDocKey.value = ''
}

// 关闭文档详情弹窗
function closeDocDetailModal(): void {
  docListAnimation.value = 'slide-reverse' // 从三级返回二级，二级从左进入
  currentLevel.value = 'docList'
  selectedDocKey.value = ''
  currentDocContent.value = null
}

// 清空插件数据
async function handleClearData(): Promise<void> {
  if (!currentPluginName.value) return

  // 确认操作
  if (
    !confirm(
      `确定要清空插件"${currentPluginName.value}"的所有数据吗？\n\n此操作将删除该插件的所有文档，无法恢复。`
    )
  ) {
    return
  }

  try {
    const result = await window.ztools.clearPluginData(currentPluginName.value)
    if (result.success) {
      alert(`已成功清空 ${result.deletedCount} 个文档`)
      // 关闭弹窗
      closeDocListModal()
      // 重新加载插件数据统计
      await loadPluginData()
    } else {
      alert(`清空数据失败: ${result.error}`)
    }
  } catch (error) {
    console.error('清空数据失败:', error)
    alert('清空数据失败')
  }
}

onMounted(() => {
  loadPluginData()
})
</script>

<style scoped>
.data-management {
  position: relative; /* 使详情面板能够覆盖该区域 */
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 防止滑动时出现滚动条 */
  background: var(--bg-color);
}

/* 主内容区 */
.main-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}

/* 列表滑动动画 */
.list-slide-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.list-slide-leave-active {
  transition:
    transform 0.2s ease-in,
    opacity 0.15s ease;
}

.list-slide-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}

.list-slide-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

/* 二级页面进入动画（不使用 Transition，直接用 CSS animation） */
.detail-animate-slide {
  animation: slideInFromRight 0.2s ease-out;
}

.detail-animate-slide-reverse {
  animation: slideInFromLeft 0.2s ease-out;
}

@keyframes slideInFromRight {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slideInFromLeft {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-card {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  cursor: default;
  transition: all 0.2s;
}

.plugin-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.plugin-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  margin-right: 14px;
  flex-shrink: 0;
  object-fit: cover;
}

.plugin-icon-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  margin-right: 14px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  color: var(--text-secondary);
  opacity: 0.6;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 4px;
}

.doc-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.plugin-card .icon-btn {
  color: var(--primary-color);
}

.plugin-card .icon-btn:hover {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.detail-header-actions {
  padding: 16px;
  border-bottom: 1px solid var(--divider-color);
}

.doc-list {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.doc-detail-content {
  padding: 16px;
}

.doc-card {
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.2s;
}

.doc-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.doc-card.active {
  background: var(--active-bg);
}

.doc-key {
  flex: 1;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-type-badge {
  margin-left: 12px;
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

.doc-key-display {
  margin-bottom: 10px;
  padding: 8px 12px;
  background: var(--bg-color);
  border-radius: 6px;
  font-size: 13px;
}

.doc-key-display .label {
  color: var(--text-secondary);
  margin-right: 8px;
  font-weight: 600;
}

.doc-key-display .value {
  color: var(--text-primary);
  font-family: 'Monaco', 'Menlo', monospace;
}

.doc-key-display .value.type-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

.doc-key-display .value.type-badge.type-document {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.doc-key-display .value.type-badge.type-attachment {
  background: var(--purple-light-bg);
  color: var(--purple-color);
}

.doc-content {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
}

.doc-content pre {
  margin: 0;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
