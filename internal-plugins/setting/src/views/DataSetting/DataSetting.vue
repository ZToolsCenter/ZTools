<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useToast, AdaptiveIcon, DetailPanel } from '@/components'
import ProgressCircleButton from '@/components/common/ProgressCircleButton/ProgressCircleButton.vue'
import { weightedSearch } from '@/utils'
import { useZtoolsSubInput } from '@/composables'
import { ACCOUNT_CHANGED_EVENT } from '@/composables/useZToolsAccount'

const { success, error, confirm } = useToast()

interface PluginData {
  pluginName: string
  pluginTitle?: string | null
  isDevelopment: boolean
  docCount: number
  attachmentCount: number
  logo: string | null
}

interface InstalledPlugin {
  name: string
  path: string
  version: string
  description?: string
  logo?: string
  isDevelopment?: boolean
}

interface MarketPlugin {
  name: string
  title?: string
  description?: string
  logo?: string
  version?: string
  [key: string]: unknown
}

interface PluginDownloadState {
  taskId?: string
  status: 'downloading' | 'installing' | 'success' | 'error' | 'cancelled'
  progress: number | null
  receivedBytes?: number
  totalBytes?: number
  error?: string
}

interface DocItem {
  key: string
  type: 'document' | 'attachment'
}

// 页面层级类型
type PageLevel = 'main' | 'docList' | 'docDetail'

const pluginDataList = ref<PluginData[]>([])
const installedPluginNames = ref<Set<string>>(new Set())
const marketPluginMap = ref<Map<string, MarketPlugin>>(new Map())
const installingPlugin = ref<string | null>(null)
const downloadStates = ref<Record<string, PluginDownloadState | undefined>>({})
const isLoaded = ref(false)

// 获取插件显示名称（优先 title，回退到 name）
function getDisplayName(data: Pick<PluginData, 'pluginName' | 'pluginTitle'> | null): string {
  if (!data) return ''
  return data.pluginTitle || marketPluginMap.value.get(data.pluginName)?.title || data.pluginName
}

function getPluginLogo(data: PluginData): string | null {
  return data.logo || marketPluginMap.value.get(data.pluginName)?.logo || null
}

function isPluginInstalled(data: PluginData): boolean {
  return (
    data.pluginName === 'ZTOOLS' ||
    data.isDevelopment ||
    installedPluginNames.value.has(data.pluginName)
  )
}

function canDownloadPlugin(data: PluginData): boolean {
  return (
    !data.isDevelopment &&
    data.pluginName !== 'ZTOOLS' &&
    !isPluginInstalled(data) &&
    marketPluginMap.value.has(data.pluginName)
  )
}

function getDownloadState(pluginName: string): PluginDownloadState | undefined {
  return downloadStates.value[pluginName]
}

function setDownloadState(pluginName: string, state: PluginDownloadState): void {
  downloadStates.value = {
    ...downloadStates.value,
    [pluginName]: state
  }
}

function clearDownloadState(pluginName: string): void {
  const nextStates = { ...downloadStates.value }
  delete nextStates[pluginName]
  downloadStates.value = nextStates
}

// 生成列表 key
function getPluginDataKey(data: PluginData): string {
  return data.pluginName
}

const { value: searchQuery } = useZtoolsSubInput('', '搜索数据...')

const filteredPluginDataList = computed(() =>
  weightedSearch(pluginDataList.value, searchQuery.value || '', [
    { value: (p) => getDisplayName(p), weight: 10 },
    { value: (p) => p.pluginName || '', weight: 3 },
    { value: (p) => (p.isDevelopment ? 'dev development 开发版' : 'installed 安装版'), weight: 1 }
  ])
)

const currentLevel = ref<PageLevel>('main') // 当前页面层级
const currentPluginData = ref<PluginData | null>(null)
const docKeys = ref<DocItem[]>([])
const selectedDocKey = ref('')
const currentDocContent = ref<any>(null)
const currentDocType = ref<'document' | 'attachment'>('document')
const docListAnimation = ref('slide') // 二级页面的动画名称，完全手动控制
let removeAccountStorageListener: (() => void) | undefined
let removeDownloadProgressListener: (() => void) | undefined
let loadRequestId = 0

// 二级页面的动画类
const docListAnimationClass = computed(() => {
  return `detail-animate-${docListAnimation.value}`
})

// 格式化文档内容
const formattedDocContent = computed(() => {
  if (!currentDocContent.value) return ''
  return JSON.stringify(currentDocContent.value, null, 2)
})

const currentPluginDetailTitle = computed(() => {
  if (!currentPluginData.value) return '文档列表'
  return `${getDisplayName(currentPluginData.value)}${currentPluginData.value.isDevelopment ? ' [DEV]' : ''} - 文档列表`
})

// 加载插件数据统计
async function loadPluginData(): Promise<void> {
  const requestId = ++loadRequestId
  if (pluginDataList.value.length === 0) {
    isLoaded.value = false
  }

  void loadPluginMetadata(requestId)

  try {
    const result = await window.ztools.internal.getPluginDataStats()
    if (requestId !== loadRequestId) return
    if (result.success) {
      pluginDataList.value = result.data || []
    }
  } catch (error) {
    console.error('加载插件数据失败:', error)
  } finally {
    if (requestId === loadRequestId) {
      isLoaded.value = true
    }
  }
}

async function loadPluginMetadata(requestId = loadRequestId): Promise<void> {
  try {
    const installedPlugins = await window.ztools.internal
      .getPlugins()
      .catch(() => [] as InstalledPlugin[])
    if (requestId !== loadRequestId) return
    installedPluginNames.value = new Set(
      (installedPlugins as InstalledPlugin[])
        .filter((plugin) => plugin?.name && !plugin.isDevelopment)
        .map((plugin) => plugin.name)
    )

    const marketResult = await window.ztools.internal.fetchPluginMarket().catch((err: unknown) => {
      console.warn('加载插件市场失败:', err)
      return null
    })
    if (requestId !== loadRequestId) return

    const nextMarketMap = new Map<string, MarketPlugin>()
    const marketPlugins = Array.isArray((marketResult as any)?.data)
      ? (marketResult as any).data
      : []
    for (const plugin of marketPlugins as MarketPlugin[]) {
      if (plugin?.name) {
        nextMarketMap.set(plugin.name, plugin)
      }
    }
    marketPluginMap.value = nextMarketMap
  } catch (err) {
    console.warn('加载插件元数据失败:', err)
  }
}

function handleDownloadProgress(payload: PluginDownloadState & { pluginName: string }): void {
  setDownloadState(payload.pluginName, {
    taskId: payload.taskId,
    status: payload.status,
    progress: payload.progress,
    receivedBytes: payload.receivedBytes,
    totalBytes: payload.totalBytes,
    error: payload.error
  })

  if (
    payload.status === 'success' ||
    payload.status === 'error' ||
    payload.status === 'cancelled'
  ) {
    window.setTimeout(() => clearDownloadState(payload.pluginName), 500)
  }
}

async function downloadPlugin(pluginData: PluginData): Promise<void> {
  const marketPlugin = marketPluginMap.value.get(pluginData.pluginName)
  if (!marketPlugin || !canDownloadPlugin(pluginData)) return

  const currentState = getDownloadState(pluginData.pluginName)
  if (currentState?.status === 'downloading') {
    const cancelResult = await window.ztools.internal.cancelPluginMarketDownload(
      currentState.taskId || pluginData.pluginName
    )
    if (!cancelResult.success) {
      error(`取消下载失败: ${cancelResult.error || '未知错误'}`)
    }
    return
  }

  if (installingPlugin.value) return

  installingPlugin.value = pluginData.pluginName
  setDownloadState(pluginData.pluginName, {
    status: 'downloading',
    progress: null
  })

  try {
    const result = await window.ztools.internal.installPluginFromMarket(
      JSON.parse(JSON.stringify(marketPlugin))
    )
    if (result.success) {
      success(`${getDisplayName(pluginData)} 安装成功`)
      installedPluginNames.value = new Set([...installedPluginNames.value, pluginData.pluginName])
      await loadPluginData()
    } else if (result.cancelled) {
      clearDownloadState(pluginData.pluginName)
    } else {
      error(`安装失败: ${result.error || '未知错误'}`)
    }
  } catch (err) {
    console.error('安装插件失败:', err)
    error(`安装失败: ${err instanceof Error ? err.message : '未知错误'}`)
  } finally {
    installingPlugin.value = null
    clearDownloadState(pluginData.pluginName)
  }
}

async function handleAccountStorageChanged(): Promise<void> {
  closeDocDetailModal()
  closeDocListModal()
  isLoaded.value = false
  await loadPluginData()
}

// 查看插件文档
async function viewPluginDocs(pluginData: PluginData): Promise<void> {
  currentPluginData.value = pluginData
  docListAnimation.value = 'slide' // 从一级进入二级，用 slide（从右进入）
  currentLevel.value = 'docList'

  try {
    const result = await window.ztools.internal.getPluginDocKeys(pluginData.pluginName)
    if (result.success) {
      docKeys.value = result.data || []
    }
  } catch (error) {
    console.error('加载文档列表失败:', error)
  }
}

// 删除文档
async function deleteDocContent(docItem: DocItem): Promise<void> {
  if (!currentPluginData.value) return

  const confirmed = await confirm({
    title: '删除文档',
    message: `确定要删除文档“${docItem.key}”吗？\n\n此操作不可恢复。`,
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!confirmed) return

  try {
    const result = await window.ztools.internal.deletePluginDoc(
      currentPluginData.value.pluginName,
      docItem.key
    )
    if (result.success) {
      success('文档删除成功')
      if (selectedDocKey.value === docItem.key) {
        closeDocDetailModal()
      }
      await viewPluginDocs(currentPluginData.value)
      await loadPluginData()
    } else {
      error(`删除失败: ${result.error || '未知错误'}`)
    }
  } catch (err) {
    console.error('删除文档失败:', err)
    error('删除文档失败')
  }
}

// 导出文档
async function exportDocContent(docItem: DocItem): Promise<void> {
  if (!currentPluginData.value) return

  try {
    const result = await window.ztools.internal.exportPluginDoc(
      currentPluginData.value.pluginName,
      docItem.key
    )
    if (result.success) {
      success('文档导出成功')
    } else if (!result.canceled) {
      error(`导出失败: ${result.error || '未知错误'}`)
    }
  } catch (err) {
    console.error('导出文档失败:', err)
    error('导出文档失败')
  }
}

// 查看文档内容
async function viewDocContent(key: string): Promise<void> {
  if (!currentPluginData.value) return

  selectedDocKey.value = key
  docListAnimation.value = 'slide-reverse' // 进入三级，二级要向左离开
  currentLevel.value = 'docDetail'

  try {
    const result = await window.ztools.internal.getPluginDoc(
      currentPluginData.value.pluginName,
      key
    )
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
  currentPluginData.value = null
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
  if (!currentPluginData.value) return

  // 禁止清空主程序数据
  if (currentPluginData.value.pluginName === 'ZTOOLS') {
    error('无法清空主程序数据，这可能导致应用异常')
    return
  }

  // 确认操作
  const confirmed = await confirm({
    title: '清空数据',
    message: `确定要清空插件"${getDisplayName(currentPluginData.value)}"${currentPluginData.value.isDevelopment ? '（DEV）' : ''}的所有数据吗？\n\n此操作将删除该插件变体的所有文档，无法恢复。`,
    type: 'danger',
    confirmText: '清空',
    cancelText: '取消'
  })
  if (!confirmed) return

  try {
    const result = await window.ztools.internal.clearPluginData(currentPluginData.value.pluginName)
    if (result.success) {
      success(`已成功清空 ${result.deletedCount} 个文档`)
      // 关闭弹窗
      closeDocListModal()
      // 重新加载插件数据统计
      await loadPluginData()
    } else {
      error(`清空数据失败: ${result.error}`)
    }
  } catch (err) {
    console.error('清空数据失败:', err)
    error('清空数据失败')
  }
}

// 处理 ESC 按键
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (currentLevel.value === 'docDetail') {
      e.stopPropagation()
      closeDocDetailModal()
    } else if (currentLevel.value === 'docList') {
      e.stopPropagation()
      closeDocListModal()
    }
  }
}

onMounted(() => {
  loadPluginData()
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener(ACCOUNT_CHANGED_EVENT, handleAccountStorageChanged)
  removeAccountStorageListener = window.ztools.internal.onSyncAccountStorageChanged?.(() => {
    handleAccountStorageChanged()
  })
  removeDownloadProgressListener =
    window.ztools.internal.onPluginMarketDownloadProgress?.(handleDownloadProgress)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener(ACCOUNT_CHANGED_EVENT, handleAccountStorageChanged)
  removeAccountStorageListener?.()
  removeDownloadProgressListener?.()
})
</script>

<template>
  <div class="data-management">
    <!-- 主内容：插件列表 -->
    <Transition name="list-slide">
      <div v-show="currentLevel === 'main'" class="main-content">
        <div v-if="!isLoaded" class="empty">
          <p>正在加载数据...</p>
        </div>

        <div v-else-if="filteredPluginDataList.length === 0" class="empty">
          <p>暂无插件数据</p>
        </div>

        <div v-else class="plugin-list">
          <div
            v-for="pluginData in filteredPluginDataList"
            :key="getPluginDataKey(pluginData)"
            class="card plugin-card"
            :class="{ 'ztools-card': pluginData.pluginName === 'ZTOOLS' }"
            @click="viewPluginDocs(pluginData)"
          >
            <!-- 图标区域（含 DEV 角标） -->
            <div class="plugin-icon-wrapper">
              <!-- 主程序特殊图标 -->
              <div
                v-if="pluginData.pluginName === 'ZTOOLS'"
                class="plugin-icon-placeholder ztools-icon"
              >
                <div class="i-z-database font-size-24px" />
              </div>
              <!-- 插件图标 -->
              <AdaptiveIcon
                v-else-if="getPluginLogo(pluginData)"
                :src="getPluginLogo(pluginData)!"
                class="plugin-icon"
                alt="插件图标"
                draggable="false"
              />
              <div v-else class="plugin-icon-placeholder">
                <div class="i-z-plugin font-size-24px"></div>
              </div>
              <span v-if="pluginData.isDevelopment" class="plugin-dev-badge">DEV</span>
            </div>

            <div class="plugin-info">
              <h3 class="plugin-name">
                <span>{{ getDisplayName(pluginData) }}</span>
                <span v-if="!isPluginInstalled(pluginData)" class="plugin-missing-badge"
                  >未安装</span
                >
              </h3>
              <span class="doc-count"
                >{{ pluginData.docCount }} 个文档 / {{ pluginData.attachmentCount }} 个附件</span
              >
            </div>

            <ProgressCircleButton
              v-if="canDownloadPlugin(pluginData)"
              class="download-plugin-btn"
              title="从官方市场下载安装"
              :active-title="
                getDownloadState(pluginData.pluginName)?.status === 'installing'
                  ? '安装中'
                  : '取消下载'
              "
              :active="!!getDownloadState(pluginData.pluginName)"
              :progress="getDownloadState(pluginData.pluginName)?.progress ?? null"
              :disabled="
                getDownloadState(pluginData.pluginName)?.status === 'installing' ||
                (!!installingPlugin &&
                  installingPlugin !== pluginData.pluginName &&
                  getDownloadState(pluginData.pluginName)?.status !== 'downloading')
              "
              @click.stop="downloadPlugin(pluginData)"
            >
              <div class="i-z-download font-size-16px" />
            </ProgressCircleButton>
            <button class="icon-btn" title="查看文档">
              <div class="i-z-search font-size-18px" />
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 二级页面：文档列表 -->
    <DetailPanel
      v-show="currentLevel === 'docList'"
      :title="currentPluginDetailTitle"
      :class="docListAnimationClass"
      @back="closeDocListModal"
    >
      <div v-if="currentPluginData?.pluginName !== 'ZTOOLS'" class="detail-header-actions">
        <button class="btn btn-danger" @click="handleClearData">
          <div class="i-z-trash font-size-16px" />
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
          <button
            class="icon-btn delete-doc-btn"
            title="删除文档"
            @click.stop="deleteDocContent(docItem)"
          >
            <div class="i-z-trash font-size-16px" />
          </button>
          <button
            class="icon-btn export-doc-btn"
            title="导出文档"
            @click.stop="exportDocContent(docItem)"
          >
            <div class="i-z-download font-size-16px" />
          </button>
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

.page-header-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.page-header-actions .btn {
  display: flex;
  align-items: center;
  gap: 6px;
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
  cursor: pointer;
  transition: all 0.2s;
}

.plugin-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

/* 主程序数据卡片特殊样式 */
.plugin-card.ztools-card .plugin-name {
  color: var(--primary-color);
  font-weight: 600;
}

.plugin-icon-placeholder.ztools-icon {
  background: var(--primary-color);
  color: white;
  opacity: 1;
}

.plugin-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  flex-shrink: 0;
  object-fit: cover;
}

.plugin-icon-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  color: var(--text-secondary);
  opacity: 0.6;
}

.plugin-icon-wrapper {
  position: relative;
  flex-shrink: 0;
  margin-right: 14px;
  width: 40px;
  height: 40px;
}

.plugin-dev-badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: inline-flex;
  min-width: 18px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--bg-color);
  border-radius: 999px;
  background: #389e0d;
  color: var(--text-on-primary);
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
  padding: 2px 4px;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 4px;
}

.plugin-missing-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  border-radius: 999px;
  background: var(--warning-bg, rgba(250, 173, 20, 0.14));
  color: var(--warning-color, #ad6800);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  padding: 0 7px;
  white-space: nowrap;
}

.doc-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.download-plugin-btn {
  flex-shrink: 0;
  margin-right: 8px;
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

.delete-doc-btn,
.export-doc-btn {
  margin-left: 12px;
  transition: all 0.2s;
}

.delete-doc-btn {
  color: var(--danger-color);
}

.delete-doc-btn:hover {
  background: var(--danger-light-bg);
  color: var(--danger-color);
}

.export-doc-btn {
  color: var(--primary-color);
}

.export-doc-btn:hover {
  background: var(--primary-light-bg);
  color: var(--primary-color);
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
  user-select: text;
  cursor: text;
}

.doc-content pre {
  margin: 0;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
</style>
