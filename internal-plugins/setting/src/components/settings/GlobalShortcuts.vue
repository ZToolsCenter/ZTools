<template>
  <div class="content-panel">
    <!-- 可滚动内容区 -->
    <Transition name="list-slide">
      <div v-show="!showEditor" class="scrollable-content">
        <!-- 顶部添加按钮 -->
        <div class="panel-header">
          <button class="btn" @click="showAddEditor">添加快捷键</button>
        </div>

        <!-- 快捷键列表 -->
        <div class="shortcut-list">
          <div v-for="shortcut in shortcuts" :key="shortcut.id" class="card shortcut-item">
            <div class="shortcut-info">
              <div class="shortcut-key-display">{{ shortcut.shortcut }}</div>
              <div class="shortcut-desc">{{ shortcut.target }}</div>
            </div>

            <div class="shortcut-meta">
              <button
                class="icon-btn edit-btn"
                title="编辑"
                :disabled="isDeleting"
                @click="handleEdit(shortcut)"
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
              <button
                class="icon-btn delete-btn"
                title="删除"
                :disabled="isDeleting"
                @click="handleDelete(shortcut.id)"
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
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-if="shortcuts.length === 0" class="empty-state">
            <Icon name="keyboard" :size="64" class="empty-icon" />
            <div class="empty-text">暂无全局快捷键</div>
            <div class="empty-hint">点击"添加快捷键"来创建你的第一个全局快捷键</div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 快捷键编辑器覆盖面板组件 -->
    <Transition name="slide">
      <ShortcutEditor
        v-if="showEditor"
        :editing-shortcut="editingShortcut"
        @back="closeEditor"
        @save="handleSave"
      />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ShortcutEditor from './ShortcutEditor.vue'
import Icon from '../common/Icon.vue'
import { useToast } from '../../composables/useToast'

const { success, error, warning, info, confirm } = useToast()

interface GlobalShortcut {
  id: string
  shortcut: string
  target: string
  enabled: boolean
}

// 快捷键列表
const shortcuts = ref<GlobalShortcut[]>([])
const isDeleting = ref(false)

// 编辑器状态
const showEditor = ref(false)
const editingShortcut = ref<GlobalShortcut | null>(null) // 正在编辑的快捷键

// 加载快捷键列表
async function loadShortcuts(): Promise<void> {
  try {
    const data = await window.ztools.internal.dbGet('global-shortcuts')
    shortcuts.value = data || []
    console.log('加载全局快捷键:', shortcuts.value)
  } catch (error) {
    console.error('加载全局快捷键失败:', error)
  }
}

// 保存快捷键列表
async function saveShortcuts(): Promise<void> {
  try {
    await window.ztools.internal.dbPut(
      'global-shortcuts',
      JSON.parse(JSON.stringify(shortcuts.value))
    )
    console.log('保存全局快捷键成功')
  } catch (error) {
    console.error('保存全局快捷键失败:', error)
  }
}

// 显示添加编辑器
function showAddEditor(): void {
  editingShortcut.value = null
  showEditor.value = true
}

// 显示编辑编辑器
function handleEdit(shortcut: GlobalShortcut): void {
  editingShortcut.value = shortcut
  showEditor.value = true
}

// 关闭编辑器
function closeEditor(): void {
  showEditor.value = false
  editingShortcut.value = null
}

// 保存快捷键（添加或编辑）
async function handleSave(recordedShortcut: string, targetCommand: string): Promise<void> {
  if (!recordedShortcut || !targetCommand) {
    return
  }

  // 如果是编辑模式
  if (editingShortcut.value) {
    // 检查新快捷键是否与其他快捷键冲突（排除自己）
    const exists = shortcuts.value.some(
      (s) => s.id !== editingShortcut.value!.id && s.shortcut === recordedShortcut
    )
    if (exists) {
      warning('该快捷键已被其他指令占用，请使用其他快捷键')
      return
    }

    const oldShortcut = editingShortcut.value.shortcut

    try {
      // 如果快捷键改变了，需要先注销旧的
      if (oldShortcut !== recordedShortcut) {
        await window.ztools.internal.unregisterGlobalShortcut(oldShortcut)
      }

      // 注册新快捷键
      const result = await window.ztools.internal.registerGlobalShortcut(
        recordedShortcut,
        targetCommand
      )

      if (result.success) {
        // 更新列表
        const index = shortcuts.value.findIndex((s) => s.id === editingShortcut.value!.id)
        if (index >= 0) {
          shortcuts.value[index].shortcut = recordedShortcut
          shortcuts.value[index].target = targetCommand
        }

        // 保存到数据库
        await saveShortcuts()
        success('快捷键更新成功!')
        closeEditor()
      } else {
        // 注册失败，恢复旧快捷键
        if (oldShortcut !== recordedShortcut) {
          await window.ztools.internal.registerGlobalShortcut(
            oldShortcut,
            editingShortcut.value.target
          )
        }
        error(`快捷键注册失败: ${result.error}`)
      }
    } catch (err: any) {
      // 注册失败，恢复旧快捷键
      if (oldShortcut !== recordedShortcut) {
        await window.ztools.internal.registerGlobalShortcut(
          oldShortcut,
          editingShortcut.value.target
        )
      }
      console.error('更新快捷键失败:', err)
      error(`更新快捷键失败: ${err.message || '未知错误'}`)
    }
    return
  }

  // 添加模式：检查快捷键是否已存在
  const exists = shortcuts.value.some((s) => s.shortcut === recordedShortcut)
  if (exists) {
    warning('该快捷键已存在，请使用其他快捷键')
    return
  }

  // 添加到列表
  const newShortcut: GlobalShortcut = {
    id: Date.now().toString(),
    shortcut: recordedShortcut,
    target: targetCommand,
    enabled: true
  }

  shortcuts.value.push(newShortcut)

  // 保存到数据库
  await saveShortcuts()

  // 注册全局快捷键
  try {
    const result = await window.ztools.internal.registerGlobalShortcut(
      recordedShortcut,
      targetCommand
    )
    if (result.success) {
      success('快捷键添加成功!')
      closeEditor()
    } else {
      // 如果注册失败，从列表中移除
      shortcuts.value = shortcuts.value.filter((s) => s.id !== newShortcut.id)
      await saveShortcuts()
      error(`快捷键注册失败: ${result.error}`)
    }
  } catch (err: any) {
    // 如果注册失败，从列表中移除
    shortcuts.value = shortcuts.value.filter((s) => s.id !== newShortcut.id)
    await saveShortcuts()
    console.error('注册快捷键失败:', err)
    error(`注册快捷键失败: ${err.message || '未知错误'}`)
  }
}

// 删除快捷键
async function handleDelete(id: string): Promise<void> {
  const shortcut = shortcuts.value.find((s) => s.id === id)
  if (!shortcut) return

  const confirmed = await confirm({
    title: '删除快捷键',
    message: `确定要删除快捷键"${shortcut.shortcut}"吗？`,
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!confirmed) return

  isDeleting.value = true
  try {
    // 注销全局快捷键
    const result = await window.ztools.internal.unregisterGlobalShortcut(shortcut.shortcut)
    if (result.success) {
      // 从列表中移除
      shortcuts.value = shortcuts.value.filter((s) => s.id !== id)
      await saveShortcuts()
    } else {
      error(`快捷键删除失败: ${result.error}`)
    }
  } catch (err: any) {
    console.error('删除快捷键失败:', err)
    error(`删除快捷键失败: ${err.message || '未知错误'}`)
  } finally {
    isDeleting.value = false
  }
}

// 初始化
onMounted(() => {
  loadShortcuts()
})
</script>

<style scoped>
.content-panel {
  position: relative; /* 使详情面板能够覆盖该区域 */
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 防止滑动时出现滚动条 */
  background: var(--bg-color);
}

/* 可滚动内容区 */
.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}

/* 列表滑动动画 */
.list-slide-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.list-slide-leave-active {
  transition:
    transform 0.2s ease-in,
    opacity 0.15s ease;
}

.list-slide-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}

.list-slide-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

/* 顶部按钮 */
.panel-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 20px;
}

/* 快捷键列表 */
.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.shortcut-item:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.shortcut-info {
  flex: 1;
  min-width: 0;
}

.shortcut-key-display {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  font-family: monospace;
}

.shortcut-desc {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortcut-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 图标按钮颜色样式 */
.edit-btn {
  color: var(--primary-color);
}

.edit-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.delete-btn {
  color: var(--danger-color);
}

.delete-btn:hover:not(:disabled) {
  background: var(--danger-light-bg);
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.3;
  color: var(--text-secondary);
}

.empty-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
  color: var(--text-secondary);
}
</style>
