<script setup lang="ts">
import { PluginDetail as SharedPluginDetail } from '@/components'
import type { PluginUninstallOptions } from '@/components'

defineProps<{
  plugin: any
  isLoading?: boolean
  isRunning?: boolean
  isPinned?: boolean
  isDisabled?: boolean
  showMarketButton?: boolean
}>()

defineEmits<{
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
}>()
</script>

<template>
  <SharedPluginDetail
    :plugin="plugin"
    :is-loading="isLoading"
    :is-running="isRunning"
    :is-pinned="isPinned"
    :is-disabled="isDisabled"
    :show-pin-button="true"
    :show-disable-toggle="true"
    :show-market-button="showMarketButton"
    :show-detail="false"
    :show-size="false"
    @back="$emit('back')"
    @open="$emit('open')"
    @download="$emit('download')"
    @upgrade="$emit('upgrade')"
    @uninstall="$emit('uninstall', $event)"
    @kill="$emit('kill')"
    @open-folder="$emit('open-folder')"
    @open-market="$emit('open-market')"
    @toggle-pin="$emit('toggle-pin')"
    @toggle-disabled="$emit('toggle-disabled', $event)"
  />
</template>
