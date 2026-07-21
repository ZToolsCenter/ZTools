<template>
  <div :class="['titlebar', platform]">
    <!-- macOS 不显示自定义交通灯，使用系统原生的 -->

    <!-- 插件图标和名称 -->
    <div class="plugin-info" @dblclick="handleDblClick">
      <div class="logo-container">
        <!-- AI 状态动画层 -->
        <div v-if="aiRequestStatus !== 'idle'" class="ai-animation-layer">
          <!-- 蒙版层 -->
          <div class="ai-mask"></div>
          <!-- AI 文字 -->
          <div class="ai-text">AI</div>
          <!-- 发送状态：同心圆向外扩散 -->
          <div v-if="aiRequestStatus === 'sending'" class="ai-ripple-container"></div>
          <!-- 接收状态：边缘向内收缩 -->
          <div v-if="aiRequestStatus === 'receiving'" class="ai-pulse-container"></div>
        </div>
        <AdaptiveIcon v-if="pluginLogo" :src="pluginLogo" class="plugin-logo" alt="Plugin Logo" />
      </div>
      <span v-if="pluginName" class="plugin-name">{{ pluginName }}</span>
    </div>

    <!-- 搜索栏 -->
    <div v-if="subInputVisible" class="search-container">
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
      <!-- 插件设置按钮 -->
      <button class="toolbar-btn" title="插件设置" @click="showPluginSettings">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <!-- 设置图标 -->
          <path
            d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.0113 9.77251C4.28059 9.5799 4.48572 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7042 4.47324 15 4.6C15.3016 4.73312 15.6362 4.77282 15.9606 4.714C16.285 4.65519 16.5843 4.50054 16.82 4.27L16.88 4.21C17.0657 4.02405 17.2863 3.87653 17.5291 3.77588C17.7719 3.67523 18.0322 3.62343 18.295 3.62343C18.5578 3.62343 18.8181 3.67523 19.0609 3.77588C19.3037 3.87653 19.5243 4.02405 19.71 4.21C19.896 4.39575 20.0435 4.61632 20.1441 4.85912C20.2448 5.10192 20.2966 5.36217 20.2966 5.625C20.2966 5.88783 20.2448 6.14808 20.1441 6.39088C20.0435 6.63368 19.896 6.85425 19.71 7.04L19.65 7.1C19.4195 7.33568 19.2648 7.63502 19.206 7.95941C19.1472 8.28381 19.1869 8.61838 19.32 8.92V9C19.4468 9.29577 19.6572 9.54802 19.9255 9.72569C20.1938 9.90337 20.5082 9.99872 20.83 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7042 19.4 15Z"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

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
import { normalizeConfigList } from '@shared/pluginSettings'
import AdaptiveIcon from '../common/AdaptiveIcon.vue'
import { CommonKeyboardModifier, readModifiers } from '@renderer/utils/convertKeyboardEvent'

const platform = ref<'darwin' | 'win32'>('darwin')
const pluginName = ref('Plugin')
const pluginId = ref('') // 插件的实际 name（用于数据库操作，与未分离状态保持一致）
const pluginPath = ref('')
const pluginLogo = ref<string | undefined>(undefined)
const searchQuery = ref('')
const subInputVisible = ref(true) // 子输入框是否可见
const isPinned = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
const acrylicLightOpacity = ref(78) // 亚克力明亮模式透明度（默认 78%）
const acrylicDarkOpacity = ref(50) // 亚克力暗黑模式透明度（默认 50%）
const aiRequestStatus = ref<'idle' | 'sending' | 'receiving'>('idle') // AI 请求状态
const primaryColor = ref('green')
const customColor = ref('#db2777')

/**
 * 获取指定主题色在当前明暗模式下对应的颜色值。
 * @param colorName 主题色名称
 * @param isDark 当前是否为暗色模式
 * @returns 可用于 CSS 的十六进制颜色值
 */
function getThemeColor(colorName: string, isDark: boolean): string {
  const colors: Record<string, { light: string; dark: string }> = {
    blue: { light: '#0284c7', dark: '#38bdf8' },
    purple: { light: '#7c3aed', dark: '#a78bfa' },
    green: { light: '#059669', dark: '#34d399' },
    orange: { light: '#ea580c', dark: '#fb923c' },
    red: { light: '#dc2626', dark: '#f87171' },
    pink: { light: '#db2777', dark: '#f472b6' }
  }
  const color = colors[colorName]
  if (color) {
    return isDark ? color.dark : color.light
  }
  // 非法或未知名称统一回退到产品默认的绿色。
  return isDark ? '#34d399' : '#059669'
}

function applyPrimaryColor(): void {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  let colorValue = ''

  if (primaryColor.value === 'custom') {
    colorValue = customColor.value
  } else {
    colorValue = getThemeColor(primaryColor.value, isDark)
  }

  document.documentElement.style.setProperty('--primary-color', colorValue)
}

// 应用亚克力背景色叠加效果
function applyAcrylicOverlay(): void {
  // 移除旧的样式
  const existingStyle = document.getElementById('acrylic-overlay-style')
  if (existingStyle) {
    existingStyle.remove()
  }

  // 获取当前窗口材质
  const material = document.documentElement.getAttribute('data-material')

  // 只在亚克力材质时添加样式
  if (material === 'acrylic') {
    const style = document.createElement('style')
    style.id = 'acrylic-overlay-style'
    style.textContent = `
      body::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: -1;
      }

      /* 明亮模式 */
      @media (prefers-color-scheme: light) {
        body::after {
          background: rgb(255 255 255 / ${acrylicLightOpacity.value}%);
        }
      }

      /* 暗黑模式 */
      @media (prefers-color-scheme: dark) {
        body::after {
          background: rgb(0 0 0 / ${acrylicDarkOpacity.value}%);
        }
      }
    `
    document.head.appendChild(style)
  }
}

// 初始化
onMounted(async () => {
  // 检测操作系统并添加类名
  const userAgent = navigator.userAgent.toLowerCase()
  const osPlatform = navigator.platform.toLowerCase()

  if (osPlatform.includes('win') || userAgent.includes('windows')) {
    document.documentElement.classList.add('os-windows')
  } else if (osPlatform.includes('mac') || userAgent.includes('mac')) {
    document.documentElement.classList.add('os-mac')
  }

  // 从数据库加载亚克力透明度设置
  try {
    const settings = await window.ztools.dbGet('settings-general')
    if (settings) {
      acrylicLightOpacity.value = settings.acrylicLightOpacity ?? 78
      acrylicDarkOpacity.value = settings.acrylicDarkOpacity ?? 50
      console.log('标题栏加载亚克力透明度:', {
        light: acrylicLightOpacity.value,
        dark: acrylicDarkOpacity.value
      })
      if (settings.primaryColor) {
        primaryColor.value = settings.primaryColor
      }
      if (settings.customColor) {
        customColor.value = settings.customColor
      }
      applyPrimaryColor()
    }
  } catch (error) {
    console.error('加载亚克力透明度设置失败:', error)
  }

  // 初始化时获取当前窗口材质
  if (window.ztools?.getWindowMaterial) {
    window.ztools
      .getWindowMaterial()
      .then((material: string) => {
        console.log('标题栏初始化材质:', material)
        document.documentElement.setAttribute('data-material', material)
        // 应用亚克力背景色叠加效果
        applyAcrylicOverlay()
      })
      .catch((err: Error) => {
        console.error('获取窗口材质失败:', err)
      })
  }

  // 监听窗口材质更新
  if (window.ztools?.onUpdateWindowMaterial) {
    window.ztools.onUpdateWindowMaterial((material: 'mica' | 'acrylic' | 'none') => {
      console.log('标题栏收到材质更新:', material)
      document.documentElement.setAttribute('data-material', material)
      // 应用亚克力背景色叠加效果
      applyAcrylicOverlay()
    })
  }

  // 监听亚克力透明度更新事件
  if (window.ztools?.onUpdateAcrylicOpacity) {
    window.ztools.onUpdateAcrylicOpacity((data: { lightOpacity: number; darkOpacity: number }) => {
      console.log('标题栏更新亚克力透明度:', data)
      acrylicLightOpacity.value = data.lightOpacity
      acrylicDarkOpacity.value = data.darkOpacity
      // 应用亚克力背景色叠加效果
      applyAcrylicOverlay()
    })
  }

  // 监听主题色更新
  if (window.ztools?.onUpdatePrimaryColor) {
    window.ztools.onUpdatePrimaryColor((data: { primaryColor: string; customColor?: string }) => {
      console.log('标题栏更新主题色:', data)
      primaryColor.value = data.primaryColor
      if (data.customColor) {
        customColor.value = data.customColor
      }
      applyPrimaryColor()
    })
  }

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyPrimaryColor()
    // 重新应用亚克力效果（因为也依赖暗色模式）
    applyAcrylicOverlay()
  })

  // 监听初始化事件（注意：preload 已经过滤掉了 event，第一个参数直接就是 data）
  window.electron.ipcRenderer.on('init-titlebar', (data: any) => {
    console.log('收到标题栏初始化数据:', data)
    platform.value = data.platform
    pluginName.value = data.title || data.pluginName
    pluginId.value = data.pluginName // 保存实际的插件 name，用于数据库读写
    pluginPath.value = data.pluginPath || ''
    pluginLogo.value = data.pluginLogo

    // 设置窗口标题
    if (data.title) {
      document.title = data.title
    }

    // 设置搜索框初始值
    searchQuery.value = data.searchQuery || ''

    // 设置子输入框可见性
    if (data.subInputVisible !== undefined) {
      subInputVisible.value = data.subInputVisible
    }

    console.log(
      '插件 Logo:',
      pluginLogo.value,
      '搜索框初始值:',
      searchQuery.value,
      '子输入框可见:',
      subInputVisible.value
    )
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

  // 监听选中子输入框内容
  window.electron.ipcRenderer.on('select-sub-input', () => {
    searchInputRef.value?.focus()
    searchInputRef.value?.select()
  })

  // 监听子输入框可见性更新（插件调用 removeSubInput 时触发）
  window.electron.ipcRenderer.on('update-sub-input-visible', (visible: boolean) => {
    console.log('更新子输入框可见性:', visible)
    subInputVisible.value = visible
  })

  // 监听 AI 状态变化
  if (window.ztools?.onAiStatusChanged) {
    window.ztools.onAiStatusChanged((status: 'idle' | 'sending' | 'receiving') => {
      aiRequestStatus.value = status
    })
  }
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

// 显示插件设置菜单
async function showPluginSettings(): Promise<void> {
  try {
    console.log('当前插件名称:', pluginName.value)

    // 读取当前插件的配置状态
    const outKillPluginData = await window.ztools.dbGet('out-kill-plugin')
    const autoDetachPluginData = await window.ztools.dbGet('auto-detach-plugin')

    console.log('读取到的配置数据:', { outKillPluginData, autoDetachPluginData })

    // 确保数据是数组
    const outKillPluginList: string[] = normalizeConfigList(outKillPluginData)
    const autoDetachPluginList: string[] = normalizeConfigList(autoDetachPluginData)

    const currentName = pluginId.value
    const isAutoKill = !!currentName && outKillPluginList.includes(currentName)
    const isAutoDetach = !!currentName && autoDetachPluginList.includes(currentName)

    // 显示菜单
    const menuItems = [
      {
        id: 'toggle-auto-kill',
        label: '退出到后台立即结束运行',
        type: 'checkbox',
        checked: isAutoKill
      },
      {
        id: 'toggle-auto-detach',
        label: '自动分离为独立窗口',
        type: 'checkbox',
        checked: isAutoDetach
      }
    ]

    // 创建 Promise 来等待菜单结果
    const result: any = await new Promise((resolve) => {
      // 注册一次性监听器
      const cleanup = window.electron.ipcRenderer.on('detached-menu-result', (data: any) => {
        cleanup() // 移除监听器
        resolve(data)
      })

      // 发送菜单请求（使用专用的事件名）
      window.electron.ipcRenderer.send('show-plugin-menu', menuItems)
    })

    // 处理菜单选择结果
    if (result?.id === 'toggle-auto-kill') {
      // 切换"退出到后台立即结束运行"
      if (!currentName) {
        return
      }
      const updatedList = outKillPluginList.includes(currentName)
        ? outKillPluginList.filter((n) => n !== currentName)
        : [...outKillPluginList, currentName]
      await window.ztools.dbPut('out-kill-plugin', updatedList)
      console.log('已更新“退出到后台立即结束运行”配置:', updatedList)
    } else if (result?.id === 'toggle-auto-detach') {
      // 切换“自动分离为独立窗口”
      if (!currentName) {
        return
      }
      const updatedList = autoDetachPluginList.includes(currentName)
        ? autoDetachPluginList.filter((n) => n !== currentName)
        : [...autoDetachPluginList, currentName]
      await window.ztools.dbPut('auto-detach-plugin', updatedList)
      console.log('已更新"自动分离为独立窗口"配置:', updatedList)
    }
  } catch (error) {
    console.error('显示插件设置菜单失败:', error)
  }
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

  // 回车键传递给插件
  const modifiers = readModifiers(event)
  if (event.key === 'Enter') {
    event.preventDefault()
    sendKeyToPlugin('Enter', modifiers)
    return
  }

  // 上下左右方向键传递给插件
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    // 上下方向键阻止默认行为并发送给插件
    event.preventDefault()
    sendArrowKeyToPlugin(event.key, modifiers)
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    // 左右方向键允许在输入框中移动光标，不阻止默认行为
    // 但仍然发送给插件（某些插件可能需要）
    sendArrowKeyToPlugin(event.key, modifiers)
  }
}

// 发送方向键到插件
function sendArrowKeyToPlugin(key: string, modifiers: CommonKeyboardModifier[] = []): void {
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
      keyCode,
      modifiers
    })
    // 短暂延迟后发送 keyUp 事件
    setTimeout(() => {
      window.electron.ipcRenderer.send('send-arrow-key', {
        type: 'keyUp',
        keyCode,
        modifiers
      })
    }, 10)
  }
}

// 发送按键到插件（用于回车键等）
function sendKeyToPlugin(key: string, modifiers: CommonKeyboardModifier[] = []): void {
  // 发送 keyDown 事件
  window.electron.ipcRenderer.send('send-arrow-key', {
    type: 'keyDown',
    keyCode: key,
    modifiers
  })
  // 短暂延迟后发送 keyUp 事件
  setTimeout(() => {
    window.electron.ipcRenderer.send('send-arrow-key', {
      type: 'keyUp',
      keyCode: key,
      modifiers
    })
  }, 10)
}
</script>
<style>
body {
  background: var(--titlebar-bg);
}
</style>

<style scoped>
.titlebar {
  width: 100%;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  -webkit-app-region: drag;
  overflow: visible;
}

.titlebar.darwin {
  padding-left: 90px; /* 为系统交通灯按钮留空间 */
}

/* 插件信息 */
.plugin-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  overflow: visible;
}

.logo-container {
  position: relative;
  width: 35px;
  height: 35px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.plugin-logo {
  position: relative;
  width: 35px;
  height: 35px;
  border-radius: 6px;
  object-fit: contain;
  flex-shrink: 0;
  z-index: 0;
}

/* AI 动画层 */
.ai-animation-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  pointer-events: none;
  z-index: 2;
}

/* AI 蒙版层 */
.ai-mask {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.7);
  z-index: 1;
}

/* 暗色模式下使用黑色蒙版 */
@media (prefers-color-scheme: dark) {
  .ai-mask {
    background: rgba(0, 0, 0, 0.3);
  }
}

/* AI 文字 */
.ai-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 11px;
  font-weight: 600;
  color: var(--primary-color, #059669);
  z-index: 3;
  letter-spacing: 0.5px;
}

/* 发送状态：从小到大扩散 */
.ai-ripple-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: inline-block;
  z-index: 2;
}

.ai-ripple-container::after,
.ai-ripple-container::before {
  content: '';
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--primary-color, #059669);
  position: absolute;
  left: 0;
  top: 0;
  animation: animloader-sending 2s linear infinite;
  animation-fill-mode: backwards;
}

.ai-ripple-container::after {
  animation-delay: 1s;
}

@keyframes animloader-sending {
  0% {
    transform: scale(0);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
}

/* 接收状态：从大到小收缩 */
.ai-pulse-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: inline-block;
  z-index: 2;
}

.ai-pulse-container::after,
.ai-pulse-container::before {
  content: '';
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--primary-color, #059669);
  position: absolute;
  left: 0;
  top: 0;
  animation: animloader-receiving 2s linear infinite;
  animation-fill-mode: backwards;
}

.ai-pulse-container::after {
  animation-delay: 1s;
}

@keyframes animloader-receiving {
  0% {
    transform: scale(1);
    opacity: 0;
  }
  100% {
    transform: scale(0);
    opacity: 1;
  }
}

/* 插件名称 */
.plugin-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--titlebar-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
  user-select: none;
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
  color: var(--primary-color);
}

/* Windows 窗口控制按钮 */
.window-controls {
  display: flex;
  gap: 4px;
  margin-left: 8px;
  -webkit-app-region: no-drag;
}

.window-btn {
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

.window-btn:hover {
  background: var(--hover-bg);
  color: var(--titlebar-icon-hover);
}

.window-btn.close-btn:hover {
  background: #ef4444;
  color: #ffffff;
}
</style>
