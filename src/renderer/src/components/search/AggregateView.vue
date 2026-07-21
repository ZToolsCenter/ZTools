<template>
  <div class="aggregate-view">
    <!-- 无搜索时：历史记录 + 固定列表 + 窗口匹配 -->
    <div v-if="!hasSearchContent" class="content-section">
      <!-- 最近使用 -->
      <CollapsibleList
        v-if="showRecentInSearch"
        :expanded="recentExpanded"
        title="最近使用"
        :apps="displayApps"
        :selected-index="getAbsoluteIndexForSection('apps')"
        :empty-text="loading ? '正在加载应用...' : '未找到应用'"
        :default-visible-rows="recentRows"
        :draggable="false"
        @select="$emit('select', $event)"
        @contextmenu="(app) => $emit('contextmenu', app, 'history')"
        @update:expanded="$emit('update:recent-expanded', $event)"
      />

      <!-- 固定栏 -->
      <CollapsibleList
        :expanded="pinnedExpanded"
        title="已固定"
        :apps="pinnedApps"
        :selected-index="getAbsoluteIndexForSection('pinned')"
        :default-visible-rows="pinnedRows"
        :draggable="true"
        @select="$emit('select', $event)"
        @contextmenu="(app) => $emit('contextmenu', app, 'pinned')"
        @update:apps="$emit('update:pinned-order', $event)"
        @update:expanded="$emit('update:pinned-expanded', $event)"
      />
    </div>
    <!-- 有搜索时：搜索结果 -->
    <div v-if="hasSearchContent" class="search-results">
      <!-- 最佳搜索结果（模糊搜索） -->
      <CollapsibleList
        v-if="bestSearchResults.length > 0"
        :expanded="searchResultsExpanded"
        title="最佳搜索结果"
        :apps="bestSearchResults"
        :selected-index="getAbsoluteIndexForSection('bestSearch')"
        :empty-text="'未找到应用'"
        :default-visible-rows="2"
        :draggable="false"
        :search-query="searchQuery"
        @select="$emit('select', $event)"
        @contextmenu="(app) => $emit('contextmenu', app, 'search')"
        @update:expanded="$emit('update:search-results-expanded', $event)"
      />

      <!-- 最佳匹配（匹配指令：regex/img/files） -->
      <CollapsibleList
        v-if="bestMatches.length > 0"
        :expanded="bestMatchesExpanded"
        title="最佳匹配"
        :apps="bestMatches"
        :selected-index="getAbsoluteIndexForSection('bestMatch')"
        :empty-text="''"
        :default-visible-rows="2"
        :draggable="false"
        :search-query="searchQuery"
        @select="$emit('select', $event)"
        @contextmenu="(app) => $emit('contextmenu', app, 'search')"
        @update:expanded="$emit('update:best-matches-expanded', $event)"
      />

      <!-- 匹配推荐（over 类型） -->
      <CollapsibleList
        :expanded="recommendationsExpanded"
        title="匹配推荐"
        :apps="recommendations"
        :selected-index="getAbsoluteIndexForSection('recommendation')"
        :empty-text="''"
        :default-visible-rows="2"
        :draggable="false"
        :search-query="searchQuery"
        :show-pinned-indicator="true"
        @select="$emit('select-recommendation', $event)"
        @contextmenu="(app) => $emit('contextmenu', app, 'recommendation')"
        @update:expanded="$emit('update:recommendations-expanded', $event)"
      />

      <!-- mainPush 插件搜索结果 -->
      <MainPushList
        v-for="group in mainPushGroups"
        :key="group.featureKey"
        :title="group.featureExplain || group.pluginName"
        :icon="group.featureIcon || group.pluginLogo"
        :plugin-name="group.pluginName"
        :items="group.items"
        :selected-index="getMainPushSelectedIndex(group.featureKey)"
        :search-query="searchQuery"
        @select="(item, _index) => $emit('select-main-push', group, item)"
        @enter-app="$emit('enter-main-push-app', group)"
      />
    </div>
    <div class="content-section">
      <!-- 窗口匹配栏 -->
      <CollapsibleList
        v-if="windowMatchedActions.length > 0"
        :title="windowMatchTitle || '窗口命令'"
        :apps="windowMatchedActions"
        :selected-index="getAbsoluteIndexForSection('window')"
        :empty-text="''"
        :draggable="false"
        @select="$emit('select-window', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MainPushGroup, MainPushItem } from '../../composables/useMainPushResults'
import CollapsibleList from '../common/CollapsibleList.vue'
import MainPushList from '../common/MainPushList.vue'

interface Props {
  searchQuery: string
  pastedImage?: string | null
  pastedFiles?: any[] | null
  pastedText?: string | null
  bestSearchResults: any[]
  bestMatches: any[]
  recommendations: any[]
  mainPushGroups: MainPushGroup[]
  displayApps: any[]
  pinnedApps: any[]
  windowMatchedActions: any[]
  windowMatchTitle: string
  navigationGrid: any[]
  selectedRow: number
  selectedCol: number
  loading: boolean
  showRecentInSearch: boolean
  recentRows: number
  pinnedRows: number
  recentExpanded?: boolean
  pinnedExpanded?: boolean
  searchResultsExpanded?: boolean
  bestMatchesExpanded?: boolean
  recommendationsExpanded?: boolean
}

type ContextMenuSource = 'history' | 'pinned' | 'search' | 'recommendation'

const props = withDefaults(defineProps<Props>(), {
  recentExpanded: false,
  pinnedExpanded: false,
  searchResultsExpanded: false,
  bestMatchesExpanded: false,
  recommendationsExpanded: false
})

defineEmits<{
  select: [app: any]
  'select-window': [item: any]
  'select-recommendation': [item: any]
  'select-main-push': [group: MainPushGroup, item: MainPushItem]
  'enter-main-push-app': [group: MainPushGroup]
  contextmenu: [app: any, source: ContextMenuSource]
  'update:pinned-order': [apps: any[]]
  'height-changed': []
  'update:recent-expanded': [value: boolean]
  'update:pinned-expanded': [value: boolean]
  'update:search-results-expanded': [value: boolean]
  'update:best-matches-expanded': [value: boolean]
  'update:recommendations-expanded': [value: boolean]
}>()

// 是否有搜索内容
const hasSearchContent = computed(() => {
  return !!(props.searchQuery.trim() || props.pastedImage || props.pastedText || props.pastedFiles)
})

// 计算指定类型在列表中的绝对索引
function getAbsoluteIndexForSection(sectionType: string): number {
  const grid = props.navigationGrid
  if (grid.length === 0 || props.selectedRow >= grid.length) {
    return -1
  }

  const currentRow = grid[props.selectedRow]
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
  return (props.selectedRow - startRow) * 9 + props.selectedCol
}

// 获取 mainPush 分组的选中索引
function getMainPushSelectedIndex(featureKey: string): number {
  const grid = props.navigationGrid
  if (grid.length === 0 || props.selectedRow >= grid.length) {
    return -1
  }

  const currentRow = grid[props.selectedRow]
  const expectedType = `mainPush:${featureKey}`
  if (currentRow.type !== expectedType) {
    return -1
  }

  // mainPush 行每行 1 个项目，直接用行偏移计算索引
  let startRow = 0
  for (let i = 0; i < grid.length; i++) {
    if (grid[i].type === expectedType) {
      startRow = i
      break
    }
  }

  return props.selectedRow - startRow
}
</script>

<style scoped>
.aggregate-view {
  display: flex;
  flex-direction: column;
}

.content-section {
  flex: 1;
}

.search-results {
  display: flex;
  flex-direction: column;
}
</style>
