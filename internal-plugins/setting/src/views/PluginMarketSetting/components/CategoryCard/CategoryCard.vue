<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  icon?: string
  showDescription: boolean
  pluginCount?: number
}>()

defineEmits<{
  (e: 'click'): void
}>()
</script>
<template>
  <div class="card category-card" @click="$emit('click')">
    <div class="category-card-left">
      <img v-if="icon" :src="icon" alt="" class="category-icon" draggable="false" />
      <div class="category-info">
        <div class="category-title">{{ title }}</div>
        <div v-if="showDescription && description" class="category-description">
          {{ description }}
        </div>
      </div>
    </div>
    <div class="category-card-right">
      <span v-if="pluginCount !== undefined" class="category-count">{{ pluginCount }}</span>
      <svg
        class="category-arrow"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.category-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.category-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.category-card-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.category-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}

.category-info {
  min-width: 0;
}

.category-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.category-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-card-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 12px;
}

.category-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.category-arrow {
  color: var(--text-secondary);
  opacity: 0.6;
}
</style>
