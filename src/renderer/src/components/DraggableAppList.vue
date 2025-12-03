<template>
  <div class="app-list">
    <draggable
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
          class="app-item"
          :class="{ selected: index === selectedIndex }"
          @click="$emit('select', app)"
          @contextmenu.prevent="$emit('contextmenu', app)"
        >
          <!-- Emoji 图标 (单个字符) -->
          <div v-if="app.icon && app.icon.length <= 2" class="app-icon-emoji">
            {{ app.icon }}
          </div>
          <!-- 图片图标 (base64) -->
          <img
            v-else-if="app.icon"
            :src="app.icon"
            class="app-icon"
            @error="(e) => onIconError(e, app)"
          />
          <!-- 占位图标 -->
          <div v-else class="app-icon-placeholder">
            {{ app.name.charAt(0).toUpperCase() }}
          </div>
          <span class="app-name" v-html="getHighlightedName(app)"></span>
        </div>
      </template>
    </draggable>
    <div v-if="apps.length === 0" class="empty-state">
      {{ emptyText || '未找到应用' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { highlightMatch } from '../utils/highlight'

interface MatchInfo {
  indices: Array<[number, number]>
  value: string
  key: string
}

interface App {
  name: string
  path: string
  icon?: string
  matches?: MatchInfo[]
}

const props = defineProps<{
  apps: App[]
  selectedIndex: number
  emptyText?: string
}>()

const emit = defineEmits<{
  (e: 'select', app: App): void
  (e: 'contextmenu', app: App): void
  (e: 'update:apps', apps: App[]): void
}>()

const localApps = computed({
  get: () => props.apps,
  set: (value) => emit('update:apps', value)
})

function onDragEnd(): void {
  // 拖动结束后自动通过 v-model 更新
}

function getHighlightedName(app: App): string {
  return highlightMatch(app.name, app.matches)
}

function onIconError(event: Event, app: App): void {
  // 图标加载失败,隐藏图标
  ;(event.target as HTMLImageElement).style.display = 'none'
  console.warn(`无法加载图标: ${app.name}`)
}
</script>

<style scoped>
.app-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px;
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr); /* 每行 9 个 */
}

.app-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5px;
  border-radius: 8px;
  cursor: move; /* 拖动光标 */
  transition: background 0.15s;
  width: 100%; /* 占满格子宽度 */
  overflow: hidden;
}

.app-item:hover {
  background: var(--hover-bg);
}

.app-item.selected {
  background: var(--active-bg);
}

/* 拖动时的样式 */
.ghost {
  opacity: 0.5;
  background: var(--border-color);
}

.chosen {
  opacity: 0.8;
}

.app-icon {
  width: 48px;
  height: 48px;
  margin-bottom: 8px;
  border-radius: 8px;
  flex-shrink: 0;
  pointer-events: none; /* 防止图标阻止拖动 */
}

.app-icon-emoji {
  width: 48px;
  height: 48px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  flex-shrink: 0;
  pointer-events: none;
}

.app-icon-placeholder {
  width: 48px;
  height: 48px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: var(--primary-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-primary);
  font-size: 20px;
  font-weight: bold;
  flex-shrink: 0;
  pointer-events: none;
}

.app-name {
  font-size: 12px;
  color: var(--text-color);
  text-align: center;
  width: 100%; /* 占满父容器宽度 */
  line-height: 1.4;
  padding: 0 4px; /* 左右留一点边距 */
  pointer-events: none;

  /* 多行文本省略 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; /* 最多显示2行 */
  overflow: hidden;
  word-break: break-all; /* 允许在任意字符间断行 */
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
}

/* 自定义滚动条 */
.app-list::-webkit-scrollbar {
  width: 6px;
}

.app-list::-webkit-scrollbar-track {
  background: transparent;
}

.app-list::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.app-list::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* 高亮样式 */
.app-name :deep(mark.highlight) {
  background-color: transparent; /* 不使用背景色 */
  color: var(--highlight-color); /* 橙色文字 */
  font-weight: 600;
}
</style>
