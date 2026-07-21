<template>
  <!-- 覆盖内容区的详情面板（无遮罩） -->
  <div class="detail-panel">
    <div class="detail-topbar">
      <button class="icon-btn back-btn" aria-label="返回" title="返回" @click="emit('back')">
        <BackIcon width="18" height="18" aria-hidden="true" />
      </button>
      <div class="topbar-title">{{ title }}</div>
    </div>

    <div class="detail-scrollable">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import BackIcon from '@renderer/assets/icons/arrow-back.svg?component'

defineProps<{
  title: string
}>()

const emit = defineEmits<{
  (e: 'back'): void
}>()
</script>

<style>
/* 全局过渡动画类（供 Transition 组件使用） */

/* slide: 从右进入，向右离开（用于一级↔二级） */
.slide-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.slide-leave-active {
  transition:
    transform 0.18s ease-in,
    opacity 0s;
}

.slide-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.slide-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.slide-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.slide-leave-to {
  transform: translateX(100%);
  opacity: 1;
}

/* slide-reverse: 从左进入，向左离开（用于二级↔三级） */
.slide-reverse-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.slide-reverse-leave-active {
  transition:
    transform 0.18s ease-in,
    opacity 0s;
}

.slide-reverse-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}

.slide-reverse-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.slide-reverse-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.slide-reverse-leave-to {
  transform: translateX(-100%);
  opacity: 1;
}
</style>

<style scoped>
/* 覆盖内容区的详情面板 */
.detail-panel {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

.detail-topbar {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--divider-color);
}

.topbar-title {
  font-size: 14px;
  color: var(--text-secondary);
}

.detail-scrollable {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 图标按钮颜色样式 */
.back-btn {
  color: var(--text-color);
}

.back-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--primary-color);
}
</style>
