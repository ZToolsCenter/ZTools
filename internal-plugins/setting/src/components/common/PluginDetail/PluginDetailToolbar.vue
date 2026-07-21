<script setup lang="ts">
defineProps<{
  isRunning?: boolean
  isDevelopment?: boolean
  installed?: boolean
  canUpgrade: boolean
  // 已安装插件特有
  isPinned?: boolean
  isDisabled?: boolean
  showPinButton?: boolean
  showDisableToggle?: boolean
  showMarketButton?: boolean
  // 设置
  showSettingsDropdown: boolean
  isAutoKill: boolean
  isAutoDetach: boolean
  isAutoStart: boolean
  isMainPushEnabled: boolean
  showMainPushToggle?: boolean
}>()

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'kill'): void
  (e: 'open-folder'): void
  (e: 'open-market'): void
  (e: 'uninstall'): void
  (e: 'toggle-pin'): void
  (e: 'toggle-disabled', disabled: boolean): void
  (e: 'toggle-settings-dropdown'): void
  (e: 'toggle-auto-kill'): void
  (e: 'toggle-auto-detach'): void
  (e: 'toggle-auto-start'): void
  (e: 'toggle-main-push-enabled'): void
}>()

function handleDisabledToggle(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  emit('toggle-disabled', !target.checked)
}
</script>

<template>
  <template v-if="installed && !canUpgrade">
    <button
      class="icon-btn topbar-action-btn open-btn"
      title="打开"
      :disabled="isDisabled"
      @click="emit('open')"
    >
      <div class="i-z-play font-size-16px" />
    </button>
    <button
      v-if="isRunning"
      class="icon-btn topbar-action-btn kill-btn"
      title="终止运行"
      @click="emit('kill')"
    >
      <div class="i-z-stop font-size-16px" />
    </button>
    <button
      class="icon-btn topbar-action-btn folder-btn"
      title="打开插件目录"
      @click="emit('open-folder')"
    >
      <div class="i-z-folder font-size-16px" />
    </button>
    <button
      v-if="showMarketButton"
      class="icon-btn topbar-action-btn market-btn"
      title="查看市场详情"
      @click="emit('open-market')"
    >
      <div class="i-z-store font-size-16px" />
    </button>
    <button class="icon-btn topbar-action-btn delete-btn" title="卸载" @click="emit('uninstall')">
      <div class="i-z-trash font-size-16px" />
    </button>
    <button
      v-if="showPinButton"
      class="icon-btn topbar-action-btn pin-btn"
      :class="{ 'is-pinned': isPinned }"
      :title="isPinned ? '取消置顶' : '置顶'"
      @click="emit('toggle-pin')"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="4" y1="4" x2="20" y2="4"></line>
        <polyline points="8 10 12 4 16 10"></polyline>
        <line x1="12" y1="10" x2="12" y2="20"></line>
      </svg>
    </button>
    <div class="topbar-settings-wrapper">
      <button
        class="icon-btn topbar-action-btn"
        :class="{ active: showSettingsDropdown }"
        title="插件设置"
        @click.stop="emit('toggle-settings-dropdown')"
      >
        <div class="i-z-settings font-size-16px" />
      </button>
      <Transition name="dropdown">
        <div v-if="showSettingsDropdown" class="settings-dropdown" @click.stop>
          <div v-if="showDisableToggle" class="settings-dropdown-item">
            <div class="settings-item-info">
              <span class="settings-item-label">启用插件</span>
              <span class="settings-item-desc">关闭后插件会从搜索和运行入口中隐藏</span>
            </div>
            <label class="toggle">
              <input type="checkbox" :checked="!isDisabled" @change="handleDisabledToggle" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div v-if="showMainPushToggle" class="settings-dropdown-item">
            <div class="settings-item-info">
              <span class="settings-item-label">搜索栏推送</span>
              <span class="settings-item-desc">关闭后不在搜索栏动态推送内容</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                :checked="isMainPushEnabled"
                @change="emit('toggle-main-push-enabled')"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="settings-dropdown-item">
            <div class="settings-item-info">
              <span class="settings-item-label">退出即结束</span>
              <span class="settings-item-desc">退出到后台时立即终止插件进程</span>
            </div>
            <label class="toggle">
              <input type="checkbox" :checked="isAutoKill" @change="emit('toggle-auto-kill')" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="settings-dropdown-item">
            <div class="settings-item-info">
              <span class="settings-item-label">自动分离窗口</span>
              <span class="settings-item-desc">打开时自动分离为独立窗口</span>
            </div>
            <label class="toggle">
              <input type="checkbox" :checked="isAutoDetach" @change="emit('toggle-auto-detach')" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="settings-dropdown-item">
            <div class="settings-item-info">
              <span class="settings-item-label">跟随启动</span>
              <span class="settings-item-desc">跟随主程序同时启动运行</span>
            </div>
            <label class="toggle">
              <input type="checkbox" :checked="isAutoStart" @change="emit('toggle-auto-start')" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </Transition>
    </div>
  </template>
</template>

<style scoped>
.topbar-action-btn {
  color: var(--text-secondary);
  margin-left: 2px;
}

.topbar-action-btn:hover:not(:disabled) {
  background: var(--hover-bg);
}

.topbar-action-btn.open-btn {
  color: var(--primary-color);
}

.topbar-action-btn.open-btn:hover {
  background: var(--primary-light-bg);
}

.topbar-action-btn.kill-btn {
  color: var(--warning-color);
}

.topbar-action-btn.kill-btn:hover:not(:disabled) {
  background: var(--warning-light-bg);
}

.topbar-action-btn.folder-btn {
  color: var(--primary-color);
}

.topbar-action-btn.folder-btn:hover {
  background: var(--primary-light-bg);
}

.topbar-action-btn.market-btn {
  color: var(--primary-color);
}

.topbar-action-btn.market-btn:hover {
  background: var(--primary-light-bg);
}

.topbar-action-btn.package-btn {
  color: var(--purple-color);
}

.topbar-action-btn.package-btn:hover:not(:disabled) {
  background: var(--purple-light-bg);
}

.topbar-action-btn.reload-btn {
  color: var(--primary-color);
}

.topbar-action-btn.reload-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.topbar-action-btn.delete-btn {
  color: var(--danger-color);
}

.topbar-action-btn.delete-btn:hover:not(:disabled) {
  background: var(--danger-light-bg);
}

.topbar-action-btn.pin-btn {
  color: var(--text-secondary);
}

.topbar-action-btn.pin-btn:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.topbar-action-btn.pin-btn.is-pinned {
  color: var(--primary-color);
}

.topbar-action-btn.pin-btn.is-pinned:hover {
  background: var(--primary-light-bg);
}

.topbar-settings-wrapper {
  position: relative;
}

.topbar-action-btn.active {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.settings-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 240px;
  background: var(--dialog-bg, var(--bg-color));
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  box-shadow: 0 8px 24px var(--shadow-color);
  z-index: 100;
  overflow: hidden;
}

.settings-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  gap: 12px;
}

.settings-dropdown-item + .settings-dropdown-item {
  border-top: 1px solid var(--divider-color);
}

.settings-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.settings-item-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
}

.settings-item-desc {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.3;
}

.settings-dropdown .toggle {
  transform: scale(0.8);
  transform-origin: right center;
  flex-shrink: 0;
}

.dropdown-enter-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.dropdown-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
