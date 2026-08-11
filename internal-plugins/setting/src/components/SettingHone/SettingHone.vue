<script setup lang="ts">
import { LeftMenu } from '@/components'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { startNotificationPolling, stopNotificationPolling, useMarketLayout } from '@/composables'
import { applyInitialAppearance } from './applyInitialAppearance'

const route = useRoute()
const { isMarketFullscreen, setMarketFullscreen } = useMarketLayout()

// 离开市场路由时重置全屏态，避免下一次从设置侧栏进入市场时误判为全屏。
watch(
  () => route.name,
  (name) => {
    if (name !== 'Market') setMarketFullscreen(false)
  }
)

onMounted(() => {
  startNotificationPolling()
  // 页面挂载后立即应用已持久化的外观配置。
  void applyInitialAppearance({
    dbGet: (key) => window.ztools.internal.dbGet(key),
    setTheme: (theme) => window.ztools.internal.setTheme(theme),
    setWindowMaterial: (material) => window.ztools.internal.setWindowMaterial(material),
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
    <!-- 市场全屏浏览时隐藏设置侧栏，让市场作为独立一级页面呈现 -->
    <div v-if="!isMarketFullscreen" class="setting-hone-menu">
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
