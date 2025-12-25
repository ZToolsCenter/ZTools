<template>
  <div ref="listRef" class="app-list">
    <!-- 可拖拽列表 -->
    <Draggable
      v-if="props.draggable"
      v-model="localApps"
      class="app-grid"
      item-key="path"
      :animation="200"
      ghost-class="ghost"
      chosen-class="chosen"
      @end="onDragEnd"
    >
      <template #item="{ element: app, index }">
        <div
          :ref="(el) => setItemRef(el, index)"
          class="app-item"
          :class="{ selected: index === selectedIndex }"
          style="cursor: move"
          @click="$emit('select', app)"
          @contextmenu.prevent="$emit('contextmenu', app)"
        >
          <!-- 图片图标 (base64) -->
          <AdaptiveIcon
            v-if="app.icon && !hasIconError(app)"
            :src="app.icon"
            class="app-icon"
            draggable="false"
            @error="(e) => onIconError(e, app)"
          />
          <!-- 占位图标（无图标或加载失败时显示） -->
          <div v-else class="app-icon-placeholder">
            {{ app.name.charAt(0).toUpperCase() }}
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span class="app-name" v-html="getHighlightedName(app)"></span>
        </div>
      </template>
    </Draggable>
    <!-- 普通列表 -->
    <div v-if="!props.draggable" class="app-grid">
      <div
        v-for="(app, index) in apps"
        :key="`${app.path}-${app.featureCode || ''}-${app.name}`"
        :ref="(el) => setItemRef(el, index)"
        class="app-item"
        :class="{ selected: index === selectedIndex }"
        draggable="false"
        @click="$emit('select', app)"
        @contextmenu.prevent="$emit('contextmenu', app)"
      >
        <!-- 图片图标 (base64) -->
        <AdaptiveIcon
          v-if="app.icon && !hasIconError(app)"
          :src="app.icon"
          class="app-icon"
          draggable="false"
          @error="(e) => onIconError(e, app)"
        />
        <!-- 占位图标（无图标或加载失败时显示） -->
        <div v-else class="app-icon-placeholder">
          {{ app.name.charAt(0).toUpperCase() }}
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <span class="app-name" v-html="getHighlightedName(app)"></span>
      </div>
    </div>
    <div v-if="apps.length === 0" class="empty-state">
      {{ emptyText || '未找到应用' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import Draggable from 'vuedraggable'
import type { Command } from '../../stores/commandDataStore'
import { highlightMatch } from '../../utils/highlight'
import AdaptiveIcon from '../common/AdaptiveIcon.vue'

const props = withDefaults(
  defineProps<{
    apps: Command[]
    selectedIndex: number
    emptyText?: string
    draggable?: boolean
  }>(),
  {
    emptyText: '',
    draggable: false
  }
)

const emit = defineEmits<{
  (e: 'select', app: Command): void
  (e: 'contextmenu', app: Command): void
  (e: 'update:apps', apps: Command[]): void
}>()

// 可拖拽列表的数据绑定
const localApps = computed({
  get: () => props.apps,
  set: (value) => emit('update:apps', value)
})

function onDragEnd(): void {
  // 拖动结束后自动通过 v-model 更新
}

const listRef = ref<HTMLElement>()
const itemRefs = ref<(HTMLElement | null)[]>([])

function setItemRef(el: Element | ComponentPublicInstance | null, index: number): void {
  if (el instanceof HTMLElement) {
    itemRefs.value[index] = el
  }
}

// 滚动到指定索引的项目
function scrollToIndex(index: number): void {
  if (!listRef.value || index < 0 || index >= itemRefs.value.length) {
    return
  }

  const targetElement = itemRefs.value[index]
  if (!targetElement) {
    return
  }

  const container = listRef.value
  const containerRect = container.getBoundingClientRect()
  const targetRect = targetElement.getBoundingClientRect()

  // 检查是否在可见区域内
  const isAbove = targetRect.top < containerRect.top
  const isBelow = targetRect.bottom > containerRect.bottom

  if (isAbove) {
    // 项目在上方，滚动到顶部对齐
    container.scrollTop = targetElement.offsetTop - container.offsetTop
  } else if (isBelow) {
    // 项目在下方，滚动到底部对齐
    container.scrollTop =
      targetElement.offsetTop -
      container.offsetTop -
      container.clientHeight +
      targetElement.offsetHeight
  }
}

// 监听选中索引变化，自动滚动
watch(
  () => props.selectedIndex,
  (newIndex) => {
    if (newIndex >= 0) {
      nextTick(() => {
        scrollToIndex(newIndex)
      })
    }
  }
)

function getHighlightedName(app: Command): string {
  return highlightMatch(app.name, app.matches)
}

// 记录图标加载失败的应用
const iconErrors = ref<Set<string>>(new Set())

function onIconError(_event: Event, app: Command): void {
  // 图标加载失败，标记该应用
  const key = `${app.path}-${app.featureCode || ''}-${app.name}`
  iconErrors.value.add(key)
  console.warn(`无法加载图标: ${app.name}`)
}

// 检查图标是否加载失败
function hasIconError(app: Command): boolean {
  const key = `${app.path}-${app.featureCode || ''}-${app.name}`
  return iconErrors.value.has(key)
}

// 暴露方法供父组件调用
defineExpose({
  scrollToIndex
})
</script>

<style scoped>
.app-list {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr); /* 每行 9 个 */
  gap: 0; /* 项目之间的间隙 */
}

.app-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px; /* 上下8px，左右4px */
  border-radius: 8px;
  cursor: pointer;
  width: 100%; /* 占满格子宽度 */
  overflow: hidden;
  user-select: none; /* 禁止文本选择 */
}

/* 拖动时的样式 */
.ghost {
  opacity: 0.5;
  background: var(--border-color);
}

.chosen {
  opacity: 0.8;
}

/* 拖拽模式下，图标和文本防止阻止拖动 */
:deep(.ghost .app-icon),
:deep(.ghost .app-icon-emoji),
:deep(.ghost .app-icon-placeholder),
:deep(.ghost .app-name),
:deep(.chosen .app-icon),
:deep(.chosen .app-icon-emoji),
:deep(.chosen .app-icon-placeholder),
:deep(.chosen .app-name) {
  pointer-events: none;
}

.app-item:hover {
  background: var(--hover-bg);
}

.app-item.selected {
  background: var(--active-bg);
}

.app-icon {
  width: 32px;
  height: 32px;
  margin-bottom: 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.app-icon-placeholder {
  width: 32px;
  height: 32px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: var(--primary-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-primary);
  font-size: 14px;
  font-weight: bold;
  flex-shrink: 0;
}

.app-name {
  font-size: 12px;
  font-weight: 500; /* 增加字体粗细，提高可读性 */
  line-height: 16px; /* 固定行高 */
  color: var(--text-color);
  text-align: center;
  width: 100%; /* 占满父容器宽度 */
  padding: 0 4px; /* 左右留一点边距 */
  height: 32px; /* 固定高度：16px * 2 = 32px（两行文本） */

  /* 多行文本省略 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; /* 最多显示2行 */
  line-clamp: 2; /* 标准属性 */
  overflow: hidden;
  word-break: break-all; /* 允许在任意字符间断行 */
}

/* 拖拽模式下，图标和文本防止阻止拖动 */
:deep(.app-item[draggable] .app-icon),
:deep(.app-item[draggable] .app-icon-emoji),
:deep(.app-item[draggable] .app-icon-placeholder),
:deep(.app-item[draggable] .app-name) {
  pointer-events: none;
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
}

/* 高亮样式 */
.app-name :deep(mark.highlight) {
  background-color: transparent; /* 不使用背景色 */
  color: var(--highlight-color); /* 橙色文字 */
  font-weight: 600;
}
</style>
