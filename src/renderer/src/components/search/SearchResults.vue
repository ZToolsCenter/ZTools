<template>
  <div ref="scrollContainerRef" class="scrollable-content" @click="handleContainerClick">
    <!-- 无搜索时显示历史 -->
    <div
      v-if="!searchQuery.trim() && !pastedImage && !pastedText && !pastedFiles"
      class="content-section"
    >
      <!-- 最近使用 -->
      <CollapsibleList
        v-model:expanded="isRecentExpanded"
        title="最近使用"
        :apps="displayApps"
        :selected-index="getAbsoluteIndexForSection('apps')"
        :empty-text="loading ? '正在加载应用...' : '未找到应用'"
        :default-visible-rows="2"
        :draggable="false"
        @select="handleSelectApp"
        @contextmenu="handleAppContextMenu"
      />

      <!-- 固定栏 -->
      <CollapsibleList
        v-model:expanded="isPinnedExpanded"
        title="已固定"
        :apps="pinnedApps"
        :selected-index="getAbsoluteIndexForSection('pinned')"
        :default-visible-rows="2"
        :draggable="true"
        @select="handleSelectApp"
        @contextmenu="(app) => handleAppContextMenu(app, false, true)"
        @update:apps="updatePinnedOrder"
      />

      <!-- 访达 -->
      <CollapsibleList
        v-if="finderActions.length > 0"
        title="访达"
        :apps="finderActions"
        :selected-index="getAbsoluteIndexForSection('finder')"
        :empty-text="''"
        :draggable="false"
        @select="handleFinderAction"
      />
    </div>

    <!-- 有搜索时显示搜索结果 -->
    <div v-else class="search-results">
      <!-- 最佳搜索结果（模糊搜索） -->
      <CollapsibleList
        v-if="bestSearchResults.length > 0"
        v-model:expanded="isSearchResultsExpanded"
        title="最佳搜索结果"
        :apps="bestSearchResults"
        :selected-index="bestSearchResultSelectedIndex"
        :empty-text="'未找到应用'"
        :default-visible-rows="2"
        :draggable="false"
        @select="handleSelectApp"
        @contextmenu="(app) => handleAppContextMenu(app, true)"
      />

      <!-- 最佳匹配（匹配指令：regex/img/files） -->
      <CollapsibleList
        v-if="bestMatches.length > 0"
        v-model:expanded="isBestMatchesExpanded"
        title="最佳匹配"
        :apps="bestMatches"
        :selected-index="bestMatchSelectedIndex"
        :empty-text="''"
        :default-visible-rows="2"
        :draggable="false"
        @select="handleSelectApp"
        @contextmenu="(app) => handleAppContextMenu(app, true)"
      />

      <!-- 匹配推荐（over 类型） -->
      <CollapsibleList
        v-model:expanded="isRecommendationsExpanded"
        title="匹配推荐"
        :apps="recommendations"
        :selected-index="recommendationSelectedIndex"
        :empty-text="''"
        :default-visible-rows="2"
        :draggable="false"
        @select="handleRecommendationSelect"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useCommandDataStore } from '../../stores/commandDataStore'
import { useWindowStore } from '../../stores/windowStore'
import CollapsibleList from '../common/CollapsibleList.vue'

// MatchFile 接口（传递给插件的文件格式）
interface MatchFile {
  isFile: boolean
  isDirectory: boolean
  name: string
  path: string
}

// FileItem 接口（从剪贴板管理器返回的格式）
interface FileItem {
  path: string
  name: string
  isDirectory: boolean
}

interface Props {
  searchQuery: string
  pastedImage?: string | null
  pastedFiles?: FileItem[] | null
  pastedText?: string | null
}

const props = defineProps<Props>()

// 使用统计数据（用于排序）
const usageStats = ref<any[]>([])

// 加载使用统计
async function loadUsageStats(): Promise<void> {
  try {
    usageStats.value = await window.ztools.getUsageStats()
    console.log('[使用统计] 已加载:', usageStats.value.length, '条记录')
  } catch (error) {
    console.error('[使用统计] 加载失败:', error)
    usageStats.value = []
  }
}

const windowStore = useWindowStore()

const emit = defineEmits<{
  (e: 'height-changed'): void
  (e: 'focus-input'): void
  (e: 'restore-match', state: any): void
}>()

// 使用 store
const commandDataStore = useCommandDataStore()

// 解构响应式状态
const { loading } = storeToRefs(commandDataStore)

// 解构方法
const {
  search,
  searchInCommands,
  searchImageCommands,
  searchTextCommands,
  searchFileCommands,
  getRecentCommands,
  removeFromHistory,
  pinCommand,
  unpinCommand,
  isPinned,
  getPinnedCommands,
  updatePinnedOrder
} = commandDataStore

// 内部状态
const selectedRow = ref(0)
const selectedCol = ref(0)
const isRecentExpanded = ref(false)
const isPinnedExpanded = ref(false)
const isSearchResultsExpanded = ref(false)
const isBestMatchesExpanded = ref(false)
const isRecommendationsExpanded = ref(false)
const scrollContainerRef = ref<HTMLElement>()

// 最佳搜索结果（模糊搜索：应用、插件、系统设置）
const bestSearchResults = computed(() => {
  // 如果有粘贴内容，先获取匹配类型的指令
  let matchedCommands: any[] | null = null

  if (props.pastedImage) {
    matchedCommands = searchImageCommands()
    console.log('searchImageCommands', matchedCommands)
  } else if (props.pastedText) {
    matchedCommands = searchTextCommands(props.pastedText)
    console.log('searchTextCommands', matchedCommands)
  } else if (props.pastedFiles) {
    matchedCommands = searchFileCommands(props.pastedFiles)
    console.log('searchFileCommands', matchedCommands)
  }

  // 如果有匹配的指令列表（有粘贴内容）
  if (matchedCommands) {
    // 如果有搜索关键词，使用统一的搜索函数，但限制在匹配的指令中
    if (props.searchQuery.trim()) {
      const result = searchInCommands(matchedCommands, props.searchQuery)
      console.log('在匹配指令中搜索', props.searchQuery, '结果:', result)
      return result
    }
    // 没有搜索关键词，直接返回匹配的指令
    return matchedCommands
  }

  // 否则正常搜索（无粘贴内容），返回模糊搜索结果
  if (!props.searchQuery.trim()) {
    return []
  }

  const result = search(props.searchQuery)
  return result.bestMatches
})

// 最佳匹配（匹配指令：regex/img/files 类型）
const bestMatches = computed(() => {
  // 有粘贴内容时不显示匹配指令
  if (props.pastedImage || props.pastedText || props.pastedFiles) {
    return []
  }

  // 没有搜索关键词时不显示
  if (!props.searchQuery.trim()) {
    return []
  }

  // 只有当没有模糊搜索结果时，才显示匹配指令
  if (bestSearchResults.value.length > 0) {
    return []
  }

  const result = search(props.searchQuery)

  // 从 regexMatches 中过滤出 regex、img、files 类型（排除 over）
  return result.regexMatches.filter((cmd) => {
    const cmdType = cmd.cmdType || cmd.matchCmd?.type
    return cmdType === 'regex' || cmdType === 'img' || cmdType === 'files'
  })
})

/**
 * 计算时间衰减因子
 * @param lastUsed 最后使用时间戳
 * @returns 衰减因子 (0-1)，越近的时间返回值越接近1
 */
function calculateTimeDecay(lastUsed: number): number {
  const now = Date.now()
  const daysSinceLastUse = (now - lastUsed) / (1000 * 60 * 60 * 24)

  // 使用指数衰减：每30天衰减到50%
  const halfLife = 30
  return Math.pow(0.5, daysSinceLastUse / halfLife)
}

/**
 * 计算使用频率分数
 * @param useCount 使用次数
 * @param lastUsed 最后使用时间戳
 * @returns 频率分数，越高表示越常用且最近使用过
 */
function calculateFrequencyScore(useCount: number, lastUsed: number): number {
  if (!useCount || useCount === 0) return 0

  // 时间衰减因子
  const decayFactor = calculateTimeDecay(lastUsed)

  // 使用次数分数（使用对数增长，避免极端值）
  const countScore = Math.log10(useCount + 1) * 100

  // 应用时间衰减
  return countScore * decayFactor
}

// 推荐列表
const recommendations = computed(() => {
  // 粘贴图片、文本或文件时不显示推荐
  if (props.pastedImage || props.pastedText || props.pastedFiles) return []
  if (props.searchQuery.trim() === '') {
    return []
  }

  const searchResult = search(props.searchQuery)
  const regexResults = searchResult.regexMatches

  // 只保留 over 类型的匹配指令
  const overTypeResults = regexResults.filter((cmd) => {
    const cmdType = cmd.cmdType || cmd.matchCmd?.type
    return cmdType === 'over'
  })

  // 去重：同一个 feature 只保留第一个匹配的 cmd
  const seenFeatures = new Set<string>()
  const uniqueRegexResults = overTypeResults.filter((item) => {
    const featureKey = item.type === 'plugin' ? `${item.path}:${item.featureCode}` : item.path
    if (seenFeatures.has(featureKey)) {
      return false // 已经出现过，跳过
    }
    seenFeatures.add(featureKey)
    return true // 第一次出现，保留
  })

  // 使用统计数据构建 Map 提升查询性能
  const statsMap = new Map<string, any>()
  for (const item of usageStats.value) {
    const key = item.type === 'plugin' ? `${item.path}:${item.featureCode}` : item.path
    statsMap.set(key, item)
  }

  // 对去重后的正则匹配结果按使用统计排序
  const sortedRegexResults = [...uniqueRegexResults].sort((a, b) => {
    // 快速查找使用统计
    const keyA = a.type === 'plugin' ? `${a.path}:${a.featureCode}` : a.path
    const keyB = b.type === 'plugin' ? `${b.path}:${b.featureCode}` : b.path
    const statsA = statsMap.get(keyA)
    const statsB = statsMap.get(keyB)

    // 计算使用频率分数
    const freqScoreA = statsA ? calculateFrequencyScore(statsA.useCount, statsA.lastUsed) : 0
    const freqScoreB = statsB ? calculateFrequencyScore(statsB.useCount, statsB.lastUsed) : 0

    // 按频率分数降序排序（分数高的排前面）
    return freqScoreB - freqScoreA
  })

  // 百度搜索指令（内置功能，始终放最后）
  const baiduSearch = commandDataStore.applySpecialConfig({
    path: `baidu-search:${props.searchQuery}`
  } as any)

  // 排序后的正则匹配结果 + 百度搜索
  return [...sortedRegexResults, baiduSearch]
})

// 访达功能列表
const finderActions = computed(() => {
  // 只要是 Finder 就显示功能列表，点击时再获取路径
  if (!windowStore.isFinder()) {
    return []
  }
  return [
    {
      name: '复制路径',
      path: 'finder-action:copy-path',
      icon: '📋',
      type: 'builtin' as const
    },
    {
      name: '在终端打开',
      path: 'finder-action:open-terminal',
      icon: '⌨️',
      type: 'builtin' as const
    }
  ]
})

// 显示的应用列表
const displayApps = computed(() => {
  // 粘贴图片、文本或文件时不显示历史记录
  if (props.pastedImage || props.pastedText || props.pastedFiles) return []

  if (props.searchQuery.trim() === '') {
    return getRecentCommands()
  } else {
    return []
  }
})

// 固定应用列表
const pinnedApps = computed(() => {
  return getPinnedCommands()
})

// 可见的最近使用应用（用于键盘导航）
const visibleRecentApps = computed(() => {
  const defaultVisibleCount = 9 * 2 // itemsPerRow * defaultVisibleRows（对应 CollapsibleList 的配置）
  if (isRecentExpanded.value || displayApps.value.length <= defaultVisibleCount) {
    return displayApps.value
  }
  return displayApps.value.slice(0, defaultVisibleCount)
})

// 可见的固定应用（用于键盘导航）
const visiblePinnedApps = computed(() => {
  const defaultVisibleCount = 9 * 2 // itemsPerRow * defaultVisibleRows
  if (isPinnedExpanded.value || pinnedApps.value.length <= defaultVisibleCount) {
    return pinnedApps.value
  }
  return pinnedApps.value.slice(0, defaultVisibleCount)
})

// 将一维数组转换为二维数组(每行9个)
function arrayToGrid(arr: any[], cols = 9): any[][] {
  const grid: any[][] = []
  for (let i = 0; i < arr.length; i += cols) {
    grid.push(arr.slice(i, i + cols))
  }
  return grid
}

// 可见的最佳搜索结果（用于键盘导航）
const visibleBestSearchResults = computed(() => {
  const defaultVisibleCount = 9 * 2 // itemsPerRow * defaultVisibleRows
  const canExpand = bestSearchResults.value.length > defaultVisibleCount

  if (!canExpand || isSearchResultsExpanded.value) {
    return bestSearchResults.value
  }
  return bestSearchResults.value.slice(0, defaultVisibleCount)
})

// 可见的最佳匹配（用于键盘导航）
const visibleBestMatches = computed(() => {
  const defaultVisibleCount = 9 * 2
  if (isBestMatchesExpanded.value || bestMatches.value.length <= defaultVisibleCount) {
    return bestMatches.value
  }
  return bestMatches.value.slice(0, defaultVisibleCount)
})

// 可见的推荐列表（用于键盘导航）
const visibleRecommendations = computed(() => {
  const defaultVisibleCount = 9 * 2
  if (isRecommendationsExpanded.value || recommendations.value.length <= defaultVisibleCount) {
    return recommendations.value
  }
  return recommendations.value.slice(0, defaultVisibleCount)
})

// 构建导航网格
const navigationGrid = computed(() => {
  const sections: any[] = []

  if (props.searchQuery.trim() || props.pastedImage || props.pastedText || props.pastedFiles) {
    // 有搜索或粘贴图片/文本/文件时：最佳搜索结果 + 最佳匹配 + 匹配推荐
    if (visibleBestSearchResults.value.length > 0) {
      const searchGrid = arrayToGrid(visibleBestSearchResults.value)
      searchGrid.forEach((row) => {
        sections.push({ type: 'bestSearch', items: row })
      })
    }

    if (visibleBestMatches.value.length > 0) {
      const matchGrid = arrayToGrid(visibleBestMatches.value)
      matchGrid.forEach((row) => {
        sections.push({ type: 'bestMatch', items: row })
      })
    }

    if (visibleRecommendations.value.length > 0) {
      const recommendGrid = arrayToGrid(visibleRecommendations.value)
      recommendGrid.forEach((row) => {
        sections.push({ type: 'recommendation', items: row })
      })
    }
  } else {
    // 无搜索时：最近使用 + 固定栏 + 访达
    const appsGrid = arrayToGrid(visibleRecentApps.value)
    appsGrid.forEach((row) => {
      sections.push({ type: 'apps', items: row })
    })

    if (visiblePinnedApps.value.length > 0) {
      const pinnedGrid = arrayToGrid(visiblePinnedApps.value)
      pinnedGrid.forEach((row) => {
        sections.push({ type: 'pinned', items: row })
      })
    }

    if (finderActions.value.length > 0) {
      const finderGrid = arrayToGrid(finderActions.value)
      finderGrid.forEach((row) => {
        sections.push({ type: 'finder', items: row })
      })
    }
  }

  return sections
})

// 计算指定类型在列表中的绝对索引（支持多行情况）
function getAbsoluteIndexForSection(sectionType: string): number {
  const grid = navigationGrid.value
  if (grid.length === 0 || selectedRow.value >= grid.length) {
    return -1
  }

  const currentRow = grid[selectedRow.value]
  if (currentRow.type !== sectionType) {
    return -1
  }

  // 找到该类型的起始行
  let startRow = 0
  for (let i = 0; i < grid.length; i++) {
    if (grid[i].type === sectionType) {
      startRow = i
      break
    }
  }

  // 计算相对于起始行的索引
  return (selectedRow.value - startRow) * 9 + selectedCol.value
}

// 计算最佳搜索结果中的选中索引
const bestSearchResultSelectedIndex = computed(() => {
  return getAbsoluteIndexForSection('bestSearch')
})

// 计算最佳匹配中的选中索引
const bestMatchSelectedIndex = computed(() => {
  return getAbsoluteIndexForSection('bestMatch')
})

// 计算推荐列表中的选中索引
const recommendationSelectedIndex = computed(() => {
  if (!props.searchQuery.trim()) return -1
  return getAbsoluteIndexForSection('recommendation')
})

// 获取当前选中的元素
const selectedItem = computed(() => {
  const grid = navigationGrid.value
  if (grid.length === 0 || selectedRow.value >= grid.length) {
    return null
  }
  const row = grid[selectedRow.value]
  if (!row || selectedCol.value >= row.items.length) {
    return null
  }
  return row.items[selectedCol.value]
})

// 监听搜索内容变化,重置选中状态
watch(
  [
    () => props.searchQuery,
    () => props.pastedImage,
    () => props.pastedText,
    () => props.pastedFiles
  ],
  () => {
    selectedRow.value = 0
    selectedCol.value = 0
    // 直接 emit，让 App.vue 的 updateWindowHeight 中的 nextTick 处理 DOM 更新
    emit('height-changed')
  }
)

// 监听展开状态变化，调整窗口高度
watch(
  [
    isRecentExpanded,
    isPinnedExpanded,
    isSearchResultsExpanded,
    isBestMatchesExpanded,
    isRecommendationsExpanded
  ],
  () => {
    // 直接 emit，让 App.vue 的 updateWindowHeight 中的 nextTick 处理 DOM 更新
    emit('height-changed')
  }
)

// 滚动到选中的项
function scrollToSelectedItem(): void {
  const container = scrollContainerRef.value
  if (!container) {
    return
  }

  nextTick(() => {
    // 查找所有选中的项
    const selectedElements = container.querySelectorAll('.app-item.selected')
    if (!selectedElements || selectedElements.length === 0) {
      return
    }

    // 获取第一个选中的项（应该只有一个）
    const selectedElement = selectedElements[0] as HTMLElement
    if (!selectedElement) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const targetRect = selectedElement.getBoundingClientRect()

    // 检查是否在可见区域内
    const isAbove = targetRect.top < containerRect.top
    const isBelow = targetRect.bottom > containerRect.bottom

    if (isAbove) {
      // 项目在上方，滚动到顶部对齐
      const scrollTop = container.scrollTop + (targetRect.top - containerRect.top) - 10 // 留一点边距
      container.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth'
      })
    } else if (isBelow) {
      // 项目在下方，滚动到底部对齐
      const scrollTop = container.scrollTop + (targetRect.bottom - containerRect.bottom) + 10 // 留一点边距
      container.scrollTo({
        top: scrollTop,
        behavior: 'smooth'
      })
    }
  })
}

// 监听选中项变化，自动滚动
watch([selectedRow, selectedCol], () => {
  scrollToSelectedItem()
})

// 监听固定列表变化，调整窗口高度（特别是从空到非空或从非空到空时）
watch(
  () => pinnedApps.value.length,
  () => {
    // 直接 emit，让 App.vue 的 updateWindowHeight 中的 nextTick 处理 DOM 更新
    emit('height-changed')
  }
)

// 监听历史记录列表变化，调整窗口高度
watch(
  () => displayApps.value.length,
  () => {
    // 直接 emit，让 App.vue 的 updateWindowHeight 中的 nextTick 处理 DOM 更新
    emit('height-changed')
  }
)

// 监听 grid 变化，修正选中位置（主要是为了处理折叠/展开时的边界情况）
watch(navigationGrid, (newGrid) => {
  if (newGrid.length === 0) {
    // 如果没有内容，不需要重置为 0，因为可能只是暂时为空或者正在加载
    // 但如果越界了，肯定要修
    return
  }

  if (selectedRow.value >= newGrid.length) {
    selectedRow.value = Math.max(0, newGrid.length - 1)
  }

  const currentRow = newGrid[selectedRow.value]
  if (currentRow && selectedCol.value >= currentRow.items.length) {
    selectedCol.value = Math.max(0, currentRow.items.length - 1)
  }
})

// 处理应用右键菜单
async function handleAppContextMenu(
  app: any,
  fromSearch = false,
  fromPinned = false
): Promise<void> {
  const menuItems: any[] = []

  // 只在历史记录中显示"从使用记录删除"
  if (!fromSearch && !fromPinned) {
    menuItems.push({
      id: `remove-from-history:${JSON.stringify({ path: app.path, featureCode: app.featureCode })}`,
      label: '从使用记录删除'
    })
  }

  // 如果是应用（不是插件和系统设置），显示"打开文件位置"
  if (
    app.type !== 'system-setting' &&
    app.type !== 'plugin' &&
    app.path &&
    !app.path.startsWith('baidu-search:')
  ) {
    menuItems.push({
      id: `reveal-in-finder:${JSON.stringify({ path: app.path })}`,
      label: '打开文件位置'
    })
  }

  // 根据是否已固定显示不同选项
  if (isPinned(app.path, app.featureCode)) {
    menuItems.push({
      id: `unpin-app:${JSON.stringify({ path: app.path, featureCode: app.featureCode })}`,
      label: '取消固定'
    })
  } else {
    menuItems.push({
      id: `pin-app:${JSON.stringify({
        name: app.name,
        path: app.path,
        icon: app.icon,
        pinyin: app.pinyin,
        pinyinAbbr: app.pinyinAbbr,
        type: app.type,
        featureCode: app.featureCode,
        pluginExplain: app.pluginExplain
      })}`,
      label: '固定到顶部'
    })
  }

  // 如果是插件，添加插件设置菜单
  if (app.type === 'plugin') {
    // 从数据库读取配置
    let outKillPlugins: string[] = []
    let autoDetachPlugins: string[] = []
    try {
      const killData = await window.ztools.dbGet('outKillPlugin')
      if (killData && Array.isArray(killData)) {
        outKillPlugins = killData
      }
      const detachData = await window.ztools.dbGet('autoDetachPlugin')
      if (detachData && Array.isArray(detachData)) {
        autoDetachPlugins = detachData
      }
    } catch (error) {
      console.log('读取配置失败:', error)
    }

    const isAutoKill = outKillPlugins.includes(app.name)
    const isAutoDetach = autoDetachPlugins.includes(app.name)

    menuItems.push({
      label: '插件设置',
      submenu: [
        {
          id: `toggle-auto-kill:${app.name}`,
          label: '退出到后台立即结束运行',
          type: 'checkbox',
          checked: isAutoKill
        },
        {
          id: `toggle-auto-detach:${app.name}`,
          label: '自动分离为独立窗口',
          type: 'checkbox',
          checked: isAutoDetach
        }
      ]
    })
  }

  await window.ztools.showContextMenu(menuItems)
}

// 选择应用
async function handleSelectApp(app: any): Promise<void> {
  console.log('选择应用:', app)
  try {
    // 如果是"上次匹配"指令，执行恢复逻辑
    if (app.path === 'special:last-match') {
      const state = await window.ztools.restoreLastMatch()
      if (state) {
        emit('restore-match', state)
      }
      return
    }

    // 构造 payload 和 type
    let payload: any = props.searchQuery
    let type = app.cmdType || 'text' // 默认使用 cmd 的类型

    if (app.cmdType === 'img' && props.pastedImage) {
      // 图片类型：传递 base64 字符串
      payload = props.pastedImage
    } else if (app.cmdType === 'over' && props.pastedText) {
      // 文本类型：传递粘贴的文本
      payload = props.pastedText
    } else if (app.cmdType === 'files' && props.pastedFiles) {
      // 文件类型：将 FileItem[] 转换为 MatchFile[]
      payload = props.pastedFiles.map((file) => ({
        isFile: !file.isDirectory,
        isDirectory: file.isDirectory,
        name: file.name,
        path: file.path
      })) as MatchFile[]
    }

    // 启动应用或插件（后端会自动处理视图切换和添加历史记录）
    await window.ztools.launch({
      path: app.path,
      type: app.type || 'app',
      featureCode: app.featureCode,
      name: app.name, // 传递 cmd 名称用于历史记录显示
      cmdType: app.cmdType || 'text', // 传递 cmdType 用于判断是否添加历史
      confirmDialog: app.confirmDialog
        ? {
            type: app.confirmDialog.type,
            buttons: [...app.confirmDialog.buttons],
            defaultId: app.confirmDialog.defaultId,
            cancelId: app.confirmDialog.cancelId,
            title: app.confirmDialog.title,
            message: app.confirmDialog.message,
            detail: app.confirmDialog.detail
          }
        : undefined, // 解构为纯对象，避免 Proxy
      param: {
        payload,
        type, // 传递 cmd 的实际类型
        // 传递完整的输入状态（用于匹配指令的状态保存）
        inputState: {
          searchQuery: props.searchQuery,
          pastedImage: props.pastedImage,
          // 将 pastedFiles 转换为纯对象数组，避免 Proxy 导致的序列化错误
          pastedFiles: props.pastedFiles
            ? props.pastedFiles.map((file) => ({
                isFile: !file.isDirectory,
                isDirectory: file.isDirectory,
                name: file.name,
                path: file.path
              }))
            : null,
          pastedText: props.pastedText
        }
      }
    })
  } catch (error) {
    console.error('启动失败:', error)
  }
}

// 访达功能选择
async function handleFinderAction(item: any): Promise<void> {
  try {
    // 先获取 Finder 路径
    const path = await window.ztools.getFinderPath()

    if (!path) {
      console.error('无法获取 Finder 路径')
      return
    }

    // 根据不同的 action 执行相应操作
    if (item.path === 'finder-action:copy-path') {
      await window.ztools.copyToClipboard(path)
      window.ztools.hideWindow()
    } else if (item.path === 'finder-action:open-terminal') {
      await window.ztools.openTerminal(path)
      window.ztools.hideWindow()
    }
  } catch (error) {
    console.error('执行 Finder 操作失败:', error)
  }
}

// 选择推荐项
async function handleRecommendationSelect(item: any): Promise<void> {
  if (item.path.startsWith('baidu-search:')) {
    // 百度搜索
    const query = encodeURIComponent(props.searchQuery)
    const url = `https://www.baidu.com/s?wd=${query}`
    await window.ztools.openExternal(url)
    window.ztools.hideWindow()
  } else if (item.type === 'plugin') {
    // 插件类型（正则匹配的结果）
    await handleSelectApp(item)
  }
}

// 键盘导航（支持循环）
async function handleKeydown(event: KeyboardEvent): Promise<void> {
  const grid = navigationGrid.value
  if (!grid || grid.length === 0) return

  switch (event.key) {
    case 'ArrowDown': {
      event.preventDefault()
      if (selectedRow.value < grid.length - 1) {
        // 不是最后一行，正常向下
        selectedRow.value++
      } else {
        // 最后一行，循环到第一行
        selectedRow.value = 0
      }
      // 调整列索引，确保不超出当前行的范围
      const currentRowItems = grid[selectedRow.value].items
      selectedCol.value = Math.min(selectedCol.value, currentRowItems.length - 1)
      break
    }
    case 'ArrowUp': {
      event.preventDefault()
      if (selectedRow.value > 0) {
        // 不是第一行，正常向上
        selectedRow.value--
      } else {
        // 第一行，循环到最后一行
        selectedRow.value = grid.length - 1
      }
      // 调整列索引，确保不超出当前行的范围
      const upRowItems = grid[selectedRow.value].items
      selectedCol.value = Math.min(selectedCol.value, upRowItems.length - 1)
      break
    }
    case 'ArrowRight': {
      event.preventDefault()
      if (grid.length > 0 && selectedRow.value < grid.length) {
        const currentRowItems = grid[selectedRow.value].items
        if (selectedCol.value < currentRowItems.length - 1) {
          // 当前行还有下一个项目，正常右移
          selectedCol.value++
        } else if (selectedRow.value < grid.length - 1) {
          // 当前行最后一个，跳到下一行第一个
          selectedRow.value++
          selectedCol.value = 0
        } else {
          // 最后一行的最后一个，循环到第一行第一个
          selectedRow.value = 0
          selectedCol.value = 0
        }
      }
      break
    }
    case 'ArrowLeft': {
      event.preventDefault()
      if (selectedCol.value > 0) {
        // 当前行还有前一个项目，正常左移
        selectedCol.value--
      } else if (selectedRow.value > 0) {
        // 当前行第一个，跳到上一行最后一个
        selectedRow.value--
        const prevRowItems = grid[selectedRow.value].items
        selectedCol.value = prevRowItems.length - 1
      } else {
        // 第一行第一个，循环到最后一行最后一个
        selectedRow.value = grid.length - 1
        const lastRowItems = grid[selectedRow.value].items
        selectedCol.value = lastRowItems.length - 1
      }
      break
    }
    case 'Enter': {
      event.preventDefault()
      const item = selectedItem.value
      if (item) {
        const currentRow = grid[selectedRow.value]
        if (currentRow.type === 'finder') {
          handleFinderAction(item)
        } else if (currentRow.type === 'recommendation') {
          handleRecommendationSelect(item)
        } else {
          handleSelectApp(item)
        }
      }
      break
    }
  }
}

// 处理上下文菜单命令
async function handleContextMenuCommand(command: string): Promise<void> {
  if (command.startsWith('remove-from-history:')) {
    const jsonStr = command.replace('remove-from-history:', '')
    try {
      const { path, featureCode } = JSON.parse(jsonStr)
      await removeFromHistory(path, featureCode)
      // Store 直接更新数据后，在 nextTick 中发送事件确保 DOM 已更新
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('从历史记录删除失败:', error)
    }
  } else if (command.startsWith('pin-app:')) {
    const appJson = command.replace('pin-app:', '')
    try {
      const app = JSON.parse(appJson)
      await pinCommand(app)
      // Store 直接更新数据后，在 nextTick 中发送事件确保 DOM 已更新
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
      const { path, featureCode } = JSON.parse(jsonStr)
      await unpinCommand(path, featureCode)
      // Store 直接更新数据后，在 nextTick 中发送事件确保 DOM 已更新
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
      // 打开文件位置后也聚焦搜索框（这个操作不涉及窗口高度变化）
      emit('focus-input')
    } catch (error) {
      console.error('打开文件位置失败:', error)
    }
  } else if (command.startsWith('toggle-auto-kill:')) {
    const pluginName = command.replace('toggle-auto-kill:', '')
    try {
      let outKillPlugins: string[] = []
      try {
        const data = await window.ztools.dbGet('outKillPlugin')
        if (data && Array.isArray(data)) {
          outKillPlugins = data
        }
      } catch (error) {
        console.debug('未找到outKillPlugin配置', error)
      }

      const index = outKillPlugins.indexOf(pluginName)
      if (index !== -1) {
        outKillPlugins.splice(index, 1)
      } else {
        outKillPlugins.push(pluginName)
      }

      await window.ztools.dbPut('outKillPlugin', outKillPlugins)
      console.log('已更新 outKillPlugin 配置:', outKillPlugins)
    } catch (error: any) {
      console.error('切换自动结束配置失败:', error)
    }
  } else if (command.startsWith('toggle-auto-detach:')) {
    const pluginName = command.replace('toggle-auto-detach:', '')
    try {
      let autoDetachPlugins: string[] = []
      try {
        const data = await window.ztools.dbGet('autoDetachPlugin')
        if (data && Array.isArray(data)) {
          autoDetachPlugins = data
        }
      } catch (error) {
        console.debug('未找到 autoDetachPlugin 配置', error)
      }

      const index = autoDetachPlugins.indexOf(pluginName)
      if (index !== -1) {
        autoDetachPlugins.splice(index, 1)
      } else {
        autoDetachPlugins.push(pluginName)
      }

      await window.ztools.dbPut('autoDetachPlugin', autoDetachPlugins)
      console.log('已更新 autoDetachPlugin 配置:', autoDetachPlugins)
    } catch (error: any) {
      console.error('切换自动分离配置失败:', error)
    }
  }
}

// 重置选中状态
function resetSelection(): void {
  selectedRow.value = 0
  selectedCol.value = 0
}

// 点击容器聚焦输入框
function handleContainerClick(event: MouseEvent): void {
  // 如果点击的是指令卡片或其子元素，不聚焦输入框
  const target = event.target as HTMLElement
  if (target.closest('.app-item')) {
    return
  }
  // 点击空白区域时聚焦输入框
  emit('focus-input')
}

// 监听搜索条件变化，重置折叠状态
watch(
  () => [props.searchQuery, props.pastedImage, props.pastedFiles, props.pastedText],
  () => {
    // 当搜索条件变化时，重置所有列表的展开状态
    resetCollapseState()
  }
)

// 重置所有列表的折叠状态
function resetCollapseState(): void {
  isRecentExpanded.value = false
  isPinnedExpanded.value = false
  isSearchResultsExpanded.value = false
  isBestMatchesExpanded.value = false
  isRecommendationsExpanded.value = false
}

// 初始化
onMounted(() => {
  // 监听上下文菜单命令
  window.ztools.onContextMenuCommand(handleContextMenuCommand)
  // 加载使用统计
  loadUsageStats()
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
  max-height: 541px; /* 600 - 59 (搜索框高度) */
  overflow-y: auto;
  overflow-x: hidden;
  user-select: none; /* 禁止选取文本 */
  padding: 0 12px 2px 12px;

  /* Firefox 滚动条样式 */
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}

/* Webkit 浏览器（Chrome、Safari、Edge）滚动条样式 */
.scrollable-content::-webkit-scrollbar {
  width: 6px;
}

.scrollable-content::-webkit-scrollbar-track {
  background: transparent;
}

.scrollable-content::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
  transition: background-color 0.2s;
}

.scrollable-content::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.3);
}

/* 暗色模式下的滚动条颜色 */
@media (prefers-color-scheme: dark) {
  .scrollable-content {
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .scrollable-content::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
  }

  .scrollable-content::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.3);
  }
}

.content-section {
  flex: 1;
}

.search-results {
  display: flex;
  flex-direction: column;
}

.result-section {
  display: flex;
  flex-direction: column;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 5px 10px;
  margin-bottom: 4px; /* 与结果项间距保持一致 */
}
</style>
