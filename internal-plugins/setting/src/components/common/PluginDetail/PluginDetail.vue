<script setup lang="ts">
import { toRef } from 'vue'
import { DetailPanel } from '@/components'
import PluginDetailHeader from './PluginDetailHeader.vue'
import PluginDetailTabs from './PluginDetailTabs.vue'
import PluginDetailToolbar from './PluginDetailToolbar.vue'
import type { PluginDownloadState, PluginItem, PluginUninstallOptions, TabId } from './types'
import { usePluginDetail } from './usePluginDetail'

const props = withDefaults(
  defineProps<{
    plugin: PluginItem
    isLoading?: boolean
    downloadState?: PluginDownloadState
    isRunning?: boolean
    // 已安装插件特有
    isPinned?: boolean
    isDisabled?: boolean
    // 功能开关
    showPinButton?: boolean
    showDisableToggle?: boolean
    showDetail?: boolean
    showCommands?: boolean
    showComments?: boolean
    showData?: boolean
    showSize?: boolean
    showDownloadCount?: boolean
    showMarketButton?: boolean
  }>(),
  {
    showDetail: true,
    showCommands: true,
    showData: true
  }
)

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'open'): void
  (e: 'download'): void
  (e: 'upgrade'): void
  (e: 'uninstall', options: PluginUninstallOptions): void
  (e: 'kill'): void
  (e: 'open-folder'): void
  (e: 'open-market'): void
  (e: 'toggle-pin'): void
  (e: 'toggle-disabled', disabled: boolean): void
  (e: 'tab-switch', tabId: TabId): void
}>()

const pluginRef = toRef(props, 'plugin')
const isRunningRef = toRef(props, 'isRunning')

const {
  // 设置状态
  showSettingsDropdown,
  isAutoKill,
  isAutoDetach,
  isAutoStart,
  isMainPushEnabled,
  pluginHasMainPush,
  toggleSettingsDropdown,
  toggleAutoKill,
  toggleAutoDetach,
  toggleAutoStart,
  toggleMainPushEnabled,
  // Tab
  activeTab,
  availableTabs,
  switchTab,
  // README
  readmeContent,
  readmeLoading,
  readmeError,
  renderedMarkdown,
  // 插件数据
  docKeys,
  dataLoading,
  dataError,
  expandedDataId,
  currentDocContent,
  currentDocType,
  isClearing,
  handleClearAllData,
  toggleDataDetail,
  // 内存
  memoryInfo,
  memoryLoading,
  // 版本
  canUpgrade,
  // 操作
  handleUninstall
} = usePluginDetail({
  plugin: pluginRef,
  isRunning: isRunningRef,
  showDetail: props.showDetail,
  showComments: props.showComments,
  showCommands: props.showCommands,
  showData: props.showData
})

function onSwitchTab(tabId: TabId): void {
  switchTab(tabId)
  emit('tab-switch', tabId)
}
</script>

<template>
  <DetailPanel title="插件详情" @back="emit('back')">
    <template #header-right>
      <PluginDetailToolbar
        :is-running="isRunning"
        :is-development="plugin.isDevelopment"
        :installed="plugin.installed"
        :can-upgrade="canUpgrade"
        :is-pinned="isPinned"
        :is-disabled="isDisabled"
        :show-pin-button="showPinButton"
        :show-disable-toggle="showDisableToggle"
        :show-market-button="showMarketButton"
        :show-settings-dropdown="showSettingsDropdown"
        :is-auto-kill="isAutoKill"
        :is-auto-detach="isAutoDetach"
        :is-auto-start="isAutoStart"
        :is-main-push-enabled="isMainPushEnabled"
        :show-main-push-toggle="pluginHasMainPush"
        @open="emit('open')"
        @kill="emit('kill')"
        @open-folder="emit('open-folder')"
        @open-market="emit('open-market')"
        @uninstall="handleUninstall((options) => emit('uninstall', options))"
        @toggle-pin="emit('toggle-pin')"
        @toggle-disabled="emit('toggle-disabled', $event)"
        @toggle-settings-dropdown="toggleSettingsDropdown"
        @toggle-auto-kill="toggleAutoKill"
        @toggle-auto-detach="toggleAutoDetach"
        @toggle-auto-start="toggleAutoStart"
        @toggle-main-push-enabled="toggleMainPushEnabled"
      />
    </template>

    <PluginDetailHeader
      :plugin="plugin"
      :is-loading="isLoading"
      :download-state="downloadState"
      :can-upgrade="canUpgrade"
      :show-size="showSize"
      :show-download-count="showDownloadCount"
      @download="emit('download')"
      @upgrade="emit('upgrade')"
    >
      <template #title-badge>
        <span v-if="isDisabled" class="detail-disabled-badge">已禁用</span>
      </template>
      <template #meta-extra>
        <template v-if="plugin.installed && isRunning">
          <div class="meta-divider"></div>
          <div class="meta-item">
            <div class="meta-label">内存</div>
            <div class="meta-icon">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="2"
                  y="5"
                  width="20"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path d="M7 9L7 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <path
                  d="M12 9L12 15"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
                <path
                  d="M17 9L17 15"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </div>
            <div v-if="memoryLoading" class="meta-value">
              <span class="memory-loading">...</span>
            </div>
            <div v-else-if="memoryInfo" class="meta-value">{{ memoryInfo.total }} MB</div>
            <div v-else class="meta-value">-</div>
          </div>
        </template>
      </template>
    </PluginDetailHeader>

    <PluginDetailTabs
      :plugin="plugin"
      :active-tab="activeTab"
      :available-tabs="availableTabs"
      :readme-loading="readmeLoading"
      :readme-error="readmeError"
      :rendered-markdown="renderedMarkdown as string"
      :readme-content="readmeContent"
      :doc-keys="docKeys"
      :data-loading="dataLoading"
      :data-error="dataError"
      :expanded-data-id="expandedDataId"
      :current-doc-content="currentDocContent"
      :current-doc-type="currentDocType"
      :is-clearing="isClearing"
      @switch-tab="onSwitchTab"
      @toggle-data-detail="toggleDataDetail"
      @clear-all-data="handleClearAllData"
    >
      <template #extra-tabs>
        <slot name="extra-tabs" />
      </template>
    </PluginDetailTabs>
  </DetailPanel>
</template>

<style scoped>
.detail-disabled-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  color: var(--warning-color);
  background: color-mix(in srgb, var(--warning-color) 12%, transparent);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent);
}

.meta-divider {
  width: 1px;
  height: 32px;
  background: var(--divider-color);
  flex-shrink: 0;
}

.meta-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.meta-icon {
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.meta-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.meta-value {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-color);
}

.memory-loading {
  color: var(--text-secondary);
  font-size: 14px;
}
</style>
