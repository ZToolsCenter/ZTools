<template>
  <div v-if="apps.length > 0" class="collapsible-section">
    <div
      class="section-header"
      :class="{ clickable: canExpand }"
      @click="canExpand ? toggleExpand() : undefined"
    >
      <div class="section-title">{{ title }}</div>
      <div v-if="canExpand" class="expand-btn-text">
        {{ isExpanded ? '收起' : `展开 (${apps.length})` }}
      </div>
    </div>
    <!-- 统一使用 CommandList，通过 draggable prop 控制 -->
    <div class="list-content">
      <AppList
        :apps="visibleApps"
        :selected-index="selectedIndex"
        :empty-text="emptyText"
        :draggable="draggable"
        @select="$emit('select', $event)"
        @contextmenu="$emit('contextmenu', $event)"
        @update:apps="handleAppsUpdate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Command } from '../../stores/commandDataStore'
import AppList from './CommandList.vue'

interface Props {
  title: string // 标题
  apps: Command[] // 应用列表
  selectedIndex?: number // 选中索引
  emptyText?: string // 空状态文本
  draggable?: boolean // 是否支持拖拽
  expanded?: MaybeRefOrGetter<boolean> // 是否展开（v-model）
  itemsPerRow?: number // 每行显示数量
  defaultVisibleRows?: number // 默认显示的行数（折叠时）
}

const props = withDefaults(defineProps<Props>(), {
  selectedIndex: -1,
  emptyText: '',
  draggable: false,
  expanded: false,
  itemsPerRow: 9,
  defaultVisibleRows: 1 // 默认显示1行
})

const emit = defineEmits<{
  (e: 'select', app: Command): void
  (e: 'contextmenu', app: Command): void
  (e: 'update:apps', apps: Command[]): void
  (e: 'update:expanded', expanded: boolean): void
}>()

// 默认可见的项目数量
const defaultVisibleCount = computed(() => {
  return props.itemsPerRow * props.defaultVisibleRows
})

// 是否可以展开（列表项数量超过默认可见数量）
const canExpand = computed(() => {
  return props.apps.length > defaultVisibleCount.value
})

// 是否展开
const isExpanded = computed({
  get: () => toValue(props.expanded),
  set: (value) => emit('update:expanded', value)
})

// 可见的应用列表
const visibleApps = computed(() => {
  let result
  if (!canExpand.value) {
    // 不可展开时，显示所有项目
    result = props.apps
  } else if (isExpanded.value) {
    result = props.apps
  } else {
    // 折叠时显示默认行数的项目
    result = props.apps.slice(0, defaultVisibleCount.value)
  }

  return result
})

// 切换展开/收起
function toggleExpand(): void {
  isExpanded.value = !isExpanded.value
}

// 处理拖拽更新
function handleAppsUpdate(newOrder: Command[]): void {
  if (props.expanded) {
    // 展开状态下，直接更新
    emit('update:apps', newOrder)
  } else {
    // 折叠状态下，需要保留隐藏的项目
    const hiddenApps = props.apps.slice(defaultVisibleCount.value)
    const fullList = [...newOrder, ...hiddenApps]
    emit('update:apps', fullList)
  }
}
</script>

<style scoped>
.collapsible-section {
  display: flex;
  flex-direction: column;
  margin-bottom: 4px; /* 列表间距 */
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-content {
  margin-top: 2px; /* 与结果项间距保持一致，确保标题和内容之间有间距 */
}

/* 可点击的标题行（只在可展开时应用） */
.section-header.clickable {
  cursor: pointer;
  margin: 0;
  padding: 2px 0;
  min-height: 28px;
}

.section-header.clickable:hover {
  background: var(--hover-bg);
}

/* 不可展开的标题行 */
.section-header:not(.clickable) {
  margin: 0;
  padding: 2px 0;
  min-height: 28px;
}

.section-title {
  font-size: 14.5px;
  font-weight: 600;
  padding: 0; /* 移除内边距 */
  line-height: 24px; /* 控制行高 */
}

.expand-btn-text {
  font-size: 14px;
  opacity: 0.6;
  user-select: none;
  white-space: nowrap; /* 防止文本换行 */
}

/* 只在可点击状态下，hover 时改变透明度 */
.section-header.clickable:hover .expand-btn-text {
  opacity: 1;
}
</style>
