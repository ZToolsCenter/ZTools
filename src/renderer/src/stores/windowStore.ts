import { defineStore } from 'pinia'
import { ref } from 'vue'
import defaultAvattar from '../asserts/image/default.png'

interface WindowInfo {
  appName: string
  bundleId: string
  timestamp: number
}

interface PluginInfo {
  name: string
  logo: string
  path: string
  subInputPlaceholder?: string
}

const DEFAULT_PLACEHOLDER = '搜索应用或输入命令'
const DEFAULT_AVATAR = defaultAvattar

// 自动粘贴选项
export type AutoPasteOption = 'off' | '1s' | '3s' | '5s' | '10s'

export const useWindowStore = defineStore('window', () => {
  // 当前激活窗口信息
  const currentWindow = ref<WindowInfo | null>(null)

  // 搜索框配置
  const placeholder = ref(DEFAULT_PLACEHOLDER)
  const avatar = ref(DEFAULT_AVATAR)

  // 当前插件信息
  const currentPlugin = ref<PluginInfo | null>(null)

  // 子输入框配置 (插件模式下使用)
  const subInputPlaceholder = ref('搜索')

  // 自动粘贴配置
  const autoPaste = ref<AutoPasteOption>('off')

  // 失去焦点隐藏配置
  const hideOnBlur = ref(true)
  const theme = ref('system') // system, light, dark
  const primaryColor = ref('blue') // blue, purple, green, orange, red, pink

  // 更新窗口信息
  function updateWindowInfo(windowInfo: WindowInfo | null): void {
    currentWindow.value = windowInfo
  }

  // 判断当前是否为 Finder
  function isFinder(): boolean {
    return currentWindow.value?.bundleId === 'com.apple.finder'
  }

  // 更新 placeholder
  function updatePlaceholder(value: string): void {
    placeholder.value = value || DEFAULT_PLACEHOLDER
  }

  // 更新 avatar
  function updateAvatar(value: string): void {
    avatar.value = value || DEFAULT_AVATAR
  }

  // 更新当前插件信息
  function updateCurrentPlugin(plugin: PluginInfo | null): void {
    currentPlugin.value = plugin

    if (plugin) {
      // 直接使用后端传递的 subInputPlaceholder
      if (plugin.subInputPlaceholder) {
        subInputPlaceholder.value = plugin.subInputPlaceholder
        console.log('使用插件配置:', plugin.path, plugin.subInputPlaceholder)
      } else {
        // 使用默认值
        subInputPlaceholder.value = '搜索'
        console.log('使用默认 placeholder:', plugin.path)
      }
    }
  }

  // 更新子输入框 placeholder (根据插件路径)
  function updateSubInputPlaceholder(pluginPath: string, placeholder: string): void {
    const newValue = placeholder || '搜索'

    // 仅更新当前显示的 placeholder，不再存储到本地 map
    // 后端已经通过 IPC 更新了持久化数据

    // 如果是当前激活的插件,立即更新显示
    if (currentPlugin.value && currentPlugin.value.path === pluginPath) {
      subInputPlaceholder.value = newValue
      console.log('当前插件,立即更新 placeholder:', newValue)
    }
  }

  // 更新自动粘贴配置
  function updateAutoPaste(value: AutoPasteOption): void {
    autoPaste.value = value
  }

  // 更新失去焦点隐藏配置
  function updateHideOnBlur(value: boolean): void {
    hideOnBlur.value = value
  }

  function updateTheme(value: string): void {
    theme.value = value
  }

  function updatePrimaryColor(value: string): void {
    primaryColor.value = value
    // 应用主题色类名到 body
    document.body.className = document.body.className.replace(/theme-\w+/g, '').trim()
    document.body.classList.add(`theme-${value}`)
  }

  // 获取自动粘贴的时间限制（毫秒）
  function getAutoPasteTimeLimit(): number {
    switch (autoPaste.value) {
      case '1s':
        return 1000
      case '3s':
        return 3000
      case '5s':
        return 5000
      case '10s':
        return 10000
      default:
        return 0
    }
  }

  // 从数据库加载设置
  async function loadSettings(): Promise<void> {
    try {
      const data = await window.ztools.dbGet('settings-general')
      if (data) {
        if (data.placeholder) {
          placeholder.value = data.placeholder
        }
        if (data.avatar) {
          avatar.value = data.avatar
        }
        if (data.autoPaste) {
          autoPaste.value = data.autoPaste
        }
        if (data.hideOnBlur !== undefined) {
          hideOnBlur.value = data.hideOnBlur
        }
        if (data.theme) {
          theme.value = data.theme
        }
        if (data.primaryColor) {
          updatePrimaryColor(data.primaryColor)
        } else {
          // 默认蓝色
          updatePrimaryColor('blue')
        }
      } else {
        // 默认蓝色
        updatePrimaryColor('blue')
      }
    } catch (error) {
      console.error('加载设置失败:', error)
    }
  }

  return {
    currentWindow,
    placeholder,
    avatar,
    currentPlugin,
    subInputPlaceholder,
    autoPaste,
    hideOnBlur,
    theme,
    updateWindowInfo,
    isFinder,
    updatePlaceholder,
    updateAvatar,
    updateCurrentPlugin,
    updateSubInputPlaceholder,
    updateAutoPaste,
    updateHideOnBlur,
    updateTheme,
    updatePrimaryColor,
    getAutoPasteTimeLimit,
    loadSettings,
    primaryColor
  }
})
