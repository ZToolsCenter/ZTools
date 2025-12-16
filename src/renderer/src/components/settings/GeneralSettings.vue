<template>
  <div class="content-panel">
    <!-- 快捷键设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>呼出快捷键</span>
        <span class="setting-desc">设置全局快捷键来呼出应用</span>
      </div>
      <div class="setting-control">
        <div class="hotkey-input" :class="{ recording: isRecording }" @click="startRecording">
          {{ displayHotkey }}
        </div>
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
        <input
          v-model.number="opacity"
          type="range"
          min="0.3"
          max="1"
          step="0.01"
          class="opacity-slider"
          @input="handleOpacityChange"
        />
        <span class="opacity-value">{{ Math.round(opacity * 100) }}%</span>
      </div>
    </div>

    <!-- 主题设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>主题设置</span>
        <span class="setting-desc">选择应用的主题外观</span>
      </div>
      <div class="setting-control">
        <select v-model="windowStore.theme" class="select" @change="handleThemeChange">
          <option value="system">跟随系统</option>
          <option value="light">明亮</option>
          <option value="dark">暗黑</option>
        </select>
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
          :class="{ active: windowStore.primaryColor === color.value }"
          :style="{ backgroundColor: color.hex }"
          :title="color.label"
          @click="handlePrimaryColorChange(color.value)"
        ></div>
        <div
          class="color-option custom-color-option"
          :class="{ active: windowStore.primaryColor === 'custom' }"
          :style="{ backgroundColor: customColor }"
          title="自定义"
          @click="handleSelectCustomColor"
        ></div>
        <button
          v-if="windowStore.primaryColor === 'custom'"
          class="btn btn-sm"
          @click="openColorPicker"
        >
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

    <!-- 搜索框提示文字设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>搜索框提示文字</span>
        <span class="setting-desc">自定义搜索框的占位提示文字</span>
      </div>
      <div class="setting-control">
        <input
          v-model="windowStore.placeholder"
          type="text"
          class="input"
          placeholder="输入提示文字"
          @blur="handlePlaceholderChange"
          @keyup.enter="handlePlaceholderChange"
        />
        <button
          v-if="windowStore.placeholder !== defaultPlaceholder"
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
          v-if="windowStore.avatar"
          :src="windowStore.avatar"
          :class="['avatar-preview', { 'default-avatar': windowStore.avatar === defaultAvatar }]"
          alt="头像预览"
          draggable="false"
        />
        <button class="btn" @click="handleSelectAvatar">选择图片</button>
        <button
          v-if="windowStore.avatar !== defaultAvatar"
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
        <select v-model="windowStore.autoPaste" class="select" @change="handleAutoPasteChange">
          <option value="off">关闭</option>
          <option value="1s">1秒内</option>
          <option value="3s">3秒内</option>
          <option value="5s">5秒内</option>
          <option value="10s">10秒内</option>
        </select>
      </div>
    </div>

    <!-- 自动清空搜索框设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>自动清空搜索框</span>
        <span class="setting-desc">窗口显示状态切换后自动清空搜索框内容的时间</span>
      </div>
      <div class="setting-control">
        <select v-model="windowStore.autoClear" class="select" @change="handleAutoClearChange">
          <option value="immediately">立即</option>
          <option value="1m">1分钟</option>
          <option value="2m">2分钟</option>
          <option value="3m">3分钟</option>
          <option value="5m">5分钟</option>
          <option value="10m">10分钟</option>
          <option value="never">从不</option>
        </select>
      </div>
    </div>

    <!-- 失去焦点隐藏设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>失去焦点隐藏窗口</span>
        <span class="setting-desc">当窗口失去焦点时自动隐藏</span>
      </div>
      <div class="setting-control">
        <label class="toggle">
          <input
            v-model="windowStore.hideOnBlur"
            type="checkbox"
            @change="handleHideOnBlurChange"
          />
          <span class="toggle-slider"></span>
        </label>
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
        <button class="btn" :disabled="isCheckingUpdate" @click="handleCheckUpdate">
          {{ isCheckingUpdate ? '检查中...' : '检查更新' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DEFAULT_PLACEHOLDER, useWindowStore } from '../../stores/windowStore'

const windowStore = useWindowStore()

// 当前平台（与 window.ztools.getPlatform 返回类型保持一致）
const platform = ref<'darwin' | 'win32' | 'linux'>('darwin')

// 默认快捷键（根据平台区分文案）
const defaultHotkey = computed(() => {
  return platform.value === 'win32' ? 'Alt+Z' : 'Option+Z'
})

// 实际快捷键字符串
const hotkey = ref('')
const isRecording = ref(false)
const recordedKeys = ref<string[]>([])

// 不透明度设置
const opacity = ref(1)

// 托盘图标显示设置
const showTrayIcon = ref(true)

// 开机启动设置
const launchAtLogin = ref(false)

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

// 头像默认值（用于重置）
const defaultAvatar = new URL('../../assets/image/default.png', import.meta.url).href

// 搜索框提示文字默认值（从 windowStore 导入）
const defaultPlaceholder = DEFAULT_PLACEHOLDER

// 显示的快捷键文本
const displayHotkey = computed(() => {
  if (isRecording.value) {
    return recordedKeys.value.length > 0 ? recordedKeys.value.join('+') : '请按下快捷键...'
  }
  return hotkey.value
})

// 开始录制快捷键
async function startRecording(): Promise<void> {
  isRecording.value = true
  recordedKeys.value = []

  // 请求后端注册临时快捷键监听
  try {
    const result = await window.ztools.startHotkeyRecording()
    if (result.success) {
      console.log('已启动后端快捷键监听')
    } else {
      console.warn('启动后端快捷键监听失败，使用前端监听:', result.error)
    }
  } catch (error) {
    console.error('启动后端快捷键监听异常，使用前端监听:', error)
  }

  // 同时监听前端键盘事件作为备用
  document.addEventListener('keydown', handleKeyDown)
  document.addEventListener('keyup', handleKeyUp)
}

// 停止录制
function stopRecording(): void {
  isRecording.value = false
  document.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('keyup', handleKeyUp)
  // 后端会在快捷键触发时自动注销，无需手动调用
}

// 处理按键
function handleKeyDown(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()

  const keys: string[] = []

  // 修饰键（根据平台区分 Alt 文案）
  if (e.metaKey) keys.push('Command')
  if (e.ctrlKey) keys.push('Ctrl')
  if (e.altKey) keys.push(platform.value === 'win32' ? 'Alt' : 'Option')
  if (e.shiftKey) keys.push('Shift')

  // 主键 - 使用 e.code 避免 Option 键产生特殊字符
  if (
    e.code &&
    ![
      'MetaLeft',
      'MetaRight',
      'ControlLeft',
      'ControlRight',
      'AltLeft',
      'AltRight',
      'ShiftLeft',
      'ShiftRight'
    ].includes(e.code)
  ) {
    // 处理 e.code 转换为友好格式
    let mainKey = ''

    if (e.code.startsWith('Key')) {
      // KeyA -> A, KeyB -> B
      mainKey = e.code.replace('Key', '')
    } else if (e.code.startsWith('Digit')) {
      // Digit1 -> 1, Digit2 -> 2
      mainKey = e.code.replace('Digit', '')
    } else if (e.code.startsWith('Numpad')) {
      // Numpad1 -> Numpad1
      mainKey = e.code
    } else {
      // Space, Enter, Tab 等
      mainKey = e.code
    }

    if (mainKey) {
      keys.push(mainKey)
    }
  }

  recordedKeys.value = keys
}

// 按键抬起时确认快捷键
async function handleKeyUp(e: KeyboardEvent): Promise<void> {
  e.preventDefault()
  e.stopPropagation()

  if (recordedKeys.value.length > 1) {
    // 至少需要一个修饰键 + 一个主键
    const newHotkey = recordedKeys.value.join('+')

    try {
      // 调用 IPC 更新全局快捷键
      const result = await window.ztools.updateShortcut(newHotkey)
      if (result.success) {
        hotkey.value = newHotkey
        // 保存到数据库
        await saveSettings()
        console.log('新快捷键设置成功:', hotkey.value)
      } else {
        alert(`快捷键设置失败: ${result.error || '未知错误'}`)
      }
    } catch (error: any) {
      console.error('设置快捷键失败:', error)
      alert(`设置快捷键失败: ${error.message || '未知错误'}`)
    }
  }

  stopRecording()
}

// 重置快捷键
async function resetHotkey(): Promise<void> {
  try {
    const result = await window.ztools.updateShortcut(defaultHotkey.value)
    if (result.success) {
      hotkey.value = defaultHotkey.value
      await saveSettings()
      console.log('重置快捷键成功:', hotkey.value)
    } else {
      alert(`重置快捷键失败: ${result.error || '未知错误'}`)
    }
  } catch (error: any) {
    console.error('重置快捷键失败:', error)
    alert(`重置快捷键失败: ${error.message || '未知错误'}`)
  }
}

// 处理不透明度变化
async function handleOpacityChange(): Promise<void> {
  try {
    await window.ztools.setWindowOpacity(opacity.value)
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
    if (!windowStore.placeholder.trim()) {
      windowStore.updatePlaceholder(defaultPlaceholder)
    }
    // 保存到数据库
    await saveSettings()
    console.log('搜索框提示文字已更新:', windowStore.placeholder)
  } catch (error) {
    console.error('保存搜索框提示文字失败:', error)
  }
}

// 重置搜索框提示文字
async function handleResetPlaceholder(): Promise<void> {
  try {
    windowStore.updatePlaceholder(defaultPlaceholder)
    await saveSettings()
    console.log('搜索框提示文字已重置')
  } catch (error) {
    console.error('重置搜索框提示文字失败:', error)
  }
}

// 选择头像
async function handleSelectAvatar(): Promise<void> {
  try {
    const result = await window.ztools.selectAvatar()
    if (result.success && result.path) {
      windowStore.updateAvatar(result.path)
      await saveSettings()
      console.log('头像已更新:', windowStore.avatar)
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
    windowStore.updateAvatar(defaultAvatar)
    await saveSettings()
    console.log('头像已重置')
  } catch (error) {
    console.error('重置头像失败:', error)
  }
}

// 处理自动粘贴配置变化
async function handleAutoPasteChange(): Promise<void> {
  try {
    await saveSettings()
    console.log('自动粘贴配置已更新:', windowStore.autoPaste)
  } catch (error) {
    console.error('保存自动粘贴配置失败:', error)
  }
}

// 处理自动清空配置变化
async function handleAutoClearChange(): Promise<void> {
  try {
    await saveSettings()
    console.log('自动清空配置已更新:', windowStore.autoClear)
  } catch (error) {
    console.error('保存自动清空配置失败:', error)
  }
}

// 处理主题变化
async function handleThemeChange(): Promise<void> {
  try {
    await saveSettings()
    await window.ztools.setTheme(windowStore.theme)
    console.log('主题配置已更新:', windowStore.theme)
  } catch (error) {
    console.error('更新主题配置失败:', error)
  }
}

// 处理失去焦点隐藏配置变化
async function handleHideOnBlurChange(): Promise<void> {
  try {
    await saveSettings()
    // 通知主进程更新配置
    await window.ztools.setHideOnBlur(windowStore.hideOnBlur)
    console.log('失去焦点隐藏配置已更新:', windowStore.hideOnBlur)
  } catch (error) {
    console.error('更新失去焦点隐藏配置失败:', error)
  }
}

// 处理主题色变化
async function handlePrimaryColorChange(color: string): Promise<void> {
  try {
    windowStore.updatePrimaryColor(color)
    await saveSettings()
    console.log('主题色已更新:', color)
  } catch (error) {
    console.error('更新主题色失败:', error)
  }
}

// 选择自定义颜色（不打开色盘）
async function handleSelectCustomColor(): Promise<void> {
  try {
    windowStore.updatePrimaryColor('custom')
    // 重新应用自定义颜色，触发智能调整
    windowStore.updateCustomColor(customColor.value)
    await saveSettings()
    console.log('已选择自定义主题色，颜色已智能调整')
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

  try {
    windowStore.updateCustomColor(color)
    await saveSettings()
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
    await window.ztools.setTrayIconVisible(showTrayIcon.value)
    console.log('托盘图标显示状态已更新:', showTrayIcon.value)
  } catch (error) {
    console.error('更新托盘图标显示状态失败:', error)
  }
}

// 处理开机启动变化
async function handleLaunchAtLoginChange(): Promise<void> {
  try {
    await window.ztools.setLaunchAtLogin(launchAtLogin.value)
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
    appVersion.value = await window.ztools.getAppVersion()
    const vs = await window.ztools.getSystemVersions()
    versions.value = {
      electron: vs.electron || '未知',
      node: vs.node || '未知',
      chrome: vs.chrome || '未知'
    }
    // 获取平台信息，用于快捷键文案（mac 显示 Option，Windows 显示 Alt）
    const pf = window.ztools.getPlatform()
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
    const result = await window.ztools.updater.checkUpdate()
    if (result.hasUpdate) {
      if (
        confirm(
          `发现新版本 ${result.latestVersion}，是否立即更新？\n\n` +
            `更新内容：\n${result.updateInfo.releaseNotes || '无'}`
        )
      ) {
        await window.ztools.updater.startUpdate(result.updateInfo)
      }
    } else {
      if (result.error) {
        alert('检查更新出错: ' + result.error)
      } else {
        alert('当前已是最新版本')
      }
    }
  } catch (error: any) {
    console.error('检查更新失败:', error)
    alert('检查更新失败: ' + (error.message || '未知错误'))
  } finally {
    isCheckingUpdate.value = false
  }
}

// 加载设置
async function loadSettings(): Promise<void> {
  try {
    // 加载数据库中的设置
    const data = await window.ztools.dbGet('settings-general')
    console.log('加载到的设置:', data)
    if (data) {
      opacity.value = data.opacity ?? 1
      hotkey.value = data.hotkey ?? defaultHotkey.value
      showTrayIcon.value = data.showTrayIcon ?? true

      // 通过 store 加载 placeholder 和 avatar
      if (data.placeholder) {
        windowStore.updatePlaceholder(data.placeholder)
      }
      if (data.avatar) {
        windowStore.updateAvatar(data.avatar)
      }

      // 加载自定义颜色
      if (data.customColor) {
        customColor.value = data.customColor
      }
    }

    // 获取当前实际注册的快捷键
    const currentShortcut = await window.ztools.getCurrentShortcut()
    hotkey.value = currentShortcut || defaultHotkey.value

    // 应用透明度设置
    await window.ztools.setWindowOpacity(opacity.value)

    // 获取开机启动状态
    launchAtLogin.value = await window.ztools.getLaunchAtLogin()
  } catch (error) {
    console.error('加载设置失败:', error)
  }
}

// 保存设置
async function saveSettings(): Promise<void> {
  try {
    // 只有自定义头像才保存到数据库，默认头像不保存
    const avatarToSave = windowStore.avatar === defaultAvatar ? undefined : windowStore.avatar

    await window.ztools.dbPut('settings-general', {
      opacity: opacity.value,
      hotkey: hotkey.value,
      placeholder: windowStore.placeholder,
      avatar: avatarToSave,
      autoPaste: windowStore.autoPaste,
      autoClear: windowStore.autoClear,
      hideOnBlur: windowStore.hideOnBlur,
      theme: windowStore.theme,
      primaryColor: windowStore.primaryColor,
      customColor: customColor.value,
      showTrayIcon: showTrayIcon.value
    })
  } catch (error) {
    console.error('保存设置失败:', error)
  }
}

// 初始化时加载设置
onMounted(() => {
  loadSettings()
  getAppVersion()

  // 监听后端发送的快捷键录制事件
  window.ztools.onHotkeyRecorded((shortcut: string) => {
    if (isRecording.value) {
      console.log('收到后端快捷键录制事件:', shortcut)
      // 直接设置快捷键，不需要等待 keyup
      recordedKeys.value = shortcut.split('+')
      handleHotkeyRecorded(shortcut)
    }
  })
})

// 处理后端传来的快捷键（立即确认）
async function handleHotkeyRecorded(newHotkey: string): Promise<void> {
  // 后端已经自动注销了临时快捷键，直接处理设置
  try {
    // 调用 IPC 更新全局快捷键
    const result = await window.ztools.updateShortcut(newHotkey)
    if (result.success) {
      hotkey.value = newHotkey
      // 保存到数据库
      await saveSettings()
      console.log('新快捷键设置成功:', hotkey.value)
    } else {
      alert(`快捷键设置失败: ${result.error || '未知错误'}`)
    }
  } catch (error: any) {
    console.error('设置快捷键失败:', error)
    alert(`设置快捷键失败: ${error.message || '未知错误'}`)
  }

  // 停止前端录制状态
  stopRecording()
}
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

/* 快捷键输入框 */
.hotkey-input {
  min-width: 150px;
  padding: 8px 16px;
  border: 2px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  color: var(--text-color);
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.hotkey-input:hover {
  background: var(--hover-bg);
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
}

.hotkey-input.recording {
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
  background: var(--primary-light-bg);
  color: var(--primary-color);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

/* 不透明度控制 */
.opacity-control {
  min-width: 250px;
  gap: 12px;
}

.opacity-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  min-width: 45px;
  text-align: right;
}

.opacity-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  outline: none;
  cursor: pointer;
  transition: all 0.2s;
}

.opacity-slider:hover {
  background: var(--hover-bg);
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
}

.opacity-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  border: 2px solid white;
}

.opacity-slider::-webkit-slider-thumb:hover {
  background: var(--primary-hover);
  transform: scale(1.15);
}

.opacity-slider::-webkit-slider-thumb:active {
  transform: scale(1.05);
}

.opacity-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  border: 2px solid white;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.opacity-slider::-moz-range-thumb:hover {
  background: var(--primary-hover);
  transform: scale(1.15);
}

.opacity-slider::-moz-range-thumb:active {
  transform: scale(1.05);
}

/* 文本输入框 */
.input {
  min-width: 250px;
  padding: 8px 12px;
}

.select {
  min-width: 150px;
  padding: 8px 12px;
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
  border: 2px solid var(--border-color);
}

/* 暗色模式下默认头像反色 */
@media (prefers-color-scheme: dark) {
  .avatar-preview.default-avatar {
    filter: invert(1);
  }
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
