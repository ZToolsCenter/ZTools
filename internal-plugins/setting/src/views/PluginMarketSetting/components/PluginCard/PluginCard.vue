<script setup lang="ts">
import { AdaptiveIcon } from '@/components'
import MarketPluginActionButton from '@/components/common/MarketPluginActionButton.vue'
import PluginUpgradeButton from '@/components/common/PluginUpgradeButton.vue'
import type { Plugin, PluginDownloadState } from '../types'

defineProps<{
  plugin: Plugin
  installingPlugin: string | null
  canUpgrade: boolean
  downloadState?: PluginDownloadState
}>()

defineEmits<{
  (e: 'click'): void
  (e: 'open'): void
  (e: 'download'): void
  (e: 'upgrade'): void
}>()
</script>
<template>
  <div class="card plugin-card" :title="plugin.description" @click="$emit('click')">
    <div class="plugin-icon">
      <AdaptiveIcon
        :src="plugin.logo ?? ''"
        class="plugin-logo-img"
        alt="icon"
        loading="lazy"
        decoding="async"
        draggable="false"
      />
    </div>
    <div class="plugin-info">
      <div class="plugin-name">{{ plugin.title || plugin.name }}</div>
      <div class="plugin-description" :title="plugin.description">
        {{ plugin.description }}
      </div>
    </div>
    <div class="plugin-action">
      <PluginUpgradeButton
        v-if="plugin.installed && canUpgrade"
        class="upgrade-btn"
        :version="plugin.version"
        :loading="installingPlugin === plugin.name"
        :download-state="downloadState"
        :disabled="!!installingPlugin && installingPlugin !== plugin.name"
        @click.stop="$emit('upgrade')"
      />
      <MarketPluginActionButton
        v-else
        :installed="plugin.installed"
        :download-state="downloadState"
        :disabled="!!installingPlugin && installingPlugin !== plugin.name"
        @open="$emit('open')"
        @download="$emit('download')"
      />
    </div>
  </div>
</template>

<style scoped>
.plugin-card {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 0;
}

.plugin-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.plugin-icon {
  flex-shrink: 0;
  margin-right: 12px;
}

.plugin-logo-img {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  object-fit: cover;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-description {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-action {
  flex-shrink: 0;
  margin-left: 10px;
}
</style>
