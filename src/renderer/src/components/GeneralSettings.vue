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
        <button v-if="hotkey !== defaultHotkey" class="reset-btn" @click="resetHotkey">重置</button>
      </div>
    </div>

    <!-- 窗口不透明度设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>窗口不透明度</span>
        <span class="setting-desc">调整窗口的透明度（{{ Math.round(opacity * 100) }}%）</span>
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
      </div>
    </div>

    <!-- 主题设置 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>主题设置</span>
        <span class="setting-desc">选择应用的主题外观</span>
      </div>
      <div class="setting-control">
        <select v-model="windowStore.theme" class="select-input" @change="handleThemeChange">
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
          class="text-input"
          placeholder="输入提示文字"
          @blur="handlePlaceholderChange"
          @keyup.enter="handlePlaceholderChange"
        />
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
          class="avatar-preview"
          alt="头像预览"
        />
        <button class="select-btn" @click="handleSelectAvatar">选择图片</button>
        <button
          v-if="windowStore.avatar !== defaultAvatar"
          class="reset-btn"
          @click="handleResetAvatar"
        >
          重置
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
        <select
          v-model="windowStore.autoPaste"
          class="select-input"
          @change="handleAutoPasteChange"
        >
          <option value="off">关闭</option>
          <option value="1s">1秒内</option>
          <option value="3s">3秒内</option>
          <option value="5s">5秒内</option>
          <option value="10s">10秒内</option>
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
        <label class="switch">
          <input
            v-model="windowStore.hideOnBlur"
            type="checkbox"
            @change="handleHideOnBlurChange"
          />
          <span class="slider"></span>
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
        <label class="switch">
          <input v-model="showTrayIcon" type="checkbox" @change="handleTrayIconChange" />
          <span class="slider"></span>
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
        <label class="switch">
          <input v-model="launchAtLogin" type="checkbox" @change="handleLaunchAtLoginChange" />
          <span class="slider"></span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useWindowStore } from '../stores/windowStore'

const windowStore = useWindowStore()

const defaultHotkey = 'Option+Z'
const hotkey = ref(defaultHotkey)
const isRecording = ref(false)
const recordedKeys = ref<string[]>([])

// 不透明度设置
const opacity = ref(1)

// 托盘图标显示设置
const showTrayIcon = ref(true)

// 开机启动设置
const launchAtLogin = ref(false)

// 主题色选项
const themeColors = [
  { label: '天空蓝', value: 'blue', hex: '#0284c7' },
  { label: '罗兰紫', value: 'purple', hex: '#7c3aed' },
  { label: '翡翠绿', value: 'green', hex: '#059669' },
  { label: '活力橙', value: 'orange', hex: '#ea580c' },
  { label: '宝石红', value: 'red', hex: '#dc2626' },
  { label: '少女粉', value: 'pink', hex: '#db2777' }
]

// 头像默认值（用于重置）
const defaultAvatar = new URL('../asserts/image/default.png', import.meta.url).href

// 显示的快捷键文本
const displayHotkey = computed(() => {
  if (isRecording.value) {
    return recordedKeys.value.length > 0 ? recordedKeys.value.join('+') : '请按下快捷键...'
  }
  return hotkey.value
})

// 开始录制快捷键
function startRecording(): void {
  isRecording.value = true
  recordedKeys.value = []
  document.addEventListener('keydown', handleKeyDown)
  document.addEventListener('keyup', handleKeyUp)
}

// 停止录制
function stopRecording(): void {
  isRecording.value = false
  document.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('keyup', handleKeyUp)
}

// 处理按键
function handleKeyDown(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()

  const keys: string[] = []

  // 修饰键
  if (e.metaKey) keys.push('Command')
  if (e.ctrlKey) keys.push('Ctrl')
  if (e.altKey) keys.push('Option')
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
    const result = await window.ztools.updateShortcut(defaultHotkey)
    if (result.success) {
      hotkey.value = defaultHotkey
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
      windowStore.updatePlaceholder('')
    }
    // 保存到数据库
    await saveSettings()
    console.log('搜索框提示文字已更新:', windowStore.placeholder)
  } catch (error) {
    console.error('保存搜索框提示文字失败:', error)
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

// 加载设置
async function loadSettings(): Promise<void> {
  try {
    // 加载数据库中的设置
    const data = await window.ztools.dbGet('settings-general')
    console.log('加载到的设置:', data)
    if (data) {
      opacity.value = data.opacity ?? 1
      hotkey.value = data.hotkey ?? defaultHotkey
      showTrayIcon.value = data.showTrayIcon ?? true

      // 通过 store 加载 placeholder 和 avatar
      if (data.placeholder) {
        windowStore.updatePlaceholder(data.placeholder)
      }
      if (data.avatar) {
        windowStore.updateAvatar(data.avatar)
      }
    }

    // 获取当前实际注册的快捷键
    const currentShortcut = await window.ztools.getCurrentShortcut()
    hotkey.value = currentShortcut

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
    await window.ztools.dbPut('settings-general', {
      opacity: opacity.value,
      hotkey: hotkey.value,
      placeholder: windowStore.placeholder,
      avatar: windowStore.avatar,
      autoPaste: windowStore.autoPaste,
      hideOnBlur: windowStore.hideOnBlur,
      theme: windowStore.theme,
      primaryColor: windowStore.primaryColor,
      showTrayIcon: showTrayIcon.value
    })
  } catch (error) {
    console.error('保存设置失败:', error)
  }
}

// 初始化时加载设置
onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
.content-panel {
  max-width: 600px;
}

/* 设置项 */
.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--border-color);
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

.setting-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 快捷键输入框 */
.hotkey-input {
  min-width: 150px;
  padding: 8px 16px;
  border: 2px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--input-bg);
  color: var(--text-color);
}

.hotkey-input:hover {
  border-color: var(--primary-color);
}

.hotkey-input.recording {
  border-color: var(--primary-color);
  background: var(--active-bg);
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

/* 重置按钮 */
.reset-btn {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-btn:hover {
  background: var(--hover-bg);
  border-color: var(--border-color);
  color: var(--text-color);
}

/* 不透明度控制 */
.opacity-control {
  min-width: 250px;
}

.opacity-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--border-color) 0%, var(--primary-color) 100%);
  outline: none;
  cursor: pointer;
}

.opacity-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 4px var(--shadow-color);
}

.opacity-slider::-webkit-slider-thumb:hover {
  background: var(--primary-hover);
  transform: scale(1.1);
}

.opacity-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  border: none;
  transition: all 0.2s;
  box-shadow: 0 2px 4px var(--shadow-color);
}

.opacity-slider::-moz-range-thumb:hover {
  background: var(--primary-hover);
  transform: scale(1.1);
}

/* 文本输入框 */
.text-input {
  min-width: 250px;
  padding: 8px 12px;
  border: 2px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.2s;
  outline: none;
  background: var(--input-bg);
  color: var(--text-color);
}

.text-input:focus {
  border-color: var(--primary-color);
  background: var(--input-focus-bg);
}

.text-input::placeholder {
  color: var(--placeholder-color);
}

/* 下拉选择框 */
.select-input {
  min-width: 150px;
  padding: 8px 12px;
  border: 2px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  background: var(--input-bg);
  color: var(--text-color);
  cursor: pointer;
  transition: all 0.2s;
  outline: none;
}

.select-input:hover {
  border-color: var(--primary-color);
}

.select-input:focus {
  border-color: var(--primary-color);
  background: var(--input-focus-bg);
}

/* 头像控制 */
.avatar-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar-preview {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--border-color);
}

.select-btn {
  padding: 8px 16px;
  border: 2px solid var(--primary-color);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--primary-color);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.select-btn:hover {
  background: var(--primary-color);
  color: #ffffff;
}

/* 开关按钮 */
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--border-color);
  transition: 0.3s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: '';
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--primary-color);
}

input:checked + .slider:before {
  transform: translateX(20px);
}

input:focus + .slider {
  box-shadow: 0 0 1px var(--primary-color);
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
</style>
