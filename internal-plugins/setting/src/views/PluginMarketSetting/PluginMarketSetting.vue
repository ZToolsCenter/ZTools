<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useToast } from '@/components'
import type { PluginUninstallOptions } from '@/components'
import { compareVersions, upgradeInstalledPluginFromMarket, weightedSearch } from '@/utils'
import { PluginDetail, PluginCard, CategoryCard, CategoryDetail, RefreshButton } from './components'
import type { Plugin, CategoryInfo, CategoryLayoutSection, PluginDownloadState } from './components'
import { useJumpFunction, useZtoolsSubInput } from '@/composables'
import { PluginMarketSettingJumpFunction } from '@/views/PluginMarketSetting/PluginMarketSetting'
import { getMarketCategoryIcon } from './marketAssets'

const { success, error, confirm } = useToast()

interface BannerItem {
  image: string
  url?: string
  height?: number
}

interface CategorySummary {
  key: string
  title: string
  description?: string
  icon?: string
  showDescription: boolean
  pluginCount: number
}

interface StorefrontSection {
  type: 'banner' | 'navigation' | 'fixed' | 'random'
  key: string
  title?: string
  height?: number
  items?: BannerItem[]
  categories?: CategorySummary[]
  plugins?: Plugin[]
}

interface StorefrontCategoryPayload {
  key: string
  title: string
  description?: string
  icon?: string
  plugins: Array<{ name: string }>
}

interface StorefrontPayload {
  sections: StorefrontSection[]
  categories?: Record<string, StorefrontCategoryPayload>
  categoryLayouts?: Record<string, CategoryLayoutSection[]>
}

interface MarketPlugin extends Omit<Plugin, 'installed'> {}

interface InstalledPlugin {
  name: string
  path: string
  version: string
}

interface PluginMarketResponse {
  success: boolean
  data?: MarketPlugin[]
  storefront?: StorefrontPayload
  error?: string
}

const plugins = ref<Plugin[]>([])
const pluginMap = ref<Map<string, Plugin>>(new Map())
const storefrontSections = ref<StorefrontSection[]>([])
const storefrontCategories = ref<Record<string, CategoryInfo>>({})
const categoryLayouts = ref<Record<string, CategoryLayoutSection[]>>({})
const isLoading = ref(false)
const installingPlugin = ref<string | null>(null)
const downloadStates = ref<Record<string, PluginDownloadState | undefined>>({})
const bannerActiveIndexes = ref<Record<string, number>>({})
let stopDownloadProgressListener: (() => void) | undefined
let bannerTimer: ReturnType<typeof window.setInterval> | undefined

const { value: searchQuery, setSubInput } = useZtoolsSubInput('', '搜索插件市场...')

// 搜索模式：有搜索词时使用扁平搜索
const isSearchMode = computed(() => (searchQuery.value || '').trim().length > 0)

const filteredPlugins = computed(() =>
  weightedSearch(plugins.value, searchQuery.value || '', [
    { value: (p) => p.title || p.name || '', weight: 10 },
    { value: (p) => p.description || '', weight: 5 }
  ])
)

// 是否有 storefront 数据可用
const hasStorefront = computed(() => storefrontSections.value.length > 0)

// 插件详情面板状态
const isDetailVisible = ref(false)
const selectedPlugin = ref<Plugin | null>(null)
const pendingDetailPluginName = ref<string | null>(null)

// 分类详情面板状态
const isCategoryDetailVisible = ref(false)
const selectedCategory = ref<CategoryInfo | null>(null)

// 是否显示主滚动内容（任一覆盖面板打开时隐藏）
const showScrollableContent = computed(
  () => !isDetailVisible.value && !isCategoryDetailVisible.value
)

function openPendingPluginDetail(): void {
  const pluginName = pendingDetailPluginName.value
  if (!pluginName) return

  const plugin = pluginMap.value.get(pluginName)
  if (!plugin) return

  pendingDetailPluginName.value = null
  openPluginDetail(plugin)
}

// 将市场插件数据标记已安装状态
function enrichPlugins(
  marketPlugins: MarketPlugin[],
  installedPlugins: InstalledPlugin[]
): Plugin[] {
  return marketPlugins.map((plugin) => {
    const installedPlugin = installedPlugins.find((item) => item.name === plugin.name)
    return {
      ...plugin,
      installed: !!installedPlugin,
      path: installedPlugin?.path,
      localVersion: installedPlugin?.version
    }
  })
}

async function fetchPlugins(): Promise<void> {
  isLoading.value = true
  try {
    const [marketResult, installedPlugins] = await Promise.all([
      window.ztools.internal.fetchPluginMarket(),
      window.ztools.internal.getPlugins()
    ])

    const typedMarketResult = marketResult as PluginMarketResponse
    const typedInstalledPlugins = installedPlugins as InstalledPlugin[]

    if (typedMarketResult.success && typedMarketResult.data) {
      const marketPlugins = typedMarketResult.data

      // 构建带安装状态的插件扁平列表（用于搜索）
      plugins.value = enrichPlugins(marketPlugins, typedInstalledPlugins)

      // 构建 pluginMap
      const pMap = new Map<string, Plugin>()
      for (const p of plugins.value) {
        if (p.name) pMap.set(p.name, p)
      }
      pluginMap.value = pMap

      // 构建 storefront sections
      storefrontCategories.value = {}
      categoryLayouts.value = {}

      if (typedMarketResult.storefront?.sections) {
        // 处理 categories（从后端返回的完整分类数据）
        if (typedMarketResult.storefront.categories) {
          const cats: Record<string, CategoryInfo> = {}
          for (const [key, cat] of Object.entries(typedMarketResult.storefront.categories)) {
            const categoryPlugins = cat.plugins
              .map((plugin) => pMap.get(plugin.name))
              .filter((plugin): plugin is Plugin => !!plugin)
            cats[key] = {
              key: cat.key,
              title: cat.title,
              description: cat.description,
              icon: cat.icon || getMarketCategoryIcon(cat.key),
              plugins: categoryPlugins
            }
          }
          storefrontCategories.value = cats
        }

        // 处理 categoryLayouts
        if (typedMarketResult.storefront.categoryLayouts) {
          categoryLayouts.value = typedMarketResult.storefront.categoryLayouts
        }

        // 处理 sections：将 fixed/random 中的插件替换为带安装状态的版本
        storefrontSections.value = typedMarketResult.storefront.sections
          .map((section) => {
            if (section.type === 'banner') {
              return section
            }

            if (section.type === 'navigation' && Array.isArray(section.categories)) {
              return {
                ...section,
                categories: section.categories.map((cat) => ({
                  ...cat,
                  icon: cat.icon || getMarketCategoryIcon(cat.key)
                }))
              }
            }

            if (
              (section.type === 'fixed' || section.type === 'random') &&
              Array.isArray(section.plugins)
            ) {
              return {
                ...section,
                plugins: section.plugins
                  .map((p) => pMap.get(p.name))
                  .filter((p): p is Plugin => !!p)
              }
            }
            return section
          })
          .filter((section) =>
            section.type === 'banner'
              ? (section.items?.length ?? 0) > 0
              : section.type === 'navigation'
                ? (section.categories?.length ?? 0) > 0
                : (section.plugins?.length ?? 0) > 0
          )
        resetBannerActiveIndexes()
      } else {
        storefrontSections.value = []
        bannerActiveIndexes.value = {}
      }
    } else {
      console.error('获取插件市场列表失败:', typedMarketResult.error)
    }
    openPendingPluginDetail()
  } catch (error) {
    console.error('获取插件列表出错:', error)
  } finally {
    isLoading.value = false
  }
}

function openPluginDetail(plugin: Plugin): void {
  selectedPlugin.value = plugin
  isDetailVisible.value = true
}

function closePluginDetail(): void {
  isDetailVisible.value = false
  selectedPlugin.value = null
}

function openCategoryDetail(categorySummary: CategorySummary): void {
  const category = storefrontCategories.value[categorySummary.key]
  if (category) {
    selectedCategory.value = category
    isCategoryDetailVisible.value = true
  }
}

function closeCategoryDetail(): void {
  isCategoryDetailVisible.value = false
  selectedCategory.value = null
}

async function handleOpenPlugin(plugin: Plugin): Promise<void> {
  if (!plugin.path) {
    error('无法打开插件: 路径未知')
    return
  }
  try {
    const result = await window.ztools.internal.launch({
      path: plugin.path,
      type: 'plugin',
      name: plugin.title || plugin.name,
      param: {}
    })

    if (result && !result.success) {
      error(`无法打开插件: ${result.error || '未知错误'}`)
    }
  } catch (err: unknown) {
    console.error('打开插件失败:', err)
    error(`打开插件失败: ${err instanceof Error ? err.message : '未知错误'}`)
  }
}

/**
 * 在系统文件管理器中显示已安装插件的位置。
 * @param plugin 要显示目录的插件信息
 * @returns 完成文件管理器调用后结束的 Promise
 */
async function handleOpenFolder(plugin: Plugin): Promise<void> {
  // 市场详情也可能展示尚未安装的插件，先阻止无效路径调用。
  if (!plugin.path) {
    error('无法打开插件目录: 路径未知')
    return
  }

  try {
    // 交由主进程按当前平台打开并选中插件文件。
    await window.ztools.internal.revealInFinder(plugin.path)
  } catch (err: unknown) {
    console.error('打开插件目录失败:', err)
    error(`打开插件目录失败: ${err instanceof Error ? err.message : '未知错误'}`)
  }
}

function canUpgrade(plugin: Plugin): boolean {
  if (!plugin.installed || !plugin.localVersion || !plugin.version) return false
  return compareVersions(plugin.localVersion, plugin.version) < 0
}

async function handleUpgradePlugin(plugin: Plugin): Promise<void> {
  if (installingPlugin.value) return
  if (!plugin.path) {
    error('无法升级：找不到插件路径')
    return
  }

  const confirmUpgrade = await confirm({
    title: '升级插件',
    message: `发现新版本 ${plugin.version}，当前版本 ${plugin.localVersion}，是否升级？\n\n升级将先卸载旧版本。`,
    type: 'warning',
    confirmText: '升级',
    cancelText: '取消'
  })
  if (!confirmUpgrade) return

  installingPlugin.value = plugin.name
  try {
    const upgradeResult = await upgradeInstalledPluginFromMarket(
      { name: plugin.name, path: plugin.path },
      plugin
    )
    if (upgradeResult.success) {
      plugin.installed = true
      plugin.localVersion = plugin.version
      if (upgradeResult.plugin && upgradeResult.plugin.path) {
        plugin.path = upgradeResult.plugin.path
      }
      await fetchPlugins()
    } else {
      throw new Error(upgradeResult.error || '升级失败')
    }
  } catch (err: unknown) {
    console.error('升级出错:', err)
    error(`升级出错: ${err instanceof Error ? err.message : '未知错误'}`)
    await fetchPlugins()
  } finally {
    installingPlugin.value = null
  }
}

function setDownloadState(pluginName: string, state: PluginDownloadState): void {
  downloadStates.value = {
    ...downloadStates.value,
    [pluginName]: state
  }
}

function clearDownloadState(pluginName: string, taskId?: string): void {
  const currentState = downloadStates.value[pluginName]
  if (taskId && currentState?.taskId && currentState.taskId !== taskId) return

  const nextStates = { ...downloadStates.value }
  delete nextStates[pluginName]
  downloadStates.value = nextStates
}

function handleDownloadProgress(payload: PluginDownloadState & { pluginName: string }): void {
  if (!payload.pluginName) return

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
    window.setTimeout(() => clearDownloadState(payload.pluginName, payload.taskId), 300)
  }
}

async function downloadPlugin(plugin: Plugin): Promise<void> {
  const currentState = downloadStates.value[plugin.name]
  if (currentState?.status === 'downloading') {
    const cancelResult = await window.ztools.internal.cancelPluginMarketDownload(
      currentState.taskId || plugin.name
    )
    if (!cancelResult.success) {
      error(`取消下载失败: ${cancelResult.error || '未知错误'}`)
    }
    return
  }

  if (installingPlugin.value) return

  installingPlugin.value = plugin.name
  setDownloadState(plugin.name, {
    status: 'downloading',
    progress: null
  })

  try {
    const result = await window.ztools.internal.installPluginFromMarket(
      JSON.parse(JSON.stringify(plugin))
    )
    if (result.success) {
      plugin.installed = true
      plugin.localVersion = plugin.version
      if (result.plugin && result.plugin.path) {
        plugin.path = result.plugin.path
      }
    } else if (result.cancelled) {
      clearDownloadState(plugin.name)
    } else {
      console.error('插件安装失败:', result.error)
      error(`安装失败: ${result.error}`)
    }
  } catch (err: unknown) {
    console.error('安装出错:', err)
    error(`安装出错: ${err instanceof Error ? err.message : '未知错误'}`)
  } finally {
    installingPlugin.value = null
    clearDownloadState(plugin.name)
  }
}

async function handleUninstallPlugin(
  plugin: Plugin,
  options: PluginUninstallOptions
): Promise<void> {
  if (!plugin.path) {
    error('无法卸载：找不到插件路径')
    return
  }

  try {
    const deleteResult = await window.ztools.internal.deletePlugin(plugin.path, options)
    if (!deleteResult.success) {
      error(`卸载失败: ${deleteResult.error}`)
      return
    }

    success(options.deleteData ? '插件已卸载，插件数据已删除' : '插件已卸载，插件数据已保留')

    plugin.installed = false
    plugin.localVersion = undefined
    plugin.path = undefined

    closePluginDetail()
    await fetchPlugins()
  } catch (err: unknown) {
    console.error('卸载出错:', err)
    error(`卸载出错: ${err instanceof Error ? err.message : '未知错误'}`)
  }
}

function handleBannerClick(item: BannerItem): void {
  if (!item.url) return
  void window.ztools.hideMainWindow(false)
  window.ztools.shellOpenExternal(item.url)
}

function getBannerActiveIndex(section: StorefrontSection): number {
  return bannerActiveIndexes.value[section.key] || 0
}

function setBannerActiveIndex(section: StorefrontSection, index: number): void {
  const count = section.items?.length || 0
  if (count <= 0) return
  bannerActiveIndexes.value = {
    ...bannerActiveIndexes.value,
    [section.key]: ((index % count) + count) % count
  }
}

function resetBannerActiveIndexes(): void {
  const nextIndexes: Record<string, number> = {}
  for (const section of storefrontSections.value) {
    if (section.type === 'banner' && (section.items?.length || 0) > 0) {
      const current = bannerActiveIndexes.value[section.key] || 0
      nextIndexes[section.key] = Math.min(current, (section.items?.length || 1) - 1)
    }
  }
  bannerActiveIndexes.value = nextIndexes
}

function rotateBanners(): void {
  for (const section of storefrontSections.value) {
    if (section.type !== 'banner' || (section.items?.length || 0) <= 1) continue
    setBannerActiveIndex(section, getBannerActiveIndex(section) + 1)
  }
}

async function shuffleRandomSection(section: StorefrontSection): Promise<void> {
  if (section.type !== 'random' || !section.plugins) return
  try {
    const [recommendations, installedPlugins] = await Promise.all([
      window.ztools.internal.fetchPluginMarketRecommendations(section.plugins.length || 12),
      window.ztools.internal.getPlugins()
    ])
    const enriched = enrichPlugins(
      recommendations as MarketPlugin[],
      installedPlugins as InstalledPlugin[]
    )
    if (enriched.length > 0) {
      section.plugins = enriched
      for (const plugin of enriched) {
        if (plugin.name) {
          pluginMap.value.set(plugin.name, plugin)
        }
      }
    }
  } catch (err) {
    console.error('获取推荐插件失败:', err)
    error(`获取推荐插件失败: ${err instanceof Error ? err.message : '未知错误'}`)
  }
}

// 处理 ESC 按键 - 逐级返回
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (isDetailVisible.value) {
      e.stopPropagation()
      closePluginDetail()
    } else if (isCategoryDetailVisible.value) {
      e.stopPropagation()
      closeCategoryDetail()
    }
  }
}

// 获取分类的布局配置
function getCategoryLayout(categoryKey: string): CategoryLayoutSection[] {
  return categoryLayouts.value[categoryKey] || categoryLayouts.value['default'] || []
}

useJumpFunction<PluginMarketSettingJumpFunction>((state) => {
  if (state.payload && state.type === 'over') {
    setSubInput(state.payload)
  } else if (state.payload && state.type === 'detail') {
    pendingDetailPluginName.value = state.payload
    openPendingPluginDetail()
  }
})

onMounted(() => {
  fetchPlugins()
  bannerTimer = window.setInterval(rotateBanners, 5000)
  stopDownloadProgressListener =
    window.ztools.internal.onPluginMarketDownloadProgress(handleDownloadProgress)
  window.addEventListener('keydown', handleKeydown, true)
})

onUnmounted(() => {
  if (bannerTimer) {
    window.clearInterval(bannerTimer)
  }
  stopDownloadProgressListener?.()
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>
<template>
  <div class="plugin-market">
    <!-- 可滚动内容区 -->
    <Transition name="list-slide">
      <div v-show="showScrollableContent" class="scrollable-content">
        <div v-if="isLoading" class="loading-state">
          <div class="loading-spinner"></div>
          <span>加载中...</span>
        </div>

        <!-- 搜索模式：扁平网格 -->
        <template v-else-if="isSearchMode">
          <div v-if="filteredPlugins.length === 0" class="empty-state">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
              <path
                d="M16 16L20 20"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
            <span>未找到匹配的插件</span>
          </div>
          <div v-else class="market-grid">
            <PluginCard
              v-for="plugin in filteredPlugins"
              :key="plugin.name"
              :plugin="plugin"
              :installing-plugin="installingPlugin"
              :download-state="downloadStates[plugin.name]"
              :can-upgrade="canUpgrade(plugin)"
              @click="openPluginDetail(plugin)"
              @open="handleOpenPlugin(plugin)"
              @download="downloadPlugin(plugin)"
              @upgrade="handleUpgradePlugin(plugin)"
            />
          </div>
        </template>

        <!-- 首页模式：storefront 布局 -->
        <template v-else-if="hasStorefront">
          <div class="storefront">
            <template v-for="section in storefrontSections" :key="section.key">
              <!-- Banner 区块 -->
              <div v-if="section.type === 'banner'" class="storefront-banner">
                <div v-if="(section.items?.length || 0) > 0" class="banner-stage">
                  <button
                    v-for="(item, idx) in section.items"
                    :key="`${section.key}-${idx}-${item.image}`"
                    class="banner-item"
                    :class="{
                      active: idx === getBannerActiveIndex(section),
                      clickable: !!item.url
                    }"
                    type="button"
                    :aria-hidden="idx !== getBannerActiveIndex(section)"
                    :tabindex="idx === getBannerActiveIndex(section) ? 0 : -1"
                    @click="handleBannerClick(item)"
                  >
                    <img :src="item.image" alt="" class="banner-image" draggable="false" />
                  </button>
                </div>
                <div v-if="(section.items?.length || 0) > 1" class="banner-dots">
                  <button
                    v-for="(_, idx) in section.items"
                    :key="idx"
                    class="banner-dot"
                    :class="{ active: idx === getBannerActiveIndex(section) }"
                    type="button"
                    :aria-label="`切换到第 ${idx + 1} 张 Banner`"
                    @click.stop="setBannerActiveIndex(section, idx)"
                  />
                </div>
              </div>

              <!-- 分类导航区块 -->
              <div v-else-if="section.type === 'navigation'" class="storefront-section">
                <div v-if="section.title" class="section-header">
                  <span class="storefront-title">{{ section.title }}</span>
                </div>
                <div class="navigation-grid">
                  <CategoryCard
                    v-for="cat in section.categories"
                    :key="cat.key"
                    :title="cat.title"
                    :description="cat.description"
                    :icon="cat.icon"
                    :show-description="cat.showDescription"
                    :plugin-count="cat.pluginCount"
                    @click="openCategoryDetail(cat)"
                  />
                </div>
              </div>

              <!-- Fixed / Random 区块 -->
              <div
                v-else-if="section.type === 'fixed' || section.type === 'random'"
                class="storefront-section"
              >
                <div v-if="section.title || section.type === 'random'" class="section-header">
                  <span v-if="section.title" class="storefront-title">{{ section.title }}</span>
                  <RefreshButton
                    v-if="section.type === 'random'"
                    @click="shuffleRandomSection(section)"
                  />
                </div>
                <div class="market-grid">
                  <PluginCard
                    v-for="plugin in section.plugins"
                    :key="plugin.name"
                    :plugin="plugin"
                    :installing-plugin="installingPlugin"
                    :download-state="downloadStates[plugin.name]"
                    :can-upgrade="canUpgrade(plugin)"
                    @click="openPluginDetail(plugin)"
                    @open="handleOpenPlugin(plugin)"
                    @download="downloadPlugin(plugin)"
                    @upgrade="handleUpgradePlugin(plugin)"
                  />
                </div>
              </div>
            </template>
          </div>
        </template>

        <!-- 降级模式：无 storefront 时平铺展示 -->
        <template v-else>
          <div v-if="plugins.length === 0" class="empty-state">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
              <path
                d="M16 16L20 20"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
            <span>暂无插件</span>
          </div>
          <div v-else class="market-grid">
            <PluginCard
              v-for="plugin in plugins"
              :key="plugin.name"
              :plugin="plugin"
              :installing-plugin="installingPlugin"
              :download-state="downloadStates[plugin.name]"
              :can-upgrade="canUpgrade(plugin)"
              @click="openPluginDetail(plugin)"
              @open="handleOpenPlugin(plugin)"
              @download="downloadPlugin(plugin)"
              @upgrade="handleUpgradePlugin(plugin)"
            />
          </div>
        </template>
      </div>
    </Transition>

    <!-- 分类详情覆盖面板 -->
    <Transition name="slide">
      <div
        v-if="isCategoryDetailVisible && selectedCategory"
        class="category-panel-container"
        :class="{ 'shifted-left': isDetailVisible }"
      >
        <CategoryDetail
          :category="selectedCategory"
          :layout="getCategoryLayout(selectedCategory.key)"
          :installing-plugin="installingPlugin"
          :download-states="downloadStates"
          :plugin-map="pluginMap"
          :can-upgrade="canUpgrade"
          @back="closeCategoryDetail"
          @click-plugin="openPluginDetail"
          @open-plugin="handleOpenPlugin"
          @download-plugin="downloadPlugin"
          @upgrade-plugin="handleUpgradePlugin"
        />
      </div>
    </Transition>

    <!-- 插件详情覆盖面板组件 -->
    <Transition name="slide">
      <PluginDetail
        v-if="isDetailVisible && selectedPlugin"
        :plugin="selectedPlugin"
        :is-loading="installingPlugin === selectedPlugin.name"
        :download-state="downloadStates[selectedPlugin.name]"
        @back="closePluginDetail"
        @open="handleOpenPlugin(selectedPlugin)"
        @open-folder="handleOpenFolder(selectedPlugin)"
        @download="downloadPlugin(selectedPlugin)"
        @upgrade="handleUpgradePlugin(selectedPlugin)"
        @uninstall="handleUninstallPlugin(selectedPlugin, $event)"
      />
    </Transition>
  </div>
</template>

<style scoped>
.plugin-market {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 可滚动内容区 */
.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
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

/* Storefront 布局 */
.storefront {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Banner */
.storefront-banner {
  position: relative;
}

.banner-stage {
  position: relative;
  aspect-ratio: 3.3 / 1;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-secondary);
}

.banner-item {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  opacity: 0;
  padding: 0;
  pointer-events: none;
  transform: scale(1.015);
  transition:
    opacity 0.55s ease,
    transform 0.75s ease;
}

.banner-item.active {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1);
}

.banner-item.clickable {
  cursor: pointer;
}
.banner-item.clickable:hover {
  filter: brightness(0.96);
}
.banner-image {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 12px;
  object-fit: cover;
}

.banner-dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 10px;
  display: flex;
  justify-content: center;
  gap: 6px;
  pointer-events: none;
}

.banner-dot {
  width: 7px;
  height: 7px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  padding: 0;
  pointer-events: auto;
  transition:
    background 0.2s,
    transform 0.2s,
    width 0.2s;
}

.banner-dot.active {
  width: 18px;
  background: rgba(255, 255, 255, 0.92);
}

/* Section 通用 */
.storefront-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.storefront-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

/* 分类详情容器（支持左移动画） */
.category-panel-container {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: var(--bg-color);
  transition: transform 0.2s ease-out;
}

.category-panel-container.shifted-left {
  transform: translateX(-100%);
}

/* 分类导航网格 */
.navigation-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

/* 插件网格 */
.market-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: 12px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--divider-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-state span {
  font-size: 13px;
  color: var(--text-color-secondary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: 12px;
  color: var(--text-secondary);
}

.empty-state svg {
  opacity: 0.4;
}

.empty-state span {
  font-size: 13px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
