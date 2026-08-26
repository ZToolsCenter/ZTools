<template>
  <div
    class="app-container"
    :class="{
      'app-container__plugin': currentView === ViewMode.Plugin,
      'has-search-wallpaper': hasSearchWallpaper
    }"
  >
    <div
      v-if="hasSearchWallpaper"
      class="search-wallpaper-layer"
      :style="searchWallpaperStyle"
    ></div>
    <div class="search-window">
      <div :class="['search-box-wrapper', { 'with-divider': currentView === ViewMode.Plugin }]">
        <SearchBox
          ref="searchBoxRef"
          v-model:pasted-image="pastedImageData"
          v-model:pasted-files="pastedFilesData"
          v-model:pasted-text="pastedTextData"
          :model-value="searchQuery"
          :current-view="currentView"
          @update:model-value="handleSearchQueryChange"
          @composing="handleComposing"
          @arrow-keydown="handleArrowKeydown"
          @close-plugin="handleClosePlugin"
        />
      </div>

      <!-- 搜索结果组件 -->
      <SearchResults
        v-if="currentView === ViewMode.Search"
        ref="searchResultsRef"
        :search-query="searchQuery"
        :pasted-image="pastedImageData"
        :pasted-files="pastedFilesData"
        :pasted-text="pastedTextData"
        @height-changed="updateWindowHeight"
        @focus-input="handleFocusInput"
        @restore-match="handleRestoreMatch"
      />

      <!-- 插件占位区域 -->
      <div v-if="currentView === ViewMode.Plugin" class="plugin-placeholder">
        <!-- 插件内容由 BrowserView 渲染，这里只是占位 -->
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import SearchBox from './components/search/SearchBox.vue'
import SearchResults from './components/search/SearchResults.vue'
import { useCommandDataStore } from './stores/commandDataStore'
import { useWindowStore } from './stores/windowStore'
import { CommonKeyboardModifier, readModifiers } from '@renderer/utils/convertKeyboardEvent'

// FileItem 接口（从剪贴板管理器返回的格式）
interface FileItem {
  path: string
  name: string
  isDirectory: boolean
}

enum ViewMode {
  Search = 'search',
  Plugin = 'plugin'
}

const windowStore = useWindowStore()
const commandDataStore = useCommandDataStore()

const searchQuery = ref('')
const isComposing = ref(false)
const currentView = ref<ViewMode>(ViewMode.Search)
const searchBoxRef = ref<{ focus: () => void; selectAll: () => void } | null>(null)
const searchResultsRef = ref<{
  handleKeydown: (e: KeyboardEvent) => void
  resetSelection: () => void
  resetCollapseState: () => void
} | null>(null)
let removeAutoCheckUpdateChangedListener: (() => void) | null = null
let removeSearchWallpaperListener: (() => void) | null = null
let removeCompactMainWindowHeaderListener: (() => void) | null = null
let removeHideMainWindowOnPluginEscListener: (() => void) | null = null
// 粘贴的图片数据
const pastedImageData = ref<string | null>(null)
// 粘贴的文件数据
const pastedFilesData = ref<FileItem[] | null>(null)
// 粘贴的文本数据
const pastedTextData = ref<string | null>(null)

const hasSearchWallpaper = computed(
  () => currentView.value === ViewMode.Search && windowStore.searchWallpaper !== null
)
const searchWallpaperStyle = computed(() => {
  const wallpaper = windowStore.searchWallpaper
  if (!wallpaper) return {}

  // 扩大图片层覆盖范围，避免 filter blur 在窗口边缘产生透明缝隙。
  const blurOverflow = Math.ceil(wallpaper.blur * 2)
  return {
    backgroundImage: `url("${wallpaper.url}")`,
    opacity: wallpaper.opacity,
    filter: `blur(${wallpaper.blur}px)`,
    inset: `-${blurOverflow}px`
  }
})

// 将当前搜索输入和粘贴态同步到主进程，供应用快捷键启动时复用
function syncLaunchContext(): void {
  window.ztools.updateLaunchContext({
    searchQuery: searchQuery.value,
    pastedImage: pastedImageData.value,
    pastedFiles: pastedFilesData.value
      ? pastedFilesData.value.map((file) => ({
          path: file.path,
          name: file.name,
          isDirectory: file.isDirectory
        }))
      : null,
    pastedText: pastedTextData.value
  })
}

// 处理搜索框输入变化（由 SearchBox @update:model-value 触发，仅用户输入会触发）
function handleSearchQueryChange(value: string): void {
  searchQuery.value = value
  // 如果在插件模式下，通知主进程，由主进程转发给插件（同时更新缓存）
  if (currentView.value === ViewMode.Plugin && windowStore.currentPlugin) {
    window.ztools.notifySubInputChange(value)
  }
}

// 监听粘贴图片数据变化
watch(pastedImageData, (newValue) => {
  // 粘贴图片时清空其他粘贴内容（但保留搜索框文本，用于搜索指令）
  if (newValue) {
    pastedFilesData.value = null
    pastedTextData.value = null
  }
})

// 监听粘贴文件数据变化
watch(pastedFilesData, (newValue) => {
  // 粘贴文件时清空其他粘贴内容（但保留搜索框文本，用于搜索指令）
  if (newValue) {
    pastedImageData.value = null
    pastedTextData.value = null
  }
})

// 监听粘贴文本数据变化
watch(pastedTextData, (newValue) => {
  // 粘贴文本时清空其他粘贴内容（但保留搜索框文本，用于搜索指令）
  if (newValue) {
    pastedImageData.value = null
    pastedFilesData.value = null
  }
})

// 监听搜索输入和粘贴态变化，同步到主进程
watch([searchQuery, pastedImageData, pastedFilesData, pastedTextData], () => {
  syncLaunchContext()
})

// 动态调整窗口高度
function updateWindowHeight(): Promise<void> {
  return nextTick(() => {
    const container = document.querySelector('.app-container')
    if (container) {
      const height = container.scrollHeight
      window.ztools.resizeWindow(height + 1)
    }
  })
}

// 聚焦输入框（由 SearchResults 组件 emit）
function handleFocusInput(): void {
  searchBoxRef.value?.focus()
}

// 恢复上次匹配状态
function handleRestoreMatch(state: any): void {
  console.log('恢复上次匹配状态:', state)
  // 恢复输入框状态
  searchQuery.value = state.searchQuery || ''
  pastedImageData.value = state.pastedImage || null
  pastedFilesData.value = state.pastedFiles || null
  pastedTextData.value = state.pastedText || null
  // 聚焦输入框
  nextTick(() => {
    searchBoxRef.value?.focus()
  })
}

// 处理输入法组合状态
function handleComposing(composing: boolean): void {
  isComposing.value = composing
}

// 关闭插件，返回搜索页（胶囊标签关闭按钮）
function handleClosePlugin(): void {
  exitPluginToSearch()
}

/**
 * 退出当前插件并返回搜索视图（主窗口）
 */
function exitPluginToSearch(): void {
  currentView.value = ViewMode.Search
  searchQuery.value = ''
  window.ztools.hidePlugin()
  focusSearchAfterPluginExit()
  console.log('[PluginExit] 已退出插件并返回搜索视图')
}

function focusSearchAfterPluginExit(): void {
  nextTick(() => {
    updateWindowHeight()
    searchBoxRef.value?.focus()
  })
}

/**
 * 处理插件模式下的分步退出逻辑：清空输入 -> 清理粘贴态 -> 退出插件或隐藏窗口。
 * @returns 无返回值。
 */
function handlePluginStepExit(): void {
  if (searchQuery.value.trim()) {
    // 主窗口插件模式：优先清空子输入框并通知插件
    searchQuery.value = ''
    window.ztools.notifySubInputChange('')
    return
  }

  if (pastedImageData.value || pastedFilesData.value || pastedTextData.value) {
    // 与现有 ESC 逻辑一致：第二步清理粘贴态
    pastedImageData.value = null
    pastedFilesData.value = null
    pastedTextData.value = null
    return
  }

  if (windowStore.hideMainWindowOnPluginEsc) {
    // 仅替换原流程的最终退出动作，确保顶部输入和粘贴态仍按顺序清理。
    console.log('[PluginExit] 分步退出完成，直接隐藏主窗口')
    window.ztools.hideWindow()
    return
  }

  // 第三步：按原有行为退出插件返回搜索。
  exitPluginToSearch()
}

// 将浏览器 KeyboardEvent 转换为 Electron KeyboardInputEvent 格式
function convertToElectronKeyboardEvent(
  direction: 'left' | 'right' | 'up' | 'down' | 'enter',
  type: 'keyDown' | 'keyUp' = 'keyDown',
  modifiers: CommonKeyboardModifier[] = []
): {
  type: 'keyDown' | 'keyUp'
  keyCode: string
  modifiers: CommonKeyboardModifier[]
} {
  // 映射方向键和回车键的 keyCode
  const keyCodeMap: Record<string, string> = {
    left: 'Left',
    right: 'Right',
    up: 'Up',
    down: 'Down',
    enter: 'Return'
  }

  return {
    type,
    keyCode: keyCodeMap[direction],
    modifiers
  }
}

// 处理方向键事件
async function handleArrowKeydown(
  event: KeyboardEvent,
  direction: 'left' | 'right' | 'up' | 'down' | 'enter'
): Promise<void> {
  // 只在插件模式下转发方向键事件
  if (currentView.value !== ViewMode.Plugin || !windowStore.currentPlugin) {
    return
  }

  // 只有上下方向键阻止默认行为，左右方向键允许在搜索框中移动光标
  if (direction === 'up' || direction === 'down') {
    event.preventDefault()
    event.stopPropagation()
  }

  const modifiers = readModifiers(event)

  // 转换为 Electron 格式
  const keyDownEvent = convertToElectronKeyboardEvent(direction, 'keyDown', modifiers)
  const keyUpEvent = convertToElectronKeyboardEvent(direction, 'keyUp', modifiers)

  // 发送给主进程：先发送 keyDown，再发送 keyUp
  try {
    await window.ztools.sendInputEvent(keyDownEvent)
    // 短暂延迟后发送 keyUp，模拟真实的按键行为
    await new Promise((resolve) => setTimeout(resolve, 10))
    await window.ztools.sendInputEvent(keyUpEvent)
  } catch (error) {
    console.error('发送方向键事件失败:', error)
  }
}

// 启动 Tab 键目标指令
function launchTabTarget(target: string, text: string): void {
  const commands = [...commandDataStore.regexCommands, ...commandDataStore.commands]
  let matchedCommand: (typeof commands)[number] | null = null

  const parts = target.split('/')
  if (parts.length === 2) {
    // 格式: 插件名称/指令名称
    const [pluginDesc, cmdName] = parts
    matchedCommand =
      commands.find(
        (c) =>
          c.type === 'plugin' &&
          (c.pluginName === pluginDesc || c.pluginTitle === pluginDesc) &&
          c.name === cmdName
      ) || null
  } else {
    // 格式: 指令名称（在所有指令中搜索）
    matchedCommand = commands.find((c) => c.name === target) || null
  }

  if (!matchedCommand) {
    console.warn('[Tab Target] 未找到目标指令:', target)
    new Notification('ZTools', {
      body: `未找到 Tab 键目标指令「${target}」，请检查设置中的指令名称是否正确`
    })
    return
  }

  console.log('[Tab Target] 启动目标指令:', matchedCommand.name, '携带文本:', text)
  window.ztools.launch({
    path: matchedCommand.path,
    type: matchedCommand.type as 'plugin' | 'direct',
    featureCode: matchedCommand.featureCode,
    name: matchedCommand.name,
    cmdType: matchedCommand.cmdType || 'text',
    param: {
      payload: text,
      type: matchedCommand.cmdType || 'text'
    }
  })
}

// 分离当前插件到独立窗口
async function detachCurrentPlugin(): Promise<void> {
  try {
    const result = await window.ztools.detachPlugin()
    if (!result.success) {
      console.error('分离插件失败:', result.error)
    }
  } catch (error: any) {
    console.error('分离插件失败:', error)
  }
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
          background: rgb(255 255 255 / ${windowStore.acrylicLightOpacity}%);
        }
      }

      /* 暗黑模式 */
      @media (prefers-color-scheme: dark) {
        body::after {
          background: rgb(0 0 0 / ${windowStore.acrylicDarkOpacity}%);
        }
      }
    `
    document.head.appendChild(style)
  }
}

// 监听视图变化，调整窗口高度
watch(currentView, (newView) => {
  if (newView === ViewMode.Plugin) {
    return
  }

  updateWindowHeight()
})

//键盘操作
async function handleKeydown(event: KeyboardEvent): Promise<void> {
  // 如果正在输入法组合中,忽略所有键盘事件
  if (isComposing.value) {
    return
  }

  // Cmd/Ctrl + D: 分离插件到独立窗口
  if ((event.key === 'd' || event.key === 'D') && (event.metaKey || event.ctrlKey)) {
    console.log('检测到 Cmd+D 快捷键，当前视图:', currentView.value)
    event.preventDefault()
    if (currentView.value === ViewMode.Plugin && windowStore.currentPlugin) {
      console.log('正在分离插件...')
      detachCurrentPlugin()
    }
    return
  }

  // Cmd/Ctrl + Q: 在插件内终止插件
  if ((event.key === 'q' || event.key === 'Q') && (event.metaKey || event.ctrlKey)) {
    const settings = (await window.ztools.dbGet('settings-general')) || {}
    const isEnabled = settings?.builtinAppShortcutsEnabled?.killPlugin !== false
    if (!isEnabled) {
      return
    }
    console.log('检测到 Cmd+Q/Ctrl+Q 快捷键，当前视图:', currentView.value)
    event.preventDefault()
    if (currentView.value === ViewMode.Plugin && windowStore.currentPlugin) {
      // 终止插件并返回搜索页面（与右上角菜单"结束运行"相同）
      console.log('终止插件并返回搜索页面')
      try {
        const result = await window.ztools.killPluginAndReturn(windowStore.currentPlugin.path)
        if (!result.success) {
          console.error('终止插件失败:', result.error)
        }
      } catch (error: any) {
        console.error('终止插件失败:', error)
      }
    } else {
      window.ztools.hideWindow()
    }
    return
  }

  // Tab 键：根据设置执行目标指令或切换选中项
  if (event.key === 'Tab') {
    if (currentView.value === ViewMode.Search) {
      if (windowStore.tabKeyFunction === 'target-command') {
        const target = windowStore.tabTargetCommand
        if (target) {
          event.preventDefault()
          launchTabTarget(target, searchQuery.value)
        }
        return
      } else {
        searchResultsRef.value?.handleKeydown(event)
        return
      }
    }
  }

  // 是否为不带修饰键的裸 Backspace
  const isPlainBackspace =
    event.key === 'Backspace' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey

  // 事件目标是否为主窗口搜索输入框（子输入框）
  const isSearchInputTarget =
    event.target instanceof HTMLInputElement && event.target.classList.contains('search-input')

  if (
    isPlainBackspace &&
    currentView.value === ViewMode.Plugin &&
    windowStore.subInputVisible &&
    isSearchInputTarget &&
    !searchQuery.value.trim()
  ) {
    // SearchBox 可能已拦截 Backspace（如清理粘贴态），避免重复处理
    if (event.defaultPrevented) {
      console.log('[PluginExit] Backspace 跳过处理：事件已被其他逻辑消费')
      return
    }

    event.preventDefault()
    console.log('[PluginExit] Backspace 命中条件：空输入 Backspace，进入分步退出逻辑')
    handlePluginStepExit()
    return
  }

  // Escape 键特殊处理
  if (event.key === 'Escape') {
    if (!windowStore.builtInEscShortcutEnabled) {
      return
    }

    event.preventDefault()

    if (currentView.value === ViewMode.Plugin) {
      console.log('[PluginExit] ESC 触发分步退出逻辑')
      handlePluginStepExit()
      return
    }

    // 搜索页面 - 分步清除
    if (searchQuery.value.trim()) {
      // 第一步：清除输入框
      searchQuery.value = ''
    } else if (pastedImageData.value || pastedFilesData.value || pastedTextData.value) {
      // 第二步：清除粘贴内容
      pastedImageData.value = null
      pastedFilesData.value = null
      pastedTextData.value = null
    } else {
      // 第三步：关闭窗口
      window.ztools.hideWindow()
    }
    return
  }

  // 如果不在搜索页面,不处理键盘导航
  if (currentView.value !== ViewMode.Search) {
    return
  }

  // 其他键盘事件委托给 SearchResults 组件处理
  searchResultsRef.value?.handleKeydown(event)
}

// 初始化
onMounted(async () => {
  syncLaunchContext()

  // 从 store 加载设置和应用数据
  await Promise.all([
    windowStore.loadSettings(),
    commandDataStore.initializeData() // 初始化应用历史记录和固定列表
  ])

  // 初始调整窗口高度
  updateWindowHeight()

  console.log('监听聚焦事件')

  // 监听窗口显示事件,聚焦搜索框，并接收窗口信息
  window.ztools.onFocusSearch(async (windowInfo) => {
    console.log('窗口聚焦事件:', windowInfo)
    // 更新窗口信息
    if (windowInfo) {
      windowStore.updateWindowInfo(windowInfo)
    }

    if (currentView.value === ViewMode.Plugin) {
      return
    }

    // 根据自动清空配置决定是否清空搜索框（会自动记录时间）
    const shouldClear = windowStore.shouldClearSearch()

    if (shouldClear) {
      searchQuery.value = ''
      pastedImageData.value = null // 清除粘贴的图片
      pastedFilesData.value = null // 清除粘贴的文件
      pastedTextData.value = null // 清除粘贴的文本
    }

    searchResultsRef.value?.resetSelection()
    // 重置所有列表的折叠状态
    searchResultsRef.value?.resetCollapseState()

    // 聚焦输入框
    nextTick(() => {
      searchBoxRef.value?.focus()
      // 如果没有清空搜索框，选中所有文本，方便用户直接输入覆盖
      if (!shouldClear && searchQuery.value) {
        searchBoxRef.value?.selectAll()
      }
    })

    // 检查是否需要自动粘贴
    const timeLimit = windowStore.getAutoPasteTimeLimit()
    if (timeLimit > 0) {
      try {
        const copiedContent = await window.ztools.getLastCopiedContent(timeLimit)
        // 由于获取剪贴板的异步等待，此时 currentView 可能已经发生改变
        if ((currentView.value as ViewMode) === ViewMode.Plugin) {
          return
        }
        if (copiedContent) {
          if (copiedContent.type === 'image') {
            // 自动粘贴图片
            pastedImageData.value = copiedContent.data as string
            console.log('自动粘贴图片')
          } else if (copiedContent.type === 'text') {
            // 自动粘贴文本到粘贴文本区域
            pastedTextData.value = copiedContent.data as string
            console.log('自动粘贴文本:', copiedContent.data)
          } else if (copiedContent.type === 'file') {
            // 自动粘贴文件
            pastedFilesData.value = copiedContent.data as FileItem[]
            console.log('自动粘贴文件:', copiedContent.data)
          }
        }
      } catch (error) {
        console.error('自动粘贴失败:', error)
      }
    }

    // 由于获取剪贴板的异步等待，此时 currentView 可能已经发生改变
    if ((currentView.value as ViewMode) === ViewMode.Plugin) {
      return
    }

    updateWindowHeight()
  })

  // 监听插件按 ESC 返回搜索页面事件
  console.log('监听返回搜索页面事件')
  window.ztools.onBackToSearch(() => {
    console.log('收到返回搜索页面事件')
    // 切换到搜索视图
    currentView.value = ViewMode.Search
    // 清空搜索框
    searchQuery.value = ''
    // 清空当前插件信息
    windowStore.updateCurrentPlugin(null)
    windowStore.setPluginLoading(false)
    // 等待 DOM 更新后调整窗口高度并聚焦搜索框
    nextTick(() => {
      updateWindowHeight()
      searchBoxRef.value?.focus()
    })
  })

  // 监听插件打开事件
  window.ztools.onPluginOpened((plugin) => {
    console.log('插件已打开:', plugin)
    windowStore.updateCurrentPlugin(plugin)
    // 清除所有粘贴内容
    pastedImageData.value = null
    pastedFilesData.value = null
    pastedTextData.value = null
  })

  // 监听插件加载完成事件
  window.ztools.onPluginLoaded((plugin) => {
    console.log('插件页面加载完成:', plugin)
    windowStore.setPluginLoading(false)
  })

  // 监听插件关闭事件
  window.ztools.onPluginClosed(() => {
    console.log('插件已关闭')
    windowStore.updateCurrentPlugin(null)
    windowStore.setPluginLoading(false)
  })

  // 监听子输入框 placeholder 更新事件
  console.log(
    'onUpdateSubInputPlaceholder 方法存在?',
    typeof window.ztools.onUpdateSubInputPlaceholder
  )
  window.ztools.onUpdateSubInputPlaceholder?.(
    (data: { pluginPath: string; placeholder: string }) => {
      console.log('收到更新子输入框 placeholder 事件:', data)
      windowStore.updateSubInputPlaceholder(data.placeholder)
    }
  )

  // 监听子输入框可见性更新事件（插件调用 removeSubInput 时触发）
  window.ztools.onUpdateSubInputVisible?.((visible: boolean) => {
    console.log('收到更新子输入框可见性事件:', visible)
    windowStore.updateSubInputVisible(visible)
  })

  // 监听设置子输入框值事件
  window.ztools.onSetSubInputValue((text: string) => {
    console.log('收到设置子输入框值事件:', text)
    searchQuery.value = text
  })

  // 监听聚焦子输入框事件
  window.ztools.onFocusSubInput(() => {
    console.log('收到聚焦子输入框事件')
    nextTick(() => {
      searchBoxRef.value?.focus()
    })
  })

  // 监听选中子输入框内容事件
  window.ztools.onSelectSubInput(() => {
    nextTick(() => {
      searchBoxRef.value?.focus()
      searchBoxRef.value?.selectAll()
    })
  })

  // 监听 HTTP API 设置搜索文本事件
  window.ztools.onSetSearchText((text: string) => {
    searchQuery.value = text
    nextTick(() => {
      searchBoxRef.value?.focus()
    })
  })

  // 监听显示插件占位区域事件（插件启动前）
  window.ztools.onShowPluginPlaceholder(() => {
    console.log('显示插件占位区域')
    currentView.value = ViewMode.Plugin
    // 清空搜索框和所有粘贴内容
    searchQuery.value = ''
    pastedImageData.value = null
    pastedFilesData.value = null
    pastedTextData.value = null
  })

  // 监听搜索框提示文字更新事件
  window.ztools.onUpdatePlaceholder((placeholder: string) => {
    console.log('更新搜索框提示文字:', placeholder)
    windowStore.updatePlaceholder(placeholder)
  })

  // 监听头像更新事件
  window.ztools.onUpdateAvatar((avatar: string) => {
    console.log('更新头像:', avatar)
    windowStore.updateAvatar(avatar)
  })

  // 壁纸设置只更新宿主搜索视图，不传递到当前插件页面。
  removeSearchWallpaperListener = window.ztools.onUpdateSearchWallpaper((wallpaper) => {
    void windowStore.updateSearchWallpaper(wallpaper)
  })

  removeCompactMainWindowHeaderListener = window.ztools.onUpdateCompactMainWindowHeader(
    (enabled) => {
      windowStore.updateCompactMainWindowHeader(enabled)
      if (currentView.value === ViewMode.Search) {
        updateWindowHeight()
      }
    }
  )
  removeHideMainWindowOnPluginEscListener = window.ztools.onUpdateHideMainWindowOnPluginEsc(
    (enabled) => {
      windowStore.updateHideMainWindowOnPluginEsc(enabled)
    }
  )

  // 监听自动粘贴配置更新事件
  window.ztools.onUpdateAutoPaste((autoPaste: string) => {
    console.log('更新自动粘贴配置:', autoPaste)
    windowStore.updateAutoPaste(autoPaste as any)
  })

  // 监听自动清空配置更新事件
  window.ztools.onUpdateAutoClear((autoClear: string) => {
    console.log('更新自动清空配置:', autoClear)
    windowStore.updateAutoClear(autoClear as any)
  })

  // 监听显示最近使用配置更新事件
  window.ztools.onUpdateShowRecentInSearch((showRecentInSearch: boolean) => {
    windowStore.updateShowRecentInSearch(showRecentInSearch)
  })

  // 监听匹配推荐配置更新事件
  window.ztools.onUpdateMatchRecommendation((showMatchRecommendation: boolean) => {
    windowStore.updateShowMatchRecommendation(showMatchRecommendation)
  })

  // 监听最近使用行数更新事件
  window.ztools.onUpdateRecentRows((rows: number) => {
    windowStore.updateRecentRows(rows)
  })

  // 监听固定栏行数更新事件
  window.ztools.onUpdatePinnedRows((rows: number) => {
    windowStore.updatePinnedRows(rows)
  })

  // 监听 Tab 键目标指令更新事件
  window.ztools.onUpdateTabTarget((target: string) => {
    console.log('更新 Tab 键目标指令:', target)
    windowStore.updateTabTargetCommand(target)
  })

  // 监听 Tab 键功能更新事件
  window.ztools.onUpdateTabKeyFunction((mode: 'navigate' | 'target-command') => {
    console.log('更新 Tab 键功能:', mode)
    windowStore.updateTabKeyFunction(mode)
  })

  // 监听空格打开指令配置更新事件
  window.ztools.onUpdateSpaceOpenCommand((enabled: boolean) => {
    console.log('更新空格打开指令:', enabled)
    windowStore.updateSpaceOpenCommand(enabled)
  })

  // 监听悬浮球双击目标指令更新事件
  window.ztools.onUpdateFloatingBallDoubleClickCommand?.((command: string) => {
    console.log('更新悬浮球双击目标指令:', command)
    windowStore.updateFloatingBallDoubleClickCommand(command)
  })

  // 监听搜索框模式更新事件
  window.ztools.onUpdateSearchMode((mode: string) => {
    windowStore.updateSearchMode(mode as 'aggregate' | 'list')
  })

  // 监听主题色更新事件
  window.ztools.onUpdatePrimaryColor((data: { primaryColor: string; customColor?: string }) => {
    console.log('更新主题色:', data)
    // 更新 store（会自动处理 DOM class 和 CSS 变量）
    windowStore.updatePrimaryColor(data.primaryColor as any)
    if (data.customColor) {
      windowStore.updateCustomColor(data.customColor)
    }
  })

  // 初始化时获取当前窗口材质
  if (window.ztools.getWindowMaterial) {
    window.ztools.getWindowMaterial().then((material) => {
      console.log('主渲染进程初始化材质:', material)
      document.documentElement.setAttribute('data-material', material)
      // 应用亚克力背景色叠加效果
      applyAcrylicOverlay()
    })
  }

  // 监听窗口材质更新事件
  window.ztools.onUpdateWindowMaterial?.((material: 'mica' | 'acrylic' | 'none') => {
    console.log('更新窗口材质:', material)
    document.documentElement.setAttribute('data-material', material)
    // 应用亚克力背景色叠加效果
    applyAcrylicOverlay()
  })

  // 监听亚克力透明度更新事件
  window.ztools.onUpdateAcrylicOpacity?.((data: { lightOpacity: number; darkOpacity: number }) => {
    console.log('更新亚克力透明度:', data)
    windowStore.updateAcrylicLightOpacity(data.lightOpacity)
    windowStore.updateAcrylicDarkOpacity(data.darkOpacity)
    // 应用亚克力背景色叠加效果
    applyAcrylicOverlay()
  })

  // 监听应用启动事件（应用启动后）
  window.ztools.onAppLaunched(() => {
    console.log('应用已启动')
    // 清空搜索框和所有粘贴内容
    searchQuery.value = ''
    pastedImageData.value = null
    pastedFilesData.value = null
    pastedTextData.value = null
    currentView.value = ViewMode.Search
  })

  // 监听全局快捷键触发的启动事件
  window.ztools.onIpcLaunch((options) => {
    console.log('收到 IPC 启动事件:', options)

    // 转换旧的 'app' 类型为新的 'direct' 类型
    const launchOptions: any = {
      ...options,
      type: options.type === 'app' ? ('direct' as const) : options.type
    }

    // 如果是插件类型，且没有传递 param.payload，则使用当前搜索框内容
    // 由于全局快捷键已直接转调主进程直启，这里仅响应旧引用和 renderer 调用
    // 因此这里主动带上输入框的内容作为搜索请求仍是合理的向后兼容逻辑。
    if (options.type === 'plugin' && (!options.param || !options.param.payload)) {
      console.log('[IPC Launch] 使用当前搜索框内容作为 payload:', searchQuery.value)
      launchOptions.param = {
        ...options.param,
        payload: searchQuery.value,
        type: options.cmdType || 'text',
        inputState: {
          searchQuery: searchQuery.value,
          pastedImage: pastedImageData.value,
          pastedFiles: pastedFilesData.value
        }
      }
    }

    window.ztools.launch(launchOptions)
  })

  // 监听悬浮球文件拖放事件
  window.ztools.onFloatingBallFiles((files) => {
    console.log('收到悬浮球文件拖放:', files)
    // 切换到搜索视图
    currentView.value = ViewMode.Search
    // 设置粘贴文件数据（效果等同于复制文件后粘贴）
    pastedFilesData.value = files
    // 聚焦搜索框
    nextTick(() => {
      searchBoxRef.value?.focus()
    })
    updateWindowHeight()
  })

  // 监听悬浮球双击事件
  window.ztools.onFloatingBallDoubleClickCommand?.((command: string) => {
    console.log('收到悬浮球双击事件，目标指令:', command)
    if (!command) return

    // 切换到搜索视图
    currentView.value = ViewMode.Search
    // 直接启动目标指令（不填充搜索框）
    nextTick(() => {
      launchTabTarget(command, '')
    })
  })

  // 监听插件重定向搜索事件
  window.ztools.onRedirectSearch((data) => {
    console.log('收到重定向搜索事件:', data)
    // 切换到搜索视图
    currentView.value = ViewMode.Search
    // 设置搜索内容
    searchQuery.value = data.cmdName
    // 聚焦搜索框
    nextTick(() => {
      searchBoxRef.value?.focus()
    })
  })

  // 监听插件变化事件（安装、删除、禁用状态变化后刷新相关数据）
  window.ztools.onPluginsChanged(async () => {
    console.log('插件列表已变化，重新加载插件可用性相关数据')
    await commandDataStore.reloadPluginAvailabilityData()
  })

  // 自动检查只更新主窗口提示，不直接弹出更新窗口
  window.ztools.onUpdateAvailable((data) => {
    console.log('发现可用更新:', data)
    windowStore.setAvailableUpdateInfo({
      hasUpdate: true,
      version: data.version,
      changelog: data.changelog
    })
  })

  // 设置插件切换自动检查后，立即同步主窗口提示的可见性。
  removeAutoCheckUpdateChangedListener = window.ztools.onAutoCheckUpdateChanged((enabled) => {
    windowStore.updateAutoCheckUpdateEnabled(enabled)
  })

  // 监听更新下载开始事件
  window.ztools.onUpdateDownloadStart((data) => {
    console.log('开始下载更新:', data)
  })

  // 监听更新下载失败事件
  window.ztools.onUpdateDownloadFailed((data) => {
    console.error('更新下载失败:', data)
  })

  // 恢复已检测到的更新状态
  windowStore.checkUpdateStatus()

  // 监听超级面板搜索请求（主进程转发，携带剪贴板内容）
  window.ztools.onSuperPanelSearch((data: { text: string; clipboardContent?: any }) => {
    console.log(
      '[超级面板搜索] 收到搜索请求:',
      data.text?.substring(0, 50),
      'clipboardType:',
      data.clipboardContent?.type
    )
    const searchText = data.text || ''
    const cc = data.clipboardContent

    const seen = new Set<string>()
    const results: any[] = []
    const addResults = (items: any[]): void => {
      for (const item of items) {
        const key = `${item.path}:${item.featureCode || ''}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push(item)
        }
      }
    }

    if (cc?.type === 'image') {
      // 图片：搜索支持 img 类型的指令
      addResults(commandDataStore.searchImageCommands())
    } else if (cc?.type === 'file' && cc.files) {
      // 文件：搜索支持 files 类型的指令
      addResults(commandDataStore.searchFileCommands(cc.files))
    } else if (cc?.type === 'text' && cc.text) {
      // 文本：搜索 text 和 regex/over 类型的指令
      const { bestMatches, regexMatches } = commandDataStore.search(cc.text)
      addResults(bestMatches)
      addResults(regexMatches)
    } else if (searchText) {
      // 普通文本搜索
      const { bestMatches, regexMatches } = commandDataStore.search(searchText)
      addResults(bestMatches)
      addResults(regexMatches)
    }

    console.log('[超级面板搜索] 返回结果数:', results.length)
    // 发送搜索结果回超级面板（携带剪贴板内容）
    window.ztools.sendSuperPanelSearchResult({
      results: JSON.parse(JSON.stringify(results)),
      clipboardContent: cc
    })
  })

  // 监听超级面板窗口匹配搜索请求
  window.ztools.onSuperPanelSearchWindowCommands(
    (data: {
      requestId: number
      windowInfo: {
        app?: string
        title?: string
        className?: string
        hwnd?: number
        bundleId?: string
        pid?: number
      }
    }) => {
      console.log('[超级面板窗口匹配] 收到搜索请求:', data.windowInfo)
      const results = commandDataStore.searchWindowCommands(data.windowInfo)
      console.log('[超级面板窗口匹配] 返回结果数:', results.length)
      window.ztools.sendSuperPanelWindowCommandsResult({
        requestId: data.requestId,
        results: JSON.parse(JSON.stringify(results))
      })
    }
  )

  // 监听超级面板启动事件（由主进程从超级面板转发）
  window.ztools.onSuperPanelLaunch(
    async (data: {
      command: any
      launchSource?: 'search' | 'global-shortcut' | 'super-panel'
      clipboardContent?: any
      windowInfo?: any
    }) => {
      console.log(
        '[超级面板启动] 收到启动事件:',
        data.command?.name,
        'clipboardType:',
        data.clipboardContent?.type
      )
      const cmd = data.command
      const cc = data.clipboardContent

      // 构造 payload（复用 SearchResults 中 handleSelectApp 的逻辑）
      let payload: any = ''
      let type = cmd.cmdType || 'text'

      if (cmd.cmdType === 'window' && data.windowInfo) {
        // 窗口匹配指令：payload 为窗口信息
        payload = data.windowInfo
      } else if (cc) {
        if (cc.type === 'text' && cc.text) {
          if (cmd.cmdType === 'over' || cmd.cmdType === 'regex') {
            payload = cc.text
          } else {
            payload = cc.text
          }
        } else if (cc.type === 'image' && cc.image) {
          payload = cc.image
          type = 'img'
        } else if (cc.type === 'file' && cc.files) {
          payload = cc.files.map((file: any) => ({
            isFile: !file.isDirectory,
            isDirectory: file.isDirectory,
            name: file.name,
            path: file.path
          }))
          type = 'files'
        }
      }

      try {
        await window.ztools.launch({
          path: cmd.path,
          type: cmd.type || 'plugin',
          featureCode: cmd.featureCode,
          name: cmd.name,
          cmdType: cmd.cmdType || type,
          launchSource: data.launchSource || 'super-panel',
          param: {
            payload,
            type,
            inputState: {
              searchQuery: cc?.type === 'text' ? cc.text || '' : '',
              pastedImage: cc?.type === 'image' ? cc.image : null,
              pastedFiles:
                cc?.type === 'file'
                  ? cc.files.map((file: any) => ({
                      isFile: !file.isDirectory,
                      isDirectory: file.isDirectory,
                      name: file.name,
                      path: file.path
                    }))
                  : null,
              pastedText: cc?.type === 'text' ? cc.text : null
            }
          }
        })
      } catch (error) {
        console.error('[超级面板启动] 启动失败:', error)
      }
    }
  )

  // 全局键盘事件监听
  window.addEventListener('keydown', handleKeydown)
})

// 清理
onUnmounted(() => {
  // 释放支持主动清理的 IPC 监听器，避免重复挂载后收到多次通知。
  removeAutoCheckUpdateChangedListener?.()
  removeAutoCheckUpdateChangedListener = null
  removeSearchWallpaperListener?.()
  removeSearchWallpaperListener = null
  removeCompactMainWindowHeaderListener?.()
  removeCompactMainWindowHeaderListener = null
  removeHideMainWindowOnPluginEscListener?.()
  removeHideMainWindowOnPluginEscListener = null
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.app-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  outline: none;
  overflow: hidden; /* 隐藏所有滚动条 */
  border-radius: 8px; /* Windows 11 圆角 */
}
.app-container__plugin {
  border-radius: 0;
}
.search-window {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
  /* overflow: hidden; 隐藏所有滚动条 */
  /* border-radius: 8px; Windows 11 圆角 */
}

.search-wallpaper-layer {
  position: absolute;
  z-index: 0;
  pointer-events: none;
  user-select: none;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  transform: translateZ(0);
  transition:
    opacity 0.2s ease,
    filter 0.2s ease;
  will-change: opacity, filter;
}

.search-box-wrapper {
  flex-shrink: 0;
}

.plugin-placeholder {
  flex: 1;
  /* min-height: 500px; */
  background: transparent; /* 透明背景，让下方的 BrowserView 和 Mica 材质显示 */
  -webkit-app-region: no-drag; /* 禁止拖动窗口 */
  user-select: none; /* 禁止选取文本 */
}
</style>
