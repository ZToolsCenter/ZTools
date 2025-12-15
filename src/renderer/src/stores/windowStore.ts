import { defineStore } from 'pinia'
import { ref } from 'vue'
import defaultAvatar from '../assets/image/default.png'

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
const DEFAULT_AVATAR = defaultAvatar

// 自动粘贴选项
export type AutoPasteOption = 'off' | '1s' | '3s' | '5s' | '10s'

// 自动清空选项
export type AutoClearOption = 'immediately' | '1m' | '2m' | '3m' | '5m' | '10m' | 'never'

// 更新下载状态
interface UpdateDownloadInfo {
  hasDownloaded: boolean
  version?: string
  changelog?: string[]
}

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

  // 自动清空配置
  const autoClear = ref<AutoClearOption>('immediately')

  // 失去焦点隐藏配置
  const hideOnBlur = ref(true)
  const theme = ref('system') // system, light, dark
  const primaryColor = ref('blue') // blue, purple, green, orange, red, pink, custom
  const customColor = ref('#db2777') // 自定义颜色

  // 更新下载状态
  const updateDownloadInfo = ref<UpdateDownloadInfo>({ hasDownloaded: false })

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

  // 更新自动清空配置
  function updateAutoClear(value: AutoClearOption): void {
    autoClear.value = value
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

    // 如果是自定义颜色，应用自定义颜色值
    if (value === 'custom') {
      applyCustomColor(customColor.value)
    }
  }

  function updateCustomColor(color: string): void {
    customColor.value = color
    // 如果当前主题色是自定义，立即应用
    if (primaryColor.value === 'custom') {
      applyCustomColor(color)
    }
  }

  function applyCustomColor(color: string): void {
    // 智能调整颜色
    const adjustedColor = adjustColorForTheme(color)

    // 如果颜色被调整了，输出日志
    if (adjustedColor !== color) {
      console.log('颜色已智能调整:', color, '→', adjustedColor)
    }

    // 动态设置 CSS 变量
    document.documentElement.style.setProperty('--primary-color', adjustedColor)
  }

  // 智能调整颜色以适应当前主题
  function adjustColorForTheme(color: string): string {
    // 检测当前是否为暗色主题
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches

    // 将颜色转换为 RGB
    const rgb = hexToRgb(color)
    if (!rgb) return color

    // 计算相对亮度（使用 W3C 公式）
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255

    // 亮色主题：如果颜色太亮（接近白色），调整为较深颜色
    if (!isDarkMode && luminance > 0.9) {
      return adjustBrightness(color, 0.4) // 降低亮度到 40%
    }

    // 暗色主题：如果颜色太暗（接近黑色），调整为较亮颜色
    if (isDarkMode && luminance < 0.15) {
      return adjustBrightness(color, 0.6) // 提高亮度到 60%
    }

    return color
  }

  // 将 hex 颜色转换为 RGB
  function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16)
        }
      : null
  }

  // 调整颜色亮度
  function adjustBrightness(hex: string, targetLuminance: number): string {
    const rgb = hexToRgb(hex)
    if (!rgb) return hex

    // 转换为 HSL
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)

    // 调整亮度
    hsl.l = targetLuminance

    // 转换回 RGB
    const adjustedRgb = hslToRgb(hsl.h, hsl.s, hsl.l)

    // 转换为 hex
    return rgbToHex(adjustedRgb.r, adjustedRgb.g, adjustedRgb.b)
  }

  // RGB 转 HSL
  function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255
    g /= 255
    b /= 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h = 0
    let s = 0
    const l = (max + min) / 2

    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6
          break
        case g:
          h = ((b - r) / d + 2) / 6
          break
        case b:
          h = ((r - g) / d + 4) / 6
          break
      }
    }

    return { h, s, l }
  }

  // HSL 转 RGB
  function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    let r: number, g: number, b: number

    if (s === 0) {
      r = g = b = l
    } else {
      const hue2rgb = (p: number, q: number, t: number): number => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p = 2 * l - q

      r = hue2rgb(p, q, h + 1 / 3)
      g = hue2rgb(p, q, h)
      b = hue2rgb(p, q, h - 1 / 3)
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    }
  }

  // RGB 转 Hex
  function rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
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

  // 获取自动清空的时间限制（毫秒）
  function getAutoClearTimeLimit(): number {
    switch (autoClear.value) {
      case 'immediately':
        return 0 // 立即清空
      case '1m':
        return 60000 // 1分钟
      case '2m':
        return 120000 // 2分钟
      case '3m':
        return 180000 // 3分钟
      case '5m':
        return 300000 // 5分钟
      case '10m':
        return 600000 // 10分钟
      case 'never':
        return -1 // 从不清空
      default:
        return 0
    }
  }

  // 记录最后一次隐藏窗口的时间
  const lastHideTime = ref<number>(0)

  // 更新最后隐藏时间
  function updateLastHideTime(): void {
    lastHideTime.value = Date.now()
  }

  // 检查是否应该清空搜索框
  function shouldClearSearch(): boolean {
    const timeLimit = getAutoClearTimeLimit()
    
    // 从不清空
    if (timeLimit === -1) {
      return false
    }
    
    // 立即清空
    if (timeLimit === 0) {
      return true
    }
    
    // 根据时间判断
    const elapsedTime = Date.now() - lastHideTime.value
    return elapsedTime >= timeLimit
  }

  // 更新下载状态
  function setUpdateDownloadInfo(info: UpdateDownloadInfo): void {
    updateDownloadInfo.value = info
  }

  // 检查是否有已下载的更新
  async function checkDownloadedUpdate(): Promise<void> {
    try {
      const status = await window.ztools.updater.getDownloadStatus()
      if (status.hasDownloaded) {
        updateDownloadInfo.value = {
          hasDownloaded: true,
          version: status.version,
          changelog: status.changelog
        }
      }
    } catch (error) {
      console.error('检查下载状态失败:', error)
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
        // 只有自定义头像才从数据库加载，没有则使用打包的默认头像
        if (data.avatar) {
          avatar.value = data.avatar
        }
        if (data.autoPaste) {
          autoPaste.value = data.autoPaste
        }
        if (data.autoClear) {
          autoClear.value = data.autoClear
        }
        if (data.hideOnBlur !== undefined) {
          hideOnBlur.value = data.hideOnBlur
        }
        if (data.theme) {
          theme.value = data.theme
        }
        if (data.customColor) {
          customColor.value = data.customColor
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

      // 监听系统主题变化，重新应用自定义颜色
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (primaryColor.value === 'custom') {
          applyCustomColor(customColor.value)
        }
      })
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
    autoClear,
    hideOnBlur,
    theme,
    primaryColor,
    customColor,
    updateDownloadInfo,
    updateWindowInfo,
    isFinder,
    updatePlaceholder,
    updateAvatar,
    updateCurrentPlugin,
    updateSubInputPlaceholder,
    updateAutoPaste,
    updateAutoClear,
    updateHideOnBlur,
    updateTheme,
    updatePrimaryColor,
    updateCustomColor,
    getAutoPasteTimeLimit,
    getAutoClearTimeLimit,
    updateLastHideTime,
    shouldClearSearch,
    setUpdateDownloadInfo,
    checkDownloadedUpdate,
    loadSettings
  }
})
