<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useToast, AdaptiveIcon } from '@/components'
import { weightedSearch } from '@/utils'
import { useJumpFunction, useZtoolsSubInput } from '@/composables'
import { LocalLaunchSettingJumpFunction } from '@/views/LocalLaunchSetting/LocalLaunchSetting'

const emit = defineEmits<{
  'pending-files-consumed': []
}>()

const { success, error, confirm } = useToast()

interface LocalShortcut {
  id: string
  name: string
  alias?: string
  path: string
  type: 'file' | 'folder' | 'app'
  icon?: string
  pinyin?: string
  pinyinAbbr?: string
  addedAt: number
}

const shortcuts = ref<LocalShortcut[]>([])
const loading = ref(true)
const isAdding = ref(false)
const isDeleting = ref(false)
const isDragging = ref(false)
// 防止并发消费待添加路径
const isConsumingPending = ref(false)

const { value: searchQuery } = useZtoolsSubInput('', '搜索本地启动项...')

const filteredShortcuts = computed(() =>
  weightedSearch(shortcuts.value, searchQuery.value || '', [
    { value: (s) => s.alias || s.name || '', weight: 10 },
    { value: (s) => s.path || '', weight: 5 }
  ])
)

// 别名编辑状态
const editingId = ref<string | null>(null)
const editingAlias = ref('')

// 加载本地启动项列表
async function loadShortcuts(): Promise<void> {
  try {
    const result = await window.ztools.internal.localShortcuts.getAll()
    shortcuts.value = result
  } catch (err) {
    console.error('加载本地启动项失败:', err)
    error('加载失败')
  } finally {
    loading.value = false
  }
}

// 添加项目
async function handleAdd(type: 'file' | 'folder'): Promise<void> {
  if (isAdding.value) return

  isAdding.value = true
  try {
    const result = await window.ztools.internal.localShortcuts.add(type)
    if (result.success) {
      success('添加成功')
      await loadShortcuts()
    } else if (result.error !== '用户取消选择') {
      error(result.error || '添加失败')
    }
  } catch (err) {
    console.error('添加失败:', err)
    error('添加失败')
  } finally {
    isAdding.value = false
  }
}

// 添加单个路径到本地启动（拖拽与主输入框复用）
async function addDroppedFile(filePath: string): Promise<void> {
  try {
    // 调用内部 API 按路径添加文件/文件夹/应用
    const result = await window.ztools.internal.localShortcuts.addByPath(filePath)
    if (result.success) {
      success('添加成功')
      await loadShortcuts()
    } else {
      error(result.error || '添加失败')
    }
  } catch (err) {
    console.error('添加失败:', err)
    error('添加失败')
  }
}

// 规范化待添加路径，去空、去重，避免重复触发
function normalizePendingFiles(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => path.trim()).filter((path) => Boolean(path))))
}

// 消费来自 onPluginEnter 的待添加路径，循环调用 addByPath
async function consumePendingFiles(paths: string[]): Promise<void> {
  if (isConsumingPending.value) {
    console.info('[LocalLaunchAdd] 正在消费上一批路径，跳过本次触发')
    return
  }

  const normalizedPaths = normalizePendingFiles(paths)
  if (normalizedPaths.length === 0) {
    emit('pending-files-consumed')
    return
  }

  isConsumingPending.value = true

  try {
    console.info('[LocalLaunchAdd] 开始消费待添加路径:', normalizedPaths)
    for (const filePath of normalizedPaths) {
      console.info('[LocalLaunchAdd] addByPath 入参:', filePath)
      await addDroppedFile(filePath)
    }
  } finally {
    isConsumingPending.value = false
    emit('pending-files-consumed')
    console.info('[LocalLaunchAdd] 本批路径消费完成')
  }
}

// 拖拽处理
function handleDragOver(e: DragEvent): void {
  e.preventDefault()
  isDragging.value = true
}

function handleDragLeave(e: DragEvent): void {
  // 检查是否真正离开了 scrollable-content 区域
  const target = e.currentTarget as HTMLElement
  const relatedTarget = e.relatedTarget as Node | null

  // 如果 relatedTarget 不在 target 内部，说明真正离开了拖拽区域
  if (!relatedTarget || !target.contains(relatedTarget)) {
    isDragging.value = false
  }
}

async function handleDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  isDragging.value = false

  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  // 获取文件路径（使用 Electron 的 webUtils）
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    try {
      const filePath = (window as any).ztools.getPathForFile(file)
      await addDroppedFile(filePath)
    } catch (err) {
      console.error('处理拖拽文件失败:', err)
      error('添加失败')
    }
  }
}

// 开始编辑别名
function startEdit(shortcut: LocalShortcut): void {
  editingId.value = shortcut.id
  editingAlias.value = shortcut.alias || ''
  // 下一帧聚焦输入框
  nextTick(() => {
    const inputs = document.querySelectorAll('.alias-input')
    const input = inputs[inputs.length - 1] as HTMLInputElement | null
    input?.focus()
    input?.select()
  })
}

// 取消编辑
function cancelEdit(): void {
  editingId.value = null
  editingAlias.value = ''
}

// 保存别名
async function saveAlias(shortcut: LocalShortcut): Promise<void> {
  if (editingId.value !== shortcut.id) return

  const newAlias = editingAlias.value.trim()
  const oldAlias = shortcut.alias || ''

  // 如果没有变化，直接取消编辑
  if (newAlias === oldAlias) {
    cancelEdit()
    return
  }

  try {
    const result = await window.ztools.internal.localShortcuts.updateAlias(shortcut.id, newAlias)
    if (result.success) {
      // 更新本地状态
      shortcut.alias = newAlias || undefined
      success(newAlias ? '别名已更新' : '别名已清除')
    } else {
      error(result.error || '更新别名失败')
    }
  } catch (err) {
    console.error('更新别名失败:', err)
    error('更新别名失败')
  } finally {
    cancelEdit()
  }
}

// 打开项目
async function handleOpen(shortcut: LocalShortcut): Promise<void> {
  try {
    const result = await window.ztools.internal.localShortcuts.open(shortcut.path)
    if (!result.success) {
      error(result.error || '打开失败')
    }
  } catch (err) {
    console.error('打开失败:', err)
    error('打开失败')
  }
}

// 删除项目
async function handleDelete(shortcut: LocalShortcut): Promise<void> {
  if (isDeleting.value) return

  // 确认删除
  const confirmed = await confirm({
    message: `确定要删除"${shortcut.name}"吗？`,
    type: 'warning'
  })
  if (!confirmed) {
    return
  }

  isDeleting.value = true
  try {
    const result = await window.ztools.internal.localShortcuts.delete(shortcut.id)
    if (result.success) {
      success('删除成功')
      await loadShortcuts()
    } else {
      error(result.error || '删除失败')
    }
  } catch (err) {
    console.error('删除失败:', err)
    error('删除失败')
  } finally {
    isDeleting.value = false
  }
}

//删除失效项目
async function handleInvalidItemDelete(): Promise<void> {
  if (isDeleting.value) return
  const confirmed = await confirm({
    message: '确定要清除所有失效的本地启动项吗？',
    type: 'warning'
  })
  if (!confirmed) return
  isDeleting.value = true
  try {
    const result = await window.ztools.internal.localShortcuts.deleteWhenNotExist()
    if (result.success) {
      success('删除成功')
    } else {
      error(result.error || '删除失败')
    }
  } catch (err) {
    console.error('删除失败:', err)
    error('删除失败')
  } finally {
    await loadShortcuts()
    isDeleting.value = false
  }
}

// 获取类型标签
function getTypeLabel(type: string): string {
  switch (type) {
    case 'file':
      return '文件'
    case 'folder':
      return '文件夹'
    case 'app':
      return '应用'
    default:
      return '未知'
  }
}

// 处理对应 ztools code 进来的功能
useJumpFunction<LocalLaunchSettingJumpFunction>((state) => {
  if (state.pendingFiles && state.pendingFiles.length > 0) {
    consumePendingFiles(state.pendingFiles)
  }
})
// 组件挂载时加载数据
onMounted(() => {
  loadShortcuts()
})
</script>
<template>
  <div class="content-panel">
    <!-- 拖拽蒙层 -->
    <div v-if="isDragging" class="drag-overlay">
      <div class="drag-overlay-content">
        <svg
          class="drag-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <div class="drag-text">释放以添加文件</div>
      </div>
    </div>

    <div
      v-show="true"
      class="scrollable-content"
      @dragover.prevent="handleDragOver"
      @dragleave="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <div class="panel-header">
        <div class="button-group">
          <button class="btn btn-primary" :disabled="isAdding" @click="handleAdd('file')">
            {{ isAdding ? '添加中...' : '添加文件' }}
          </button>
          <button class="btn btn-primary" :disabled="isAdding" @click="handleAdd('folder')">
            {{ isAdding ? '添加中...' : '添加文件夹' }}
          </button>
          <button class="btn btn-primary" :disabled="isDeleting" @click="handleInvalidItemDelete()">
            {{ isDeleting ? '删除中...' : '删除失效项' }}
          </button>
        </div>
      </div>

      <!-- 空状态提示 -->
      <div v-if="!loading && shortcuts.length === 0" class="empty-state">
        <svg
          class="empty-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
          ></path>
        </svg>
        <div class="empty-text">暂无本地启动项</div>
        <div class="empty-hint">拖拽文件、文件夹或应用到此处，或点击上方按钮添加</div>
      </div>

      <!-- 本地启动项列表 -->
      <div v-else class="shortcuts-list">
        <div
          v-for="shortcut in filteredShortcuts"
          :key="shortcut.id"
          class="card shortcut-item"
          :title="shortcut.path"
        >
          <AdaptiveIcon
            v-if="shortcut.icon"
            :src="shortcut.icon"
            class="shortcut-icon"
            alt="文件图标"
            draggable="false"
          />
          <div v-else class="shortcut-icon-placeholder">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                v-if="shortcut.type === 'folder'"
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              ></path>
              <path v-else-if="shortcut.type === 'app'" d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
              <path v-else d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
              <polyline v-if="shortcut.type === 'file'" points="13 2 13 9 20 9"></polyline>
            </svg>
          </div>

          <div class="shortcut-info">
            <!-- 编辑别名模式 -->
            <div v-if="editingId === shortcut.id" class="alias-edit-row">
              <input
                ref="aliasInputRef"
                v-model="editingAlias"
                type="text"
                class="input alias-input"
                placeholder="输入别名，留空则使用原名"
                @keyup.enter="saveAlias(shortcut)"
                @keyup.escape="cancelEdit"
                @blur="saveAlias(shortcut)"
              />
            </div>
            <!-- 正常显示模式 -->
            <template v-else>
              <div class="shortcut-name">
                {{ shortcut.alias || shortcut.name }}
                <span class="type-badge">{{ getTypeLabel(shortcut.type) }}</span>
              </div>
            </template>
            <div class="shortcut-path" :title="shortcut.path">{{ shortcut.path }}</div>
          </div>

          <div class="shortcut-actions">
            <button
              class="icon-btn alias-btn"
              :title="shortcut.alias ? '修改别名' : '设置别名'"
              @click.stop="startEdit(shortcut)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="icon-btn open-btn" title="打开" @click.stop="handleOpen(shortcut)">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
            <button
              class="icon-btn delete-btn"
              title="删除"
              :disabled="isDeleting"
              @click.stop="handleDelete(shortcut)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="3 6 5 6 21 6"></polyline>
                <path
                  d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                ></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-panel {
  position: relative; /* 重要：为 absolute 定位的子元素提供定位上下文 */
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 拖拽蒙层 */
.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 1000;
  background: var(--primary-light-bg);
  border: 3px dashed var(--primary-color);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.9;
  }
  50% {
    opacity: 0.7;
  }
}

.drag-overlay-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.drag-icon {
  color: var(--primary-color);
  animation: bounce 1s ease-in-out infinite;
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.drag-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--primary-color);
}

.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

.panel-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-bottom: 20px;
}

.button-group {
  display: flex;
  gap: 10px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  border: 2px dashed var(--control-border);
  border-radius: 12px;
  background: var(--card-bg);
}

.empty-icon {
  color: var(--text-secondary);
  opacity: 0.5;
  margin-bottom: 16px;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  max-width: 400px;
}

/* 本地启动项列表 */
.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: default;
  transition: all 0.2s;
}

.shortcut-item:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.shortcut-icon,
.shortcut-icon-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  margin-right: 12px;
  flex-shrink: 0;
}

.shortcut-icon {
  object-fit: cover;
}

.shortcut-icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  color: var(--text-secondary);
}

.shortcut-info {
  flex: 1;
  min-width: 0;
}

.shortcut-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-badge {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 2px 6px;
  background: var(--active-bg);
  border-radius: 4px;
  flex-shrink: 0;
}

.shortcut-path {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortcut-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 12px;
}

/* 图标按钮样式 */
.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  color: var(--text-secondary);
}

.icon-btn:hover {
  background: var(--control-bg);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.alias-btn {
  color: var(--text-secondary);
}

.alias-btn:hover {
  color: var(--primary-color);
  background: var(--primary-light-bg);
}

.open-btn:hover {
  color: var(--primary-color);
  background: var(--primary-light-bg);
}

.delete-btn:hover {
  color: var(--danger-color);
  background: var(--danger-light-bg);
}

/* 别名编辑 */
.alias-edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.alias-input {
  min-width: 0;
  flex: 1;
  padding: 4px 10px;
  font-size: 14px;
}
</style>
