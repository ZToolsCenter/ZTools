<template>
  <div :class="['titlebar', platform]">
    <!-- macOS 不显示自定义交通灯，使用系统原生的 -->

    <!-- 插件图标 -->
    <div class="plugin-info" @dblclick="handleDblClick">
      <img v-if="pluginLogo" :src="pluginLogo" class="plugin-logo" alt="Plugin Logo" />
    </div>

    <!-- 搜索栏 -->
    <div class="search-container">
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="搜索..."
        @input="handleSearchInput"
        @keydown="handleKeydown"
      />
    </div>

    <!-- 工具按钮 -->
    <div class="toolbar">
      <!-- 置顶按钮 -->
      <button :class="['toolbar-btn', { active: isPinned }]" title="置顶窗口" @click="togglePin">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <!-- 未激活：线性图标 -->
          <path
            v-if="!isPinned"
            d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
          <!-- 激活：扁平图标 -->
          <path
            v-else
            d="M16 12V4H17V2H7V4H8V12L6 14V16H11.2V22H12.8V16H18V14L16 12Z"
            fill="currentColor"
          />
        </svg>
      </button>

      <!-- 开发者工具按钮 -->
      <button class="toolbar-btn" title="开发者工具" @click="openDevTools">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <!-- 代码图标 </> -->
          <path
            d="M8 6L2 12L8 18M16 6L22 12L16 18M13 4L11 20"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>

    <!-- Windows 窗口控制按钮 -->
    <div v-if="platform === 'win32'" class="window-controls">
      <button class="window-btn minimize-btn" @click="minimize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M 0 5 L 10 5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button class="window-btn maximize-btn" @click="maximize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect
            width="9"
            height="9"
            x="0.5"
            y="0.5"
            stroke="currentColor"
            stroke-width="1"
            fill="none"
          />
        </svg>
      </button>
      <button class="window-btn close-btn" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M 0 0 L 10 10 M 10 0 L 0 10" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const platform = ref<'darwin' | 'win32'>('darwin')
const pluginName = ref('Plugin')
const pluginLogo = ref<string | undefined>(undefined)
const searchQuery = ref('')
const isPinned = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)

// 初始化
onMounted(() => {
  // 监听初始化事件（注意：preload 已经过滤掉了 event，第一个参数直接就是 data）
  window.electron.ipcRenderer.on('init-titlebar', (data: any) => {
    console.log('收到标题栏初始化数据:', data)
    platform.value = data.platform
    pluginName.value = data.pluginName
    pluginLogo.value = data.pluginLogo

    // 设置搜索框初始值
    searchQuery.value = data.searchQuery || ''
    console.log('插件 Logo:', pluginLogo.value, '搜索框初始值:', searchQuery.value)
  })

  // 监听置顶状态变化
  window.electron.ipcRenderer.on('pin-state-changed', (pinned: boolean) => {
    isPinned.value = pinned
  })

  // 监听插件设置子输入框占位符
  window.electron.ipcRenderer.on('update-sub-input-placeholder', (data: any) => {
    console.log('更新搜索框占位符:', data)
    // 清空搜索内容
    searchQuery.value = ''
    // 可以在这里更新 placeholder，如果需要的话
  })

  // 监听插件设置子输入框的值
  window.electron.ipcRenderer.on('set-sub-input-value', (text: string) => {
    console.log('设置搜索框值:', text)
    searchQuery.value = text
  })

  // 监听聚焦子输入框
  window.electron.ipcRenderer.on('focus-sub-input', () => {
    console.log('聚焦搜索框')
    // 聚焦搜索框
    searchInputRef.value?.focus()
  })
})

// 窗口控制
function minimize(): void {
  window.electron.ipcRenderer.send('titlebar-action', 'minimize')
}

function maximize(): void {
  window.electron.ipcRenderer.send('titlebar-action', 'maximize')
}

function close(): void {
  window.electron.ipcRenderer.send('titlebar-action', 'close')
}

// 置顶切换
function togglePin(): void {
  window.electron.ipcRenderer.send('titlebar-action', 'toggle-pin')
}

// 开发者工具
function openDevTools(): void {
  window.electron.ipcRenderer.send('titlebar-action', 'open-devtools')
}

// 搜索输入
function handleSearchInput(): void {
  window.electron.ipcRenderer.send('search-input', searchQuery.value)
}

// macOS 双击标题栏
function handleDblClick(): void {
  if (platform.value === 'darwin') {
    window.electron.ipcRenderer.send('titlebar-dblclick')
  }
}

// 键盘事件处理
function handleKeydown(event: KeyboardEvent): void {
  // ESC 键清空输入
  if (event.key === 'Escape') {
    event.preventDefault()
    if (searchQuery.value.trim()) {
      searchQuery.value = ''
      // 触发变动回调，通知插件
      handleSearchInput()
    }
    return
  }

  // 上下左右方向键传递给插件
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    // 上下方向键阻止默认行为并发送给插件
    event.preventDefault()
    sendArrowKeyToPlugin(event.key)
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    // 左右方向键允许在输入框中移动光标，不阻止默认行为
    // 但仍然发送给插件（某些插件可能需要）
    sendArrowKeyToPlugin(event.key)
  }
}

// 发送方向键到插件
function sendArrowKeyToPlugin(key: string): void {
  const keyCodeMap: Record<string, string> = {
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down'
  }

  const keyCode = keyCodeMap[key]
  if (keyCode) {
    // 发送 keyDown 事件
    window.electron.ipcRenderer.send('send-arrow-key', {
      type: 'keyDown',
      keyCode
    })
    // 短暂延迟后发送 keyUp 事件
    setTimeout(() => {
      window.electron.ipcRenderer.send('send-arrow-key', {
        type: 'keyUp',
        keyCode
      })
    }, 10)
  }
}
</script>

<style scoped>
.titlebar {
  width: 100%;
  height: 52px;
  background: var(--titlebar-bg);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  -webkit-app-region: drag;
}

.titlebar.darwin {
  padding-left: 90px; /* 为系统交通灯按钮留空间 */
}

/* 插件信息 */
.plugin-info {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.plugin-logo {
  width: 35px;
  height: 35px;
  border-radius: 6px;
  object-fit: contain;
  flex-shrink: 0;
}

/* 搜索栏 */
.search-container {
  flex: 1;
  max-width: 300px;
  -webkit-app-region: no-drag;
}

.search-input {
  width: 100%;
  height: 35px;
  padding: 0 10px;
  background: var(--input-bg);
  border: none;
  border-radius: 6px;
  color: var(--titlebar-text);
  font-size: 14px;
  outline: none;
  transition: background 0.2s;
}

.search-input::placeholder {
  color: var(--titlebar-icon);
  opacity: 0.5;
}

.search-input:focus {
  background: var(--input-focus-bg);
}

/* 工具按钮 */
.toolbar {
  display: flex;
  gap: 4px;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

.toolbar-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--titlebar-icon);
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: var(--hover-bg);
  color: var(--titlebar-icon-hover);
}

.toolbar-btn.active {
  background: var(--hover-bg);
  color: #0284c7; /* 固定使用默认蓝色 */
}

/* Windows 窗口控制按钮 */
.window-controls {
  display: flex;
  margin-left: 8px;
  -webkit-app-region: no-drag;
}

.window-btn {
  width: 46px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--titlebar-icon);
  cursor: pointer;
  transition: all 0.2s;
}

.window-btn:hover {
  background: var(--win-button-hover);
  color: var(--titlebar-icon-hover);
}

.window-btn.close-btn:hover {
  background: var(--win-close-hover);
  color: #ffffff;
}
</style>
