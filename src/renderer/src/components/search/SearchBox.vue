<template>
  <div ref="searchBoxRef" class="search-box" @mousedown="handleMouseDown">
    <!-- 拖放蒙版 -->
    <div v-if="isDraggingOver" class="drag-overlay"></div>
    <!-- 隐藏的测量元素,用于计算文本宽度 -->
    <div class="search-input-container">
      <!-- 粘贴的图片缩略图 -->
      <div v-if="pastedImage" class="pasted-image-thumbnail">
        <img :src="pastedImage" alt="粘贴的图片" />
      </div>
      <!-- 粘贴的文件显示 -->
      <div v-if="pastedFiles && pastedFiles.length > 0" class="pasted-files">
        <div class="file-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M13 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V9L13 2Z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M13 2V9H20"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div class="file-info">
          <span class="file-name">{{ getFirstFileName(pastedFiles) }}</span>
          <span v-if="pastedFiles.length > 1" class="file-count">{{ pastedFiles.length }}</span>
        </div>
      </div>
      <!-- 粘贴的文本显示 -->
      <div v-if="pastedText" class="pasted-text" @click="handlePastedTextClick">
        <div class="text-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M14 2V8H20M16 13H8M16 17H8M10 9H8"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div class="text-info">
          <span class="text-content">{{ truncatedPastedText }}</span>
        </div>
      </div>
      <!-- 输入框包装器：占位符和输入框在同一容器内 -->
      <div class="input-wrapper">
        <span ref="measureRef" class="measure-text"></span>
        <!-- 独立的占位符显示 -->
        <div v-if="!modelValue && !isComposing" class="placeholder-text">
          {{ currentPlaceholder }}
        </div>
        <input
          ref="inputRef"
          type="text"
          :value="modelValue"
          placeholder=""
          class="search-input"
          @input="onInput"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @keydown="onKeydown"
          @keydown.left="(e) => keydownEvent(e, 'left')"
          @keydown.right="(e) => keydownEvent(e, 'right')"
          @keydown.down="(e) => keydownEvent(e, 'down')"
          @keydown.up="(e) => keydownEvent(e, 'up')"
          @paste="handlePaste"
        />
      </div>
    </div>

    <!-- 操作栏 -->
    <div ref="searchActionsRef" class="search-actions">
      <!-- 更新提示（有下载好的更新时显示） -->
      <div
        v-if="windowStore.updateDownloadInfo.hasDownloaded && !windowStore.currentPlugin"
        class="update-notification"
        @click="handleUpdateClick"
      >
        <span class="update-text">新版本已下载，点击升级</span>
        <UpdateIcon />
      </div>
      <!-- 头像按钮（无更新或插件模式时显示） -->
      <div
        v-else
        class="avatar-wrapper"
        :class="{
          loading: isPluginLoading,
          'is-default': isDefaultAvatar
        }"
        @click="handleSettingsClick"
      >
        <!-- 插件模式下显示操作提示图标 -->
        <div v-if="windowStore.currentPlugin" class="action-indicator">
          <svg
            width="4"
            height="18"
            viewBox="0 0 4 18"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="2" cy="2" r="2" fill="currentColor" opacity="0.7" />
            <circle cx="2" cy="9" r="2" fill="currentColor" opacity="0.7" />
            <circle cx="2" cy="16" r="2" fill="currentColor" opacity="0.7" />
          </svg>
        </div>
        <AdaptiveIcon
          :src="avatarUrl"
          :force-adaptive="false"
          :class="[
            'search-btn',
            { 'plugin-logo': windowStore.currentPlugin?.logo && !isPluginLoading },
            { 'is-default': isDefaultAvatar }
          ]"
          draggable="false"
        />
        <div v-if="isPluginLoading" class="avatar-spinner"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { DEFAULT_AVATAR, useWindowStore } from '../../stores/windowStore'
import AdaptiveIcon from '../common/AdaptiveIcon.vue'
import UpdateIcon from './UpdateIcon.vue'

// FileItem 接口（从剪贴板管理器返回的格式）
interface FileItem {
  path: string
  name: string
  isDirectory: boolean
}

const props = defineProps<{
  modelValue: string
  pastedImage?: string | null
  pastedFiles?: FileItem[] | null
  pastedText?: string | null
  currentView?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:pastedImage', value: string | null): void
  (e: 'update:pastedFiles', value: FileItem[] | null): void
  (e: 'update:pastedText', value: string | null): void
  (e: 'keydown', event: KeyboardEvent): void
  (e: 'arrow-keydown', event: KeyboardEvent, direction: 'left' | 'right' | 'up' | 'down'): void
  (e: 'composing', isComposing: boolean): void
  (e: 'settings-click'): void
}>()

const windowStore = useWindowStore()

const searchBoxRef = ref<HTMLDivElement | null>(null)
const searchActionsRef = ref<HTMLDivElement | null>(null)

const placeholderText = computed(() => {
  // 如果在插件模式下,使用子输入框的 placeholder
  if (windowStore.currentPlugin) {
    return windowStore.subInputPlaceholder
  }
  // 否则使用全局 placeholder
  return windowStore.placeholder
})

// 当前实际显示的占位符文字
const currentPlaceholder = computed(() => {
  // 如果有粘贴内容（图片/文件/文本），显示"搜索"
  if (props.pastedImage || props.pastedFiles || props.pastedText) {
    return '搜索'
  }
  // 否则显示完整的占位符文字
  return placeholderText.value
})
const avatarUrl = computed(() => {
  // 优先显示插件图标
  if (windowStore.currentPlugin?.logo) {
    return windowStore.currentPlugin.logo
  }
  // 否则显示用户头像
  return windowStore.avatar
})

// 判断是否是默认头像
const isDefaultAvatar = computed(() => {
  // 使用严格相等判断，而不是字符串包含判断
  // 这样在打包后路径被处理时也能正确判断
  return avatarUrl.value === DEFAULT_AVATAR
})

const isPluginLoading = computed(() => windowStore.pluginLoading)

// 截断显示的粘贴文本（从中间截断，显示头尾）
const truncatedPastedText = computed(() => {
  if (!props.pastedText) return ''
  const maxLength = 30
  if (props.pastedText.length <= maxLength) return props.pastedText

  // 从中间截断，保留前15个字符和后10个字符
  const headLength = 15
  const tailLength = 10
  const head = props.pastedText.substring(0, headLength)
  const tail = props.pastedText.substring(props.pastedText.length - tailLength)
  return `${head}...${tail}`
})

const inputRef = ref<HTMLInputElement>()
const measureRef = ref<HTMLSpanElement>()
const isComposing = ref(false) // 是否正在输入法组合
const composingText = ref('') // 正在组合的文本

// 拖放相关状态
const isDraggingOver = ref(false) // 是否正在拖动文件到搜索框
const dragCounter = ref(0) // 拖动计数器，处理嵌套元素的 dragenter/dragleave

watch(
  () => composingText.value,
  (newValue) => {
    console.log('composingText 更改了', newValue)
    // 输入法组合中的文本也应该影响宽度
    if (
      newValue &&
      measureRef.value &&
      inputRef.value &&
      searchBoxRef.value &&
      searchActionsRef.value
    ) {
      measureRef.value.textContent = newValue
      const width = measureRef.value.offsetWidth + 10

      // 动态计算最大宽度
      const searchBoxWidth = searchBoxRef.value.offsetWidth
      const searchActionsWidth = searchActionsRef.value.offsetWidth
      const gap = 8
      const padding = 30
      const maxWidth = searchBoxWidth - searchActionsWidth - gap - padding

      inputRef.value.style.width = `${Math.min(width, maxWidth)}px`
    } else {
      // 组合文本为空时，使用正常的更新逻辑
      updateInputWidth()
    }
  }
)

function onCompositionStart(): void {
  isComposing.value = true
  emit('composing', true)
}

function onCompositionEnd(event: Event): void {
  isComposing.value = false
  emit('composing', false)
  // 组合结束后触发一次输入事件
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', value)
}

function onInput(event: Event): void {
  console.log('onInput', event)
  // 如果正在输入法组合中,不触发更新
  if (isComposing.value) {
    composingText.value = (event.target as HTMLInputElement).value
    return
  }
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', value)
}

function onKeydown(event: KeyboardEvent): void {
  // 如果正在输入法组合中,不触发键盘事件
  if (isComposing.value && event.key === 'Enter') {
    return
  }

  // 如果有粘贴的图片、文件或文本，按 Backspace 或 Delete 键清除
  if (
    (props.pastedImage || props.pastedFiles || props.pastedText) &&
    (event.key === 'Backspace' || event.key === 'Delete')
  ) {
    // 如果输入框为空，清除图片、文件或文本
    if (!props.modelValue) {
      event.preventDefault()
      if (props.pastedImage) {
        clearPastedImage()
      } else if (props.pastedFiles) {
        clearPastedFiles()
      } else if (props.pastedText) {
        // 文本类型：填充到输入框并全选
        const textContent = props.pastedText
        clearPastedText()
        nextTick(() => {
          emit('update:modelValue', textContent)
          nextTick(() => {
            // 全选文本
            inputRef.value?.select()
          })
        })
      }
      return
    }
  }

  emit('keydown', event)
}

function keydownEvent(event: KeyboardEvent, direction: 'left' | 'right' | 'up' | 'down'): void {
  // 如果正在输入法组合中,不触发键盘事件
  if (isComposing.value) {
    return
  }
  emit('arrow-keydown', event, direction)
}

// 处理粘贴事件
async function handlePaste(event: ClipboardEvent): Promise<void> {
  try {
    // 先阻止默认粘贴行为（因为是异步操作，必须在这里就阻止）
    event.preventDefault()

    // 手动粘贴不需要时间限制
    const copiedContent = await window.ztools.getLastCopiedContent()

    if (copiedContent?.type === 'image') {
      // 粘贴的是图片 -> 作为匹配内容
      emit('update:pastedImage', copiedContent.data as string)
      // 清空输入框文本
      emit('update:modelValue', '')
    } else if (copiedContent?.type === 'file') {
      // 粘贴的是文件 -> 作为匹配内容
      emit('update:pastedFiles', copiedContent.data as FileItem[])
      // 清空输入框文本
      emit('update:modelValue', '')
    } else if (copiedContent?.type === 'text') {
      // 粘贴的是文本 -> 检查输入框状态
      const input = inputRef.value
      const hasSelection =
        input && input.selectionStart !== null && input.selectionStart !== input.selectionEnd
      const hasInputText = props.modelValue && props.modelValue.trim().length > 0

      if (hasSelection || hasInputText) {
        // 有选中文字或输入框有文本 -> 手动插入文本到光标位置
        const text = copiedContent.data as string
        const currentValue = props.modelValue || ''

        if (hasSelection) {
          // 替换选中内容
          const start = input!.selectionStart!
          const end = input!.selectionEnd!
          const newValue = currentValue.substring(0, start) + text + currentValue.substring(end)
          emit('update:modelValue', newValue)

          // 设置光标位置到插入文本的末尾
          nextTick(() => {
            if (input) {
              const newCursorPos = start + text.length
              input.setSelectionRange(newCursorPos, newCursorPos)
            }
          })
        } else {
          // 在光标位置插入文本
          const cursorPos = input?.selectionStart || currentValue.length
          const newValue =
            currentValue.substring(0, cursorPos) + text + currentValue.substring(cursorPos)
          emit('update:modelValue', newValue)

          // 设置光标位置到插入文本的末尾
          nextTick(() => {
            if (input) {
              const newCursorPos = cursorPos + text.length
              input.setSelectionRange(newCursorPos, newCursorPos)
            }
          })
        }
      } else {
        // 输入框为空 -> 作为粘贴内容（用于 over 类型匹配指令）
        emit('update:pastedText', copiedContent.data as string)
        // 清空输入框文本
        emit('update:modelValue', '')
      }
    }
  } catch (error) {
    console.error('处理粘贴失败:', error)
  }
}

// 拖放事件处理
function handleDragEnter(event: DragEvent): void {
  event.preventDefault()
  event.stopPropagation()

  dragCounter.value++
  if (dragCounter.value === 1) {
    isDraggingOver.value = true
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

function handleDragLeave(event: DragEvent): void {
  event.preventDefault()
  event.stopPropagation()

  dragCounter.value--
  if (dragCounter.value === 0) {
    isDraggingOver.value = false
  }
}

async function handleDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  event.stopPropagation()

  // 重置拖放状态
  isDraggingOver.value = false
  dragCounter.value = 0

  try {
    // 获取拖放的文件
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) {
      console.log('没有文件被拖放')
      return
    }

    // 提取文件路径
    const paths: string[] = []
    const names: string[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // 使用 Electron webUtils 获取文件路径
      try {
        const filePath = window.ztools.getPathForFile(file)
        if (filePath) {
          paths.push(filePath)
          names.push(file.name)
        }
      } catch (error) {
        console.error('获取文件路径失败:', file.name, error)
      }
    }

    if (paths.length === 0) {
      console.log('没有有效的文件路径')
      return
    }

    // 使用主进程提供的异步方法检查文件类型
    const fileStats = await window.ztools.checkFilePaths(paths)

    // 转换为 FileItem[] 格式
    const fileItems: FileItem[] = fileStats
      .filter((stat) => stat.exists)
      .map((stat, index) => ({
        path: stat.path,
        name: names[index],
        isDirectory: stat.isDirectory
      }))

    // 触发粘贴文件事件（和粘贴文件一样的处理）
    if (fileItems.length > 0) {
      emit('update:pastedFiles', fileItems)
      // 清空输入框文本
      emit('update:modelValue', '')
    } else {
      console.log('没有有效的文件项')
    }
  } catch (error) {
    console.error('处理拖放文件失败:', error)
  }
}

// 处理点击粘贴文本框
function handlePastedTextClick(): void {
  if (props.pastedText) {
    // 将粘贴的文本填充到输入框
    emit('update:modelValue', props.pastedText)
    // 清除粘贴状态
    emit('update:pastedText', null)
    // 聚焦输入框
    nextTick(() => {
      inputRef.value?.focus()
    })
  }
}

// 清除粘贴的图片
function clearPastedImage(): void {
  emit('update:pastedImage', null)
  nextTick(() => {
    inputRef.value?.focus()
  })
}

// 清除粘贴的文件
function clearPastedFiles(): void {
  emit('update:pastedFiles', null)
  nextTick(() => {
    inputRef.value?.focus()
  })
}

// 清除粘贴的文本
function clearPastedText(): void {
  emit('update:pastedText', null)
  nextTick(() => {
    inputRef.value?.focus()
  })
}

// 窗口拖拽 Composable
interface DragHandlers {
  onStart: (e: MouseEvent) => Promise<void>
  cleanup: () => void
}

const useDrag = (): DragHandlers => {
  let isDragging = false
  let offsetX = 0
  let offsetY = 0

  const onMove = (e: MouseEvent): void => {
    if (!isDragging) return
    window.ztools.setWindowPosition(e.screenX - offsetX, e.screenY - offsetY)
  }

  const onEnd = (e: MouseEvent): void => {
    if (!isDragging) return
    isDragging = false
    window.ztools.setWindowSizeLock(false)
    cleanup()

    const target = e.target as HTMLElement
    if (!target.closest('input') && !target.closest('.search-actions')) {
      inputRef.value?.focus()
    }
  }

  const onStart = async (e: MouseEvent): Promise<void> => {
    const target = e.target as HTMLElement
    if (target === inputRef.value || target.closest('.search-actions')) return

    const { x, y } = await window.ztools.getWindowPosition()
    offsetX = e.screenX - x
    offsetY = e.screenY - y
    isDragging = true
    window.ztools.setWindowSizeLock(true)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onEnd)
  }

  const cleanup = (): void => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
  }

  return { onStart, cleanup }
}

const { onStart: handleMouseDown, cleanup: cleanupDrag } = useDrag()

// 获取第一个文件的名称（用于显示）
function getFirstFileName(files: FileItem[]): string {
  if (files.length === 0) return ''
  return files[0].name
}

function updateInputWidth(): void {
  nextTick(() => {
    if (measureRef.value && inputRef.value && searchBoxRef.value && searchActionsRef.value) {
      let width: number
      const minWidth = 2 // 最小宽度，确保光标可见

      if (props.modelValue && props.modelValue.length > 0) {
        // 有内容时，根据内容计算宽度
        measureRef.value.textContent = props.modelValue
        width = measureRef.value.offsetWidth + 10 // 添加光标和边距

        // 动态计算最大宽度 = 父容器宽度 - 右侧操作栏宽度 - gap - padding
        const searchBoxWidth = searchBoxRef.value.offsetWidth
        const searchActionsWidth = searchActionsRef.value.offsetWidth
        const gap = 8 // .search-box 的 gap
        const padding = 30 // .search-box 的左右 padding (15 * 2)
        const maxWidth = searchBoxWidth - searchActionsWidth - gap - padding

        // 限制最大宽度
        width = Math.min(width, maxWidth)
      } else {
        // 无内容时，使用最小宽度（确保光标可见）
        width = minWidth
      }

      // 设置输入框宽度
      inputRef.value.style.width = `${width}px`
      console.log('inputWidth.value', width, 'hasContent', !!props.modelValue)
    }
  })
}

// 监听 modelValue 变化
watch(
  () => props.modelValue,
  () => {
    updateInputWidth()
  }
)

// 监听 currentPlugin 变化（可能改变占位符，但不影响宽度计算）
watch(
  () => windowStore.currentPlugin,
  () => {
    updateInputWidth()
  }
)

// 用于清理的 ResizeObserver
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  // 初始化输入框宽度（updateInputWidth 内部会根据是否有内容来决定宽度）
  updateInputWidth()

  inputRef.value?.focus()

  // 监听窗口大小变化，重新计算输入框最大宽度
  resizeObserver = new ResizeObserver(() => {
    updateInputWidth()
  })
  if (searchBoxRef.value) {
    resizeObserver.observe(searchBoxRef.value)
  }

  // 添加拖放事件监听
  if (searchBoxRef.value) {
    searchBoxRef.value.addEventListener('dragenter', handleDragEnter)
    searchBoxRef.value.addEventListener('dragover', handleDragOver)
    searchBoxRef.value.addEventListener('dragleave', handleDragLeave)
    searchBoxRef.value.addEventListener('drop', handleDrop)
  }

  // 监听菜单命令
  window.ztools.onContextMenuCommand(async (command) => {
    if (command === 'open-devtools') {
      window.ztools.openPluginDevTools()
    } else if (command === 'kill-plugin') {
      try {
        // 调用新接口：终止插件并返回搜索页面
        const result = await window.ztools.killPluginAndReturn(windowStore.currentPlugin!.path)
        if (!result.success) {
          alert(`终止插件失败: ${result.error}`)
        }
      } catch (error: any) {
        console.error('终止插件失败:', error)
        alert(`终止插件失败: ${error.message || '未知错误'}`)
      }
    } else if (command === 'detach-plugin') {
      try {
        const result = await window.ztools.detachPlugin()
        if (!result.success) {
          alert(`分离插件失败: ${result.error}`)
        }
      } catch (error: any) {
        console.error('分离插件失败:', error)
        alert(`分离插件失败: ${error.message || '未知错误'}`)
      }
    } else if (command === 'toggle-auto-kill') {
      try {
        // 读取当前配置
        let outKillPlugins: string[] = []
        try {
          const data = await window.ztools.dbGet('outKillPlugin')
          if (data && Array.isArray(data)) {
            outKillPlugins = data
          }
        } catch (error) {
          console.debug('未找到outKillPlugin配置', error)
        }

        const currentPluginName = windowStore.currentPlugin!.name
        const index = outKillPlugins.indexOf(currentPluginName)

        if (index !== -1) {
          // 已存在，移除
          outKillPlugins.splice(index, 1)
        } else {
          // 不存在，添加
          outKillPlugins.push(currentPluginName)
        }

        // 保存到数据库
        await window.ztools.dbPut('outKillPlugin', outKillPlugins)

        console.log('已更新 outKillPlugin 配置:', outKillPlugins)
      } catch (error: any) {
        console.error('切换自动结束配置失败:', error)
        alert(`操作失败: ${error.message || '未知错误'}`)
      }
    } else if (command === 'toggle-auto-detach') {
      try {
        // 读取当前配置
        let autoDetachPlugins: string[] = []
        try {
          const data = await window.ztools.dbGet('autoDetachPlugin')
          if (data && Array.isArray(data)) {
            autoDetachPlugins = data
          }
        } catch (error) {
          console.debug('未找到 autoDetachPlugin 配置', error)
        }

        const currentPluginName = windowStore.currentPlugin!.name
        const index = autoDetachPlugins.indexOf(currentPluginName)

        if (index !== -1) {
          // 已存在，移除
          autoDetachPlugins.splice(index, 1)
        } else {
          // 不存在，添加
          autoDetachPlugins.push(currentPluginName)
        }

        // 保存到数据库
        await window.ztools.dbPut('autoDetachPlugin', autoDetachPlugins)

        console.log('已更新 autoDetachPlugin 配置:', autoDetachPlugins)
      } catch (error: any) {
        console.error('切换自动分离配置失败:', error)
        alert(`操作失败: ${error.message || '未知错误'}`)
      }
    }
  })
})

async function handleSettingsClick(): Promise<void> {
  console.log('点击设置按钮:', {
    currentView: props.currentView,
    currentPlugin: windowStore.currentPlugin
  })

  // 只有在插件视图真正显示时才显示插件菜单
  if (props.currentView === 'plugin' && windowStore.currentPlugin) {
    console.log('显示插件菜单')

    // 从数据库读取配置
    let outKillPlugins: string[] = []
    let autoDetachPlugins: string[] = []
    try {
      const killData = await window.ztools.dbGet('outKillPlugin')
      if (killData && Array.isArray(killData)) {
        outKillPlugins = killData
      }
      const detachData = await window.ztools.dbGet('autoDetachPlugin')
      if (detachData && Array.isArray(detachData)) {
        autoDetachPlugins = detachData
      }
    } catch (error) {
      console.log('读取配置失败（可能不存在）:', error)
    }

    // 检查当前插件是否在列表中
    const currentPluginName = windowStore.currentPlugin.name
    const isAutoKill = outKillPlugins.includes(currentPluginName)
    const isAutoDetach = autoDetachPlugins.includes(currentPluginName)

    // 根据平台显示不同的快捷键
    const platform = window.ztools.getPlatform()
    const detachShortcut = platform === 'darwin' ? '⌘+D' : 'Ctrl+D'

    const menuItems = [
      { id: 'detach-plugin', label: `分离到独立窗口 (${detachShortcut})` },
      { id: 'open-devtools', label: '打开开发者工具' },
      {
        label: '插件设置',
        submenu: [
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
      },
      { id: 'kill-plugin', label: '结束运行' }
    ]

    await window.ztools.showContextMenu(menuItems)
  } else {
    // 否则打开设置插件
    console.log('打开设置插件')
    window.ztools.openSettings()
  }
}

async function handleUpdateClick(): Promise<void> {
  try {
    // 确认升级
    const confirmed = confirm(
      `确定要升级到版本 ${windowStore.updateDownloadInfo.version} 吗？\n\n应用将重启以完成升级。`
    )
    if (!confirmed) {
      return
    }

    // 执行升级
    const result = await window.ztools.updater.installDownloadedUpdate()
    if (!result.success) {
      alert(`升级失败: ${result.error}`)
    }
  } catch (error: any) {
    console.error('升级失败:', error)
    alert(`升级失败: ${error.message || '未知错误'}`)
  }
}

onUnmounted(() => {
  resizeObserver?.disconnect()
  cleanupDrag()

  // 清理拖放事件监听
  if (searchBoxRef.value) {
    searchBoxRef.value.removeEventListener('dragenter', handleDragEnter)
    searchBoxRef.value.removeEventListener('dragover', handleDragOver)
    searchBoxRef.value.removeEventListener('dragleave', handleDragLeave)
    searchBoxRef.value.removeEventListener('drop', handleDrop)
  }
})

defineExpose({
  focus: () => inputRef.value?.focus(),
  selectAll: () => inputRef.value?.select()
})
</script>

<style scoped>
.search-box {
  padding: 5px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  /* -webkit-app-region: drag; 暂时注释掉，测试 mousemove */
  position: relative;
  overflow: hidden; /* 防止内容溢出 */
  width: 100%; /* 确保宽度不超过父容器 */
  z-index: 10; /* 确保在其他内容之上 */
  user-select: none; /* 禁止选取文本 */
}

/* 拖放蒙版 */
.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1000;
  pointer-events: none;
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.measure-text {
  position: absolute;
  white-space: pre;
  font-size: 25px;
  line-height: 1.3; /* 与 .search-input 保持一致 */
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-weight: inherit;
  letter-spacing: inherit;
  pointer-events: none;
  visibility: hidden;
  left: -9999px;
}

.placeholder-text {
  position: absolute;
  left: 0;
  color: #7a7a7a;
  font-size: 25px;
  font-weight: 300;
  line-height: 1.3;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* 暗色模式下的 placeholder 颜色 */
@media (prefers-color-scheme: dark) {
  .placeholder-text {
    color: #aaaaaa;
  }
}

.search-input {
  /* 移除 flex: 1，改为根据内容自动调整 */
  width: auto; /* 将由 JS 动态设置 */
  height: 48px;
  line-height: 1.3; /* 降低行高，使文本更紧凑 */
  font-size: 25px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-color);
  -webkit-app-region: no-drag;
  user-select: text; /* 允许选取文本 */
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* 移除了原生 placeholder 样式，因为现在使用独立的占位符元素 */

.search-input-container {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0; /* 允许 flex 子元素缩小 */
  overflow: hidden; /* 防止内容溢出 */
  /* 不设置 no-drag，继承父元素的 drag，整个区域可拖动 */
}

.input-wrapper {
  position: relative; /* 为占位符提供定位上下文 */
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.pasted-image-thumbnail {
  position: relative;
  width: 48px;
  height: 48px;
  flex-shrink: 0; /* 图片缩略图不允许缩小，保持尺寸 */
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.15); /* 透明黑色描边 */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  background: var(--control-bg); /* 添加背景色，图片未填满时显示 */
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  user-select: none; /* 不可选取 */
}

.pasted-image-thumbnail img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain; /* 显示完整图片，不裁切 */
}

.pasted-files,
.pasted-text {
  position: relative;
  max-width: 200px;
  height: 36px;
  flex-shrink: 1; /* 允许缩小 */
  display: inline-flex; /* 改为inline-flex，内容自适应宽度 */
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 6px;
  background: var(--control-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  -webkit-app-region: no-drag;
  user-select: none; /* 不可选取文本 */
}

/* 文件粘贴：实线描边（与图片一致） */
.pasted-files {
  border: 1px solid rgba(0, 0, 0, 0.15);
}

/* 文本粘贴：虚线描边，可点击 */
.pasted-text {
  border: 1px dashed rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: all 0.2s;
}

.pasted-text:hover {
  background: var(--hover-bg);
  border-color: rgba(0, 0, 0, 0.3);
}

/* 暗色模式下使用透明白色描边（必须放在所有描边定义之后） */
@media (prefers-color-scheme: dark) {
  .pasted-image-thumbnail,
  .pasted-files {
    border-color: rgba(255, 255, 255, 0.15);
  }

  .pasted-text {
    border-color: rgba(255, 255, 255, 0.2);
  }

  .pasted-text:hover {
    border-color: rgba(255, 255, 255, 0.3);
  }
}

.file-icon,
.text-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--primary-color);
  opacity: 0.8;
}

.file-info,
.text-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.file-name,
.text-content {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  padding: 2px 6px;
  border-radius: 10px;
  flex-shrink: 0;
}

.search-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0; /* 右侧按钮区域不允许缩小 */
  -webkit-app-region: no-drag; /* 头像区域不可拖动 */
}

.update-notification {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.1);
  transition: all 0.2s;
  -webkit-app-region: no-drag;
}

.update-notification:hover {
  background: rgba(16, 185, 129, 0.2);
  transform: scale(1.02);
}

.update-notification:active {
  transform: scale(0.98);
}

.update-text {
  font-size: 13px;
  color: #10b981;
  font-weight: 500;
  white-space: nowrap;
}

.search-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  cursor: pointer;
  transition: all 0.2s;
  -webkit-app-region: no-drag;
  /* 按钮不可拖动 */
  border: none;
  outline: none;
  position: relative;
  z-index: 1;
}

/* 插件图标：保持原本形状，不使用圆形遮罩 */
.search-btn.plugin-logo {
  border-radius: 6px;
  object-fit: contain;
}

.search-btn:not(.plugin-logo):hover {
  transform: scale(0.96);
  box-shadow: 0 0 6px 1px color-mix(in srgb, var(--primary-color), transparent 60%);
}

.search-btn:active {
  transform: scale(0.95);
}

.avatar-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.avatar-wrapper.loading .search-btn {
  opacity: 0.9;
}

.action-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  opacity: 0.6;
  transition: opacity 0.2s;
}

.avatar-wrapper:hover .action-indicator {
  opacity: 1;
}

.search-btn.is-default {
  opacity: 1;
}

.avatar-spinner {
  position: absolute;
  right: -4px;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: var(--primary-color, #3b82f6);
  animation: avatar-spin 0.8s linear infinite;
  pointer-events: none;
}

@keyframes avatar-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
