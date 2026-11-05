<template>
  <div
    ref="scrollContainerRef"
    class="scrollable-content"
    @click="handleContainerClick"
    @scroll="scrollPosition = ($event.target as HTMLElement).scrollTop"
  >
    <!-- 聚合模式 -->
    <AggregateView
      v-if="searchMode === 'aggregate'"
      v-model:recent-expanded="isRecentExpanded"
      v-model:pinned-expanded="isPinnedExpanded"
      v-model:search-results-expanded="isSearchResultsExpanded"
      v-model:best-matches-expanded="isBestMatchesExpanded"
      v-model:recommendations-expanded="isRecommendationsExpanded"
      :search-query="displayContext.searchQuery"
      :pasted-image="displayContext.pastedImage"
      :pasted-files="displayContext.pastedFiles"
      :pasted-text="displayContext.pastedText"
      :best-search-results="bestSearchResults"
      :best-matches="bestMatches"
      :recommendations="recommendationItems"
      :main-push-groups="mainPushGroups"
      :display-apps="displayApps"
      :pinned-apps="pinnedApps"
      :window-matched-actions="windowMatchedActions"
      :window-match-title="windowMatchTitle"
      :navigation-grid="navigationGrid"
      :selected-row="selectedRow"
      :selected-col="selectedCol"
      :loading="loading"
      :show-recent-in-search="showRecentInSearch"
      :recent-rows="windowStore.recentRows"
      :pinned-rows="windowStore.pinnedRows"
      @select="handleSelectApp"
      @select-window="handleWindowAction"
      @select-recommendation="handleRecommendationSelect"
      @select-main-push="handleMainPushSelectAction"
      @enter-main-push-app="handleEnterMainPushApp"
      @contextmenu="handleAppContextMenu"
      @update:pinned-order="updatePinnedOrder"
      @height-changed="emit('height-changed')"
    />

    <!-- 列表模式 -->
    <div v-if="searchMode === 'list' && hasSearchContent" class="list-mode-results">
      <VerticalList
        :apps="allListModeResults"
        :selected-index="listModeSelectedIndex"
        :search-query="displayContext.searchQuery"
        :scroll-top="scrollPosition"
        @select="handleSelectApp"
        @contextmenu="(app) => handleAppContextMenu(app, 'search')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { normalizeConfigList } from '@shared/pluginSettings'
import {
  useMainPushResults,
  type MainPushGroup,
  type MainPushItem
} from '../../composables/useMainPushResults'
import {
  resolveMainPushMenuState,
  toggleMainPushSetting
} from '../../composables/useMainPushSetting'
import { useNavigation } from '../../composables/useNavigation'
import { useSearchResults } from '../../composables/useSearchResults'
import { useCommandDataStore } from '../../stores/commandDataStore'
import { useWindowStore } from '../../stores/windowStore'
import VerticalList from '../common/VerticalList.vue'
import AggregateView from './AggregateView.vue'
import { buildAggregateNavigationGrid } from './navigationGrid'
import type { NavigationGridRow } from './navigationGrid'

interface Props {
  searchQuery: string
  pastedImage?: string | null
  pastedFiles?: Array<{ path: string; name: string; isDirectory: boolean }> | null
  pastedText?: string | null
}
type ContextMenuSource = 'history' | 'pinned' | 'search' | 'recommendation'

const props = defineProps<Props>()

const windowStore = useWindowStore()
const searchMode = computed(() => windowStore.searchMode)

const emit = defineEmits<{
  (e: 'height-changed'): void
  (e: 'focus-input'): void
  (e: 'restore-match', state: any): void
}>()

// 使用 store
const commandDataStore = useCommandDataStore()
const { loading, displayContext } = storeToRefs(commandDataStore)
const {
  getRecentCommands,
  removeFromHistory,
  pinCommand,
  unpinCommand,
  isPinned,
  getRecommendationPinIndex,
  isRecommendationPinned,
  pinRecommendation,
  unpinRecommendation,
  moveRecommendationToFront,
  getPinnedCommands,
  updatePinnedOrder,
  loadSuperPanelPinnedData,
  isPinnedToSuperPanel
} = commandDataStore

// 使用搜索结果 composable
const { bestSearchResults, bestMatches, recommendations, allListModeResults } =
  useSearchResults(props)

// 为推荐项附加仅用于渲染的置顶状态，避免把 UI 字段写入固定列表数据。
const recommendationItems = computed(() =>
  recommendations.value.map((item) => ({
    ...item,
    isPinnedInSearch: isRecommendationPinned(item)
  }))
)

// 使用 mainPush 结果 composable
const { mainPushGroups, handleMainPushSelect } = useMainPushResults()

// 内部状态
const scrollContainerRef = ref<HTMLElement>()
const scrollPosition = ref(0)
const showRecentInSearch = computed(() => windowStore.showRecentInSearch)

// 展示设置插件详情页面对应小项的 payload
type PluginPayload = { pluginName: string; path?: string }

/**
 * 从搜索结果项中提取插件名称载荷。
 */
function getPluginPayload(app: any): PluginPayload | null {
  if (!app?.pluginName) {
    return null
  }
  return { pluginName: app.pluginName, path: app.path }
}

/**
 * 解析右键菜单回传的插件载荷。
 */
function parsePluginPayload(raw: string): PluginPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.pluginName) return null
    return { pluginName: parsed.pluginName, path: parsed.path }
  } catch {
    return null
  }
}

// 是否有搜索内容

const hasSearchContent = computed(() => {
  const context = displayContext.value
  return !!(
    context.searchQuery.trim() ||
    context.pastedImage ||
    context.pastedText ||
    context.pastedFiles
  )
})

// 窗口匹配分组由主进程根据本次输入和窗口快照生成。
const windowMatchedActions = computed(() => commandDataStore.result.windowCommands)

// 窗口匹配栏的标题（基于当前窗口的 app 名称）
const windowMatchTitle = computed(() => {
  const currentWindow = displayContext.value.windowInfo
  if (!currentWindow) {
    return ''
  }
  // 提取 app 名称（去掉 .app 后缀）
  const appName = currentWindow.app || ''
  return appName.replace(/\.app$/i, '')
})

// 显示的应用列表
const displayApps = computed(() => {
  const context = displayContext.value
  if (context.pastedImage || context.pastedText || context.pastedFiles) return []
  if (context.searchQuery.trim() === '') {
    return getRecentCommands()
  }
  return []
})

// 固定应用列表
const pinnedApps = computed(() => {
  return getPinnedCommands()
})

// 折叠状态（提升到这里统一管理）
const isRecentExpanded = ref(false)
const isPinnedExpanded = ref(false)
const isSearchResultsExpanded = ref(false)
const isBestMatchesExpanded = ref(false)
const isRecommendationsExpanded = ref(false)

// 构建导航网格
const navigationGrid = computed<NavigationGridRow[]>(() => {
  // 列表模式：使用一维数组（每个项目占一行）
  if (searchMode.value === 'list') {
    if (!hasSearchContent.value) {
      return []
    }
    return allListModeResults.value.map((item: any) => ({ type: 'listItem', items: [item] }))
  }

  return buildAggregateNavigationGrid({
    hasSearchContent: hasSearchContent.value,
    bestSearchResults: bestSearchResults.value,
    bestMatches: bestMatches.value,
    recommendations: recommendationItems.value,
    mainPushGroups: mainPushGroups.value,
    windowMatchedActions: windowMatchedActions.value,
    displayApps: displayApps.value,
    pinnedApps: pinnedApps.value,
    showRecentInSearch: showRecentInSearch.value,
    recentExpanded: isRecentExpanded.value,
    pinnedExpanded: isPinnedExpanded.value,
    searchResultsExpanded: isSearchResultsExpanded.value,
    bestMatchesExpanded: isBestMatchesExpanded.value,
    recommendationsExpanded: isRecommendationsExpanded.value,
    recentRows: windowStore.recentRows,
    pinnedRows: windowStore.pinnedRows
  })
})

// 使用导航 composable
const {
  selectedRow,
  selectedCol,
  selectedItem,
  handleKeydown: handleNavigationKeydown,
  resetSelection
} = useNavigation(searchMode, navigationGrid)

// 列表模式的选中索引（一维索引）
const listModeSelectedIndex = computed(() => {
  if (searchMode.value !== 'list') {
    return -1
  }

  const grid = navigationGrid.value
  if (grid.length === 0 || selectedRow.value >= grid.length) {
    return -1
  }

  // 计算一维索引
  let index = 0
  for (let i = 0; i < selectedRow.value; i++) {
    index += grid[i].items.length
  }
  index += selectedCol.value

  return index
})

/**
 * 为导航展示项生成身份，动态选项附加所属结果组以避免跨插件同名。
 * @param row 导航行
 * @param item 导航项目
 * @returns 用于保留选择的身份
 */
function navigationIdentity(row: NavigationGridRow, item: any): string {
  return row.mainPushGroup
    ? row.mainPushGroup.resultId + JSON.stringify(item)
    : item?.resultId || JSON.stringify([item?.path, item?.featureCode, item?.name])
}

let selectionRequestId = commandDataStore.result.requestId
watch(
  navigationGrid,
  (next, previous) => {
    const newQuery = selectionRequestId !== commandDataStore.result.requestId
    selectionRequestId = commandDataStore.result.requestId
    const oldRow = previous[selectedRow.value]
    const oldItem = oldRow?.items[selectedCol.value]
    if (!newQuery && oldItem) {
      const identity = navigationIdentity(oldRow, oldItem)
      for (let row = 0; row < next.length; row++) {
        const col = next[row].items.findIndex(
          (item) => navigationIdentity(next[row], item) === identity
        )
        if (col >= 0) {
          selectedRow.value = row
          selectedCol.value = col
          break
        }
      }
    }
    // 异步静态结果与逐组动态结果都要重新测量窗口高度。
    emit('height-changed')
  },
  { flush: 'post' }
)

// 新结果提交时才重置，查询等待期间保留原有布局。
watch(
  () => commandDataStore.result.requestId,
  () => {
    resetSelection()
    // 重置所有折叠状态
    isRecentExpanded.value = false
    isPinnedExpanded.value = false
    isSearchResultsExpanded.value = false
    isBestMatchesExpanded.value = false
    isRecommendationsExpanded.value = false
    emit('height-changed')
  }
)

// 监听折叠状态变化，通知父组件调整窗口高度
watch(
  [
    isRecentExpanded,
    isPinnedExpanded,
    isSearchResultsExpanded,
    isBestMatchesExpanded,
    isRecommendationsExpanded
  ],
  () => {
    emit('height-changed')
  }
)

/**
 * 滚动到键盘选中项，虚拟列表使用行高定位未挂载的项目。
 * @returns 无返回值
 */
function scrollToSelectedItem(): void {
  const container = scrollContainerRef.value
  if (!container) {
    return
  }
  if (searchMode.value === 'list') {
    // 虚拟列表中目标可能尚未挂载，使用固定行高定位后再由页面渲染它。
    const top = listModeSelectedIndex.value * 54
    if (top < container.scrollTop) container.scrollTop = top
    else if (top + 54 > container.scrollTop + container.clientHeight)
      container.scrollTop = top + 54 - container.clientHeight
    scrollPosition.value = container.scrollTop
    return
  }

  nextTick(() => {
    // 选中项可能是网格卡片（.app-item）、mainPush 推送行或垂直列表行（.list-item），
    // 聚合模式下三种都会出现，统一匹配,否则选中移入未覆盖的区块时不会跟随滚动。
    const selectedElement = container.querySelector(
      '.app-item.selected, .list-item.selected'
    ) as HTMLElement | null

    if (!selectedElement) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const targetRect = selectedElement.getBoundingClientRect()

    // 检查是否在可见区域内
    const isAbove = targetRect.top < containerRect.top
    const isBelow = targetRect.bottom > containerRect.bottom

    if (isAbove) {
      const scrollTop = container.scrollTop + (targetRect.top - containerRect.top)
      setTimeout(() => {
        container.scrollTo({
          top: Math.max(0, scrollTop),
          behavior: 'auto'
        })
      }, 50)
    } else if (isBelow) {
      const scrollTop = container.scrollTop + (targetRect.bottom - containerRect.bottom)
      setTimeout(() => {
        container.scrollTo({
          top: scrollTop,
          behavior: 'auto'
        })
      }, 50)
    }
  })
}

// 监听选中项变化，自动滚动
watch([selectedRow, selectedCol], () => {
  scrollToSelectedItem()
})

// 监听 mainPush 结果变化，调整窗口高度
watch(
  () => mainPushGroups.value,
  () => {
    emit('height-changed')
  },
  { deep: true }
)

// 监听固定列表变化，调整窗口高度
watch(
  () => pinnedApps.value.length,
  () => {
    emit('height-changed')
  }
)

// 监听历史记录列表变化，调整窗口高度
watch(
  () => displayApps.value.length,
  () => {
    emit('height-changed')
  }
)

/**
 * 根据结果来源构建应用右键菜单。
 * @param app 触发菜单的指令
 * @param source 结果所在区域
 * @returns 菜单展示完成后结束的 Promise
 */
async function handleAppContextMenu(app: any, source: ContextMenuSource = 'search'): Promise<void> {
  const menuItems: any[] = []

  // 只在历史记录中显示"从使用记录删除"
  if (source === 'history') {
    const historyMatchName =
      app.type === 'plugin'
        ? app.pluginName || app.name
        : app.type === 'direct' && app.subType === 'app'
          ? app.persistedName || app.name
          : app.name
    menuItems.push({
      id: `remove-from-history:${JSON.stringify({
        path: app.path,
        featureCode: app.featureCode,
        name: historyMatchName
      })}`,
      label: '从使用记录删除'
    })
  }

  // 如果是应用（不是插件和系统设置，且不是协议链接），显示"打开文件位置"
  const isProtocolLink = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(app.path) && !app.path.includes('\\')
  const isLocalApp =
    app.type !== 'system-setting' && app.type !== 'plugin' && app.path && !isProtocolLink
  if (isLocalApp) {
    menuItems.push({
      id: `reveal-in-finder:${JSON.stringify({ path: app.path })}`,
      label: '打开文件位置'
    })
  }

  // Windows 本地应用显示"以管理员身份运行"
  if (isLocalApp && window.ztools.getPlatform() === 'win32') {
    menuItems.push({
      id: `launch-as-admin:${JSON.stringify({ path: app.path, name: app.name })}`,
      label: '以管理员身份运行'
    })
  }

  if (source === 'recommendation') {
    // 推荐区使用独立置顶序列，与主搜索框固定列表完全隔离。
    const recommendationIndex = getRecommendationPinIndex(app)
    if (recommendationIndex >= 0) {
      menuItems.push({
        id: `unpin-recommendation:${JSON.stringify({
          path: app.path,
          featureCode: app.featureCode,
          name: app.name,
          pluginName: app.pluginName,
          type: app.type
        })}`,
        label: '取消置顶'
      })
      menuItems.push({
        id: `move-recommendation-to-front:${JSON.stringify({
          path: app.path,
          featureCode: app.featureCode,
          name: app.name,
          pluginName: app.pluginName,
          type: app.type
        })}`,
        label: '排到最前',
        enabled: recommendationIndex > 0
      })
    } else {
      menuItems.push({
        id: `pin-recommendation:${JSON.stringify({
          path: app.path,
          featureCode: app.featureCode,
          name: app.name,
          pluginName: app.pluginName,
          type: app.type
        })}`,
        label: '置顶'
      })
    }

    // 匹配推荐使用专属菜单，不追加超级面板、插件设置和快捷键等通用操作。
    await window.ztools.showContextMenu(menuItems)
    return
  } else {
    // 其他区域继续使用原有的主搜索框固定逻辑。
    const fixedMatchName =
      app.type === 'plugin'
        ? app.pluginName || app.name
        : app.type === 'direct' && app.subType === 'app'
          ? app.persistedName || app.name
          : app.name
    if (isPinned(app.path, app.featureCode, fixedMatchName)) {
      menuItems.push({
        id: `unpin-app:${JSON.stringify({
          path: app.path,
          featureCode: app.featureCode,
          name: fixedMatchName
        })}`,
        label: '从搜索框取消固定'
      })
    } else {
      menuItems.push({
        id: `pin-app:${JSON.stringify({
          name:
            app.type === 'direct' && app.subType === 'app'
              ? app.persistedName || app.name
              : app.name,
          path: app.path,
          icon: app.icon,
          pinyin: app.pinyin,
          pinyinAbbr: app.pinyinAbbr,
          type: app.type,
          featureCode: app.featureCode,
          pluginName: app.pluginName,
          pluginExplain: app.pluginExplain,
          subType: app.subType,
          cmdType: app.cmdType,
          originalName: app.originalName,
          persistedName: app.persistedName
        })}`,
        label: '固定到搜索框'
      })
    }
  }

  // 超级面板固定/取消固定
  if (isPinnedToSuperPanel(app)) {
    menuItems.push({
      id: `unpin-super-panel:${JSON.stringify({ path: app.path, featureCode: app.featureCode })}`,
      label: '从超级面板取消固定'
    })
  } else {
    menuItems.push({
      id: `pin-super-panel:${JSON.stringify({
        name: app.name,
        path: app.path,
        icon: app.icon,
        type: app.type,
        featureCode: app.featureCode,
        pluginName: app.pluginName,
        pluginExplain: app.pluginExplain,
        cmdType: app.cmdType
      })}`,
      label: '固定到超级面板'
    })
  }

  // 如果是插件，添加插件设置菜单
  if (app.type === 'plugin' && app.pluginName) {
    let outKillPlugins: string[] = []
    let autoDetachPlugins: string[] = []
    try {
      const killData = await window.ztools.dbGet('out-kill-plugin')
      outKillPlugins = normalizeConfigList(killData)
      const detachData = await window.ztools.dbGet('auto-detach-plugin')
      autoDetachPlugins = normalizeConfigList(detachData)
    } catch (error) {
      console.log('读取配置失败:', error)
    }

    const pluginPayload = getPluginPayload(app)
    const isAutoKill = !!pluginPayload && outKillPlugins.includes(pluginPayload.pluginName)
    const isAutoDetach = !!pluginPayload && autoDetachPlugins.includes(pluginPayload.pluginName)
    const mainPushState = await resolveMainPushMenuState(pluginPayload?.pluginName)

    menuItems.push({
      label: '插件设置',
      submenu: [
        ...(mainPushState.supported
          ? [
              {
                id: `toggle-main-push:${JSON.stringify(pluginPayload)}`,
                label: '搜索栏推送',
                type: 'checkbox',
                checked: mainPushState.enabled
              }
            ]
          : []),
        {
          id: `toggle-auto-kill:${JSON.stringify(pluginPayload)}`,
          label: '退出到后台立即结束运行',
          type: 'checkbox',
          checked: isAutoKill
        },
        {
          id: `toggle-auto-detach:${JSON.stringify(pluginPayload)}`,
          label: '自动分离为独立窗口',
          type: 'checkbox',
          checked: isAutoDetach
        }
      ]
    })

    menuItems.push({
      id: `view-plugin-detail:${JSON.stringify(pluginPayload)}`,
      label: '查看插件详情'
    })
  }

  // 添加更多菜单
  menuItems.push({
    label: '更多',
    submenu: [
      {
        id: `add-global-shortcut:${JSON.stringify({ name: app.name, pluginTitle: app.pluginTitle || app.pluginName })}`,
        label: '设置全局快捷键'
      }
    ]
  })

  await window.ztools.showContextMenu(menuItems)
}

// 选择应用
/**
 * 将选择身份交给统一执行服务，页面只处理显示与状态恢复。
 * @param app 当前选择的指令
 * @returns 操作结束的 Promise
 */
async function handleSelectApp(app: any): Promise<void> {
  try {
    const response = await commandDataStore.execute(app)
    if (response.restoreContext) emit('restore-match', response.restoreContext)
    if (!response.success) console.error('启动失败:', response.error)
  } catch (error) {
    console.error('启动失败:', error)
  }
}

// 窗口功能选择
async function handleWindowAction(item: any): Promise<void> {
  try {
    // 执行命令，将 window feature 的命令作为普通插件命令执行
    await handleSelectApp(item)
  } catch (error) {
    console.error('执行窗口操作失败:', error)
  }
}

// 选择推荐项
async function handleRecommendationSelect(item: any): Promise<void> {
  if (item.type === 'plugin') {
    await handleSelectApp(item)
  }
}

/**
 * 提交动态结果选择，主进程决定是否进入插件。
 * @param group 动态分组
 * @param item 插件返回的选项
 * @returns 操作结束的 Promise
 */
async function handleMainPushSelectAction(group: MainPushGroup, item: MainPushItem): Promise<void> {
  await handleMainPushSelect(group, item)
}

/**
 * 直接进入产生当前动态结果的插件。
 * @param group 动态分组
 * @returns 操作结束的 Promise
 */
async function handleEnterMainPushApp(group: MainPushGroup): Promise<void> {
  await handleMainPushSelect(group, undefined, true)
}

/**
 * 执行当前选择并处理其他导航按键。
 * @param event 键盘事件
 * @returns 按键处理结束的 Promise
 */
async function handleKeydown(event: KeyboardEvent): Promise<void> {
  const grid = navigationGrid.value
  if (!grid || grid.length === 0) return

  // 处理 Enter 键的特殊逻辑
  if (event.key === 'Enter') {
    event.preventDefault()
    const item = selectedItem.value
    if (item) {
      const currentRow = grid[selectedRow.value]
      if (currentRow.type === 'window') {
        handleWindowAction(item)
      } else if (currentRow.type === 'recommendation') {
        handleRecommendationSelect(item)
      } else if (currentRow.type?.startsWith('mainPush:') && currentRow.mainPushGroup) {
        handleMainPushSelectAction(currentRow.mainPushGroup, item)
      } else {
        handleSelectApp(item)
      }
    }
    return
  }

  // 处理空格键的特殊逻辑（开启了空格打开指令时）
  if (event.key === ' ' && windowStore.spaceOpenCommand) {
    event.preventDefault()
    const item = selectedItem.value
    if (item) {
      const currentRow = grid[selectedRow.value]
      if (currentRow.type === 'window') {
        handleWindowAction(item)
      } else if (currentRow.type === 'recommendation') {
        handleRecommendationSelect(item)
      } else if (currentRow.type?.startsWith('mainPush:') && currentRow.mainPushGroup) {
        handleMainPushSelectAction(currentRow.mainPushGroup, item)
      } else {
        handleSelectApp(item)
      }
    }
    return
  }

  // 其他导航键交给 useNavigation 处理
  handleNavigationKeydown(event, () => {
    // 这个回调不会被调用，因为 Enter 键已经在上面处理了
  })
}

/**
 * 执行主进程右键菜单回传的命令。
 * @param command 菜单命令及其序列化参数
 * @returns 命令处理完成后结束的 Promise
 */
async function handleContextMenuCommand(command: string): Promise<void> {
  if (command.startsWith('remove-from-history:')) {
    const jsonStr = command.replace('remove-from-history:', '')
    try {
      const { path, featureCode, name } = JSON.parse(jsonStr)
      await removeFromHistory(path, featureCode, name)
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('从历史记录删除失败:', error)
    }
  } else if (command.startsWith('pin-recommendation:')) {
    const jsonStr = command.replace('pin-recommendation:', '')
    try {
      await pinRecommendation(JSON.parse(jsonStr))
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('置顶匹配推荐失败:', error)
    }
  } else if (command.startsWith('unpin-recommendation:')) {
    const jsonStr = command.replace('unpin-recommendation:', '')
    try {
      await unpinRecommendation(JSON.parse(jsonStr))
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('取消匹配推荐置顶失败:', error)
    }
  } else if (command.startsWith('move-recommendation-to-front:')) {
    const jsonStr = command.replace('move-recommendation-to-front:', '')
    try {
      await moveRecommendationToFront(JSON.parse(jsonStr))
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('调整匹配推荐顺序失败:', error)
    }
  } else if (command.startsWith('pin-app:')) {
    const appJson = command.replace('pin-app:', '')
    try {
      const app = JSON.parse(appJson)
      await pinCommand(app)
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('固定应用失败:', error)
    }
  } else if (command.startsWith('unpin-app:')) {
    const jsonStr = command.replace('unpin-app:', '')
    try {
      const { path, featureCode, name } = JSON.parse(jsonStr)
      await unpinCommand(path, featureCode, name)
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('取消固定失败:', error)
    }
  } else if (command.startsWith('reveal-in-finder:')) {
    const jsonStr = command.replace('reveal-in-finder:', '')
    try {
      const { path: filePath } = JSON.parse(jsonStr)
      await window.ztools.revealInFinder(filePath)
      emit('focus-input')
    } catch (error) {
      console.error('打开文件位置失败:', error)
    }
  } else if (command.startsWith('launch-as-admin:')) {
    const jsonStr = command.replace('launch-as-admin:', '')
    try {
      const { path: appPath, name } = JSON.parse(jsonStr)
      await window.ztools.launchAsAdmin(appPath, name)
    } catch (error) {
      console.error('管理员启动失败:', error)
    }
  } else if (command.startsWith('toggle-auto-kill:')) {
    const pluginPayload = parsePluginPayload(command.replace('toggle-auto-kill:', ''))
    try {
      let outKillPlugins: string[] = []
      try {
        const data = await window.ztools.dbGet('out-kill-plugin')
        outKillPlugins = normalizeConfigList(data)
      } catch (error) {
        console.debug('未找outKillPlugin配置', error)
      }

      if (!pluginPayload) {
        return
      }

      const { pluginName } = pluginPayload
      outKillPlugins = outKillPlugins.includes(pluginName)
        ? outKillPlugins.filter((n) => n !== pluginName)
        : [...outKillPlugins, pluginName]
      await window.ztools.dbPut('out-kill-plugin', outKillPlugins)
      console.log('已更新 outKillPlugin 配置:', outKillPlugins)
    } catch (error: any) {
      console.error('切换自动结束配置失败:', error)
    }
  } else if (command.startsWith('view-plugin-detail:')) {
    const pluginPayload = parsePluginPayload(command.replace('view-plugin-detail:', ''))
    try {
      // 从 commandDataStore 中查找设置插件（已安装插件功能）的路径
      const settingCmd = (await window.ztools.commands.getCatalog()).find(
        (c) =>
          c.type === 'plugin' &&
          c.pluginName === 'setting' &&
          c.featureCode === 'ui.router?router=Plugins'
      )
      if (settingCmd) {
        await window.ztools.launch({
          path: settingCmd.path,
          type: 'plugin',
          featureCode: 'ui.router?router=Plugins',
          name: '已安装插件',
          cmdType: 'text',
          param: {
            payload: pluginPayload ? pluginPayload.pluginName : '',
            type: 'text'
          }
        })
      } else {
        console.error('未找到设置插件的已安装插件指令')
      }
    } catch (error) {
      console.error('查看插件详情失败:', error)
    }
  } else if (command.startsWith('toggle-auto-detach:')) {
    const pluginPayload = parsePluginPayload(command.replace('toggle-auto-detach:', ''))
    try {
      let autoDetachPlugins: string[] = []
      try {
        const data = await window.ztools.dbGet('auto-detach-plugin')
        autoDetachPlugins = normalizeConfigList(data)
      } catch (error) {
        console.debug('未找到 autoDetachPlugin 配置', error)
      }

      if (!pluginPayload) {
        return
      }

      const { pluginName } = pluginPayload
      autoDetachPlugins = autoDetachPlugins.includes(pluginName)
        ? autoDetachPlugins.filter((n) => n !== pluginName)
        : [...autoDetachPlugins, pluginName]
      await window.ztools.dbPut('auto-detach-plugin', autoDetachPlugins)
      console.log('已更新 autoDetachPlugin 配置:', autoDetachPlugins)
    } catch (error: any) {
      console.error('切换自动分离配置失败:', error)
    }
  } else if (command.startsWith('toggle-main-push:')) {
    const pluginPayload = parsePluginPayload(command.replace('toggle-main-push:', ''))
    try {
      await toggleMainPushSetting(pluginPayload?.pluginName)
    } catch (error: any) {
      console.error('切换搜索栏推送配置失败:', error)
    }
  } else if (command.startsWith('pin-super-panel:')) {
    const appJson = command.replace('pin-super-panel:', '')
    try {
      const app = JSON.parse(appJson)
      await window.ztools.pinToSuperPanel(app)
      await loadSuperPanelPinnedData()
    } catch (error) {
      console.error('固定到超级面板失败:', error)
    }
  } else if (command.startsWith('unpin-super-panel:')) {
    const jsonStr = command.replace('unpin-super-panel:', '')
    try {
      const { path, featureCode } = JSON.parse(jsonStr)
      await window.ztools.unpinSuperPanelCommand(path, featureCode)
      await loadSuperPanelPinnedData()
    } catch (error) {
      console.error('从超级面板取消固定失败:', error)
    }
  } else if (command.startsWith('add-global-shortcut:')) {
    const jsonStr = command.replace('add-global-shortcut:', '')
    try {
      const { name, pluginTitle } = JSON.parse(jsonStr)
      // 构建目标指令字符串（使用插件标题/指令名称格式）
      const targetCommand = pluginTitle ? `${pluginTitle}/${name}` : name

      // 找到设置插件的快捷键指令
      const settingCmd = (await window.ztools.commands.getCatalog()).find(
        (c) =>
          c.type === 'plugin' &&
          c.pluginName === 'setting' &&
          c.featureCode === 'ui.router?router=Shortcuts'
      )
      console.log('targetCommand', targetCommand)
      if (settingCmd) {
        await window.ztools.launch({
          path: settingCmd.path,
          type: 'plugin',
          featureCode: 'ui.router?router=Shortcuts',
          name: '快捷键',
          cmdType: 'text',
          param: {
            payload: targetCommand
          }
        })
      } else {
        console.error('未找到设置插件的快捷键指令')
      }
    } catch (error) {
      console.error('添加全局快捷键失败:', error)
    }
  }
}

// 点击容器聚焦输入框
function handleContainerClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (target.closest('.app-item')) {
    return
  }
  emit('focus-input')
}

// 重置折叠状态
function resetCollapseState(): void {
  isRecentExpanded.value = false
  isPinnedExpanded.value = false
  isSearchResultsExpanded.value = false
  isBestMatchesExpanded.value = false
  isRecommendationsExpanded.value = false
}

// 初始化
let cleanupContextMenuListener: (() => void) | null = null

onMounted(() => {
  // 先清理之前可能残留的监听器
  cleanupContextMenuListener?.()
  cleanupContextMenuListener = window.ztools.onContextMenuCommand(handleContextMenuCommand)
})

onUnmounted(() => {
  cleanupContextMenuListener?.()
  cleanupContextMenuListener = null
})

// 导出方法供父组件调用
defineExpose({
  navigationGrid,
  handleKeydown,
  resetSelection,
  resetCollapseState
})
</script>

<style scoped>
.scrollable-content {
  max-height: 541px;
  overflow-y: auto;
  overflow-x: hidden;
  user-select: none;
  padding: 0 0 2px 0;
  border-radius: 0;
}

.list-mode-results {
  display: flex;
  flex-direction: column;
}
</style>
