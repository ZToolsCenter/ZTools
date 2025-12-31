<template>
  <div class="content-panel">
    <!-- 快捷键设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>呼出快捷键</span>
        <span class="setting-desc">设置全局快捷键来呼出应用</span>
      </div>
      <div class="setting-control">
        <HotkeyInput v-model="hotkey" :platform="platform" @change="handleHotkeyChange" />
        <button
          v-if="hotkey !== defaultHotkey"
          class="btn btn-icon"
          title="重置"
          @click="resetHotkey"
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

    <!-- 窗口不透明度设置 -->
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

    <!-- 主题设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>主题设置</span>
        <span class="setting-desc">选择应用的主题外观</span>
      </div>
      <div class="setting-control">
        <Dropdown v-model="theme" :options="themeOptions" @change="handleThemeChange" />
      </div>
    </div>

    <!-- 主题色设置 -->
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

    <!-- 窗口材质设置（仅 Windows） -->
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

    <!-- 亚克力材质背景色透明度设置（仅在亚克力材质时显示） -->
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

    <!-- 搜索框提示文字设置 -->
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

    <!-- 头像设置 -->
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

    <!-- 自动粘贴设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>自动粘贴搜索框</span>
        <span class="setting-desc">复制文本后在设定时间内打开窗口自动粘贴</span>
      </div>
      <div class="setting-control">
        <Dropdown v-model="autoPaste" :options="autoPasteOptions" @change="handleAutoPasteChange" />
      </div>
    </div>

    <!-- 自动清空搜索框设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>自动清空搜索框</span>
        <span class="setting-desc">窗口显示状态切换后自动清空搜索框内容的时间</span>
      </div>
      <div class="setting-control">
        <Dropdown v-model="autoClear" :options="autoClearOptions" @change="handleAutoClearChange" />
      </div>
    </div>

    <!-- 显示托盘图标设置 -->
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

    <!-- 开机启动设置 -->
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
    <!-- 软件更新 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>软件更新</span>
        <div class="version-info">
          <div>当前版本: {{ appVersion }}</div>
          <div class="versions-detail">
            Electron: {{ versions.electron }} | Node: {{ versions.node }} | Chrome:
            {{ versions.chrome }}
          </div>
        </div>
      </div>
      <div class="setting-control">
        <button class="btn" @click="handleCheckUpdate">检查更新</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from '../../composables/useToast'
import {
  DEFAULT_AVATAR,
  DEFAULT_PLACEHOLDER,
  type AutoClearOption,
  type AutoPasteOption,
  type PrimaryColor,
  type ThemeType
} from '../../constants'
import Dropdown from '../common/Dropdown.vue'
import HotkeyInput from '../common/HotkeyInput.vue'
import Slider from '../common/Slider.vue'

const { error, info, confirm } = useToast()

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

// 当前平台（与 window.ztools.getPlatform 返回类型保持一致）
const platform = ref<'darwin' | 'win32' | 'linux'>('darwin')

// 默认快捷键（根据平台区分文案）
const defaultHotkey = computed(() => {
  return platform.value === 'win32' ? 'Alt+Z' : 'Option+Z'
})

// 本地状态（替代 windowStore）
const theme = ref<ThemeType>('system')
const primaryColor = ref<PrimaryColor>('blue')
const placeholder = ref(DEFAULT_PLACEHOLDER)
const avatar = ref(DEFAULT_AVATAR)
const autoPaste = ref<AutoPasteOption>('off')
const autoClear = ref<AutoClearOption>('immediately')

// 实际快捷键字符串
const hotkey = ref('')

// 不透明度设置
const opacity = ref(1)

// 托盘图标显示设置
const showTrayIcon = ref(true)

// 开机启动设置
const launchAtLogin = ref(false)

// 窗口材质设置
const windowMaterial = ref<'mica' | 'acrylic' | 'none'>('none')

// 亚克力材质背景色透明度
const acrylicLightOpacity = ref(78) // 明亮模式默认 78%
const acrylicDarkOpacity = ref(50) // 暗黑模式默认 50%

// 颜色选择器引用
const colorPickerInput = ref<HTMLInputElement | null>(null)

// 软件版本
const appVersion = ref('')
const versions = ref({ electron: '', node: '', chrome: '' })
const isCheckingUpdate = ref(false)

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
  try {
    // 调用 IPC 更新全局快捷键
    const result = await window.ztools.internal.updateShortcut(newHotkey)
    if (result.success) {
      // 保存到数据库
      await saveSettings()
      console.log('新快捷键设置成功:', hotkey.value)
    } else {
      error(`快捷键设置失败: ${result.error || '未知错误'}`)
    }
  } catch (err: any) {
    console.error('设置快捷键失败:', err)
    error(`设置快捷键失败: ${err.message || '未知错误'}`)
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

// 处理主题色变化
async function handlePrimaryColorChange(color: string): Promise<void> {
  try {
    primaryColor.value = color as PrimaryColor

    // 应用主题色类名到 body
    document.body.className = document.body.className.replace(/theme-\w+/g, '').trim()
    document.body.classList.add(`theme-${color}`)

    // 如果是自定义颜色，应用自定义颜色值
    if (color === 'custom') {
      applyCustomColor(customColor.value)
    }

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

    // 应用主题色类名到 body
    document.body.className = document.body.className.replace(/theme-\w+/g, '').trim()
    document.body.classList.add('theme-custom')

    // 应用自定义颜色值
    applyCustomColor(customColor.value)

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
    await window.ztools.internal.updateAcrylicOpacity(acrylicLightOpacity.value, acrylicDarkOpacity.value)
  } catch (error) {
    console.error('更新亚克力明亮模式透明度失败:', error)
  }
}

// 处理亚克力暗黑模式透明度变化
async function handleAcrylicDarkOpacityChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主渲染进程更新（主渲染进程会应用 CSS 叠加效果）
    await window.ztools.internal.updateAcrylicOpacity(acrylicLightOpacity.value, acrylicDarkOpacity.value)
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

// 获取应用版本
async function getAppVersion(): Promise<void> {
  try {
    appVersion.value = await window.ztools.internal.getAppVersion()
    const vs = await window.ztools.internal.getSystemVersions()
    versions.value = {
      electron: vs.electron || '未知',
      node: vs.node || '未知',
      chrome: vs.chrome || '未知'
    }
    // 获取平台信息，用于快捷键文案（mac 显示 Option，Windows 显示 Alt）
    const pf = await window.ztools.internal.getPlatform()
    if (pf === 'darwin' || pf === 'win32' || pf === 'linux') {
      platform.value = pf
    }
  } catch (error) {
    console.error('获取版本失败:', error)
    appVersion.value = '未知'
  }
}

// 检查更新
async function handleCheckUpdate(): Promise<void> {
  if (isCheckingUpdate.value) return
  isCheckingUpdate.value = true

  try {
    const result = await window.ztools.internal.updaterCheckUpdate()
    if (result.hasUpdate) {
      const shouldUpdate = await confirm({
        title: '发现新版本',
        message: `发现新版本 ${result.latestVersion}，是否立即更新？\n\n更新内容：\n${result.updateInfo?.releaseNotes || '无'}`,
        type: 'info',
        confirmText: '立即更新',
        cancelText: '稍后'
      })
      if (shouldUpdate) {
        await window.ztools.internal.updaterStartUpdate(result.updateInfo)
      }
    } else {
      if (result.error) {
        error('检查更新出错: ' + result.error)
      } else {
        info('当前已是最新版本')
      }
    }
  } catch (err: any) {
    console.error('检查更新失败:', err)
    error('检查更新失败: ' + (err.message || '未知错误'))
  } finally {
    isCheckingUpdate.value = false
  }
}

// ==================== 自定义颜色相关辅助函数 ====================

// 应用自定义颜色
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
    r = g = b = l // achromatic
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

// ==================== 数据持久化 ====================

// 加载设置
async function loadSettings(): Promise<void> {
  try {
    // 加载数据库中的设置
    const data = await window.ztools.internal.dbGet('settings-general')
    console.log('加载到的设置:', data)
    if (data) {
      opacity.value = data.opacity ?? 1
      hotkey.value = data.hotkey ?? defaultHotkey.value
      showTrayIcon.value = data.showTrayIcon ?? true
      placeholder.value = data.placeholder ?? DEFAULT_PLACEHOLDER
      avatar.value = data.avatar ?? DEFAULT_AVATAR
      autoPaste.value = data.autoPaste ?? 'off'
      autoClear.value = data.autoClear ?? 'immediately'
      theme.value = data.theme ?? 'system'
      primaryColor.value = data.primaryColor ?? 'blue'
      windowMaterial.value = data.windowMaterial ?? 'none'
      acrylicLightOpacity.value = data.acrylicLightOpacity ?? 78
      acrylicDarkOpacity.value = data.acrylicDarkOpacity ?? 50

      // 加载自定义颜色
      if (data.customColor) {
        customColor.value = data.customColor
      }

      // 应用主题色类名到 body
      document.body.className = document.body.className.replace(/theme-\w+/g, '').trim()
      document.body.classList.add(`theme-${primaryColor.value}`)

      // 如果是自定义颜色，应用自定义颜色值
      if (primaryColor.value === 'custom') {
        applyCustomColor(customColor.value)
      }
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

    await window.ztools.internal.dbPut('settings-general', {
      opacity: opacity.value,
      hotkey: hotkey.value,
      placeholder: placeholder.value,
      avatar: avatarToSave,
      autoPaste: autoPaste.value,
      autoClear: autoClear.value,
      theme: theme.value,
      primaryColor: primaryColor.value,
      customColor: customColor.value,
      showTrayIcon: showTrayIcon.value,
      windowMaterial: windowMaterial.value,
      acrylicLightOpacity: acrylicLightOpacity.value,
      acrylicDarkOpacity: acrylicDarkOpacity.value
    })
  } catch (error) {
    console.error('保存设置失败:', error)
  }
}

// 初始化时加载设置
onMounted(() => {
  loadSettings()
  getAppVersion()
})
</script>

<style scoped>
.content-panel {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

/* 设置项 */
.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--divider-color);
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.setting-label > span:first-child {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-color);
}

.setting-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

.version-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: var(--text-secondary);
}

.versions-detail {
  font-size: 12px;
  opacity: 0.8;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 10px;
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
</style>
