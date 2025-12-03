<template>
  <div class="scrollable-content">
    <!-- 无搜索时显示历史 -->
    <div v-if="!searchQuery.trim()" class="content-section">
      <!-- 最近使用 -->
      <div v-if="displayApps.length > 0">
        <div class="section-header">
          <div class="section-title">最近使用</div>
          <div
            v-if="displayApps.length > 18"
            class="expand-btn"
            @click="isRecentExpanded = !isRecentExpanded"
          >
            {{ isRecentExpanded ? '收起' : `展开 (${displayApps.length})` }}
          </div>
        </div>
        <AppList
          :apps="visibleRecentApps"
          :selected-index="getAbsoluteIndexForSection('apps')"
          :empty-text="loading ? '正在加载应用...' : '未找到应用'"
          @select="handleSelectApp"
          @contextmenu="handleAppContextMenu"
        />
      </div>

      <!-- 固定栏 -->
      <div v-if="pinnedApps.length > 0" class="pinned-section">
        <div class="section-header">
          <div class="section-title">固定</div>
          <div
            v-if="pinnedApps.length > 18"
            class="expand-btn"
            @click="isPinnedExpanded = !isPinnedExpanded"
          >
            {{ isPinnedExpanded ? '收起' : `展开 (${pinnedApps.length})` }}
          </div>
        </div>
        <DraggableAppList
          :apps="visiblePinnedApps"
          :selected-index="getAbsoluteIndexForSection('pinned')"
          :empty-text="''"
          @select="handleSelectApp"
          @contextmenu="(app) => handleAppContextMenu(app, false, true)"
          @update:apps="handlePinnedOrderUpdate"
        />
      </div>

      <!-- 访达 -->
      <div v-if="finderActions.length > 0" class="result-section">
        <div class="section-title">访达</div>
        <AppList
          :apps="finderActions"
          :selected-index="getAbsoluteIndexForSection('finder')"
          :empty-text="''"
          @select="handleFinderAction"
        />
      </div>
    </div>

    <!-- 有搜索时显示搜索结果 -->
    <div v-else class="search-results">
      <!-- 最佳匹配 -->
      <div v-if="internalSearchResults.length > 0" class="result-section">
        <div class="section-title">最佳匹配</div>
        <AppList
          :apps="internalSearchResults"
          :selected-index="searchResultSelectedIndex"
          :empty-text="'未找到应用'"
          @select="handleSelectApp"
          @contextmenu="(app) => handleAppContextMenu(app, true)"
        />
      </div>

      <!-- 匹配推荐 -->
      <div class="result-section">
        <div class="section-title">匹配推荐</div>
        <AppList
          :apps="recommendations"
          :selected-index="recommendationSelectedIndex"
          :empty-text="''"
          @select="handleRecommendationSelect"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import AppList from './AppList.vue'
import DraggableAppList from './DraggableAppList.vue'
import { useAppDataStore } from '../stores/appDataStore'
import { useWindowStore } from '../stores/windowStore'

interface Props {
  searchQuery: string
}

const props = defineProps<Props>()

const windowStore = useWindowStore()

const emit = defineEmits<{
  (e: 'height-changed'): void
}>()

// 使用 store
const appDataStore = useAppDataStore()
const {
  loading,
  search,
  addToHistory,
  getRecentApps,
  removeFromHistory,
  pinApp,
  unpinApp,
  isPinned,
  getPinnedApps,
  updatePinnedOrder
} = appDataStore

// 内部状态
const selectedRow = ref(0)
const selectedCol = ref(0)
const isRecentExpanded = ref(false)
const isPinnedExpanded = ref(false)

// 搜索结果
const internalSearchResults = computed(() => {
  const result = search(props.searchQuery)
  return result.bestMatches
})

// 推荐列表
const recommendations = computed(() => {
  if (props.searchQuery.trim() === '') {
    return []
  }

  const result = search(props.searchQuery)
  const regexResults = result.regexMatches

  // 正则匹配结果 + 百度搜索（内置，放最后）
  return [
    ...regexResults,
    {
      name: '百度搜索',
      path: `baidu-search:${props.searchQuery}`,
      icon: '🔍'
    }
  ]
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
      icon: '📋'
    },
    {
      name: '在终端打开',
      path: 'finder-action:open-terminal',
      icon: '⌨️'
    }
  ]
})

// 显示的应用列表
const displayApps = computed(() => {
  if (props.searchQuery.trim() === '') {
    return getRecentApps()
  } else {
    return internalSearchResults.value
  }
})

// 固定应用列表
const pinnedApps = computed(() => {
  return getPinnedApps()
})

// 可见的最近使用应用
const visibleRecentApps = computed(() => {
  if (isRecentExpanded.value) {
    return displayApps.value
  }
  return displayApps.value.slice(0, 18)
})

// 可见的固定应用
const visiblePinnedApps = computed(() => {
  if (isPinnedExpanded.value) {
    return pinnedApps.value
  }
  return pinnedApps.value.slice(0, 18)
})

// 将一维数组转换为二维数组(每行9个)
function arrayToGrid(arr: any[], cols = 9): any[][] {
  const grid: any[][] = []
  for (let i = 0; i < arr.length; i += cols) {
    grid.push(arr.slice(i, i + cols))
  }
  return grid
}

// 构建导航网格
const navigationGrid = computed(() => {
  const sections: any[] = []

  if (props.searchQuery.trim()) {
    // 有搜索时：搜索结果 + 推荐
    if (internalSearchResults.value.length > 0) {
      const searchGrid = arrayToGrid(internalSearchResults.value)
      searchGrid.forEach((row) => {
        sections.push({ type: 'search', items: row })
      })
    }

    if (recommendations.value.length > 0) {
      const recommendGrid = arrayToGrid(recommendations.value)
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

// 计算搜索结果中的选中索引
const searchResultSelectedIndex = computed(() => {
  return getAbsoluteIndexForSection('search')
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
  () => props.searchQuery,
  () => {
    selectedRow.value = 0
    selectedCol.value = 0
    nextTick(() => {
      emit('height-changed')
    })
  }
)

// 监听展开状态变化，调整窗口高度
watch([isRecentExpanded, isPinnedExpanded], () => {
  nextTick(() => {
    emit('height-changed')
  })
})

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

// 处理固定应用排序更新
function handlePinnedOrderUpdate(newOrder: any[]): void {
  if (isPinnedExpanded.value) {
    // 展开状态下，直接更新
    updatePinnedOrder(newOrder)
  } else {
    // 折叠状态下，newOrder 只是前 18 个
    // 需要保留后面的应用
    const hiddenApps = pinnedApps.value.slice(18)
    const fullList = [...newOrder, ...hiddenApps]
    updatePinnedOrder(fullList)
  }
}

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

  await window.ztools.showContextMenu(menuItems)
}

// 选择应用
async function handleSelectApp(app: any): Promise<void> {
  console.log('选择应用:', app)
  try {
    // 添加到历史记录
    await addToHistory(app)
    // 启动应用或插件（后端会自动处理视图切换）
    await window.ztools.launch({
      path: app.path,
      type: app.type || 'app',
      featureCode: app.featureCode,
      param: {
        payload: props.searchQuery,
        type: app.cmdType || 'text' // 传递 cmdType，默认为 text
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

// 键盘导航
async function handleKeydown(event: KeyboardEvent): Promise<void> {
  const grid = navigationGrid.value
  if (!grid || grid.length === 0) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      if (selectedRow.value < grid.length - 1) {
        selectedRow.value++
        const currentRowItems = grid[selectedRow.value].items
        selectedCol.value = Math.min(selectedCol.value, currentRowItems.length - 1)
      }
      break
    case 'ArrowUp':
      event.preventDefault()
      if (selectedRow.value > 0) {
        selectedRow.value--
        const currentRowItems = grid[selectedRow.value].items
        selectedCol.value = Math.min(selectedCol.value, currentRowItems.length - 1)
      }
      break
    case 'ArrowRight':
      if (grid.length > 0 && selectedRow.value < grid.length) {
        const currentRowItems = grid[selectedRow.value].items
        if (selectedCol.value < currentRowItems.length - 1) {
          selectedCol.value++
        }
      }
      break
    case 'ArrowLeft':
      if (selectedCol.value > 0) {
        selectedCol.value--
      }
      break
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
      nextTick(() => {
        emit('height-changed')
      })
    } catch (error) {
      console.error('从历史记录删除失败:', error)
    }
  } else if (command.startsWith('pin-app:')) {
    const appJson = command.replace('pin-app:', '')
    try {
      const app = JSON.parse(appJson)
      await pinApp(app)
      nextTick(() => {
        emit('height-changed')
      })
    } catch (error) {
      console.error('固定应用失败:', error)
    }
  } else if (command.startsWith('unpin-app:')) {
    const jsonStr = command.replace('unpin-app:', '')
    try {
      const { path, featureCode } = JSON.parse(jsonStr)
      await unpinApp(path, featureCode)
      nextTick(() => {
        emit('height-changed')
      })
    } catch (error) {
      console.error('取消固定失败:', error)
    }
  }
}

// 重置选中状态
function resetSelection(): void {
  selectedRow.value = 0
  selectedCol.value = 0
}

// 初始化
onMounted(() => {
  // 监听上下文菜单命令
  window.ztools.onContextMenuCommand(handleContextMenuCommand)
})

// 导出方法供父组件调用
defineExpose({
  navigationGrid,
  handleKeydown,
  resetSelection
})
</script>

<style scoped>
.scrollable-content {
  max-height: 541px; /* 600 - 59 (搜索框高度) */
  overflow-y: auto;
  overflow-x: hidden;
}

/* 自定义滚动条 */
.scrollable-content::-webkit-scrollbar {
  width: 6px;
}

.scrollable-content::-webkit-scrollbar-track {
  background: transparent;
}

.scrollable-content::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.scrollable-content::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
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

.pinned-section {
  display: flex;
  flex-direction: column;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-right: 10px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 5px 10px;
}

.expand-btn {
  font-size: 12px;
  color: var(--primary-color);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.2s;
}

.expand-btn:hover {
  background: var(--hover-bg);
}
</style>
