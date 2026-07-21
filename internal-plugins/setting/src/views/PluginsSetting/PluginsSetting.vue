<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useToast, AdaptiveIcon } from '@/components'
import type { PluginUninstallOptions } from '@/components'
import { PluginDetail, NpmInstallPanel } from './components'
import { compareVersions, upgradeInstalledPluginFromMarket, weightedSearch } from '@/utils'
import { useJumpFunction, useZtoolsSubInput } from '@/composables'
import { jumpFunctionPluginMarketSetting } from '@/views/PluginMarketSetting/PluginMarketSetting'
import { useRouter } from 'vue-router'

// const emit = defineEmits<{
//   (e: 'add-dev-consumed'): void
// }>()

const { success, error, warning, info, confirm } = useToast()

// 插件相关状态
const plugins = ref<any[]>([])
const disabledPluginPaths = ref<string[]>([])
const runningPlugins = ref<string[]>([])
const isLoading = ref(true)
const isImporting = ref(false)
const isImportingNpm = ref(false)
const isDeleting = ref(false)
const isKilling = ref(false)
const isKillingAll = ref(false)
const isExportingAll = ref(false)
const isCheckingMarketUpdates = ref(false)
// 是否正在执行“全部更新”
const isUpgradingAll = ref(false)
// “全部更新”当前完成数（用于进度展示）
const upgradeProgressDone = ref(0)
// “全部更新”总任务数（用于进度展示）
const upgradeProgressTotal = ref(0)

// npm 安装相关状态
const showNpmPanel = ref(false)
const showMoreMenu = ref(false)

// 详情弹窗状态
const isDetailVisible = ref(false)
const selectedPlugin = ref<any | null>(null)
const npmInstallPanelRef = ref<InstanceType<typeof NpmInstallPanel>>()

// 过滤状态
const filterStatus = ref<'all' | 'running'>('all')

// 置顶列表（插件 path 有序数组，持久化到 db）
const PINNED_PLUGINS_KEY = 'plugin-center-pinned'
const pinnedPluginPaths = ref<string[]>([])

// 路由
const router = useRouter()

const { value: searchQuery } = useZtoolsSubInput('', '搜索已安装插件...')
// 先进行搜索过滤（不考虑运行状态）
const searchFilteredPlugins = computed(() => {
  return weightedSearch(plugins.value, searchQuery.value || '', [
    { value: (p) => p.title || p.name || '', weight: 10 },
    { value: (p) => p.description || '', weight: 5 }
  ])
})

// 全部插件数量（经过搜索过滤）
const allPluginsCount = computed(() => searchFilteredPlugins.value.length)

// 运行中插件列表（经过搜索过滤）
const runningFilteredPlugins = computed(() => {
  return searchFilteredPlugins.value.filter((p) => isPluginRunning(p.path))
})

// 运行中插件数量（经过搜索过滤）
const runningPluginsCount = computed(() => {
  return runningFilteredPlugins.value.length
})

// 可升级插件（以已安装插件与插件市场版本比对）
const upgradablePlugins = computed(() => {
  return plugins.value.filter((p) => p.hasUpdate && p.marketPlugin)
})

// 可升级插件数量（用于菜单显示与批量更新）
const upgradablePluginsCount = computed(() => upgradablePlugins.value.length)

// 最终显示的插件列表（根据状态过滤，置顶的排在最前）
const filteredPlugins = computed(() => {
  let list =
    filterStatus.value === 'running'
      ? searchFilteredPlugins.value.filter((p) => isPluginRunning(p.path))
      : searchFilteredPlugins.value
  const pinnedOrder = pinnedPluginPaths.value
  if (pinnedOrder.length === 0) return list
  const pinnedSet = new Set(pinnedOrder)
  const pinnedItems = pinnedOrder
    .map((path) => list.find((p) => p.path === path))
    .filter(Boolean) as typeof list
  const unpinnedItems = list.filter((p) => !pinnedSet.has(p.path))
  return [...pinnedItems, ...unpinnedItems]
})

function isPluginPinned(pluginPath: string): boolean {
  return pinnedPluginPaths.value.includes(pluginPath)
}

function isPluginDisabled(pluginPath: string): boolean {
  return disabledPluginPaths.value.includes(pluginPath)
}

async function togglePin(plugin: any): Promise<void> {
  const path = plugin.path
  const idx = pinnedPluginPaths.value.indexOf(path)
  if (idx >= 0) {
    pinnedPluginPaths.value = pinnedPluginPaths.value.filter((p) => p !== path)
  } else {
    pinnedPluginPaths.value = [path, ...pinnedPluginPaths.value]
  }
  try {
    // 将 Vue 响应式数组转换为普通数组，避免 IPC 克隆错误
    const plainArray = [...pinnedPluginPaths.value]
    await window.ztools.internal.dbPut(PINNED_PLUGINS_KEY, plainArray)
  } catch (e) {
    console.error('保存置顶列表失败:', e)
  }
}

// 加载插件列表
async function loadPlugins(): Promise<void> {
  isLoading.value = true
  try {
    const [installedPlugins, disabledPlugins] = await Promise.all([
      window.ztools.internal.getPlugins(),
      window.ztools.internal.getDisabledPlugins()
    ])
    disabledPluginPaths.value = disabledPlugins
    plugins.value = buildPluginList(installedPlugins)
    await loadRunningPlugins()
  } catch (err) {
    console.error('加载插件列表失败:', err)
  } finally {
    isLoading.value = false
  }

  // 异步获取市场数据，补充更新信息（不阻塞列表展示）
  void checkMarketUpdates()
}

// 将已安装插件列表按安装时间排序并设置初始字段
function buildPluginList(installedPlugins: any[], marketPluginMap?: Map<string, any>): any[] {
  return installedPlugins
    .map((plugin: any) => {
      const market = marketPluginMap?.get(plugin.name)
      return {
        ...plugin,
        installed: true,
        localVersion: plugin.version,
        latestVersion: market?.version,
        marketPlugin: market,
        hasUpdate: !!market?.version && compareVersions(plugin.version, market.version) < 0
      }
    })
    .sort((a: any, b: any) => {
      const timeA = a.installedAt ? new Date(a.installedAt).getTime() : 0
      const timeB = b.installedAt ? new Date(b.installedAt).getTime() : 0
      return timeB - timeA
    })
}

// 市场更新检查序列号，防止并发请求导致过时数据覆盖
let marketCheckSeq = 0

// 异步检查市场更新，补充 hasUpdate / marketPlugin 等字段
async function checkMarketUpdates(): Promise<void> {
  const seq = ++marketCheckSeq
  isCheckingMarketUpdates.value = true
  try {
    const marketResult = await window.ztools.internal.fetchPluginMarket()
    if (seq !== marketCheckSeq) return // 已被新调用取代，丢弃结果
    if (!marketResult.success || !Array.isArray(marketResult.data)) return

    const currentPlatform = window.ztools.internal.getPlatform()
    const marketPluginMap = new Map<string, any>()
    for (const marketPlugin of marketResult.data) {
      if (!marketPlugin?.name) continue
      if (
        Array.isArray(marketPlugin.platform) &&
        !marketPlugin.platform.includes(currentPlatform)
      ) {
        continue
      }
      marketPluginMap.set(marketPlugin.name, marketPlugin)
    }

    // 用市场信息重新构建列表（剥离旧的市场字段后重新赋值）
    plugins.value = buildPluginList(
      plugins.value.map((p: any) => {
        const { latestVersion: _lv, marketPlugin: _mp, hasUpdate: _hu, ...rest } = p
        return rest
      }),
      marketPluginMap
    )
    if (selectedPlugin.value) {
      const updated = plugins.value.find((p: any) => p.path === selectedPlugin.value?.path)
      if (updated) {
        selectedPlugin.value = updated
      }
    }
  } catch (err) {
    console.error('检查市场更新失败:', err)
  } finally {
    if (seq === marketCheckSeq) {
      isCheckingMarketUpdates.value = false
    }
  }
}

// 将单个已安装插件升级到市场最新版本（复用公共升级逻辑）
async function upgradePluginToLatest(plugin: any): Promise<{ success: boolean; error?: string }> {
  return upgradeInstalledPluginFromMarket(
    { name: plugin.name, path: plugin.path },
    plugin.marketPlugin
  )
}

/**
 * 批量升级可更新插件
 * 逐个更新并实时反馈进度，完成后统一刷新列表与提示结果
 */
async function handleUpgradeAllPlugins(): Promise<void> {
  const targets = upgradablePlugins.value
  if (isUpgradingAll.value || targets.length === 0) return

  const confirmed = await confirm({
    title: '全部更新插件',
    message: `检测到 ${targets.length} 个可更新插件，是否立即全部更新？`,
    type: 'warning',
    confirmText: '全部更新',
    cancelText: '取消'
  })
  if (!confirmed) return

  isUpgradingAll.value = true
  upgradeProgressDone.value = 0
  upgradeProgressTotal.value = targets.length
  showMoreMenu.value = false

  let successCount = 0
  let failCount = 0
  const failedNames: string[] = []

  try {
    console.log('开始批量更新插件:', {
      total: targets.length,
      names: targets.map((p) => p.name)
    })
    for (let i = 0; i < targets.length; i++) {
      const plugin = targets[i]
      const displayName = plugin.title || plugin.name
      console.log(`批量更新进度 ${i + 1}/${targets.length}:`, displayName)
      info(`正在更新 ${i + 1}/${targets.length}: ${displayName}`, 1400)

      const result = await upgradePluginToLatest(plugin)
      if (result.success) {
        successCount++
      } else {
        failCount++
        failedNames.push(displayName)
        console.error(`[批量更新] 更新失败: ${displayName}`, result.error)
      }
      upgradeProgressDone.value = i + 1
    }

    await loadPlugins()

    if (failCount === 0) {
      console.log('批量更新完成，全部成功:', successCount)
      success(`全部更新完成（共 ${successCount} 个）`)
    } else if (successCount === 0) {
      console.warn('批量更新完成，全部失败:', failCount)
      error(`全部更新失败（共 ${failCount} 个）`)
    } else {
      console.warn('批量更新完成，部分失败:', { successCount, failCount })
      warning(`部分更新失败：成功 ${successCount} 个，失败 ${failCount} 个`)
      console.warn('[批量更新] 失败插件:', failedNames.join(', '))
    }
  } catch (err: any) {
    console.error('批量更新插件失败:', err)
    error(`批量更新失败: ${err.message || '未知错误'}`)
  } finally {
    isUpgradingAll.value = false
    upgradeProgressDone.value = 0
    upgradeProgressTotal.value = 0
  }
}

// 加载运行中的插件
async function loadRunningPlugins(): Promise<void> {
  try {
    const result = await window.ztools.internal.getRunningPlugins()
    runningPlugins.value = result
  } catch (error) {
    console.error('加载运行中插件失败:', error)
  }
}

// 检查插件是否运行中
function isPluginRunning(pluginPath: string): boolean {
  return runningPlugins.value.includes(pluginPath)
}

// 导入本地插件（选择文件后跳转到预览页面）
async function importPlugin(): Promise<void> {
  if (isImporting.value) return

  isImporting.value = true
  try {
    // 仅选择文件，不直接安装
    const result = await window.ztools.internal.selectPluginFile()
    if (result.success && result.filePath) {
      void router.replace({
        name: 'PluginInstaller',
        query: { _t: Date.now() },
        state: { installFilePath: result.filePath }
      })
    } else if (result.error && result.error !== '未选择文件') {
      error(`选择插件文件失败: ${result.error}`)
    }
  } catch (err: any) {
    console.error('选择插件文件失败:', err)
    error(`选择插件文件失败: ${err.message || '未知错误'}`)
  } finally {
    isImporting.value = false
  }
}

// 从详情页面卸载插件（确认弹窗在 PluginDetail 中已展示，此处直接执行删除）
async function handleUninstallFromDetail(
  plugin: any,
  options: PluginUninstallOptions
): Promise<void> {
  if (isDeleting.value) return

  isDeleting.value = true
  try {
    const result = await window.ztools.internal.deletePlugin(plugin.path, options)
    if (result.success) {
      success(options.deleteData ? '插件已卸载，插件数据已删除' : '插件已卸载，插件数据已保留')
      // 关闭详情面板
      closePluginDetail()
      // 重新加载插件列表
      await loadPlugins()
    } else {
      error(`插件卸载失败: ${result.error}`)
    }
  } catch (err: any) {
    console.error('卸载插件失败:', err)
    error(`卸载插件失败: ${err.message || '未知错误'}`)
  } finally {
    isDeleting.value = false
  }
}

// 终止插件
async function handleKillPlugin(plugin: any): Promise<void> {
  if (isKilling.value) return

  isKilling.value = true
  try {
    const result = await window.ztools.internal.killPlugin(plugin.path)
    if (result.success) {
      // 重新加载运行状态
      await loadRunningPlugins()
    } else {
      error(`终止插件失败: ${result.error}`)
    }
  } catch (err: any) {
    console.error('终止插件失败:', err)
    error(`终止插件失败: ${err.message || '未知错误'}`)
  } finally {
    isKilling.value = false
  }
}

// 停止所有插件
async function handleKillAllPlugins(): Promise<void> {
  const pluginsToKill = runningFilteredPlugins.value
  if (isKillingAll.value || pluginsToKill.length === 0) return

  // 确认停止
  const confirmed = await confirm({
    title: '停止所有插件',
    message: `确定要停止所有运行中的插件吗？\n\n共有 ${pluginsToKill.length} 个插件正在运行。`,
    type: 'warning',
    confirmText: '停止',
    cancelText: '取消'
  })
  if (!confirmed) return

  isKillingAll.value = true
  try {
    // 获取要停止的插件路径列表
    const pluginPaths = pluginsToKill.map((p) => p.path)
    let successCount = 0
    let failCount = 0

    // 逐个停止插件
    for (const pluginPath of pluginPaths) {
      try {
        const result = await window.ztools.internal.killPlugin(pluginPath)
        if (result.success) {
          successCount++
        } else {
          failCount++
          console.error(`停止插件失败: ${pluginPath}`, result.error)
        }
      } catch (err) {
        failCount++
        console.error(`停止插件异常: ${pluginPath}`, err)
      }
    }

    // 重新加载运行状态
    await loadRunningPlugins()

    // 关闭更多菜单
    showMoreMenu.value = false

    // 显示结果
    if (failCount === 0) {
      success(`已停止所有插件（共 ${successCount} 个）`)
    } else if (successCount === 0) {
      error(`停止失败（共 ${failCount} 个）`)
    } else {
      error(`部分停止失败：成功 ${successCount} 个，失败 ${failCount} 个`)
    }
  } catch (err: any) {
    console.error('停止所有插件失败:', err)
    error(`停止所有插件失败: ${err.message || '未知错误'}`)
  } finally {
    isKillingAll.value = false
  }
}

// 打开插件
async function handleOpenPlugin(plugin: any): Promise<void> {
  if (isPluginDisabled(plugin.path)) {
    warning('插件已禁用，请先在设置中启用')
    return
  }

  try {
    const result = await window.ztools.internal.launch({
      path: plugin.path,
      type: 'plugin',
      name: plugin.title || plugin.name, // 传递插件名称
      param: {}
    })

    // 检查返回结果
    if (result && !result.success) {
      error(`无法打开插件: ${result.error || '未知错误'}`)
    }
  } catch (err: any) {
    console.error('打开插件失败:', err)
    error(`打开插件失败: ${err.message || '未知错误'}`)
  }
}

// 打开插件目录
async function handleOpenFolder(plugin: any): Promise<void> {
  try {
    await window.ztools.internal.revealInFinder(plugin.path)
  } catch (err: any) {
    console.error('打开目录失败:', err)
    error(`打开目录失败: ${err.message || '未知错误'}`)
  }
}

function handleOpenMarketDetail(plugin: any): void {
  jumpFunctionPluginMarketSetting({
    type: 'detail',
    payload: plugin.name
  })
}

async function handleTogglePluginDisabled(plugin: any, disabled: boolean): Promise<void> {
  try {
    const result = await window.ztools.internal.setPluginDisabled(plugin.path, disabled)
    if (!result.success) {
      error(`更新插件状态失败: ${result.error || '未知错误'}`)
      return
    }

    await loadPlugins()
    const updated = plugins.value.find((p) => p.path === plugin.path)
    if (updated && selectedPlugin.value?.path === plugin.path) {
      selectedPlugin.value = updated
    }

    success(disabled ? '插件已禁用' : '插件已启用')
  } catch (err: any) {
    console.error('更新插件禁用状态失败:', err)
    error(`更新插件状态失败: ${err.message || '未知错误'}`)
  }
}

// 导出全部插件到下载目录
async function handleExportAllPlugins(): Promise<void> {
  if (isExportingAll.value) return

  const confirmed = await confirm({
    title: '导出全部插件',
    message: '将导出全部已安装插件（不含开发中插件），是否继续？',
    type: 'info',
    confirmText: '导出',
    cancelText: '取消'
  })
  if (!confirmed) return

  isExportingAll.value = true
  showMoreMenu.value = false

  try {
    const result = await window.ztools.internal.exportAllPlugins()
    if (result.success) {
      success(`导出成功，共 ${result.count} 个插件`)
    } else {
      error(`导出失败: ${result.error}`)
    }
  } catch (err: any) {
    console.error('导出插件失败:', err)
    error(`导出失败: ${err.message || '未知错误'}`)
  } finally {
    isExportingAll.value = false
  }
}

// 处理 ESC 按键
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (showNpmPanel.value) {
      e.stopPropagation()
      closeNpmPanel()
    } else if (showMoreMenu.value) {
      e.stopPropagation()
      showMoreMenu.value = false
    } else if (isDetailVisible.value) {
      e.stopPropagation()
      closePluginDetail()
    }
  }
}

// 处理点击外部关闭更多菜单
function handleClickOutside(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (!target.closest('.more-menu-wrapper')) {
    showMoreMenu.value = false
  }
}

// 初始化时加载插件列表
onMounted(async () => {
  try {
    const data = await window.ztools.internal.dbGet(PINNED_PLUGINS_KEY)
    pinnedPluginPaths.value = Array.isArray(data) ? data : []
  } catch (e) {
    console.error('加载置顶列表失败:', e)
  }
  await loadPlugins()
  // 如果有需要自动打开的插件，加载完成后打开详情
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener('click', handleClickOutside)
})

// 处理对应 ztools code 进来的功能
useJumpFunction((state) => {
  void loadRunningPlugins()
  if (state.payload) {
    void openPluginByPayload(state.payload)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('click', handleClickOutside)
})

// 打开指定插件名称的详情
async function openPluginByPayload(payload: string): Promise<void> {
  if (!payload) return

  // 如果插件列表还没加载完，等待加载完成
  if (plugins.value.length === 0 && isLoading.value) {
    await new Promise<void>((resolve) => {
      const unwatch = watch(isLoading, (loading) => {
        if (!loading) {
          unwatch()
          resolve()
        }
      })
    })
  }

  const pluginName = payload

  const plugin = plugins.value.find((candidate) => candidate.name === pluginName)
  if (plugin) {
    openPluginDetail(plugin)
  }
}

// 打开插件详情
function openPluginDetail(plugin: any): void {
  selectedPlugin.value = plugin
  isDetailVisible.value = true
}

// 关闭插件详情
function closePluginDetail(): void {
  isDetailVisible.value = false
  selectedPlugin.value = null
}

// 显示 npm 安装面板
function showNpmInstallPanel(): void {
  showNpmPanel.value = true
  isDetailVisible.value = true
  showMoreMenu.value = false
}

// 关闭 npm 安装面板
function closeNpmPanel(): void {
  if (isImportingNpm.value) return
  showNpmPanel.value = false
  isDetailVisible.value = false
  npmInstallPanelRef.value?.resetForm()
}

// 切换更多菜单
function toggleMoreMenu(): void {
  showMoreMenu.value = !showMoreMenu.value
}

// 关闭更多菜单
function closeMoreMenu(event?: Event): void {
  // 如果点击的是菜单项，不阻止事件
  if (event && (event.target as HTMLElement).closest('.more-menu-item')) {
    return
  }
  showMoreMenu.value = false
}

// 从 npm 安装插件
async function handleInstallFromNpm(data: {
  packageName: string
  useChinaMirror: boolean
}): Promise<void> {
  if (isImportingNpm.value) return

  isImportingNpm.value = true
  try {
    const result = await window.ztools.internal.installPluginFromNpm({
      packageName: data.packageName,
      useChinaMirror: data.useChinaMirror
    })
    if (result.success) {
      // 先设置加载状态为 false，这样 closeNpmPanel 才能正常关闭
      isImportingNpm.value = false
      // 重新加载插件列表
      await loadPlugins()
      // 关闭面板
      closeNpmPanel()
      // 显示成功提示
      success(`插件 "${data.packageName}" 安装成功！`)
    } else {
      error(`安装失败: ${result.error}`)
    }
  } catch (err: any) {
    console.error('从 npm 安装插件失败:', err)
    error(`安装失败: ${err.message || '未知错误'}`)
  } finally {
    isImportingNpm.value = false
  }
}
</script>
<template>
  <div class="content-panel">
    <!-- 可滚动内容区 -->
    <Transition name="list-slide">
      <div v-show="!isDetailVisible" class="scrollable-content">
        <div class="panel-header">
          <div class="tab-group">
            <button
              class="tab-btn"
              :class="{ active: filterStatus === 'all' }"
              @click="filterStatus = 'all'"
            >
              全部
              <span class="tab-count">{{ allPluginsCount }}</span>
            </button>
            <button
              class="tab-btn"
              :class="{ active: filterStatus === 'running' }"
              @click="filterStatus = 'running'"
            >
              运行中
              <span class="tab-count">{{ runningPluginsCount }}</span>
            </button>
          </div>
          <div class="button-group">
            <button class="btn" :disabled="isImporting" @click="importPlugin">
              {{ isImporting ? '导入中...' : '导入本地插件' }}
            </button>
            <div class="more-menu-wrapper">
              <button class="btn btn-more" @click="toggleMoreMenu">
                更多
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              <div v-if="showMoreMenu" class="more-menu" @click="closeMoreMenu">
                <button
                  class="more-menu-item"
                  :disabled="isImportingNpm"
                  @click="showNpmInstallPanel"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  {{ isImportingNpm ? '安装中...' : '从 npm 安装' }}
                </button>
                <button
                  class="more-menu-item"
                  :disabled="
                    isUpgradingAll || isCheckingMarketUpdates || upgradablePluginsCount === 0
                  "
                  @click="handleUpgradeAllPlugins"
                >
                  <div class="i-z-refresh font-size-16px" />
                  {{
                    isCheckingMarketUpdates
                      ? '检测更新中...'
                      : isUpgradingAll
                        ? `更新中... ${upgradeProgressDone}/${upgradeProgressTotal}`
                        : upgradablePluginsCount > 0
                          ? `全部更新 (${upgradablePluginsCount})`
                          : '暂无可更新'
                  }}
                </button>
                <button
                  class="more-menu-item"
                  :disabled="isExportingAll"
                  @click="handleExportAllPlugins"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  {{ isExportingAll ? '导出中...' : '导出全部插件' }}
                </button>
                <button
                  class="more-menu-item kill-all-item"
                  :disabled="isKillingAll || runningPluginsCount === 0"
                  @click="handleKillAllPlugins"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  </svg>
                  {{ isKillingAll ? '停止中...' : '停止所有插件' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 插件列表 -->
        <div class="plugin-list">
          <div
            v-for="plugin in filteredPlugins"
            :key="plugin.path"
            class="card plugin-item"
            :title="plugin.description"
            @click="openPluginDetail(plugin)"
          >
            <div class="plugin-icon-wrapper">
              <AdaptiveIcon
                v-if="plugin.logo"
                :src="plugin.logo"
                class="plugin-icon"
                alt="插件图标"
                draggable="false"
              />
              <div v-else class="plugin-icon-placeholder">🧩</div>
              <span v-if="plugin.isDevelopment" class="plugin-dev-badge">DEV</span>
            </div>

            <div class="plugin-info">
              <div class="plugin-name">
                {{ plugin.title || plugin.name }}
                <span class="plugin-version">v{{ plugin.version }}</span>
                <span v-if="isPluginDisabled(plugin.path)" class="disabled-badge">已禁用</span>
                <span v-if="isPluginRunning(plugin.path)" class="running-badge">
                  <span class="status-dot"></span>
                  运行中
                </span>
              </div>
              <div class="plugin-desc">{{ plugin.description || '暂无描述' }}</div>
            </div>

            <div class="plugin-meta">
              <button
                class="icon-btn open-btn"
                :disabled="isPluginDisabled(plugin.path)"
                title="打开插件"
                @click.stop="handleOpenPlugin(plugin)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </button>
              <button
                v-if="isPluginRunning(plugin.path)"
                class="icon-btn kill-btn"
                title="终止运行"
                :disabled="isKilling"
                @click.stop="handleKillPlugin(plugin)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                </svg>
              </button>
              <button
                class="icon-btn folder-btn"
                title="打开插件目录"
                @click.stop="handleOpenFolder(plugin)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                  ></path>
                </svg>
              </button>
              <button
                class="icon-btn pin-btn"
                :class="{ 'is-pinned': isPluginPinned(plugin.path) }"
                :title="isPluginPinned(plugin.path) ? '取消置顶' : '置顶'"
                @click.stop="togglePin(plugin)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="4" y1="4" x2="20" y2="4"></line>
                  <polyline points="8 10 12 4 16 10"></polyline>
                  <line x1="12" y1="10" x2="12" y2="20"></line>
                </svg>
              </button>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-if="!isLoading && plugins.length === 0" class="empty-state">
            <div class="i-z-plugin empty-icon font-size-64px" />
            <div class="empty-text">暂无插件</div>
            <div class="empty-hint">点击"导入本地插件"来安装你的第一个插件</div>
          </div>

          <!-- 搜索无结果 -->
          <div
            v-if="!isLoading && plugins.length > 0 && filteredPlugins.length === 0"
            class="empty-state"
          >
            <div class="i-z-plugin empty-icon font-size-64px" />
            <div class="empty-text">未找到匹配的插件</div>
            <div class="empty-hint">尝试使用其他关键词搜索</div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 插件详情覆盖面板组件 -->
    <Transition name="slide">
      <PluginDetail
        v-if="isDetailVisible && selectedPlugin && !showNpmPanel"
        :plugin="selectedPlugin"
        :is-running="isPluginRunning(selectedPlugin.path)"
        :is-pinned="isPluginPinned(selectedPlugin.path)"
        :is-disabled="isPluginDisabled(selectedPlugin.path)"
        :show-market-button="!!selectedPlugin.marketPlugin"
        @back="closePluginDetail"
        @open="handleOpenPlugin(selectedPlugin)"
        @uninstall="handleUninstallFromDetail(selectedPlugin, $event)"
        @kill="handleKillPlugin(selectedPlugin)"
        @open-folder="handleOpenFolder(selectedPlugin)"
        @open-market="handleOpenMarketDetail(selectedPlugin)"
        @toggle-pin="togglePin(selectedPlugin)"
        @toggle-disabled="handleTogglePluginDisabled(selectedPlugin, $event)"
      />
    </Transition>

    <!-- npm 安装面板 -->
    <Transition name="slide">
      <NpmInstallPanel
        v-if="isDetailVisible && showNpmPanel"
        ref="npmInstallPanelRef"
        :visible="showNpmPanel"
        @back="closeNpmPanel"
        @install="handleInstallFromNpm"
      />
    </Transition>
  </div>
</template>

<style scoped>
.content-panel {
  position: relative;
  /* 使详情面板能够覆盖该区域 */
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 防止滑动时出现滚动条 */
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

/* 插件中心样式 */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.tab-group {
  display: flex;
  gap: 6px;
  background: var(--control-bg);
  padding: 3px;
  border-radius: 8px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 13px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.tab-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.tab-btn.active {
  background: var(--active-bg);
  color: var(--primary-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.tab-count {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--control-bg);
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

.tab-btn.active .tab-count {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.button-group {
  display: flex;
  gap: 10px;
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-item {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.plugin-item:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.plugin-icon,
.plugin-icon-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  flex-shrink: 0;
}

.plugin-icon {
  object-fit: cover;
}

.plugin-icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  font-size: 24px;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-version {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 2px 6px;
  background: var(--active-bg);
  border-radius: 4px;
}

.dev-badge {
  display: none;
}

.plugin-icon-wrapper {
  position: relative;
  flex-shrink: 0;
  margin-right: 12px;
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

.disabled-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  color: var(--warning-color);
  background: color-mix(in srgb, var(--warning-color) 12%, transparent);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent);
}

.running-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--success-color);
  background: var(--success-light-bg);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--success-color);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success-color);
  animation: pulse-dot 2s infinite;
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}

.plugin-desc {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 图标按钮颜色样式 */
.open-btn {
  color: var(--primary-color);
}

.open-btn:hover {
  background: var(--primary-light-bg);
}

.kill-btn {
  color: var(--warning-color);
}

.kill-btn:hover:not(:disabled) {
  background: var(--warning-light-bg);
}

.folder-btn {
  color: var(--primary-color);
}

.folder-btn:hover {
  background: var(--primary-light-bg);
}

.pin-btn {
  color: var(--text-secondary);
}

.pin-btn:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.pin-btn.is-pinned {
  color: var(--primary-color);
}

.pin-btn.is-pinned:hover {
  background: var(--primary-light-bg);
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.3;
  color: var(--text-secondary);
}

.empty-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
  color: var(--text-secondary);
}

.empty-feature {
  font-size: 13px;
  color: var(--text-secondary);
}

/* 更多菜单样式 */
.more-menu-wrapper {
  position: relative;
  z-index: 10000;
}

.more-menu-wrapper .btn-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.more-menu-wrapper .btn-more svg {
  flex-shrink: 0;
}

.more-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: #ffffff;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 180px;
  padding: 4px;
  z-index: 10001;
}

@media (prefers-color-scheme: dark) {
  .more-menu {
    background: #1e1e1e;
  }
}

.more-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-color);
  font-size: 14px;
  text-align: left;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.more-menu-item:hover:not(:disabled) {
  background: var(--hover-bg);
}

.more-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.more-menu-item svg {
  flex-shrink: 0;
}

.more-menu-item.kill-all-item:not(:disabled) {
  color: var(--warning-color);
}

.more-menu-item.kill-all-item:hover:not(:disabled) {
  background: var(--warning-light-bg);
}
</style>
