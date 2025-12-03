<template>
  <div class="settings-container">
    <!-- 左侧菜单 -->
    <div class="settings-sidebar">
      <div
        v-for="item in menuItems"
        :key="item.id"
        class="menu-item"
        :class="{ active: activeMenu === item.id }"
        @click="activeMenu = item.id"
      >
        <Icon :name="item.icon" :size="18" class="menu-icon" />
        <span class="menu-label">{{ item.label }}</span>
      </div>
    </div>

    <!-- 右侧内容区 -->
    <div class="settings-content">
      <!-- 通用设置 -->
      <GeneralSettings v-if="activeMenu === 'general'" />

      <!-- 插件中心 -->
      <PluginCenter v-if="activeMenu === 'plugins'" />

      <!-- 插件市场 -->
      <PluginMarket v-if="activeMenu === 'market'" />

      <!-- 我的数据 -->
      <DataManagement v-if="activeMenu === 'data'" />

      <!-- 全局快捷键 -->
      <GlobalShortcuts v-if="activeMenu === 'shortcuts'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Icon from './Icon.vue'
import GeneralSettings from './GeneralSettings.vue'
import PluginCenter from './PluginCenter.vue'
import PluginMarket from './PluginMarket.vue'
import DataManagement from './DataManagement.vue'
import GlobalShortcuts from './GlobalShortcuts.vue'

// 菜单项类型
interface MenuItem {
  id: string
  icon: 'settings' | 'plugin' | 'keyboard' | 'store' | 'database'
  label: string
}

// 菜单项
const menuItems: MenuItem[] = [
  { id: 'general', icon: 'settings', label: '通用设置' },
  { id: 'shortcuts', icon: 'keyboard', label: '全局快捷键' },
  { id: 'plugins', icon: 'plugin', label: '已安装插件' },
  { id: 'market', icon: 'store', label: '插件市场' },
  { id: 'data', icon: 'database', label: '我的数据' }
]

const activeMenu = ref('general')
</script>

<style scoped>
.settings-container {
  display: flex;
  height: 500px; /* 固定高度 */
  background: var(--bg-color);
}

/* 左侧菜单 */
.settings-sidebar {
  width: 200px;
  border-right: 1px solid var(--border-color);
  padding: 12px 8px;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-secondary);
  border-radius: 8px;
}

.menu-item:last-child {
  margin-bottom: 0;
}

.menu-item:hover {
  background: var(--hover-bg);
}

.menu-item.active {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.menu-icon {
  margin-right: 10px;
  color: inherit;
}

.menu-label {
  font-size: 14px;
  font-weight: 500;
}

/* 右侧内容区 */
.settings-content {
  flex: 1;
  padding: 10px;
  overflow-y: auto;
}

/* 自定义滚动条 */
.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-track {
  background: transparent;
}

.settings-content::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
</style>
