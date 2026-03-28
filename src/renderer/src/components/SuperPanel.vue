<template>
  <div class="super-panel" @keydown="handleKeydown">
    <!-- 宫格模式：无剪贴板数据，显示固定指令 -->
    <template v-if="mode === 'pinned'">
      <!-- 头部：头像 + 超级面板标题 -->
      <div class="search-header pinned-header">
        <img
          :src="avatar"
          class="header-avatar clickable"
          draggable="false"
          title="显示主搜索窗口"
          @click="showMainWindow"
        />
        <span class="header-text">超级面板</span>
        <div class="header-spacer" />
        <div
          class="header-menu-btn"
          :class="{ 'window-match-blink': windowMatchBlink }"
          title="窗口匹配"
          @click="openWindowMatch"
          @animationend="windowMatchBlink = false"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect
              x="1"
              y="2"
              width="14"
              height="11"
              rx="1.5"
              stroke="currentColor"
              stroke-width="1.3"
              fill="none"
            />
            <rect x="1" y="2" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.3" />
            <circle cx="3" cy="3.5" r="0.7" fill="currentColor" />
            <circle cx="5" cy="3.5" r="0.7" fill="currentColor" />
          </svg>
        </div>
      </div>

      <!-- 固定列表：使用 Draggable 组件 -->
      <Draggable
        v-if="pinnedCommands.length > 0"
        v-model="pinnedCommands"
        class="pinned-grid"
        :item-key="(item: any) => getItemKey(item)"
        :animation="200"
        :move="onDragMove"
        :swap-threshold="0.65"
        :inverted-swap-threshold="0.65"
        ghost-class="ghost"
        chosen-class="chosen"
        @start="onDragStart"
        @end="onDragEnd"
      >
        <template #item="{ element: cmd, index }">
          <div
            class="grid-item"
            :data-item-key="getItemKey(cmd)"
            :class="{
              selected: index === selectedIndex
            }"
            style="cursor: move"
            @click="isFolder(cmd) ? openFolderPopup(cmd, index) : launch(cmd)"
            @mouseenter="!isDragging && (selectedIndex = index)"
            @contextmenu.prevent="handleContextMenu(cmd)"
          >
            <!-- 文件夹图标：2x2 宫格 -->
            <template v-if="isFolder(cmd)">
              <div class="folder-icon">
                <template v-for="i in 4" :key="i">
                  <img
                    v-if="cmd.items[i - 1]?.icon && !iconErrors.has(getItemKey(cmd.items[i - 1]))"
                    :src="cmd.items[i - 1].icon"
                    class="folder-thumb"
                    draggable="false"
                    @error="iconErrors.add(getItemKey(cmd.items[i - 1]))"
                  />
                  <div v-else-if="cmd.items[i - 1]" class="folder-thumb-placeholder">
                    {{ cmd.items[i - 1].name.charAt(0).toUpperCase() }}
                  </div>
                  <div v-else class="folder-thumb-empty" />
                </template>
              </div>
              <span class="grid-name">{{ cmd.name }}</span>
            </template>
            <!-- 普通指令图标 -->
            <template v-else>
              <img
                v-if="cmd.icon && !iconErrors.has(getItemKey(cmd))"
                :src="cmd.icon"
                class="grid-icon"
                draggable="false"
                @error="iconErrors.add(getItemKey(cmd))"
              />
              <div v-else class="grid-icon-placeholder">
                {{ cmd.name.charAt(0).toUpperCase() }}
              </div>
              <span class="grid-name">{{ cmd.name }}</span>
            </template>
          </div>
        </template>
      </Draggable>
      <!-- 空状态 -->
      <div v-if="pinnedCommands.length === 0" class="empty-state">
        <span class="empty-text">暂无固定项目</span>
      </div>
    </template>

    <!-- 列表模式：有搜索结果 -->
    <template v-else-if="mode === 'search'">
      <!-- 头部：剪贴板内容描述 -->
      <div class="search-header">
        <div class="header-menu-btn" title="返回固定列表" @click="showPinned">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="3.5" cy="3.5" r="1.5" fill="currentColor" />
            <circle cx="9" cy="3.5" r="1.5" fill="currentColor" />
            <circle cx="14.5" cy="3.5" r="1.5" fill="currentColor" />
            <circle cx="3.5" cy="9" r="1.5" fill="currentColor" />
            <circle cx="9" cy="9" r="1.5" fill="currentColor" />
            <circle cx="14.5" cy="9" r="1.5" fill="currentColor" />
            <circle cx="3.5" cy="14.5" r="1.5" fill="currentColor" />
            <circle cx="9" cy="14.5" r="1.5" fill="currentColor" />
            <circle cx="14.5" cy="14.5" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <span class="header-text">{{ clipboardDescription }}</span>
        <div class="header-spacer" />
        <div
          class="header-menu-btn"
          :class="{ 'window-match-blink': windowMatchBlink }"
          title="窗口匹配"
          @click="openWindowMatch"
          @animationend="windowMatchBlink = false"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect
              x="1"
              y="2"
              width="14"
              height="11"
              rx="1.5"
              stroke="currentColor"
              stroke-width="1.3"
              fill="none"
            />
            <rect x="1" y="2" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.3" />
            <circle cx="3" cy="3.5" r="0.7" fill="currentColor" />
            <circle cx="5" cy="3.5" r="0.7" fill="currentColor" />
          </svg>
        </div>
      </div>

      <!-- 翻译结果 -->
      <div v-if="translationText" class="translation-bar">
        <span class="translation-label">译</span>
        <span class="translation-text">{{ translationText }}</span>
      </div>

      <!-- 搜索结果列表 -->
      <div class="search-list">
        <div
          v-for="(item, index) in displayItems"
          :key="
            '__aiFormat' in item
              ? '__ai_format__'
              : `${(item as CommandItem).name}|${(item as CommandItem).path}-${(item as CommandItem).featureCode || ''}`
          "
          class="list-item"
          :class="{ selected: index === selectedIndex }"
          @click="'__aiFormat' in item ? requestAiFormat() : launch(item as CommandItem)"
          @mouseenter="selectedIndex = index"
        >
          <!-- AI 格式化项 -->
          <template v-if="'__aiFormat' in item">
            <div class="md-format-icon">
              <svg
                v-if="aiFormatLoading"
                class="spin-icon"
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
              >
                <circle
                  cx="6.5"
                  cy="6.5"
                  r="5"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-dasharray="14 7"
                />
              </svg>
              <span v-else class="md-format-icon-text">MD</span>
            </div>
            <div class="list-info">
              <span class="list-name">
                <template v-if="aiFormatLoading">格式化中…</template>
                <template v-else-if="aiFormatDone">✓ 已格式化，可直接粘贴</template>
                <template v-else-if="aiFormatError">{{ aiFormatError }}</template>
                <template v-else>格式化为 Markdown</template>
              </span>
              <span v-if="!aiFormatDone && !aiFormatError && !aiFormatLoading" class="list-desc"
                >使用 AI 整理为规范 Markdown 格式</span
              >
            </div>
          </template>
          <!-- 普通搜索结果项 -->
          <template v-else>
            <img
              v-if="(item as CommandItem).icon && !iconErrors.has(getItemKey(item as CommandItem))"
              :src="(item as CommandItem).icon"
              class="list-icon"
              draggable="false"
              @error="iconErrors.add(getItemKey(item as CommandItem))"
            />
            <div v-else class="list-icon-placeholder">
              {{ (item as CommandItem).name.charAt(0).toUpperCase() }}
            </div>
            <div class="list-info">
              <span class="list-name">{{ (item as CommandItem).name }}</span>
              <span v-if="(item as CommandItem).pluginExplain" class="list-desc">{{
                (item as CommandItem).pluginExplain
              }}</span>
            </div>
          </template>
        </div>
        <!-- 空状态 -->
        <div
          v-if="searchResults.length === 0 && !currentClipboardContent?.text"
          class="empty-state"
        >
          <span class="empty-text">无匹配结果</span>
        </div>
      </div>
    </template>

    <!-- 加载中 -->
    <div v-else class="loading-state">
      <span class="loading-text">加载中...</span>
    </div>

    <!-- 底部工具栏 -->
    <div v-if="mode !== 'loading'" class="panel-footer">
      <div class="footer-spacer" />
      <div
        class="header-menu-btn"
        :class="{ 'btn-disabled': !currentWindowInfo }"
        :title="currentWindowInfo ? `屏蔽 ${currentWindowInfo.app} 弹出面板` : '屏蔽面板弹出'"
        @click="addBlockedApp"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3" fill="none" />
          <line
            x1="3.4"
            y1="12.6"
            x2="12.6"
            y2="3.4"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
          />
        </svg>
      </div>
    </div>

    <!-- 文件夹弹窗 - 覆盖式 -->
    <Transition name="slide-up">
      <div v-if="showFolderPopup && currentFolder" class="folder-popup-overlay">
        <div class="folder-popup-backdrop" @click="closeFolderPopup" />
        <div class="folder-popup-panel">
          <div class="folder-popup-header">
            <span
              v-if="!isRenamingFolder"
              class="folder-popup-title clickable"
              @click="startRenameFolder"
            >
              {{ currentFolder.name }}
            </span>
            <input
              v-else
              ref="folderNameInputRef"
              v-model="folderNameInput"
              class="folder-rename-input"
              maxlength="20"
              @blur="confirmRenameFolder"
              @keydown.enter="confirmRenameFolder"
              @keydown.escape.stop="cancelRenameFolder"
            />
            <div class="header-menu-btn" title="关闭" @click="closeFolderPopup">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 3l8 8M11 3l-8 8"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </div>
          </div>
          <draggable
            v-if="currentFolder"
            v-model="currentFolder.items"
            class="folder-popup-grid"
            :item-key="(item: any) => getItemKey(item)"
            :animation="200"
            ghost-class="ghost"
            chosen-class="chosen"
            @end="savePinnedCommands"
          >
            <template #item="{ element: cmd, index: idx }">
              <div
                class="grid-item"
                style="cursor: move"
                @click="launchFromFolder(cmd)"
                @contextmenu.prevent="handleFolderItemContextMenu(cmd, idx)"
              >
                <img
                  v-if="cmd.icon && !iconErrors.has(getItemKey(cmd))"
                  :src="cmd.icon"
                  class="grid-icon"
                  draggable="false"
                  @error="iconErrors.add(getItemKey(cmd))"
                />
                <div v-else class="grid-icon-placeholder">
                  {{ cmd.name.charAt(0).toUpperCase() }}
                </div>
                <span class="grid-name">{{ cmd.name }}</span>
              </div>
            </template>
          </draggable>
        </div>
      </div>
    </Transition>

    <!-- 窗口匹配底部滑出面板 -->
    <Transition name="slide-up">
      <div v-if="showWindowMatch" class="window-match-overlay">
        <div class="window-match-backdrop" @click="closeWindowMatch" />
        <div class="window-match-panel">
          <div class="window-match-header">
            <span class="window-match-title">窗口匹配</span>
            <div class="header-menu-btn" title="关闭" @click="closeWindowMatch">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 3l8 8M11 3l-8 8"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </div>
          </div>
          <div class="window-match-list">
            <div
              v-for="(item, index) in windowMatchResults"
              :key="`wm-${item.path}-${item.featureCode || ''}`"
              class="list-item"
              :class="{ selected: index === windowMatchSelectedIndex }"
              @click="launchWindowMatch(item)"
              @mouseenter="windowMatchSelectedIndex = index"
            >
              <img
                v-if="item.icon && !iconErrors.has(getItemKey(item))"
                :src="item.icon"
                class="list-icon"
                draggable="false"
                @error="iconErrors.add(getItemKey(item))"
              />
              <div v-else class="list-icon-placeholder">
                {{ item.name.charAt(0).toUpperCase() }}
              </div>
              <div class="list-info">
                <span class="list-name">{{ item.name }}</span>
                <span v-if="item.pluginExplain" class="list-desc">{{ item.pluginExplain }}</span>
              </div>
            </div>
            <div v-if="windowMatchResults.length === 0" class="empty-state window-match-empty">
              <span class="empty-text">无匹配结果</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import Draggable from 'vuedraggable'
import defaultAvatar from '../assets/image/default.png'

interface CommandItem {
  name: string
  path: string
  icon?: string
  type?: string
  subType?: string
  featureCode?: string
  pluginName?: string
  pluginExplain?: string
  cmdType?: string
  param?: any
}

interface FolderItem {
  isFolder: true
  id: string
  name: string
  items: CommandItem[]
}

type GridItem = CommandItem | FolderItem

function isFolder(item: GridItem): item is FolderItem {
  return 'isFolder' in item && (item as FolderItem).isFolder === true
}

function generateFolderId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** 兼容旧数据：给没有 id 的文件夹补上 */
function ensureFolderIds(items: GridItem[]): void {
  for (const item of items) {
    if (isFolder(item) && !item.id) {
      item.id = generateFolderId()
    }
  }
}

interface ClipboardContent {
  type: 'text' | 'image' | 'file'
  text?: string
  image?: string
  files?: Array<{ path: string; name: string; isDirectory: boolean }>
}

const mode = ref<'pinned' | 'search' | 'loading'>('loading')
const pinnedCommands = ref<GridItem[]>([])
const searchResults = ref<CommandItem[]>([])
const selectedIndex = ref(0)

type AiFormatItem = { __aiFormat: true }
const AI_FORMAT_ITEM: AiFormatItem = { __aiFormat: true }
const aiFormatFeatureEnabled = ref(false)
const displayItems = computed<(CommandItem | AiFormatItem)[]>(() => {
  if (
    aiFormatFeatureEnabled.value &&
    currentClipboardContent.value?.type === 'text' &&
    currentClipboardContent.value.text
  ) {
    return [AI_FORMAT_ITEM, ...searchResults.value]
  }
  return searchResults.value
})
const iconErrors = ref<Set<string>>(new Set())
// 保存当前的剪贴板内容（由搜索结果携带）
const currentClipboardContent = ref<ClipboardContent | null>(null)
// 翻译结果
const translationText = ref('')
const pendingTranslation = ref<{ text: string; sourceText?: string } | null>(null)
// AI 整理状态
const aiFormatLoading = ref(false)
const aiFormatDone = ref(false)
const aiFormatError = ref('')
let aiFormatResetTimer: ReturnType<typeof setTimeout> | null = null
// 头像（默认使用内置头像）
const avatar = ref(defaultAvatar)
const acrylicLightOpacity = ref(78)
const acrylicDarkOpacity = ref(50)
const primaryColor = ref('blue')
const customColor = ref('#db2777')
// 窗口匹配相关状态
const showWindowMatch = ref(false)
const windowMatchResults = ref<CommandItem[]>([])
const windowMatchSelectedIndex = ref(0)
const currentWindowInfo = ref<{ app?: string; title?: string } | null>(null)
// 窗口匹配图标闪动
const windowMatchBlink = ref(false)

// 文件夹弹窗相关状态
const showFolderPopup = ref(false)
const currentFolder = ref<FolderItem | null>(null)
const currentFolderIndex = ref(-1)
const isRenamingFolder = ref(false)
const folderNameInput = ref('')
const folderNameInputRef = ref<HTMLInputElement | null>(null)

// 拖拽排序相关状态
const isDragging = ref(false)
const dragItemKey = ref('') // 被拖拽项的 key（身份标识）
const dragSnapshot = ref<GridItem[]>([])
const dragItemIsFolder = ref(false) // 被拖拽项是否是文件夹

// 同步翻译
function syncTranslationForClipboardContent(content: ClipboardContent | null): void {
  if (content?.type !== 'text' || !content.text) {
    translationText.value = ''
    return
  }

  if (pendingTranslation.value?.sourceText === content.text) {
    translationText.value = pendingTranslation.value.text
    return
  }

  translationText.value = ''
}

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
  return isDark ? '#38bdf8' : '#0284c7'
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

function applyAcrylicOverlay(): void {
  const existingStyle = document.getElementById('acrylic-overlay-style')
  if (existingStyle) {
    existingStyle.remove()
  }

  const material = document.documentElement.getAttribute('data-material')

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

// 剪贴板内容描述
const clipboardDescription = computed(() => {
  const content = currentClipboardContent.value
  if (!content) return ''

  if (content.type === 'text' && content.text) {
    return `选中的文本 ${content.text.length} 个`
  } else if (content.type === 'image') {
    return '选中的图片'
  } else if (content.type === 'file' && content.files) {
    return `选中的文件 ${content.files.length} 个`
  }
  return ''
})

// 保存固定列表
async function savePinnedCommands(): Promise<void> {
  try {
    const plainCommands = JSON.parse(JSON.stringify(pinnedCommands.value))
    await window.ztools.updateSuperPanelPinnedOrder(plainCommands)
  } catch (error) {
    console.error('保存固定列表顺序失败:', error)
  }
}

// 拖动排序结束后保存顺序
async function onDragEnd(): Promise<void> {
  isDragging.value = false
  dragItemKey.value = ''
  dragItemIsFolder.value = false
  dragSnapshot.value = []

  savePinnedCommands()
}

// 添加到已有文件夹
function addToFolder(folderIndex: number, draggedIndex: number): void {
  const folder = pinnedCommands.value[folderIndex]
  if (!isFolder(folder)) return

  const dragged = pinnedCommands.value[draggedIndex]
  if (isFolder(dragged)) return

  folder.items.push(dragged as CommandItem)
  pinnedCommands.value.splice(draggedIndex, 1)
  savePinnedCommands()
}

// 移出文件夹
function moveOutOfFolder(folderIndex: number, itemIndex: number): void {
  const folder = pinnedCommands.value[folderIndex]
  if (!isFolder(folder)) return

  const item = folder.items.splice(itemIndex, 1)[0]
  pinnedCommands.value.splice(folderIndex + 1, 0, item)

  // 文件夹只剩 1 个指令时自动解散
  if (folder.items.length <= 1) {
    const lastItem = folder.items[0]
    pinnedCommands.value.splice(folderIndex, 1, ...(lastItem ? [lastItem] : []))
    closeFolderPopup()
  } else if (showFolderPopup.value && currentFolder.value) {
    // 更新弹窗中的文件夹引用
    currentFolder.value = folder
  }

  savePinnedCommands()
}

// 从文件夹中取消固定
function unpinFromFolder(folderIndex: number, itemIndex: number): void {
  const folder = pinnedCommands.value[folderIndex]
  if (!isFolder(folder)) return

  folder.items.splice(itemIndex, 1)

  if (folder.items.length <= 1) {
    const lastItem = folder.items[0]
    pinnedCommands.value.splice(folderIndex, 1, ...(lastItem ? [lastItem] : []))
    closeFolderPopup()
  } else if (showFolderPopup.value && currentFolder.value) {
    currentFolder.value = folder
  }

  savePinnedCommands()
}

// 解散文件夹（将内容展开到原位置）
function ungroupFolder(folderIndex: number): void {
  const folder = pinnedCommands.value[folderIndex]
  if (!isFolder(folder)) return

  pinnedCommands.value.splice(folderIndex, 1, ...folder.items)
  savePinnedCommands()
}

// 删除文件夹（连同内容一起删除）
function deleteFolder(folderIndex: number): void {
  const folder = pinnedCommands.value[folderIndex]
  if (!isFolder(folder)) return

  pinnedCommands.value.splice(folderIndex, 1)
  savePinnedCommands()
}

// 右键菜单
async function handleContextMenu(cmd: GridItem): Promise<void> {
  if (isFolder(cmd)) {
    const folderIndex = pinnedCommands.value.indexOf(cmd)
    const menuItems = [
      { id: `rename-folder:${folderIndex}`, label: '重命名文件夹' },
      { id: `ungroup-folder:${folderIndex}`, label: '解散文件夹' },
      { id: `delete-folder:${folderIndex}`, label: '删除文件夹' }
    ]
    await window.ztools.showContextMenu(menuItems)
  } else {
    const itemIndex = pinnedCommands.value.indexOf(cmd)

    // 查找当前可用的文件夹列表
    const folderOptions = pinnedCommands.value
      .map((item, idx) => (isFolder(item) ? { idx, name: item.name } : null))
      .filter(Boolean) as { idx: number; name: string }[]

    // 构建子菜单添加至文件夹
    const addToFolderMenu = folderOptions.map((f) => ({
      id: `add-to-folder:${itemIndex}:${f.idx}`,
      label: f.name
    }))

    addToFolderMenu.push({ id: `new-folder-with:${itemIndex}`, label: '新建文件夹' })

    const menuItems = [
      {
        id: 'add-folder-group',
        label: '添加到文件夹',
        submenu: addToFolderMenu
      },
      {
        id: `unpin:${JSON.stringify({ path: cmd.path, featureCode: cmd.featureCode })}`,
        label: '取消固定'
      }
    ]
    await window.ztools.showContextMenu(menuItems)
  }
}

// ========== 文件夹弹窗 ==========
function openFolderPopup(folder: FolderItem, index: number): void {
  currentFolder.value = folder
  currentFolderIndex.value = index
  showFolderPopup.value = true
  isRenamingFolder.value = false
}

function closeFolderPopup(): void {
  showFolderPopup.value = false
  currentFolder.value = null
  currentFolderIndex.value = -1
  isRenamingFolder.value = false
}

function launchFromFolder(cmd: CommandItem): void {
  closeFolderPopup()
  launch(cmd)
}

// ========== 文件夹重命名 ==========
function startRenameFolder(): void {
  if (!currentFolder.value) return
  isRenamingFolder.value = true
  folderNameInput.value = currentFolder.value.name
  setTimeout(() => {
    folderNameInputRef.value?.focus()
    folderNameInputRef.value?.select()
  }, 200)
}

function confirmRenameFolder(): void {
  if (!currentFolder.value || !isRenamingFolder.value) return
  const newName = folderNameInput.value.trim()
  if (newName && newName !== currentFolder.value.name) {
    currentFolder.value.name = newName
    savePinnedCommands()
  }
  isRenamingFolder.value = false
}

function cancelRenameFolder(): void {
  isRenamingFolder.value = false
}

// ========== 文件夹弹窗内右键菜单 ==========
async function handleFolderItemContextMenu(
  _cmd: CommandItem,
  indexInFolder: number
): Promise<void> {
  const menuItems = [
    {
      id: `move-out:${currentFolderIndex.value}:${indexInFolder}`,
      label: '移出文件夹'
    },
    {
      id: `unpin-from-folder:${currentFolderIndex.value}:${indexInFolder}`,
      label: '取消固定'
    }
  ]
  await window.ztools.showContextMenu(menuItems)
}

function onDragStart(evt: any): void {
  isDragging.value = true
  const idx = evt.oldIndex ?? -1
  const item = pinnedCommands.value[idx]
  dragItemKey.value = item ? getItemKey(item) : ''
  dragItemIsFolder.value = item ? isFolder(item) : false
  dragSnapshot.value = JSON.parse(JSON.stringify(pinnedCommands.value))
}

/**
 * vuedraggable 的 move 回调。
 */
function onDragMove(): boolean | void {
  if (!isDragging.value || dragItemIsFolder.value) return
}

// 返回固定列表
function showPinned(): void {
  window.ztools.superPanelShowPinned()
}

// 点击头像：隐藏超级面板，显示主搜索窗口
function showMainWindow(): void {
  window.ztools.superPanelShowMainWindow()
}

// 添加当前窗口到屏蔽列表
async function addBlockedApp(): Promise<void> {
  if (!currentWindowInfo.value) return
  await window.ztools.superPanelAddBlockedApp()
}

// 打开窗口匹配面板
function openWindowMatch(): void {
  showWindowMatch.value = true
  windowMatchBlink.value = false
  windowMatchSelectedIndex.value = 0
  // 如果已有结果（自动搜索过），直接使用；否则发起搜索
  if (windowMatchResults.value.length === 0 && currentWindowInfo.value) {
    window.ztools.superPanelSearchWindowCommands(
      JSON.parse(JSON.stringify(currentWindowInfo.value))
    )
  }
}

// 关闭窗口匹配面板
function closeWindowMatch(): void {
  showWindowMatch.value = false
}

// 从窗口匹配面板启动指令
async function launchWindowMatch(cmd: CommandItem): Promise<void> {
  closeWindowMatch()
  await launch(cmd)
}

function getItemKey(item: GridItem): string {
  if (isFolder(item)) {
    return `folder-${item.id}`
  }
  return `${item.path}-${item.featureCode || ''}-${item.name}`
}

function resetAiFormatState(): void {
  if (aiFormatResetTimer !== null) {
    clearTimeout(aiFormatResetTimer)
    aiFormatResetTimer = null
  }
  aiFormatLoading.value = false
  aiFormatDone.value = false
  aiFormatError.value = ''
}

function scheduleAiFormatReset(): void {
  if (aiFormatResetTimer !== null) clearTimeout(aiFormatResetTimer)
  aiFormatResetTimer = setTimeout(() => {
    aiFormatDone.value = false
    aiFormatError.value = ''
    aiFormatResetTimer = null
  }, 3000)
}

async function requestAiFormat(): Promise<void> {
  const text = currentClipboardContent.value?.text
  if (!text || aiFormatLoading.value || aiFormatDone.value) return

  aiFormatLoading.value = true
  aiFormatError.value = ''

  try {
    const result = await window.ztools.superPanelAiFormat(text)
    if (result.success && result.text) {
      await window.ztools.copyToClipboard(result.text)
      aiFormatDone.value = true
      if (currentClipboardContent.value) {
        currentClipboardContent.value = { ...currentClipboardContent.value, text: result.text }
      }
    } else {
      aiFormatError.value = result.error || 'AI 整理失败'
    }
  } catch (e: unknown) {
    aiFormatError.value = e instanceof Error ? e.message : 'AI 整理失败'
  } finally {
    aiFormatLoading.value = false
    scheduleAiFormatReset()
  }
}

// 获取当前显示的列表
function getCurrentList(): (GridItem | CommandItem | AiFormatItem)[] {
  return mode.value === 'pinned' ? pinnedCommands.value : displayItems.value
}

// 启动指令（携带剪贴板内容和窗口信息）
async function launch(cmd: CommandItem): Promise<void> {
  try {
    console.log('启动指令:', cmd, '剪贴板内容:', currentClipboardContent.value?.type)
    // 将命令和剪贴板内容一起发送给主进程，由主进程转发给主渲染进程处理
    const launchData = JSON.parse(
      JSON.stringify({
        ...cmd,
        clipboardContent: currentClipboardContent.value,
        windowInfo: currentWindowInfo.value
      })
    )
    await window.ztools.superPanelLaunch(launchData)
  } catch (error) {
    console.error('超级面板启动失败:', error)
  }
}

// 键盘导航
function handleKeydown(event: KeyboardEvent): void {
  const list = getCurrentList()
  if (list.length === 0) return

  if (mode.value === 'pinned') {
    // 宫格模式：3 列布局，支持上下左右
    const cols = 3
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        if (selectedIndex.value >= cols) {
          selectedIndex.value -= cols
        }
        break
      case 'ArrowDown':
        event.preventDefault()
        if (selectedIndex.value + cols < list.length) {
          selectedIndex.value += cols
        }
        break
      case 'ArrowLeft':
        event.preventDefault()
        if (selectedIndex.value > 0) {
          selectedIndex.value--
        }
        break
      case 'ArrowRight':
        event.preventDefault()
        if (selectedIndex.value < list.length - 1) {
          selectedIndex.value++
        }
        break
      case 'Enter':
        event.preventDefault()
        {
          const item = list[selectedIndex.value]
          if (item && !('__aiFormat' in item) && isFolder(item)) {
            openFolderPopup(item, selectedIndex.value)
          } else if (item && !('__aiFormat' in item)) {
            launch(item as CommandItem)
          }
        }
        break
      case 'Escape':
        event.preventDefault()
        if (showFolderPopup.value) {
          closeFolderPopup()
        } else {
          window.close()
        }
        break
    }
  } else {
    // 列表模式：上下导航
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        if (selectedIndex.value > 0) {
          selectedIndex.value--
        }
        break
      case 'ArrowDown':
        event.preventDefault()
        if (selectedIndex.value < list.length - 1) {
          selectedIndex.value++
        }
        break
      case 'Enter':
        event.preventDefault()
        if (list[selectedIndex.value]) {
          const selected = list[selectedIndex.value]
          if ('__aiFormat' in selected) {
            requestAiFormat()
          } else {
            launch(selected as CommandItem)
          }
        }
        break
      case 'Escape':
        event.preventDefault()
        if (showFolderPopup.value) {
          closeFolderPopup()
        } else {
          window.close()
        }
        break
    }
  }

  // 确保选中项可见
  scrollToSelected()
}

// 滚动到选中项
function scrollToSelected(): void {
  const container = document.querySelector('.search-list') || document.querySelector('.pinned-grid')
  if (!container) return

  const selectedEl = container.querySelector('.selected') as HTMLElement
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

// 滚动到顶部
function scrollToTop(): void {
  nextTick(() => {
    const container =
      document.querySelector('.search-list') || document.querySelector('.pinned-grid')
    if (container) {
      container.scrollTop = 0
    }
  })
}

let cleanupContextMenuListener: (() => void) | null = null

onMounted(() => {
  // 监听超级面板数据（从主进程发送）
  window.ztools.onSuperPanelData((data) => {
    console.log(
      '[SuperPanel] 收到数据, type:',
      data.type,
      'count:',
      data.commands?.length || data.results?.length || 0
    )
    // 保存窗口信息
    if (data.windowInfo) {
      currentWindowInfo.value = data.windowInfo
    }
    // 收到新数据时关闭窗口匹配面板、重置闪动状态
    showWindowMatch.value = false
    windowMatchBlink.value = false
    windowMatchResults.value = []

    // 自动发起窗口匹配搜索（用于判断是否需要闪动图标）
    if (data.windowInfo) {
      window.ztools.superPanelSearchWindowCommands(JSON.parse(JSON.stringify(data.windowInfo)))
    }

    if (data.type === 'pinned') {
      mode.value = 'pinned'
      pinnedCommands.value = data.commands || []
      ensureFolderIds(pinnedCommands.value)
      selectedIndex.value = 0
      currentClipboardContent.value = null
      syncTranslationForClipboardContent(null)
      resetAiFormatState()
      scrollToTop()
    } else if (data.type === 'search') {
      mode.value = 'search'
      searchResults.value = data.results || []
      selectedIndex.value = 0
      // 保存搜索结果携带的剪贴板内容
      currentClipboardContent.value = data.clipboardContent || null
      syncTranslationForClipboardContent(currentClipboardContent.value)
      resetAiFormatState()
      scrollToTop()
    }
  })

  // 监听窗口匹配搜索结果
  window.ztools.onSuperPanelWindowCommandsData((data: { results: any[] }) => {
    windowMatchResults.value = data.results || []
    windowMatchSelectedIndex.value = 0
    // 有匹配结果且面板未打开时，触发图标闪动
    if (data.results?.length > 0 && !showWindowMatch.value) {
      windowMatchBlink.value = true
    }
  })

  // 加载设置（头像、亚克力透明度、主题色）
  window.ztools
    .dbGet('settings-general')
    .then((settings) => {
      if (settings?.avatar) {
        avatar.value = settings.avatar
      }
      if (settings) {
        aiFormatFeatureEnabled.value = settings.superPanelAiFormatEnabled ?? false
        acrylicLightOpacity.value = settings.acrylicLightOpacity ?? 78
        acrylicDarkOpacity.value = settings.acrylicDarkOpacity ?? 50
        if (settings.primaryColor) {
          primaryColor.value = settings.primaryColor
        }
        if (settings.customColor) {
          customColor.value = settings.customColor
        }
        applyPrimaryColor()
      }
    })
    .catch(() => {
      // ignore
    })

  // 初始化时获取当前窗口材质
  if (window.ztools?.getWindowMaterial) {
    window.ztools
      .getWindowMaterial()
      .then((material: string) => {
        document.documentElement.setAttribute('data-material', material)
        applyAcrylicOverlay()
      })
      .catch((err: Error) => {
        console.error('获取窗口材质失败:', err)
      })
  }

  // 监听窗口材质更新
  if (window.ztools?.onUpdateWindowMaterial) {
    window.ztools.onUpdateWindowMaterial((material: 'mica' | 'acrylic' | 'none') => {
      document.documentElement.setAttribute('data-material', material)
      applyAcrylicOverlay()
    })
  }

  // 监听亚克力透明度更新事件
  if (window.ztools?.onUpdateAcrylicOpacity) {
    window.ztools.onUpdateAcrylicOpacity((data: { lightOpacity: number; darkOpacity: number }) => {
      acrylicLightOpacity.value = data.lightOpacity
      acrylicDarkOpacity.value = data.darkOpacity
      applyAcrylicOverlay()
    })
  }

  // 监听主题色更新
  if (window.ztools?.onUpdatePrimaryColor) {
    window.ztools.onUpdatePrimaryColor((data: { primaryColor: string; customColor?: string }) => {
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
    applyAcrylicOverlay()
  })

  // 监听头像更新事件
  window.ztools.onUpdateAvatar((newAvatar: string) => {
    console.log('[SuperPanel] 收到头像更新:', newAvatar)
    avatar.value = newAvatar || defaultAvatar
  })

  // 监听翻译结果
  window.ztools.onSuperPanelTranslation((data: { text: string; sourceText?: string }) => {
    if (data.text) {
      pendingTranslation.value = data

      if (
        currentClipboardContent.value?.type === 'text' &&
        currentClipboardContent.value.text &&
        data.sourceText === currentClipboardContent.value.text
      ) {
        translationText.value = data.text
      }
    }
  })

  // 监听右键菜单命令
  cleanupContextMenuListener?.()
  cleanupContextMenuListener = window.ztools.onContextMenuCommand(async (command: string) => {
    console.log('[SuperPanel] 收到右键菜单命令:', command)
    if (command.startsWith('unpin:')) {
      const jsonStr = command.replace('unpin:', '')
      try {
        const { path, featureCode } = JSON.parse(jsonStr)
        console.log('[SuperPanel] 准备取消固定:', { path, featureCode })
        await window.ztools.unpinSuperPanelCommand(path, featureCode)
        console.log('[SuperPanel] 取消固定成功')
      } catch (error) {
        console.error('[SuperPanel] 取消固定失败:', error)
      }
    } else if (command.startsWith('rename-folder:')) {
      const folderIndex = parseInt(command.replace('rename-folder:', ''))
      const folder = pinnedCommands.value[folderIndex]
      if (folder && isFolder(folder)) {
        openFolderPopup(folder, folderIndex)
        nextTick(() => startRenameFolder())
      }
    } else if (command.startsWith('ungroup-folder:')) {
      const folderIndex = parseInt(command.replace('ungroup-folder:', ''))
      ungroupFolder(folderIndex)
    } else if (command.startsWith('delete-folder:')) {
      const folderIndex = parseInt(command.replace('delete-folder:', ''))
      deleteFolder(folderIndex)
    } else if (command.startsWith('move-out:')) {
      const parts = command.replace('move-out:', '').split(':')
      const folderIdx = parseInt(parts[0])
      const itemIdx = parseInt(parts[1])
      moveOutOfFolder(folderIdx, itemIdx)
    } else if (command.startsWith('unpin-from-folder:')) {
      const parts = command.replace('unpin-from-folder:', '').split(':')
      const folderIdx = parseInt(parts[0])
      const itemIdx = parseInt(parts[1])
      unpinFromFolder(folderIdx, itemIdx)
    } else if (command.startsWith('add-to-folder:')) {
      const parts = command.replace('add-to-folder:', '').split(':')
      const itemIdx = parseInt(parts[0])
      let folderIdx = parseInt(parts[1])
      // 注意：如果原下标在被拖入目标前面，拖出原元素后目标的下标会减一。但这里我们使用独立的逻辑直接处理：
      if (itemIdx >= 0 && folderIdx >= 0 && itemIdx !== folderIdx) {
        // 由于 addToFolder 会使用 splice 操作数组，先保留引用
        const draggedItem = pinnedCommands.value[itemIdx]
        const targetFolder = pinnedCommands.value[folderIdx]
        if (targetFolder && isFolder(targetFolder) && draggedItem && !isFolder(draggedItem)) {
          // 安全处理 addToFolder 逻辑
          addToFolder(folderIdx, itemIdx)
        }
      }
    } else if (command.startsWith('new-folder-with:')) {
      const itemIdx = parseInt(command.replace('new-folder-with:', ''))
      if (itemIdx >= 0 && itemIdx < pinnedCommands.value.length) {
        const item = pinnedCommands.value[itemIdx] as CommandItem
        if (!isFolder(item)) {
          const folder: FolderItem = {
            isFolder: true,
            id: generateFolderId(),
            name: '新文件夹',
            items: [item]
          }
          pinnedCommands.value.splice(itemIdx, 1, folder)
          savePinnedCommands()
          // 自动触发展开改名
          openFolderPopup(folder, itemIdx)
          nextTick(() => startRenameFolder())
        }
      }
    }
  })

  // 聚焦以接收键盘事件
  const panel = document.querySelector('.super-panel') as HTMLElement
  if (panel) {
    panel.setAttribute('tabindex', '0')
    panel.focus()
  }

  // 通知主进程窗口已准备好
  window.ztools.superPanelReady()
})

// 键盘焦点保持
function handleFocusOut(): void {
  // 重命名文件夹时不抢焦点，否则 input 无法输入
  if (isRenamingFolder.value) return
  const panel = document.querySelector('.super-panel') as HTMLElement
  if (panel) {
    panel.focus()
  }
}

onMounted(() => {
  document.addEventListener('focusout', handleFocusOut)
})

onUnmounted(() => {
  document.removeEventListener('focusout', handleFocusOut)
  cleanupContextMenuListener?.()
  cleanupContextMenuListener = null
  if (aiFormatResetTimer !== null) clearTimeout(aiFormatResetTimer)
})
</script>

<style scoped>
.super-panel {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  border-radius: 10px;
  overflow: hidden;
  outline: none;
  user-select: none;
}

/* ========== 头部 ========== */
.search-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.header-menu-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.15s;
  flex-shrink: 0;
}

.header-menu-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.header-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.clickable {
  cursor: pointer;
  transition: opacity 0.15s;
}

.clickable:hover {
  opacity: 0.7;
}

.header-avatar-placeholder {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-primary);
  font-size: 14px;
  font-weight: bold;
  flex-shrink: 0;
}

.header-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 宫格模式 ========== */
.pinned-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-content: start;
  gap: 2px;
  padding: 8px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 4px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s;
  overflow: hidden;
  min-height: 80px;
  height: fit-content;
}

.grid-item:hover,
.grid-item.selected {
  background: var(--hover-bg);
}

.grid-item.selected {
  background: var(--active-bg);
}

.grid-icon {
  width: 36px;
  height: 36px;
  margin-bottom: 6px;
  border-radius: 8px;
  flex-shrink: 0;
  object-fit: contain;
}

.grid-icon-placeholder {
  width: 36px;
  height: 36px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: var(--primary-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-primary);
  font-size: 16px;
  font-weight: bold;
  flex-shrink: 0;
}

.grid-name {
  font-size: 11px;
  font-weight: 500;
  pointer-events: none; /* 防止拖动时文字阻碍拖动 */
  line-height: 14px;
  color: var(--text-color);
  text-align: center;
  width: 100%;
  padding: 0 2px;
  min-height: 28px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
  flex-shrink: 0;
}

/* 拖动时的样式 */
.ghost {
  opacity: 0.5;
  background: var(--border-color);
}

.chosen {
  opacity: 0.8;
}

/* 防止拖动时图标和文字阻碍拖动 */
:deep(.ghost .grid-icon),
:deep(.ghost .grid-icon-placeholder),
:deep(.ghost .grid-name),
:deep(.chosen .grid-icon),
:deep(.chosen .grid-icon-placeholder),
:deep(.chosen .grid-name) {
  pointer-events: none;
}

/* ========== 翻译结果 ========== */
.translation-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--divider-color);
  flex-shrink: 0;
  min-height: 0;
}

.translation-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-on-primary);
  background: var(--primary-color);
  border-radius: 3px;
  padding: 1px 4px;
  flex-shrink: 0;
  line-height: 14px;
}

.translation-text {
  font-size: 12px;
  color: var(--text-color);
  line-height: 16px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  word-break: break-all;
}

.md-format-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1.5px solid var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.md-format-icon-text {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: -0.3px;
  line-height: 1;
}

.spin-icon {
  animation: spin 1s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ========== 列表模式 ========== */
.search-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px;
  overflow-y: auto;
  flex: 1;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s;
  flex-shrink: 0;
}

.list-item:hover,
.list-item.selected {
  background: var(--hover-bg);
}

.list-item.selected {
  background: var(--active-bg);
}

.list-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  flex-shrink: 0;
  object-fit: contain;
}

.list-icon-placeholder {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--primary-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-primary);
  font-size: 13px;
  font-weight: bold;
  flex-shrink: 0;
}

.list-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.list-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-desc {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 空状态和加载状态 ========== */
.empty-state,
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 100px;
  grid-column: 1 / -1;
}

.empty-text,
.loading-text {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ========== 标题栏间距 ========== */
.header-spacer {
  flex: 1;
}

/* ========== 底部工具栏 ========== */
.panel-footer {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  border-top: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.footer-spacer {
  flex: 1;
}

.btn-disabled {
  opacity: 0.3;
  pointer-events: none;
}

/* ========== 窗口匹配底部滑出面板 ========== */
.window-match-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
  border-radius: 10px;
}

.window-match-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
}

.window-match-panel {
  position: relative;
  z-index: 1;
  background: #f4f4f4;
  border-top: 1px solid var(--divider-color);
  border-radius: 12px 12px 0 0;
  max-height: 75%;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.1);
}

@media (prefers-color-scheme: dark) {
  .window-match-panel {
    background: #303133;
  }
}

.window-match-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.window-match-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.window-match-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.window-match-empty {
  min-height: 60px;
}

/* ========== 滑出动画 ========== */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: opacity 0.2s ease;
}

.slide-up-enter-active .window-match-panel,
.slide-up-leave-active .window-match-panel {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
}

.slide-up-enter-from .window-match-panel,
.slide-up-leave-to .window-match-panel {
  transform: translateY(100%);
}
/* ========== 文件夹图标 ========== */
.folder-icon {
  width: 36px;
  height: 36px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: var(--control-bg, rgba(0, 0, 0, 0.05));
  border: 1.5px solid var(--control-border, rgba(0, 0, 0, 0.08));
  padding: 3px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  flex-shrink: 0;
  overflow: hidden;
}

.folder-thumb {
  width: 100%;
  height: 100%;
  border-radius: 2px;
  object-fit: contain;
}

.folder-thumb-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 2px;
  background: var(--primary-color, #0284c7);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 7px;
  font-weight: bold;
}

.folder-thumb-empty {
  width: 100%;
  height: 100%;
}

/* ========== 拖拽合并预览 ========== */
/* ========== 文件夹弹窗 ========== */
.folder-popup-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
  border-radius: 10px;
}

.folder-popup-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
}

.folder-popup-panel {
  position: relative;
  z-index: 1;
  background: #f4f4f4;
  border-top: 1px solid var(--divider-color);
  border-radius: 12px 12px 0 0;
  max-height: 75%;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.1);
}

@media (prefers-color-scheme: dark) {
  .folder-popup-panel {
    background: #303133;
  }
}

.folder-popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.folder-popup-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}

.folder-popup-title:hover {
  background: var(--hover-bg);
}

.folder-rename-input {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  background: var(--control-bg, rgba(0, 0, 0, 0.05));
  border: 1px solid var(--primary-color, #0284c7);
  border-radius: 4px;
  padding: 2px 6px;
  outline: none;
  flex: 1;
  max-width: 160px;
}

.folder-popup-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  padding: 8px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

/* 文件夹弹窗共用 slide-up 过渡动画 */
.slide-up-enter-active .folder-popup-panel,
.slide-up-leave-active .folder-popup-panel {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from .folder-popup-panel,
.slide-up-leave-to .folder-popup-panel {
  transform: translateY(100%);
}

/* ========== 窗口匹配图标闪动 ========== */
.window-match-blink {
  animation: blink-highlight 0.5s ease-in-out 3;
  color: var(--primary-color);
}

@keyframes blink-highlight {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.15;
  }
}
</style>
