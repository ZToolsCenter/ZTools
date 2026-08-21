<template>
  <div v-if="items.length > 0" class="main-push-section">
    <div class="section-header" @click="$emit('enter-app')">
      <div class="section-title-row">
        <div class="section-icon-wrap">
          <img v-if="icon" :src="icon" class="section-icon" alt="" draggable="false" />
          <span v-if="pluginName && isDevelopmentPluginName(pluginName)" class="section-dev-badge"
            >DEV</span
          >
        </div>
        <div class="section-title">{{ title }}</div>
      </div>
      <div class="section-action">进入应用 ›</div>
    </div>
    <div class="push-list" role="listbox" :aria-label="title">
      <div
        v-for="(item, index) in items"
        :key="index"
        class="push-item list-item"
        :class="{ selected: index === selectedIndex }"
        role="option"
        :aria-selected="index === selectedIndex"
        @click="$emit('select', item, index)"
      >
        <div class="item-icon">
          <img
            v-if="item._resolvedIcon || item.icon"
            :src="item._resolvedIcon || item.icon"
            alt=""
            draggable="false"
          />
        </div>
        <div class="item-content">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="item-text" v-html="getHighlightedText(item.text)"></div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="item.title" class="item-title" v-html="getHighlightedText(item.title)"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MainPushItem } from '../../composables/useMainPushResults'
import { highlightSubstring } from '../../utils/highlight'
import { isDevelopmentPluginName } from '../../../../shared/pluginRuntimeNamespace'

interface Props {
  title: string
  icon?: string // 标题行图标
  pluginName?: string
  items: MainPushItem[]
  selectedIndex?: number
  searchQuery?: string // 搜索查询（用于高亮）
}

const props = withDefaults(defineProps<Props>(), {
  selectedIndex: -1,
  icon: '',
  pluginName: '',
  searchQuery: ''
})

defineEmits<{
  (e: 'select', item: MainPushItem, index: number): void
  (e: 'enter-app'): void
}>()

function getHighlightedText(text: string): string {
  return highlightSubstring(text, props.searchQuery)
}
</script>

<style scoped>
.main-push-section {
  display: flex;
  flex-direction: column;
  margin-bottom: 2px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 12px;
  min-height: 26px;
  cursor: pointer;
  border-radius: 6px;
  user-select: none;
}

.section-header:hover {
  background: var(--hover-bg);
}

.section-header:hover .section-action {
  opacity: 1;
}

.section-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.section-icon-wrap {
  position: relative;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.section-icon {
  width: 15px;
  height: 15px;
  object-fit: contain;
  border-radius: 3px;
}

.section-dev-badge {
  position: absolute;
  right: -8px;
  bottom: -6px;
  display: inline-flex;
  min-width: 18px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--bg-color);
  border-radius: 999px;
  background: var(--highlight-color);
  color: var(--text-on-primary);
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
  padding: 2px 4px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 22px;
}

.section-action {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.push-list {
  display: flex;
  flex-direction: column;
}

.push-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s;
  user-select: none;
}

.push-item:hover {
  background: var(--hover-bg);
}

.push-item.selected {
  background: var(--primary-light-bg);
}

.item-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.item-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 20px;
}

.item-title {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 16px;
}

/* 高亮样式 */
.item-text :deep(mark.highlight),
.item-title :deep(mark.highlight) {
  background-color: transparent;
  color: var(--highlight-color);
  font-weight: 600;
}
</style>
