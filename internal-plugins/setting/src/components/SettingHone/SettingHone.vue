<script setup lang="ts">
import { LeftMenu } from '@/components'
import { onBeforeUnmount, onMounted } from 'vue'
import { startNotificationPolling, stopNotificationPolling } from '@/composables'
import { applyInitialAppearance } from './applyInitialAppearance'

onMounted(() => {
  startNotificationPolling()
  // 页面挂载后应用已保存的主题和当前宿主材质。
  void applyInitialAppearance({
    dbGet: (key) => window.ztools.internal.dbGet(key),
    setTheme: (theme) => window.ztools.internal.setTheme(theme),
    getWindowMaterial: () => window.ztools.internal.getWindowMaterial(),
    isWindows: window.ztools.isWindows()
  }).catch((error) => {
    console.error('初始化设置页外观失败:', error)
  })
})

onBeforeUnmount(() => {
  stopNotificationPolling()
})
</script>

<template>
  <div class="setting-hone">
    <div class="setting-hone-menu">
      <LeftMenu />
    </div>
    <div class="w-full setting-hone-content">
      <router-view />
    </div>
  </div>
</template>

<style lang="less" scoped>
.setting-hone {
  height: 100vh;
  display: flex;
  &-menu {
    height: 100%;
    min-height: 0;
  }

  &-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
}
</style>
