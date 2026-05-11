<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  DEFAULT_AVATAR,
  DEFAULT_PLACEHOLDER,
  type AutoBackToSearchOption,
  type AutoClearOption,
  type AutoPasteOption,
  type MouseButtonType,
  type PrimaryColor,
  type ThemeType
} from '@/constants'
import { Dropdown, HotkeyInput, Slider, useToast } from '@/components'
import { applyCustomColor, applyPrimaryColor } from '@/utils'

const { success, error, info, confirm } = useToast()

// Dropdown 选项数据
const themeOptions = [
  { label: '跟随系统', value: 'system' },
  { label: '明亮', value: 'light' },
  { label: '暗黑', value: 'dark' }
]

const windowMaterialOptions = [
  { label: 'Mica（云母）', value: 'mica' },
  { label: 'Acrylic（亚克力）', value: 'acrylic' },
  { label: '无', value: 'none' }
]

const autoPasteOptions = [
  { label: '关闭', value: 'off' },
  { label: '1秒内', value: '1s' },
  { label: '3秒内', value: '3s' },
  { label: '5秒内', value: '5s' },
  { label: '10秒内', value: '10s' }
]

const autoClearOptions = [
  { label: '立即', value: 'immediately' },
  { label: '1分钟', value: '1m' },
  { label: '2分钟', value: '2m' },
  { label: '3分钟', value: '3m' },
  { label: '5分钟', value: '5m' },
  { label: '10分钟', value: '10m' },
  { label: '从不', value: 'never' }
]

const autoBackToSearchOptions = [
  { label: '立即', value: 'immediately' },
  { label: '30秒', value: '30s' },
  { label: '1分钟', value: '1m' },
  { label: '3分钟', value: '3m' },
  { label: '5分钟', value: '5m' },
  { label: '10分钟', value: '10m' },
  { label: '从不', value: 'never' }
]

const recentRowsOptions = [
  { label: '1行', value: 1 },
  { label: '2行', value: 2 },
  { label: '3行', value: 3 },
  { label: '4行', value: 4 }
]

const pinnedRowsOptions = [
  { label: '1行', value: 1 },
  { label: '2行', value: 2 },
  { label: '3行', value: 3 },
  { label: '4行', value: 4 }
]

const searchModeOptions = [
  { label: '聚合模式', value: 'aggregate' },
  { label: '列表模式', value: 'list' }
]

const tabKeyFunctionOptions = [
  { label: '切换选中', value: 'navigate' },
  { label: '目标指令', value: 'target-command' }
]

const devToolsModeOptions = [
  { label: '独立窗口', value: 'detach' },
  { label: '靠右', value: 'right' },
  { label: '靠下', value: 'bottom' },
  { label: '独立窗口（可停靠）', value: 'undocked' }
]

const superPanelMouseButtonOptions = [
  { label: '按下鼠标中键', value: 'middle' },
  { label: '长按鼠标中键', value: 'middle-long' },
  { label: '长按鼠标右键', value: 'right-long' },
  { label: '按下鼠标后退键', value: 'back' },
  { label: '长按鼠标后退键', value: 'back-long' },
  { label: '按下鼠标前进键', value: 'forward' },
  { label: '长按鼠标前进键', value: 'forward-long' }
]

// 当前平台（与 window.ztools.getPlatform 返回类型保持一致）
const platform = ref<'darwin' | 'win32' | 'linux'>('darwin')

// 默认快捷键（根据平台区分文案）
const defaultHotkey = computed(() => {
  return platform.value === 'win32' ? 'Alt+Z' : 'Option+Z'
})

// 快捷键预设选项（根据平台）
const hotkeyPresets = computed(() => {
  if (platform.value === 'win32') {
    return [
      { label: 'Alt + Space', value: 'Alt+Space' },
      { label: 'Ctrl + Space', value: 'Ctrl+Space' }
    ]
  }
  return [
    { label: 'Command + Space', value: 'Command+Space' },
    { label: 'Option + Space', value: 'Option+Space' }
  ]
})

const showHotkeyQuickActions = ref(false)

// 本地状态（替代 windowStore）
const theme = ref<ThemeType>('system')
const primaryColor = ref<PrimaryColor>('blue')
const placeholder = ref(DEFAULT_PLACEHOLDER)
const avatar = ref(DEFAULT_AVATAR)
const autoPaste = ref<AutoPasteOption>('3s')
const autoClear = ref<AutoClearOption>('immediately')
const autoBackToSearch = ref<AutoBackToSearchOption>('never')
const showRecentInSearch = ref(true)
const showMatchRecommendation = ref(true)
const localAppSearch = ref(true)
const recentRows = ref(2)
const pinnedRows = ref(2)
const searchMode = ref<'aggregate' | 'list'>('aggregate')
const clipboardRetentionDays = ref(180)

// Tab 键目标指令
const tabTargetCommand = ref('')
const tabKeyFunction = ref<'navigate' | 'target-command'>('navigate')

// 空格打开指令
const spaceOpenCommand = ref(false)

// 悬浮球双击目标指令
const floatingBallDoubleClickCommand = ref('')

// 超级面板设置
const superPanelEnabled = ref(false)
const superPanelMouseButton = ref<MouseButtonType>('middle')
const superPanelLongPressMs = ref(500)
const superPanelBlockedApps = ref<Array<{ app: string; bundleId?: string; label?: string }>>([])

// 唤醒黑名单
const wakeupBlacklist = ref<Array<{ app: string; bundleId?: string; label?: string }>>([])

// 超级面板翻译设置
const superPanelTranslateEnabled = ref(false)
const translationStatus = ref<'idle' | 'downloading' | 'initializing' | 'ready' | 'error'>('idle')

// 超级面板触发模式（计算属性）
const superPanelTriggerMode = computed({
  get: () => {
    // 右键特殊处理，如果配置是右键，强制显示为长按右键
    if (superPanelMouseButton.value === 'right') {
      return 'right-long'
    }
    // 如果长按时间大于0，显示为长按模式
    if (superPanelLongPressMs.value > 0) {
      return `${superPanelMouseButton.value}-long`
    }
    // 否则显示为短按模式
    return superPanelMouseButton.value
  },
  set: () => {
    // 这里的 setter 主要用于 v-model 绑定，实际更新逻辑在 handleSuperPanelTriggerModeChange 中
  }
})

function normalizePluginNameList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter((name) => name.length > 0)
    )
  )
}

// 实际快捷键字符串
const hotkey = ref('')

// 不透明度设置
const opacity = ref(1)

// 插件默认高度设置
const windowDefaultHeight = ref(541)

// 托盘图标显示设置
const showTrayIcon = ref(true)

// 悬浮球设置
const floatingBallEnabled = ref(false)
const floatingBallLetter = ref('Z')

// 开机启动设置
const launchAtLogin = ref(false)

// 开发者工具位置
const devToolsMode = ref<'right' | 'bottom' | 'undocked' | 'detach'>('detach')

// 关闭 GPU 加速（兜底方案，修改后需重启生效）
const disableGpuAcceleration = ref(false)

// 用户自定义内部 API 授权插件名
const customInternalApiPluginNameInput = ref('')
const customInternalApiPluginNames = ref<string[]>([])

// 代理设置
const proxyEnabled = ref(false)
const proxyUrl = ref('')

// 插件市场配置
const pluginMarketCustom = ref(false)
const pluginMarketUrl = ref('')

// 窗口材质设置
const windowMaterial = ref<'mica' | 'acrylic' | 'none'>('none')

// 亚克力材质背景色透明度
const acrylicLightOpacity = ref(78) // 明亮模式默认 78%
const acrylicDarkOpacity = ref(50) // 暗黑模式默认 50%

// 颜色选择器引用
const colorPickerInput = ref<HTMLInputElement | null>(null)

// 自动检查更新（保留用于设置持久化）
const autoCheckUpdate = ref(true)

// 主题色选项
const themeColors = [
  { label: '天空蓝', value: 'blue', hex: '#0284c7' },
  { label: '罗兰紫', value: 'purple', hex: '#7c3aed' },
  { label: '翡翠绿', value: 'green', hex: '#059669' },
  { label: '活力橙', value: 'orange', hex: '#ea580c' },
  { label: '宝石红', value: 'red', hex: '#dc2626' }
]

// 自定义颜色
const customColor = ref('#db2777')

// 头像默认值
const defaultAvatar = DEFAULT_AVATAR

// 搜索框提示文字默认值
const defaultPlaceholder = DEFAULT_PLACEHOLDER

// 处理快捷键变化
async function handleHotkeyChange(newHotkey: string): Promise<void> {
  const previousHotkey = hotkey.value
  try {
    // 调用 IPC 更新全局快捷键
    const result = await window.ztools.internal.updateShortcut(newHotkey)
    if (result.success) {
      // 保存到数据库
      await saveSettings()
      console.log('新快捷键设置成功:', hotkey.value)
    } else {
      // 设置失败（被占用等），还原为之前的快捷键
      hotkey.value = previousHotkey
      error(`快捷键设置失败: ${result.error || '未知错误'}`)
    }
  } catch (err: any) {
    hotkey.value = previousHotkey
    console.error('设置快捷键失败:', err)
    error(`设置快捷键失败: ${err.message || '未知错误'}`)
  }
}

// 应用快捷键预设
async function applyHotkeyPreset(preset: string): Promise<void> {
  const previousHotkey = hotkey.value
  try {
    const result = await window.ztools.internal.updateShortcut(preset)
    if (result.success) {
      hotkey.value = preset
      await saveSettings()
      console.log('快捷键预设已应用:', preset)
    } else {
      hotkey.value = previousHotkey
      error(`快捷键设置失败: ${result.error || '未知错误'}`)
    }
  } catch (err: any) {
    hotkey.value = previousHotkey
    console.error('应用快捷键预设失败:', err)
    error(`应用快捷键预设失败: ${err.message || '未知错误'}`)
  }
}

// 重置快捷键
async function resetHotkey(): Promise<void> {
  try {
    const result = await window.ztools.internal.updateShortcut(defaultHotkey.value)
    if (result.success) {
      hotkey.value = defaultHotkey.value
      await saveSettings()
      console.log('重置快捷键成功:', hotkey.value)
    } else {
      error(`重置快捷键失败: ${result.error || '未知错误'}`)
    }
  } catch (err: any) {
    console.error('重置快捷键失败:', err)
    error(`重置快捷键失败: ${err.message || '未知错误'}`)
  }
}

function handleQuickActionsClickOutside(): void {
  showHotkeyQuickActions.value = false
}

function toggleHotkeyQuickActions(): void {
  showHotkeyQuickActions.value = !showHotkeyQuickActions.value
}

async function handleHotkeyPresetSelect(preset: string): Promise<void> {
  await applyHotkeyPreset(preset)
  showHotkeyQuickActions.value = false
}

async function handleHotkeyResetClick(): Promise<void> {
  await resetHotkey()
  showHotkeyQuickActions.value = false
}

// 处理不透明度变化
async function handleOpacityChange(): Promise<void> {
  try {
    await window.ztools.internal.setWindowOpacity(opacity.value)
    // 保存到数据库
    await saveSettings()
  } catch (error) {
    console.error('设置窗口不透明度失败:', error)
  }
}

// 处理窗口默认高度变化
async function handleWindowDefaultHeightChange(): Promise<void> {
  try {
    // 验证输入值
    if (!windowDefaultHeight.value || windowDefaultHeight.value < 200) {
      windowDefaultHeight.value = 541
    }
    await saveSettings()
    // 通知主进程更新
    await window.ztools.internal.setWindowDefaultHeight(windowDefaultHeight.value)
    console.log('插件默认高度已更新:', windowDefaultHeight.value)
  } catch (error) {
    console.error('设置插件默认高度失败:', error)
  }
}

// 重置窗口默认高度
async function resetWindowDefaultHeight(): Promise<void> {
  try {
    windowDefaultHeight.value = 541
    await saveSettings()
    await window.ztools.internal.setWindowDefaultHeight(541)
    console.log('插件默认高度已重置')
  } catch (error) {
    console.error('重置插件默认高度失败:', error)
  }
}

// 处理剪贴板历史保存天数变化
async function handleClipboardRetentionDaysChange(): Promise<void> {
  try {
    if (!clipboardRetentionDays.value || clipboardRetentionDays.value < 1) {
      clipboardRetentionDays.value = 180
    }
    await saveSettings()
    // 通知主进程更新剪贴板配置
    await window.ztools.internal.updateClipboardConfig({
      retentionDays: clipboardRetentionDays.value
    })
    console.log('剪贴板历史保存天数已更新:', clipboardRetentionDays.value)
  } catch (error) {
    console.error('保存剪贴板历史保存天数失败:', error)
  }
}

// 重置剪贴板历史保存天数
async function resetClipboardRetentionDays(): Promise<void> {
  try {
    clipboardRetentionDays.value = 180
    await handleClipboardRetentionDaysChange()
  } catch (error) {
    console.error('重置剪贴板历史保存天数失败:', error)
  }
}

// 处理 placeholder 变化
async function handlePlaceholderChange(): Promise<void> {
  try {
    // 如果为空，恢复默认值
    if (!placeholder.value.trim()) {
      placeholder.value = defaultPlaceholder
    }
    // 保存到数据库
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updatePlaceholder(placeholder.value)
    console.log('搜索框提示文字已更新:', placeholder.value)
  } catch (error) {
    console.error('保存搜索框提示文字失败:', error)
  }
}

// 重置搜索框提示文字
async function handleResetPlaceholder(): Promise<void> {
  try {
    placeholder.value = defaultPlaceholder
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updatePlaceholder(placeholder.value)
    console.log('搜索框提示文字已重置')
  } catch (error) {
    console.error('重置搜索框提示文字失败:', error)
  }
}

// 选择头像
async function handleSelectAvatar(): Promise<void> {
  try {
    const result = await window.ztools.internal.selectAvatar()
    if (result.success && result.path) {
      avatar.value = result.path
      await saveSettings()
      // 通知主渲染进程更新
      await window.ztools.internal.updateAvatar(avatar.value)
      console.log('头像已更新:', avatar.value)
    } else if (result.error) {
      console.error('选择头像失败:', result.error)
    }
  } catch (error) {
    console.error('选择头像失败:', error)
  }
}

// 重置头像
async function handleResetAvatar(): Promise<void> {
  try {
    avatar.value = defaultAvatar
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateAvatar(avatar.value)
    console.log('头像已重置')
  } catch (error) {
    console.error('重置头像失败:', error)
  }
}

// 处理自动粘贴配置变化
async function handleAutoPasteChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateAutoPaste(autoPaste.value)
    console.log('自动粘贴配置已更新:', autoPaste.value)
  } catch (error) {
    console.error('保存自动粘贴配置失败:', error)
  }
}

// 处理自动清空配置变化
async function handleAutoClearChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateAutoClear(autoClear.value)
    console.log('自动清空配置已更新:', autoClear.value)
  } catch (error) {
    console.error('保存自动清空配置失败:', error)
  }
}

// 处理自动返回搜索配置变化
async function handleAutoBackToSearchChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateAutoBackToSearch(autoBackToSearch.value)
    console.log('自动返回搜索配置已更新:', autoBackToSearch.value)
  } catch (error) {
    console.error('保存自动返回搜索配置失败:', error)
  }
}

// 处理主题变化
async function handleThemeChange(): Promise<void> {
  try {
    await saveSettings()
    await window.ztools.internal.setTheme(theme.value)
    console.log('主题配置已更新:', theme.value)
  } catch (error) {
    console.error('更新主题配置失败:', error)
  }
}

// 处理显示最近使用配置变化
async function handleShowRecentInSearchChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateShowRecentInSearch(showRecentInSearch.value)
    console.log('显示最近使用配置已更新:', showRecentInSearch.value)
  } catch (error) {
    console.error('保存显示最近使用配置失败:', error)
  }
}

// 处理匹配推荐配置变化
async function handleShowMatchRecommendationChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateMatchRecommendation(showMatchRecommendation.value)
    console.log('匹配推荐配置已更新:', showMatchRecommendation.value)
  } catch (error) {
    console.error('保存匹配推荐配置失败:', error)
  }
}

// 处理本地应用搜索配置变化
async function handleLocalAppSearchChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateLocalAppSearch(localAppSearch.value)
    console.log('本地应用搜索配置已更新:', localAppSearch.value)
  } catch (error) {
    console.error('保存本地应用搜索配置失败:', error)
  }
}

// 处理最近使用行数变化
async function handleRecentRowsChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateRecentRows(recentRows.value)
    console.log('最近使用行数已更新:', recentRows.value)
  } catch (error) {
    console.error('保存最近使用行数配置失败:', error)
  }
}

// 处理固定栏行数变化
async function handlePinnedRowsChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updatePinnedRows(pinnedRows.value)
    console.log('固定栏行数已更新:', pinnedRows.value)
  } catch (error) {
    console.error('保存固定栏行数配置失败:', error)
  }
}

// 处理搜索框模式变化
async function handleSearchModeChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateSearchMode(searchMode.value)
    console.log('搜索框模式已更新:', searchMode.value)
  } catch (error) {
    console.error('保存搜索框模式配置失败:', error)
  }
}

// 处理空格打开指令变化
async function handleSpaceOpenCommandChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateSpaceOpenCommand(spaceOpenCommand.value)
    console.log('空格打开指令已更新:', spaceOpenCommand.value)
  } catch (error) {
    console.error('保存空格打开指令失败:', error)
  }
}

// 处理 Tab 键目标指令变化
async function handleTabTargetChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateTabTarget(tabTargetCommand.value)
    console.log('Tab 键目标指令已更新:', tabTargetCommand.value)
  } catch (error) {
    console.error('保存 Tab 键目标指令失败:', error)
  }
}

// 处理 Tab 键功能变化
async function handleTabKeyFunctionChange(): Promise<void> {
  try {
    await saveSettings()
    await window.ztools.internal.updateTabKeyFunction(tabKeyFunction.value)
    console.log('Tab 键功能已更新:', tabKeyFunction.value)
  } catch (error) {
    console.error('保存 Tab 键功能失败:', error)
  }
}

// 清除 Tab 键目标指令
async function handleClearTabTarget(): Promise<void> {
  try {
    tabTargetCommand.value = ''
    await saveSettings()
    await window.ztools.internal.updateTabTarget('')
    console.log('Tab 键目标指令已清除')
  } catch (error) {
    console.error('清除 Tab 键目标指令失败:', error)
  }
}

// 应用 Tab 键目标指令预设
async function applyTabTargetPreset(preset: string): Promise<void> {
  try {
    tabTargetCommand.value = preset
    await saveSettings()
    await window.ztools.internal.updateTabTarget(preset)
    console.log('Tab 键目标指令预设已应用:', preset)
  } catch (err) {
    console.error('应用 Tab 键目标指令预设失败:', err)
  }
}

// 处理悬浮球双击目标指令变化
async function handleFloatingBallDoubleClickChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updateFloatingBallDoubleClickCommand(
      floatingBallDoubleClickCommand.value
    )
    console.log('悬浮球双击目标指令已更新:', floatingBallDoubleClickCommand.value)
  } catch (error) {
    console.error('保存悬浮球双击目标指令失败:', error)
  }
}

// 清除悬浮球双击目标指令
async function handleClearFloatingBallDoubleClick(): Promise<void> {
  try {
    floatingBallDoubleClickCommand.value = ''
    await saveSettings()
    await window.ztools.internal.updateFloatingBallDoubleClickCommand('')
    console.log('悬浮球双击目标指令已清除')
  } catch (error) {
    console.error('清除悬浮球双击目标指令失败:', error)
  }
}

// 处理超级面板开关变化
async function handleSuperPanelEnabledChange(): Promise<void> {
  try {
    await saveSettings()
    await window.ztools.internal.updateSuperPanelConfig({
      enabled: superPanelEnabled.value,
      mouseButton: superPanelMouseButton.value,
      longPressMs: superPanelLongPressMs.value
    })
    console.log('超级面板开关已更新:', superPanelEnabled.value)
  } catch (err) {
    console.error('更新超级面板开关失败:', err)
  }
}

// 处理超级面板翻译开关变化
async function handleSuperPanelTranslateChange(): Promise<void> {
  try {
    await saveSettings()
    await window.ztools.internal.updateSuperPanelTranslate(superPanelTranslateEnabled.value)
    if (superPanelTranslateEnabled.value) {
      translationStatus.value = 'downloading'
      // 轮询翻译状态
      pollTranslationStatus()
    } else {
      translationStatus.value = 'idle'
    }
    console.log('超级面板翻译开关已更新:', superPanelTranslateEnabled.value)
  } catch (err) {
    console.error('更新超级面板翻译开关失败:', err)
  }
}

// 轮询翻译引擎状态
function pollTranslationStatus(): void {
  const poll = async (): Promise<void> => {
    try {
      const result = await window.ztools.internal.getTranslationStatus()
      translationStatus.value = result.status
      if (result.status === 'downloading' || result.status === 'initializing') {
        setTimeout(poll, 1000)
      }
    } catch {
      // ignore
    }
  }
  poll()
}

// 处理超级面板触发模式变化
async function handleSuperPanelTriggerModeChange(mode: string | number): Promise<void> {
  try {
    const triggerMode = String(mode)
    let mouseButton: MouseButtonType
    let longPressMs: number

    if (triggerMode.endsWith('-long')) {
      // 长按模式
      mouseButton = triggerMode.replace('-long', '') as MouseButtonType
      // 如果之前的长按时间太短或为0，设置为默认200ms
      longPressMs =
        superPanelLongPressMs.value && superPanelLongPressMs.value >= 200
          ? superPanelLongPressMs.value
          : 200
    } else {
      // 短按模式
      mouseButton = triggerMode as MouseButtonType
      longPressMs = 0
    }

    // 更新本地状态
    superPanelMouseButton.value = mouseButton
    superPanelLongPressMs.value = longPressMs

    await saveSettings()
    await window.ztools.internal.updateSuperPanelConfig({
      enabled: superPanelEnabled.value,
      mouseButton: superPanelMouseButton.value,
      longPressMs: superPanelLongPressMs.value
    })
    console.log('超级面板触发模式已更新:', triggerMode)
  } catch (err) {
    console.error('更新超级面板触发模式失败:', err)
  }
}

// 处理超级面板长按响应时间变化
async function handleSuperPanelLongPressMsChange(): Promise<void> {
  try {
    if (!superPanelLongPressMs.value || superPanelLongPressMs.value < 200) {
      superPanelLongPressMs.value = 200
    }
    if (superPanelLongPressMs.value > 3000) {
      superPanelLongPressMs.value = 3000
    }
    await saveSettings()
    await window.ztools.internal.updateSuperPanelConfig({
      enabled: superPanelEnabled.value,
      mouseButton: superPanelMouseButton.value,
      longPressMs: superPanelLongPressMs.value
    })
    console.log('超级面板长按响应时间已更新:', superPanelLongPressMs.value)
  } catch (err) {
    console.error('更新超级面板长按响应时间失败:', err)
  }
}

// 添加屏蔽应用（获取当前窗口）
async function handleAddBlockedApp(): Promise<void> {
  try {
    console.log('[Setting] handleAddBlockedApp 开始')
    const windowInfo = await window.ztools.internal.getCurrentWindowInfo()
    console.log('[Setting] getCurrentWindowInfo 返回:', JSON.stringify(windowInfo))
    if (!windowInfo) {
      error('无法获取当前窗口信息')
      return
    }

    // 去重检查
    const exists = superPanelBlockedApps.value.some(
      (item) => item.app.toLowerCase() === windowInfo.app.toLowerCase()
    )
    if (exists) {
      info('该应用已在屏蔽列表中')
      return
    }

    // 生成显示名称：去掉 .exe / .app 后缀
    const label = windowInfo.app.replace(/\.(exe|app)$/i, '')

    superPanelBlockedApps.value.push({
      app: windowInfo.app,
      bundleId: windowInfo.bundleId,
      label
    })

    console.log(
      '[Setting] saveSettings 前, blockedApps:',
      JSON.stringify(superPanelBlockedApps.value)
    )
    await saveSettings()
    console.log('[Setting] saveSettings 完成, 开始调用 updateSuperPanelBlockedApps')
    await window.ztools.internal.updateSuperPanelBlockedApps(
      superPanelBlockedApps.value.map((item) => ({ ...item }))
    )
    console.log('[Setting] updateSuperPanelBlockedApps 完成')
  } catch (err) {
    console.error('添加屏蔽应用失败:', err)
  }
}

// 移除屏蔽应用
async function handleRemoveBlockedApp(index: number): Promise<void> {
  try {
    superPanelBlockedApps.value.splice(index, 1)
    await saveSettings()
    await window.ztools.internal.updateSuperPanelBlockedApps(
      superPanelBlockedApps.value.map((item) => ({ ...item }))
    )
  } catch (err) {
    console.error('移除屏蔽应用失败:', err)
  }
}

// 添加到唤醒黑名单
async function handleAddWakeupBlacklistApp(): Promise<void> {
  try {
    const windowInfo = await window.ztools.internal.getCurrentWindowInfo()
    if (!windowInfo) {
      error('无法获取当前窗口信息')
      return
    }

    const isDuplicate =
      platform.value === 'darwin' && windowInfo.bundleId
        ? wakeupBlacklist.value.some((item) => item.bundleId === windowInfo.bundleId)
        : wakeupBlacklist.value.some(
            (item) => item.app.toLowerCase() === windowInfo.app.toLowerCase()
          )

    if (isDuplicate) {
      info('该应用已在唤醒黑名单中')
      return
    }

    const label = windowInfo.app.replace(/\.(exe|app)$/i, '')
    wakeupBlacklist.value.push({
      app: windowInfo.app,
      bundleId: windowInfo.bundleId,
      label
    })

    await saveSettings()
    await window.ztools.internal.updateWakeupBlacklist(
      wakeupBlacklist.value.map((item) => ({ ...item }))
    )
  } catch (err) {
    console.error('添加唤醒黑名单失败:', err)
  }
}

// 移除唤醒黑名单应用
async function handleRemoveWakeupBlacklistApp(index: number): Promise<void> {
  try {
    wakeupBlacklist.value.splice(index, 1)
    await saveSettings()
    await window.ztools.internal.updateWakeupBlacklist(
      wakeupBlacklist.value.map((item) => ({ ...item }))
    )
  } catch (err) {
    console.error('移除唤醒黑名单失败:', err)
  }
}

// 处理主题色变化
async function handlePrimaryColorChange(color: string): Promise<void> {
  try {
    primaryColor.value = color as PrimaryColor

    applyPrimaryColor(primaryColor.value, customColor.value)

    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updatePrimaryColor(color, customColor.value)
    console.log('主题色已更新:', color)
  } catch (error) {
    console.error('更新主题色失败:', error)
  }
}

// 选择自定义颜色（不打开色盘）
async function handleSelectCustomColor(): Promise<void> {
  try {
    primaryColor.value = 'custom' as PrimaryColor

    applyPrimaryColor(primaryColor.value, customColor.value)

    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updatePrimaryColor('custom', customColor.value)
    console.log('已选择自定义主题色')
  } catch (error) {
    console.error('选择自定义主题色失败:', error)
  }
}

// 打开颜色选择器
function openColorPicker(): void {
  colorPickerInput.value?.click()
}

// 处理自定义颜色变化
async function handleCustomColorChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const color = target.value
  customColor.value = color

  // 如果当前主题色是自定义，立即应用
  if (primaryColor.value === 'custom') {
    applyCustomColor(color)
  }

  try {
    await saveSettings()
    // 通知主渲染进程更新
    await window.ztools.internal.updatePrimaryColor(primaryColor.value, color)
    console.log('自定义主题色已更新:', color)
  } catch (error) {
    console.error('更新自定义主题色失败:', error)
  }
}

// 处理托盘图标显示变化
async function handleTrayIconChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主进程更新托盘图标显示状态
    await window.ztools.internal.setTrayIconVisible(showTrayIcon.value)
    console.log('托盘图标显示状态已更新:', showTrayIcon.value)
  } catch (error) {
    console.error('更新托盘图标显示状态失败:', error)
  }
}

// 处理悬浮球开关变化
async function handleFloatingBallChange(): Promise<void> {
  try {
    await window.ztools.internal.setFloatingBallEnabled(floatingBallEnabled.value)
    console.log('悬浮球设置已更新:', floatingBallEnabled.value)
  } catch (err) {
    console.error('更新悬浮球设置失败:', err)
    // 恢复状态
    floatingBallEnabled.value = !floatingBallEnabled.value
  }
}

// 处理悬浮球文字变化
async function handleFloatingBallLetterChange(): Promise<void> {
  try {
    const letter = floatingBallLetter.value.trim() || 'Z'
    floatingBallLetter.value = letter
    await window.ztools.internal.setFloatingBallLetter(letter)
    console.log('悬浮球文字已更新:', letter)
  } catch (err) {
    console.error('更新悬浮球文字失败:', err)
  }
}

// 处理窗口材质变化
async function handleWindowMaterialChange(): Promise<void> {
  try {
    await saveSettings()
    // 调用主进程更新材质（会广播到主渲染进程）
    await window.ztools.internal.setWindowMaterial(windowMaterial.value)
    // 设置插件自己也需要更新 data-material 属性
    document.documentElement.setAttribute('data-material', windowMaterial.value)
  } catch (error) {
    console.error('更新窗口材质失败:', error)
  }
}

// 处理亚克力明亮模式透明度变化
async function handleAcrylicLightOpacityChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新（主渲染进程会应用 CSS 叠加效果）
    await window.ztools.internal.updateAcrylicOpacity(
      acrylicLightOpacity.value,
      acrylicDarkOpacity.value
    )
  } catch (error) {
    console.error('更新亚克力明亮模式透明度失败:', error)
  }
}

// 处理亚克力暗黑模式透明度变化
async function handleAcrylicDarkOpacityChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新（主渲染进程会应用 CSS 叠加效果）
    await window.ztools.internal.updateAcrylicOpacity(
      acrylicLightOpacity.value,
      acrylicDarkOpacity.value
    )
  } catch (error) {
    console.error('更新亚克力暗黑模式透明度失败:', error)
  }
}

// 处理开机启动变化
async function handleLaunchAtLoginChange(): Promise<void> {
  try {
    await window.ztools.internal.setLaunchAtLogin(launchAtLogin.value)
    console.log('开机启动设置已更新:', launchAtLogin.value)
  } catch (error) {
    console.error('更新开机启动设置失败:', error)
    // 恢复状态
    launchAtLogin.value = !launchAtLogin.value
  }
}

// 处理开发者工具位置变化
async function handleDevToolsModeChange(): Promise<void> {
  try {
    await saveSettings()
    console.log('开发者工具位置已更新:', devToolsMode.value)
  } catch (err) {
    console.error('保存开发者工具位置失败:', err)
  }
}

// 处理关闭 GPU 加速开关变化
async function handleDisableGpuAccelerationChange(): Promise<void> {
  try {
    await saveSettings()
    info('设置已保存，重启应用后生效')
    console.log('关闭 GPU 加速设置已更新:', disableGpuAcceleration.value)
  } catch (err) {
    console.error('保存关闭 GPU 加速设置失败:', err)
  }
}

// 处理代理开关变化
async function handleProxyEnabledChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主进程更新代理配置
    await window.ztools.internal.setProxyConfig({
      enabled: proxyEnabled.value,
      url: proxyUrl.value
    })
    console.log('代理开关已更新:', proxyEnabled.value)
    info(proxyEnabled.value ? '代理已启用' : '代理已禁用')
  } catch (error) {
    console.error('更新代理开关失败:', error)
    // 恢复状态
    proxyEnabled.value = !proxyEnabled.value
  }
}

// 处理代理地址变化
async function handleProxyUrlChange(): Promise<void> {
  try {
    // 验证代理地址格式
    if (proxyUrl.value && !isValidProxyUrl(proxyUrl.value)) {
      error('代理地址格式不正确，请使用 http://host:port 或 socks5://host:port 格式')
      return
    }

    await saveSettings()
    // 通知主进程更新代理配置
    await window.ztools.internal.setProxyConfig({
      enabled: proxyEnabled.value,
      url: proxyUrl.value
    })
    console.log('代理地址已更新:', proxyUrl.value)
    info('代理地址已更新')
  } catch (err: any) {
    console.error('更新代理地址失败:', err)
    error(`更新代理地址失败: ${err.message || '未知错误'}`)
  }
}

// 处理插件市场开关变化
async function handlePluginMarketCustomChange(): Promise<void> {
  try {
    await saveSettings()
    console.log('插件市场自定义开关已更新:', pluginMarketCustom.value)
    info(pluginMarketCustom.value ? '自定义插件市场已启用' : '已恢复默认插件市场')
  } catch (err) {
    console.error('更新插件市场配置失败:', err)
    pluginMarketCustom.value = !pluginMarketCustom.value
  }
}

// 处理插件市场地址变化
async function handlePluginMarketUrlChange(): Promise<void> {
  try {
    if (pluginMarketUrl.value && !pluginMarketUrl.value.startsWith('http')) {
      error('市场地址必须以 http:// 或 https:// 开头')
      return
    }
    await saveSettings()
    console.log('插件市场地址已更新:', pluginMarketUrl.value)
    info('插件市场地址已更新')
  } catch (err: any) {
    console.error('更新插件市场地址失败:', err)
    error(`更新插件市场地址失败: ${err.message || '未知错误'}`)
  }
}

async function handleAddCustomInternalApiPluginName(): Promise<void> {
  const pluginName = customInternalApiPluginNameInput.value.trim()
  if (!pluginName) {
    error('请输入插件名称')
    return
  }

  if (customInternalApiPluginNames.value.includes(pluginName)) {
    info('该插件已在授权列表中')
    return
  }

  const confirmed = await confirm({
    title: '授权内部 API 风险提示',
    message: `即将允许插件 "${pluginName}" 调用内部 API。\n\n内部 API 可以读写 ZTools 设置、管理插件、注册快捷键、访问窗口信息并执行其他高权限操作。请仅授权你完全信任的插件；恶意插件可能造成隐私泄露、数据损坏或执行非预期操作。`,
    type: 'danger',
    confirmText: '已知风险，继续授权',
    cancelText: '取消'
  })
  if (!confirmed) {
    return
  }

  customInternalApiPluginNames.value = [...customInternalApiPluginNames.value, pluginName]
  customInternalApiPluginNameInput.value = ''
  await saveSettings()
  success('内部 API 授权已添加')
}

async function handleRemoveCustomInternalApiPluginName(index: number): Promise<void> {
  try {
    customInternalApiPluginNames.value.splice(index, 1)
    await saveSettings()
    success('内部 API 授权已删除')
  } catch (err) {
    console.error('删除内部 API 授权失败:', err)
    error('删除内部 API 授权失败')
  }
}

// 验证代理 URL 格式
function isValidProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:', 'socks5:', 'socks4:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

// ==================== 自定义颜色相关辅助函数 ====================

// 获取平台信息（用于快捷键文案）
async function getPlatformInfo(): Promise<void> {
  try {
    const pf = await window.ztools.internal.getPlatform()
    if (pf === 'darwin' || pf === 'win32' || pf === 'linux') {
      platform.value = pf
    }
  } catch (error) {
    console.error('获取平台信息失败:', error)
  }
}

// ==================== 数据持久化 ====================

// 加载设置
async function loadSettings(): Promise<void> {
  try {
    // 加载数据库中的设置
    const data = await window.ztools.internal.dbGet('settings-general')
    console.log('加载到的设置:', data)

    if (data) {
      opacity.value = data.opacity ?? 1
      windowDefaultHeight.value = data.windowDefaultHeight ?? 541
      hotkey.value = data.hotkey ?? defaultHotkey.value
      showTrayIcon.value = data.showTrayIcon ?? true
      placeholder.value = data.placeholder ?? DEFAULT_PLACEHOLDER
      avatar.value = data.avatar ?? DEFAULT_AVATAR
      autoPaste.value = data.autoPaste ?? '3s'
      autoClear.value = data.autoClear ?? 'immediately'
      autoBackToSearch.value = data.autoBackToSearch ?? 'never'
      showRecentInSearch.value = data.showRecentInSearch ?? true
      showMatchRecommendation.value = data.showMatchRecommendation ?? true
      localAppSearch.value = data.localAppSearch ?? true
      recentRows.value = data.recentRows ?? 2
      pinnedRows.value = data.pinnedRows ?? 2
      theme.value = data.theme ?? 'system'
      primaryColor.value = data.primaryColor ?? 'blue'
      searchMode.value = data.searchMode ?? 'aggregate'
      autoCheckUpdate.value = data.autoCheckUpdate ?? true
      tabKeyFunction.value =
        data.tabKeyFunction ?? (data.tabTargetCommand ? 'target-command' : 'navigate')
      // Tab 键目标指令
      tabTargetCommand.value = data.tabTargetCommand ?? ''
      // 空格打开指令
      spaceOpenCommand.value = data.spaceOpenCommand ?? false
      // 悬浮球双击目标指令
      floatingBallDoubleClickCommand.value = data.floatingBallDoubleClickCommand ?? ''

      // 超级面板配置
      superPanelEnabled.value = data.superPanelEnabled ?? false
      superPanelMouseButton.value = data.superPanelMouseButton ?? 'middle'
      superPanelLongPressMs.value = data.superPanelLongPressMs ?? 500
      superPanelBlockedApps.value = data.superPanelBlockedApps ?? []
      wakeupBlacklist.value = data.wakeupBlacklist ?? []
      superPanelTranslateEnabled.value = data.superPanelTranslateEnabled ?? false
      if (superPanelTranslateEnabled.value) {
        pollTranslationStatus()
      }
      // 窗口材质由主进程启动时保证一定有值，无需兜底
      windowMaterial.value = data.windowMaterial
      acrylicLightOpacity.value = data.acrylicLightOpacity ?? 78
      acrylicDarkOpacity.value = data.acrylicDarkOpacity ?? 50
      // 开发者工具位置
      devToolsMode.value = data.devToolsMode ?? 'detach'
      // GPU 加速控制
      disableGpuAcceleration.value = data.disableGpuAcceleration ?? false
      customInternalApiPluginNames.value = normalizePluginNameList(
        data.customInternalApiPluginNames
      )

      // 代理配置
      proxyEnabled.value = data.proxyEnabled ?? false
      proxyUrl.value = data.proxyUrl ?? ''

      // 插件市场配置
      pluginMarketCustom.value = data.pluginMarketCustom ?? false
      pluginMarketUrl.value = data.pluginMarketUrl ?? ''

      // 悬浮球配置
      floatingBallEnabled.value = data.floatingBallEnabled ?? false
      floatingBallLetter.value = data.floatingBallLetter || 'Z'

      // 加载自定义颜色
      if (data.customColor) {
        customColor.value = data.customColor
      }

      applyPrimaryColor(primaryColor.value, customColor.value)
    }

    // 获取当前实际注册的快捷键
    const currentShortcut = await window.ztools.internal.getCurrentShortcut()
    hotkey.value = currentShortcut || defaultHotkey.value

    // 应用透明度设置
    await window.ztools.internal.setWindowOpacity(opacity.value)

    // 获取开机启动状态
    launchAtLogin.value = await window.ztools.internal.getLaunchAtLogin()
  } catch (error) {
    console.error('加载设置失败:', error)
  }
}

// 保存设置
async function saveSettings(): Promise<void> {
  try {
    // 只有自定义头像才保存到数据库，默认头像不保存
    const avatarToSave = avatar.value === defaultAvatar ? undefined : avatar.value

    // 先读取现有设置，保留本页不管理的字段（如 builtinAppShortcutsEnabled）
    const existing = (await window.ztools.internal.dbGet('settings-general')) || {}

    await window.ztools.internal.dbPut('settings-general', {
      ...existing,
      opacity: opacity.value,
      windowDefaultHeight: windowDefaultHeight.value,
      hotkey: hotkey.value,
      placeholder: placeholder.value,
      avatar: avatarToSave,
      autoPaste: autoPaste.value,
      autoClear: autoClear.value,
      autoBackToSearch: autoBackToSearch.value,
      showRecentInSearch: showRecentInSearch.value,
      showMatchRecommendation: showMatchRecommendation.value,
      localAppSearch: localAppSearch.value,
      recentRows: recentRows.value,
      pinnedRows: pinnedRows.value,
      searchMode: searchMode.value,
      tabKeyFunction: tabKeyFunction.value,
      tabTargetCommand: tabTargetCommand.value,
      spaceOpenCommand: spaceOpenCommand.value,
      floatingBallDoubleClickCommand: floatingBallDoubleClickCommand.value,
      floatingBallEnabled: floatingBallEnabled.value,
      floatingBallLetter: floatingBallLetter.value,
      superPanelEnabled: superPanelEnabled.value,
      superPanelMouseButton: superPanelMouseButton.value,
      superPanelLongPressMs: superPanelLongPressMs.value,
      superPanelBlockedApps: superPanelBlockedApps.value.map((item) => ({ ...item })),
      wakeupBlacklist: wakeupBlacklist.value.map((item) => ({ ...item })),
      superPanelTranslateEnabled: superPanelTranslateEnabled.value,
      theme: theme.value,
      primaryColor: primaryColor.value,
      customColor: customColor.value,
      showTrayIcon: showTrayIcon.value,
      windowMaterial: windowMaterial.value,
      acrylicLightOpacity: acrylicLightOpacity.value,
      acrylicDarkOpacity: acrylicDarkOpacity.value,
      devToolsMode: devToolsMode.value,
      disableGpuAcceleration: disableGpuAcceleration.value,
      customInternalApiPluginNames: [...customInternalApiPluginNames.value],
      proxyEnabled: proxyEnabled.value,
      proxyUrl: proxyUrl.value,
      pluginMarketCustom: pluginMarketCustom.value,
      pluginMarketUrl: pluginMarketUrl.value,
      autoCheckUpdate: autoCheckUpdate.value,
      clipboardRetentionDays: clipboardRetentionDays.value
    })
  } catch (error) {
    console.error('保存设置失败:', error)
  }
}

// 初始化时加载设置
onMounted(() => {
  loadSettings()
  getPlatformInfo()
  document.addEventListener('click', handleQuickActionsClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleQuickActionsClickOutside)
})
</script>

<template>
  <div class="content-panel">
    <!-- ==================== 基础 ==================== -->
    <div class="setting-group">
      <h3 class="setting-group-title">基础</h3>

      <div class="setting-item">
        <div class="setting-label">
          <span>呼出快捷键</span>
          <span class="setting-desc">设置全局快捷键来呼出应用</span>
        </div>
        <div class="setting-control">
          <HotkeyInput v-model="hotkey" :platform="platform" @change="handleHotkeyChange" />
          <div class="quick-actions-wrapper">
            <button
              type="button"
              class="icon-btn quick-actions-trigger"
              :class="{ active: showHotkeyQuickActions }"
              title="快捷设置"
              @click.stop="toggleHotkeyQuickActions"
            >
              <div class="i-z-settings font-size-16px" />
            </button>
            <Transition name="dropdown">
              <div v-if="showHotkeyQuickActions" class="quick-actions-dropdown" @click.stop>
                <button
                  v-for="preset in hotkeyPresets"
                  :key="preset.value"
                  type="button"
                  class="quick-actions-item"
                  :class="{ active: hotkey === preset.value }"
                  @click="handleHotkeyPresetSelect(preset.value)"
                >
                  <div class="quick-actions-item-info">
                    <span class="quick-actions-item-label">{{ preset.label }}</span>
                    <span class="quick-actions-item-desc">快速应用该快捷键预设</span>
                  </div>
                </button>
                <button
                  type="button"
                  class="quick-actions-item quick-actions-item-reset"
                  @click="handleHotkeyResetClick"
                >
                  <div class="quick-actions-item-info">
                    <span class="quick-actions-item-label">重置</span>
                    <span class="quick-actions-item-desc"
                      >恢复为默认快捷键 {{ defaultHotkey }}</span
                    >
                  </div>
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>开机自动启动</span>
          <span class="setting-desc">登录系统时自动启动应用</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input v-model="launchAtLogin" type="checkbox" @change="handleLaunchAtLoginChange" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>显示托盘图标</span>
          <span class="setting-desc">在系统托盘中显示应用图标</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input v-model="showTrayIcon" type="checkbox" @change="handleTrayIconChange" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="setting-item blocked-apps-setting">
        <div class="blocked-apps-content">
          <div class="blocked-apps-header">
            <div class="setting-label">
              <span>唤醒黑名单</span>
              <span class="setting-desc">在指定应用窗口中按快捷键不唤醒主窗口</span>
            </div>
            <div class="setting-control">
              <button class="btn btn-sm" @click="handleAddWakeupBlacklistApp">添加当前窗口</button>
            </div>
          </div>
          <div v-if="wakeupBlacklist.length > 0" class="blocked-apps-tags">
            <span v-for="(app, index) in wakeupBlacklist" :key="app.app" class="blocked-app-tag">
              {{ app.label || app.app }}
              <button class="blocked-app-remove" @click="handleRemoveWakeupBlacklistApp(index)">
                &times;
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 外观 ==================== -->
    <div class="setting-group">
      <h3 class="setting-group-title">外观</h3>

      <div class="setting-item">
        <div class="setting-label">
          <span>主题设置</span>
          <span class="setting-desc">选择应用的主题外观</span>
        </div>
        <div class="setting-control">
          <Dropdown v-model="theme" :options="themeOptions" @change="handleThemeChange" />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>主题色</span>
          <span class="setting-desc">自定义应用的主色调</span>
        </div>
        <div class="setting-control color-control">
          <div
            v-for="color in themeColors"
            :key="color.value"
            class="color-option"
            :class="{ active: primaryColor === color.value }"
            :style="{ backgroundColor: color.hex }"
            :title="color.label"
            @click="handlePrimaryColorChange(color.value)"
          ></div>
          <div
            class="color-option custom-color-option"
            :class="{ active: primaryColor === 'custom' }"
            :style="{ backgroundColor: customColor }"
            title="自定义"
            @click="handleSelectCustomColor"
          ></div>
          <button v-if="primaryColor === 'custom'" class="btn btn-sm" @click="openColorPicker">
            自定义
          </button>
          <input
            ref="colorPickerInput"
            type="color"
            :value="customColor"
            class="color-picker-hidden"
            @input="handleCustomColorChange"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>窗口不透明度</span>
          <span class="setting-desc">调整窗口的透明度</span>
        </div>
        <div class="setting-control opacity-control">
          <Slider
            v-model="opacity"
            :min="0.3"
            :max="1"
            :step="0.01"
            :formatter="(value) => `${Math.round(value * 100)}%`"
            @change="handleOpacityChange"
          />
        </div>
      </div>

      <div v-if="platform === 'win32'" class="setting-item">
        <div class="setting-label">
          <span>窗口材质</span>
          <span class="setting-desc">选择窗口背景材质效果（需要 Windows 11）</span>
        </div>
        <div class="setting-control">
          <Dropdown
            v-model="windowMaterial"
            :options="windowMaterialOptions"
            @change="handleWindowMaterialChange"
          />
        </div>
      </div>

      <div v-if="platform === 'win32' && windowMaterial === 'acrylic'" class="setting-item">
        <div class="setting-label">
          <span>明亮模式背景色透明度</span>
          <span class="setting-desc">调整亚克力材质在明亮模式下的白色背景叠加透明度</span>
        </div>
        <div class="setting-control opacity-control">
          <Slider
            v-model="acrylicLightOpacity"
            :min="0"
            :max="100"
            :step="1"
            :formatter="(value) => `${value}%`"
            @change="handleAcrylicLightOpacityChange"
          />
        </div>
      </div>

      <div v-if="platform === 'win32' && windowMaterial === 'acrylic'" class="setting-item">
        <div class="setting-label">
          <span>暗黑模式背景色透明度</span>
          <span class="setting-desc">调整亚克力材质在暗黑模式下的黑色背景叠加透明度</span>
        </div>
        <div class="setting-control opacity-control">
          <Slider
            v-model="acrylicDarkOpacity"
            :min="0"
            :max="100"
            :step="1"
            :formatter="(value) => `${value}%`"
            @change="handleAcrylicDarkOpacityChange"
          />
        </div>
      </div>
    </div>

    <!-- ==================== 搜索 ==================== -->
    <div class="setting-group">
      <h3 class="setting-group-title">搜索</h3>

      <div class="setting-item">
        <div class="setting-label">
          <span>搜索框提示文字</span>
          <span class="setting-desc">自定义搜索框的占位提示文字</span>
        </div>
        <div class="setting-control">
          <input
            v-model="placeholder"
            type="text"
            class="input"
            placeholder="输入提示文字"
            @blur="handlePlaceholderChange"
            @keyup.enter="handlePlaceholderChange"
          />
          <button
            v-if="placeholder !== defaultPlaceholder"
            class="btn btn-icon"
            title="重置"
            @click="handleResetPlaceholder"
          >
            <svg
              width="20"
              height="20"
              viewBox="1 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M14.5 9C14.5 11.4853 12.4853 13.5 10 13.5C7.51472 13.5 5.5 11.4853 5.5 9C5.5 6.51472 7.51472 4.5 10 4.5C11.6569 4.5 13.0943 5.41421 13.8536 6.75M14 4V7H11"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>搜索框头像</span>
          <span class="setting-desc">自定义搜索框右侧显示的头像</span>
        </div>
        <div class="setting-control avatar-control">
          <img
            v-if="avatar"
            :src="avatar"
            :class="['avatar-preview', { 'default-avatar': avatar === defaultAvatar }]"
            alt="头像预览"
            draggable="false"
          />
          <button class="btn" @click="handleSelectAvatar">选择图片</button>
          <button
            v-if="avatar !== defaultAvatar"
            class="btn btn-icon"
            title="重置"
            @click="handleResetAvatar"
          >
            <svg
              width="20"
              height="20"
              viewBox="1 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M14.5 9C14.5 11.4853 12.4853 13.5 10 13.5C7.51472 13.5 5.5 11.4853 5.5 9C5.5 6.51472 7.51472 4.5 10 4.5C11.6569 4.5 13.0943 5.41421 13.8536 6.75M14 4V7H11"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>搜索框模式</span>
          <span class="setting-desc">选择搜索框的显示模式</span>
        </div>
        <div class="setting-control">
          <Dropdown
            v-model="searchMode"
            :options="searchModeOptions"
            @change="handleSearchModeChange"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>搜索框显示最近使用</span>
          <span class="setting-desc">开启后搜索框将显示最近使用的应用</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              v-model="showRecentInSearch"
              type="checkbox"
              @change="handleShowRecentInSearchChange"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>匹配推荐</span>
          <span class="setting-desc">
            开启后显示匹配推荐分组(建议不要关闭否则带 over 匹配无法正常运行)
          </span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              v-model="showMatchRecommendation"
              type="checkbox"
              @change="handleShowMatchRecommendationChange"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div v-if="showRecentInSearch && searchMode === 'aggregate'" class="setting-item">
        <div class="setting-label">
          <span>最近使用显示行数</span>
          <span class="setting-desc">设置最近使用列表显示的行数（每行9个）</span>
        </div>
        <div class="setting-control">
          <Dropdown
            v-model="recentRows"
            :options="recentRowsOptions"
            @change="handleRecentRowsChange"
          />
        </div>
      </div>

      <div v-if="searchMode === 'aggregate'" class="setting-item">
        <div class="setting-label">
          <span>固定栏显示行数</span>
          <span class="setting-desc">设置已固定应用列表显示的行数（每行9个）</span>
        </div>
        <div class="setting-control">
          <Dropdown
            v-model="pinnedRows"
            :options="pinnedRowsOptions"
            @change="handlePinnedRowsChange"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>本地应用搜索</span>
          <span class="setting-desc">开启后搜索结果将包含本地安装的应用</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input v-model="localAppSearch" type="checkbox" @change="handleLocalAppSearchChange" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>空格打开指令</span>
          <span class="setting-desc">搜索框为空时按空格键打开选中的指令</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              v-model="spaceOpenCommand"
              type="checkbox"
              @change="handleSpaceOpenCommandChange"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="setting-item tab-target-setting-item">
        <div class="setting-label">
          <span>Tab 功能</span>
          <span class="setting-desc">设置 Tab 键用于切换选中项，或直接进入指定指令</span>
        </div>
        <div class="setting-control-column">
          <div class="setting-control">
            <Dropdown
              v-model="tabKeyFunction"
              :options="tabKeyFunctionOptions"
              @change="handleTabKeyFunctionChange"
            />
          </div>
        </div>
      </div>

      <div v-if="tabKeyFunction === 'target-command'" class="setting-item tab-target-setting-item">
        <div class="setting-label">
          <span>Tab 键目标指令</span>
          <span class="setting-desc"
            >配置后在搜索框输入文字按 Tab 键可直接进入对应指令，常用于快速打开 AI 对话等场景</span
          >
        </div>
        <div class="setting-control-column">
          <div class="setting-control">
            <input
              v-model="tabTargetCommand"
              type="text"
              class="input"
              placeholder="例如：AI助手/对话"
              @blur="handleTabTargetChange"
              @keyup.enter="handleTabTargetChange"
            />
            <button
              v-if="tabTargetCommand"
              class="btn btn-icon"
              title="清除"
              @click="handleClearTabTarget"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M6 6L14 14M14 6L6 14"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
          <div class="hotkey-presets">
            <button
              class="hotkey-preset-btn"
              :class="{ active: tabTargetCommand === 'AI助手/AI对话' }"
              @click="applyTabTargetPreset('AI助手/AI对话')"
            >
              AI提问
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 行为 ==================== -->
    <div class="setting-group">
      <h3 class="setting-group-title">行为</h3>

      <div class="setting-item">
        <div class="setting-label">
          <span>自动粘贴搜索框</span>
          <span class="setting-desc">复制文本后在设定时间内打开窗口自动粘贴</span>
        </div>
        <div class="setting-control">
          <Dropdown
            v-model="autoPaste"
            :options="autoPasteOptions"
            @change="handleAutoPasteChange"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>自动清空搜索框</span>
          <span class="setting-desc">窗口显示状态切换后自动清空搜索框内容的时间</span>
        </div>
        <div class="setting-control">
          <Dropdown
            v-model="autoClear"
            :options="autoClearOptions"
            @change="handleAutoClearChange"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>自动返回到搜索</span>
          <span class="setting-desc">主窗口打开插件后隐藏，在设定时间后自动返回搜索界面</span>
        </div>
        <div class="setting-control">
          <Dropdown
            v-model="autoBackToSearch"
            :options="autoBackToSearchOptions"
            @change="handleAutoBackToSearchChange"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>插件默认高度</span>
          <span class="setting-desc">设置进入插件时的默认高度（像素）</span>
        </div>
        <div class="setting-control">
          <input
            v-model.number="windowDefaultHeight"
            type="number"
            class="input"
            placeholder="600"
            min="200"
            @blur="handleWindowDefaultHeightChange"
            @keyup.enter="handleWindowDefaultHeightChange"
          />
          <button
            v-if="windowDefaultHeight !== 541"
            class="btn btn-icon"
            title="重置"
            @click="resetWindowDefaultHeight"
          >
            <svg
              width="20"
              height="20"
              viewBox="1 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M14.5 9C14.5 11.4853 12.4853 13.5 10 13.5C7.51472 13.5 5.5 11.4853 5.5 9C5.5 6.51472 7.51472 4.5 10 4.5C11.6569 4.5 13.0943 5.41421 13.8536 6.75M14 4V7H11"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>剪贴板历史保存天数</span>
          <span class="setting-desc">剪贴板历史记录的保留时长（天）</span>
        </div>
        <div class="setting-control">
          <input
            v-model.number="clipboardRetentionDays"
            type="number"
            class="input"
            placeholder="180"
            min="1"
            max="3650"
            @blur="handleClipboardRetentionDaysChange"
            @keyup.enter="handleClipboardRetentionDaysChange"
          />
          <button
            v-if="clipboardRetentionDays !== 180"
            class="btn btn-icon"
            title="重置"
            @click="resetClipboardRetentionDays"
          >
            <svg
              width="20"
              height="20"
              viewBox="1 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M14.5 9C14.5 11.4853 12.4853 13.5 10 13.5C7.51472 13.5 5.5 11.4853 5.5 9C5.5 6.51472 7.51472 4.5 10 4.5C11.6569 4.5 13.0943 5.41421 13.8536 6.75M14 4V7H11"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- ==================== 超级面板 ==================== -->
    <div class="setting-group">
      <h3 class="setting-group-title">超级面板</h3>

      <div class="setting-item">
        <div class="setting-label">
          <span>启用超级面板</span>
          <span class="setting-desc">长按鼠标按键弹出超级面板，快速访问应用和插件</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              v-model="superPanelEnabled"
              type="checkbox"
              @change="handleSuperPanelEnabledChange"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div v-if="superPanelEnabled" class="setting-item">
        <div class="setting-label">
          <span>鼠标按键弹出</span>
          <span class="setting-desc">选择触发超级面板的鼠标按键</span>
        </div>
        <div class="setting-control">
          <Dropdown
            v-model="superPanelTriggerMode"
            :options="superPanelMouseButtonOptions"
            @change="handleSuperPanelTriggerModeChange"
          />
        </div>
      </div>

      <div v-if="superPanelEnabled && superPanelTriggerMode.endsWith('-long')" class="setting-item">
        <div class="setting-label">
          <span>长按响应时间</span>
          <span class="setting-desc">长按鼠标按键多少毫秒后弹出超级面板</span>
        </div>
        <div class="setting-control">
          <input
            v-model.number="superPanelLongPressMs"
            type="number"
            class="input"
            placeholder="500"
            min="200"
            max="3000"
            @blur="handleSuperPanelLongPressMsChange"
            @keyup.enter="handleSuperPanelLongPressMsChange"
          />
        </div>
      </div>

      <div v-if="superPanelEnabled" class="setting-item">
        <div class="setting-label">
          <span>选中翻译</span>
          <span class="setting-desc">
            选中文字触发超级面板时，自动翻译为中文显示（使用 Bergamot 离线翻译引擎，首次启用需下载约
            55MB 模型）
          </span>
          <span
            v-if="superPanelTranslateEnabled && translationStatus === 'downloading'"
            class="setting-desc"
            style="color: var(--primary-color)"
          >
            正在下载翻译模型...
          </span>
          <span
            v-else-if="superPanelTranslateEnabled && translationStatus === 'initializing'"
            class="setting-desc"
            style="color: var(--primary-color)"
          >
            正在初始化翻译引擎...
          </span>
          <span
            v-else-if="superPanelTranslateEnabled && translationStatus === 'ready'"
            class="setting-desc"
            style="color: var(--success-color)"
          >
            翻译引擎就绪
          </span>
          <span
            v-else-if="superPanelTranslateEnabled && translationStatus === 'error'"
            class="setting-desc"
            style="color: var(--danger-color)"
          >
            翻译引擎初始化失败
          </span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              v-model="superPanelTranslateEnabled"
              type="checkbox"
              @change="handleSuperPanelTranslateChange"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div v-if="superPanelEnabled" class="setting-item blocked-apps-setting">
        <div class="blocked-apps-content">
          <div class="blocked-apps-header">
            <div class="setting-label">
              <span>屏蔽弹出</span>
              <span class="setting-desc">在指定应用窗口中不触发超级面板</span>
            </div>
            <div class="setting-control">
              <button class="btn btn-sm" @click="handleAddBlockedApp">添加当前窗口</button>
            </div>
          </div>
          <div
            v-if="superPanelEnabled && superPanelBlockedApps.length > 0"
            class="blocked-apps-tags"
          >
            <span
              v-for="(app, index) in superPanelBlockedApps"
              :key="app.app"
              class="blocked-app-tag"
            >
              {{ app.label || app.app }}
              <button class="blocked-app-remove" @click="handleRemoveBlockedApp(index)">
                &times;
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 悬浮球 ==================== -->
    <div class="setting-group">
      <h3 class="setting-group-title">悬浮球</h3>

      <div class="setting-item">
        <div class="setting-label">
          <span>显示悬浮球</span>
          <span class="setting-desc"
            >在桌面显示一个置顶悬浮球，点击可快速启动/隐藏主界面，支持拖入文件到悬浮球</span
          >
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              v-model="floatingBallEnabled"
              type="checkbox"
              @change="handleFloatingBallChange"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div v-if="floatingBallEnabled" class="setting-item">
        <div class="setting-label">
          <span>悬浮球文字</span>
          <span class="setting-desc">自定义悬浮球上显示的文字，默认为 Z</span>
        </div>
        <div class="setting-control">
          <input
            v-model="floatingBallLetter"
            type="text"
            class="input"
            placeholder="Z"
            maxlength="2"
            style="width: 60px; text-align: center"
            @blur="handleFloatingBallLetterChange"
            @keyup.enter="handleFloatingBallLetterChange"
          />
        </div>
      </div>

      <div v-if="floatingBallEnabled" class="setting-item">
        <div class="setting-label">
          <span>悬浮球双击目标指令</span>
          <span class="setting-desc"
            >配置后双击悬浮球可直接进入对应指令，常用于快速打开 AI 对话等场景</span
          >
        </div>
        <div class="setting-control">
          <input
            v-model="floatingBallDoubleClickCommand"
            type="text"
            class="input"
            placeholder="例如：AI助手/对话"
            @blur="handleFloatingBallDoubleClickChange"
            @keyup.enter="handleFloatingBallDoubleClickChange"
          />
          <button
            v-if="floatingBallDoubleClickCommand"
            class="btn btn-icon"
            title="清除"
            @click="handleClearFloatingBallDoubleClick"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 6L14 14M14 6L6 14"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- ==================== 网络 ==================== -->
    <div class="setting-group">
      <h3 class="setting-group-title">网络</h3>

      <div class="setting-item">
        <div class="setting-label">
          <span>网络代理</span>
          <span class="setting-desc">配置 HTTP/HTTPS 代理服务器</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input v-model="proxyEnabled" type="checkbox" @change="handleProxyEnabledChange" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div v-if="proxyEnabled" class="setting-item">
        <div class="setting-label">
          <span>代理地址</span>
          <span class="setting-desc">格式: http://host:port 或 socks5://host:port</span>
        </div>
        <div class="setting-control">
          <input
            v-model="proxyUrl"
            type="text"
            class="input"
            placeholder="例如: http://127.0.0.1:7890"
            @blur="handleProxyUrlChange"
            @keyup.enter="handleProxyUrlChange"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>自定义插件市场</span>
          <span class="setting-desc">配置自定义插件市场地址</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              v-model="pluginMarketCustom"
              type="checkbox"
              @change="handlePluginMarketCustomChange"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div v-if="pluginMarketCustom" class="setting-item">
        <div class="setting-label">
          <span>市场地址</span>
          <span class="setting-desc">自定义插件市场的基础 URL</span>
        </div>
        <div class="setting-control">
          <input
            v-model="pluginMarketUrl"
            type="text"
            class="input"
            placeholder="例如: https://market.example.com"
            @blur="handlePluginMarketUrlChange"
            @keyup.enter="handlePluginMarketUrlChange"
          />
        </div>
      </div>
    </div>

    <!-- ==================== 开发者 ==================== -->
    <div class="setting-group">
      <h3 class="setting-group-title">开发者</h3>

      <div class="setting-item">
        <div class="setting-label">
          <span>开发者工具位置</span>
          <span class="setting-desc">设置插件开发者工具的默认打开位置</span>
        </div>
        <div class="setting-control">
          <Dropdown
            v-model="devToolsMode"
            :options="devToolsModeOptions"
            style="min-width: 200px"
            @change="handleDevToolsModeChange"
          />
        </div>
      </div>

      <div class="setting-item internal-api-setting">
        <div class="internal-api-content">
          <div class="internal-api-header">
            <div class="setting-label">
              <span>内部 API 授权插件</span>
              <span class="setting-desc">允许指定插件名称调用高权限内部 API</span>
            </div>
            <div class="setting-control internal-api-control">
              <input
                v-model="customInternalApiPluginNameInput"
                type="text"
                class="input internal-api-input"
                placeholder="输入插件 name"
                @keyup.enter="handleAddCustomInternalApiPluginName"
              />
              <button
                class="btn btn-sm internal-api-add-btn"
                @click="handleAddCustomInternalApiPluginName"
              >
                添加
              </button>
            </div>
          </div>
          <div v-if="customInternalApiPluginNames.length > 0" class="blocked-apps-tags">
            <span
              v-for="(pluginName, index) in customInternalApiPluginNames"
              :key="pluginName"
              class="blocked-app-tag"
            >
              {{ pluginName }}
              <button
                class="blocked-app-remove"
                title="删除授权"
                @click="handleRemoveCustomInternalApiPluginName(index)"
              >
                &times;
              </button>
            </span>
          </div>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>关闭 GPU 加速</span>
          <span class="setting-desc"
            >禁用硬件加速渲染，可解决白屏、渲染异常等 GPU 兼容性问题，修改后需重启应用生效</span
          >
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              v-model="disableGpuAcceleration"
              type="checkbox"
              @change="handleDisableGpuAccelerationChange"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-panel {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

/* 设置分组 */
.setting-group {
  margin-bottom: 28px;
}

.setting-group:last-child {
  margin-bottom: 0;
}

.setting-group-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary-color);
  margin: 0 0 4px 0;
  line-height: 1.4;
}

/* 设置项 */
.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--divider-color);
}

.setting-group .setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.setting-label > span:first-child {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
}

.setting-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.quick-actions-wrapper {
  position: relative;
}

.quick-actions-trigger {
  color: var(--text-secondary);
}

.quick-actions-trigger:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.quick-actions-trigger.active {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.quick-actions-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 240px;
  background: var(--dialog-bg, var(--bg-color));
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  box-shadow: 0 8px 24px var(--shadow-color);
  z-index: 100;
  overflow: hidden;
}

.quick-actions-item {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  gap: 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.quick-actions-item + .quick-actions-item {
  border-top: 1px solid var(--divider-color);
}

.quick-actions-item:hover {
  background: var(--hover-bg);
}

.quick-actions-item.active {
  background: var(--primary-light-bg);
}

.quick-actions-item-reset:hover .quick-actions-item-label {
  color: var(--primary-color);
}

.quick-actions-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.quick-actions-item-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
}

.quick-actions-item-desc {
  font-size: 11px;
  line-height: 1.3;
  color: var(--text-secondary);
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

/* 不透明度控制 */
.opacity-control {
  min-width: 250px;
  gap: 12px;
}

/* 文本输入框 - 只设置布局，颜色由 global.css 控制 */
:deep(.input) {
  min-width: 250px;
}

/* 头像控制 */
.avatar-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar-preview {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--control-border);
}

/* 颜色选择器 */
/* 组合控件（如：开关+按钮） */
.combined-control {
  gap: 16px;
}

.color-control {
  display: flex;
  gap: 12px;
}

.color-option {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  border: 2px solid transparent;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.1),
    0 1px 3px rgba(0, 0, 0, 0.15);
}

.color-option:hover {
  transform: scale(1.1);
}

.color-option.active {
  border-color: var(--text-color);
  transform: scale(1.1);
}

.color-option.active::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  background: white;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* 自定义颜色选择器 */
.custom-color-option {
  position: relative;
  overflow: hidden;
}

/* 隐藏的颜色选择器 */
.color-picker-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

/* 自定义按钮 */

/* Tab 目标设置项 */
.tab-target-setting-item {
  align-items: flex-start;
}

.setting-control-column {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.hotkey-presets {
  display: flex;
  gap: 6px;
}

.hotkey-preset-btn {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.hotkey-preset-btn:hover {
  color: var(--primary-color);
  background: var(--primary-light-bg);
  border-color: var(--primary-color);
}

.hotkey-preset-btn.active {
  color: var(--primary-color);
  background: var(--primary-light-bg);
  border-color: var(--primary-color);
  font-weight: 500;
}

.blocked-apps-content {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.internal-api-content {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.blocked-apps-header {
  display: flex;
  justify-content: space-between;
}

.internal-api-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.internal-api-input {
  min-width: 180px;
  width: 220px;
}

.internal-api-add-btn {
  min-width: 56px;
  white-space: nowrap;
  flex-shrink: 0;
}

.blocked-apps-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  background-color: var(--control-bg);
  border-radius: 4px;
  border: 2px solid var(--control-border);
}

.blocked-app-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 12px;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 6px;
  color: var(--text-color);
  transition: border-color 0.2s;
}

.blocked-app-tag:hover {
  border-color: var(--danger-color);
}

.blocked-app-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  border-radius: 50%;
  transition:
    color 0.2s,
    background 0.2s;
}

.blocked-app-remove:hover {
  color: var(--danger-color);
  background: var(--danger-light-bg);
}
</style>
