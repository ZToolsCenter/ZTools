import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import defaultAvatar from '../assets/image/default.png'

interface WindowInfo {
  title?: string
  app: string // 应用名称（如 "Finder.app"）
  bundleId?: string
  appPath?: string
  pid?: number
  x?: number
  y?: number
  width?: number
  height?: number
  className?: string
  hwnd?: number
  timestamp?: number
}

interface PluginInfo {
  name: string
  title?: string
  logo: string
  path: string
  cmdName?: string
  subInputPlaceholder?: string
  subInputVisible?: boolean
}

export const DEFAULT_PLACEHOLDER = '搜索应用和指令 / 粘贴文件或图片'
export const DEFAULT_AVATAR = defaultAvatar

// 自动粘贴选项
export type AutoPasteOption = 'off' | '1s' | '3s' | '5s' | '10s'

// 自动清空选项
export type AutoClearOption = 'immediately' | '1m' | '2m' | '3m' | '5m' | '10m' | 'never'

// 搜索框模式选项
export type SearchMode = 'aggregate' | 'list'
export type TabKeyFunction = 'navigate' | 'target-command'
export type BuiltInShortcutKey = 'search' | 'closePlugin' | 'killPlugin' | 'esc'

// 更新状态
interface AvailableUpdateInfo {
  hasUpdate: boolean
  version?: string
  changelog?: string
}

// AI 请求状态
export type AiRequestStatus = 'idle' | 'sending' | 'receiving'

export const useWindowStore = defineStore('window', () => {
  // 当前激活窗口信息
  const currentWindow = ref<WindowInfo | null>(null)

  // 搜索框配置
  const placeholder = ref(DEFAULT_PLACEHOLDER)
  const avatar = ref(DEFAULT_AVATAR)

  // Tab 键目标指令
  const tabTargetCommand = ref('')
  const tabKeyFunction = ref<TabKeyFunction>('navigate')

  // 空格打开指令
  const spaceOpenCommand = ref(false)

  // 内置应用快捷键开关
  const builtInSearchShortcutEnabled = ref(true)
  const builtInClosePluginShortcutEnabled = ref(true)
  const builtInKillPluginShortcutEnabled = ref(true)
  const builtInEscShortcutEnabled = ref(true)

  // 悬浮球双击目标指令
  const floatingBallDoubleClickCommand = ref('')

  // 当前插件信息
  const currentPlugin = ref<PluginInfo | null>(null)
  // 插件加载中状态（用于显示 loading 动效）
  const pluginLoading = ref(false)

  // AI 请求状态（用于显示 AI 调用动画）
  const aiRequestStatus = ref<AiRequestStatus>('idle')

  // 子输入框配置 (插件模式下使用)
  const subInputPlaceholder = ref('搜索')
  const subInputVisible = ref(false) // 子输入框是否可见（默认隐藏，调用 setSubInput 后显示）

  // 自动粘贴配置
  const autoPaste = ref<AutoPasteOption>('3s')

  // 自动清空配置
  const autoClear = ref<AutoClearOption>('immediately')
  const showRecentInSearch = ref(true)
  const showMatchRecommendation = ref(true)
  // 最近使用显示行数
  const recentRows = ref(2)
  // 固定栏显示行数
  const pinnedRows = ref(2)
  // 搜索框模式
  const searchMode = ref<SearchMode>('aggregate')

  const theme = ref('system') // system, light, dark
  const primaryColor = ref('green') // blue, purple, green, orange, red, pink, custom
  const customColor = ref('#db2777') // 自定义颜色

  // 亚克力材质背景色透明度（0-100）
  const acrylicLightOpacity = ref(78) // 明亮模式默认 78%
  const acrylicDarkOpacity = ref(50) // 暗黑模式默认 50%

  // 更新状态
  const availableUpdateInfo = ref<AvailableUpdateInfo>({ hasUpdate: false })
  const autoCheckUpdateEnabled = ref(true)
  const dismissedUpdateVersion = ref<string | null>(null)
  const shouldShowUpdateNotification = computed(() => {
    const availableVersion = availableUpdateInfo.value.version ?? ''
    return (
      availableUpdateInfo.value.hasUpdate &&
      autoCheckUpdateEnabled.value &&
      !currentPlugin.value &&
      availableVersion !== dismissedUpdateVersion.value
    )
  })

  // 更新窗口信息
  function updateWindowInfo(windowInfo: WindowInfo | null): void {
    currentWindow.value = windowInfo
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

      // 更新子输入框可见性
      if (plugin.subInputVisible !== undefined) {
        subInputVisible.value = plugin.subInputVisible
        console.log('更新子输入框可见性:', plugin.subInputVisible)
      } else {
        // 默认隐藏（调用 setSubInput 后才显示）
        subInputVisible.value = false
      }

      pluginLoading.value = true
    } else {
      pluginLoading.value = false
    }
  }

  // 更新子输入框 placeholder
  function updateSubInputPlaceholder(placeholder: string): void {
    const newValue = placeholder || '搜索'

    // 仅更新当前显示的 placeholder，不再存储到本地 map
    // 后端已经通过 IPC 更新了持久化数据

    // 如果是当前激活的插件,立即更新显示
    if (currentPlugin.value) {
      subInputPlaceholder.value = newValue
      console.log('当前插件,立即更新 placeholder:', newValue)
    }
  }

  // 更新子输入框可见性
  function updateSubInputVisible(visible: boolean): void {
    subInputVisible.value = visible
    console.log('更新子输入框可见性:', visible)
  }

  function setPluginLoading(isLoading: boolean): void {
    pluginLoading.value = isLoading
  }

  // 更新自动粘贴配置
  function updateAutoPaste(value: AutoPasteOption): void {
    autoPaste.value = value
  }

  // 更新自动清空配置
  function updateAutoClear(value: AutoClearOption): void {
    autoClear.value = value
  }

  // 更新是否显示最近使用
  function updateShowRecentInSearch(value: boolean): void {
    showRecentInSearch.value = value
  }

  function updateShowMatchRecommendation(value: boolean): void {
    showMatchRecommendation.value = value
  }

  function updateRecentRows(rows: number): void {
    recentRows.value = rows
  }

  function updatePinnedRows(rows: number): void {
    pinnedRows.value = rows
  }

  function updateSearchMode(mode: SearchMode): void {
    searchMode.value = mode
  }

  function updateTabTargetCommand(value: string): void {
    tabTargetCommand.value = value
  }

  function updateTabKeyFunction(value: TabKeyFunction): void {
    tabKeyFunction.value = value
  }

  function updateSpaceOpenCommand(value: boolean): void {
    spaceOpenCommand.value = value
  }

  function updateBuiltInShortcutEnabled(key: BuiltInShortcutKey, value: boolean): void {
    if (key === 'search') {
      builtInSearchShortcutEnabled.value = value
      return
    }
    if (key === 'closePlugin') {
      builtInClosePluginShortcutEnabled.value = value
      return
    }
    if (key === 'killPlugin') {
      builtInKillPluginShortcutEnabled.value = value
      return
    }
    builtInEscShortcutEnabled.value = value
  }

  function updateFloatingBallDoubleClickCommand(value: string): void {
    floatingBallDoubleClickCommand.value = value
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

  function updateAcrylicLightOpacity(value: number): void {
    acrylicLightOpacity.value = value
  }

  function updateAcrylicDarkOpacity(value: number): void {
    acrylicDarkOpacity.value = value
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

  // 记录最后一次窗口显示的时间（用于判断是否需要清空）
  const lastShowTime = ref<number>(Date.now())

  // 检查是否应该清空搜索框（并更新时间）
  function shouldClearSearch(): boolean {
    const timeLimit = getAutoClearTimeLimit()
    const now = Date.now()
    const elapsedTime = now - lastShowTime.value

    // 更新时间为当前时间
    lastShowTime.value = now

    // 从不清空
    if (timeLimit === -1) {
      return false
    }

    // 立即清空
    if (timeLimit === 0) {
      return true
    }

    // 根据时间判断（窗口隐藏了多久）
    return elapsedTime >= timeLimit
  }

  // 设置可用更新信息
  function setAvailableUpdateInfo(info: AvailableUpdateInfo): void {
    availableUpdateInfo.value = info
  }

  /**
   * 更新自动检查开关的运行时状态，并在重新开启时允许更新提示再次出现。
   * @param enabled 是否启用自动检查更新
   * @returns 无返回值
   */
  function updateAutoCheckUpdateEnabled(enabled: boolean): void {
    autoCheckUpdateEnabled.value = enabled

    // 用户主动重新开启自动检查时，清除本次运行的旧关闭记录。
    if (enabled) dismissedUpdateVersion.value = null
  }

  /**
   * 关闭当前版本的主窗口更新提示，关闭状态仅保留到本次应用退出。
   * @returns 无返回值
   */
  function dismissUpdateNotification(): void {
    dismissedUpdateVersion.value = availableUpdateInfo.value.version ?? ''
  }

  /**
   * 在自动检查开启时恢复主进程中已检测到的更新状态。
   * @returns 状态检查完成后结束的 Promise
   */
  async function checkUpdateStatus(): Promise<void> {
    // 自动检查关闭时不恢复缓存提示，手动检查更新功能仍保持可用。
    if (!autoCheckUpdateEnabled.value) return

    try {
      const status = await window.ztools.updater.getDownloadStatus()
      if (status.hasUpdate) {
        availableUpdateInfo.value = {
          hasUpdate: true,
          version: status.version,
          changelog: status.changelog
        }
      }
    } catch (error) {
      console.error('检查更新状态失败:', error)
    }
  }

  // 更新 AI 请求状态
  function setAiRequestStatus(status: AiRequestStatus): void {
    aiRequestStatus.value = status
  }

  /**
   * 从数据库加载主窗口设置，并应用缺失字段的默认值。
   * @returns 设置加载和应用完成后结束的 Promise
   */
  async function loadSettings(): Promise<void> {
    try {
      const data = await window.ztools.dbGet('settings-general')
      if (data) {
        if (data.placeholder) {
          placeholder.value = data.placeholder
        }
        // 只有自定义头像才从数据库加载
        // 如果数据库中是默认头像路径（历史数据），不加载，使用内置的默认头像
        if (data.avatar && data.avatar !== DEFAULT_AVATAR) {
          avatar.value = data.avatar
        }
        // 否则使用内置的默认头像（已在初始化时设置）
        if (data.autoPaste) {
          autoPaste.value = data.autoPaste
        }
        if (data.autoClear) {
          autoClear.value = data.autoClear
        }
        if (data.autoCheckUpdate !== undefined) {
          autoCheckUpdateEnabled.value = data.autoCheckUpdate
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
          // 旧配置缺少主题色时使用当前产品默认的绿色。
          updatePrimaryColor('green')
        }
        if (data.acrylicLightOpacity !== undefined) {
          acrylicLightOpacity.value = data.acrylicLightOpacity
        }
        if (data.acrylicDarkOpacity !== undefined) {
          acrylicDarkOpacity.value = data.acrylicDarkOpacity
        }
        if (data.showRecentInSearch !== undefined) {
          showRecentInSearch.value = data.showRecentInSearch
        }
        if (data.showMatchRecommendation !== undefined) {
          showMatchRecommendation.value = data.showMatchRecommendation
        }
        if (data.recentRows) {
          recentRows.value = data.recentRows
        }
        if (data.pinnedRows) {
          pinnedRows.value = data.pinnedRows
        }
        if (data.searchMode) {
          searchMode.value = data.searchMode
        }
        if (data.tabKeyFunction !== undefined) {
          tabKeyFunction.value = data.tabKeyFunction
        } else {
          tabKeyFunction.value = data.tabTargetCommand ? 'target-command' : 'navigate'
        }
        if (data.tabTargetCommand !== undefined) {
          tabTargetCommand.value = data.tabTargetCommand
        }
        if (data.spaceOpenCommand !== undefined) {
          spaceOpenCommand.value = data.spaceOpenCommand
        }
        if (data.floatingBallDoubleClickCommand !== undefined) {
          floatingBallDoubleClickCommand.value = data.floatingBallDoubleClickCommand
        }
        if (data.builtinAppShortcutsEnabled !== undefined) {
          const config = data.builtinAppShortcutsEnabled || {}
          builtInSearchShortcutEnabled.value = config.search !== false
          builtInClosePluginShortcutEnabled.value = config.closePlugin !== false
          builtInKillPluginShortcutEnabled.value = config.killPlugin !== false
          builtInEscShortcutEnabled.value = config.esc !== false
        }
      } else {
        // 首次启动没有通用设置时使用当前产品默认的绿色。
        updatePrimaryColor('green')
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
    pluginLoading,
    aiRequestStatus,
    subInputPlaceholder,
    subInputVisible,
    autoPaste,
    autoClear,
    showRecentInSearch,
    showMatchRecommendation,
    theme,
    primaryColor,
    customColor,
    acrylicLightOpacity,
    acrylicDarkOpacity,
    availableUpdateInfo,
    autoCheckUpdateEnabled,
    shouldShowUpdateNotification,
    updateWindowInfo,
    updatePlaceholder,
    updateAvatar,
    updateCurrentPlugin,
    setPluginLoading,
    setAiRequestStatus,
    updateSubInputPlaceholder,
    updateSubInputVisible,
    updateAutoPaste,
    updateAutoClear,
    updateShowRecentInSearch,
    updateShowMatchRecommendation,
    recentRows,
    pinnedRows,
    updateRecentRows,
    updatePinnedRows,
    searchMode,
    updateSearchMode,
    tabKeyFunction,
    updateTabKeyFunction,
    tabTargetCommand,
    updateTabTargetCommand,
    spaceOpenCommand,
    updateSpaceOpenCommand,
    builtInSearchShortcutEnabled,
    builtInClosePluginShortcutEnabled,
    builtInKillPluginShortcutEnabled,
    builtInEscShortcutEnabled,
    updateBuiltInShortcutEnabled,
    floatingBallDoubleClickCommand,
    updateFloatingBallDoubleClickCommand,
    updateTheme,
    updatePrimaryColor,
    updateCustomColor,
    updateAcrylicLightOpacity,
    updateAcrylicDarkOpacity,
    getAutoPasteTimeLimit,
    getAutoClearTimeLimit,
    shouldClearSearch,
    setAvailableUpdateInfo,
    updateAutoCheckUpdateEnabled,
    dismissUpdateNotification,
    checkUpdateStatus,
    loadSettings
  }
})
