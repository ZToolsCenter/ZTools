<template>
  <div class="card feature-card">
    <div class="feature-header">
      <div v-if="feature.icon" class="feature-icon">
        <span v-if="feature.icon.length <= 2" class="icon-emoji">{{ feature.icon }}</span>
        <img v-else-if="!hasError" :src="feature.icon" draggable="false" @error="handleIconError" />
        <div v-else class="icon-placeholder">
          {{ (feature.explain || feature.name || 'F').charAt(0).toUpperCase() }}
        </div>
      </div>
      <div class="feature-title">
        {{ feature.explain || feature.name }}
      </div>
    </div>
    <div class="feature-commands">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Feature {
  name?: string
  code?: string
  explain?: string
  icon?: string
}

defineProps<{
  feature: Feature
}>()

const hasError = ref(false)

function handleIconError(): void {
  hasError.value = true
}
</script>

<style scoped>
.feature-card {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  cursor: default;
  transition: all 0.2s;
  gap: 8px;
}

.feature-card:hover {
  background: var(--hover-bg);
}

.feature-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.feature-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  overflow: hidden;
}

.feature-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.feature-icon .icon-emoji {
  font-size: 16px;
  line-height: 1;
}

.feature-icon .icon-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--control-bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
}

.feature-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  line-height: 1.4;
}

.feature-commands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
