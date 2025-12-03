<template>
  <div class="content-panel">
    <!-- 顶部添加按钮 -->
    <div class="panel-header">
      <button class="add-btn" @click="showAddDialog">添加快捷键</button>
    </div>

    <!-- 快捷键列表 -->
    <div class="shortcut-list">
      <div v-for="shortcut in shortcuts" :key="shortcut.id" class="shortcut-item">
        <div class="shortcut-key">{{ shortcut.shortcut }}</div>
        <div class="shortcut-arrow">→</div>
        <div class="shortcut-target">{{ shortcut.target }}</div>
        <button class="edit-btn" :disabled="isDeleting" @click="handleEdit(shortcut)">编辑</button>
        <button class="delete-btn" :disabled="isDeleting" @click="handleDelete(shortcut.id)">
          删除
        </button>
      </div>

      <!-- 空状态 -->
      <div v-if="shortcuts.length === 0" class="empty-state">
        <div class="empty-icon">⌨️</div>
        <div class="empty-text">暂无全局快捷键</div>
        <div class="empty-hint">点击"添加快捷键"来创建你的第一个全局快捷键</div>
      </div>
    </div>

    <!-- 添加/编辑快捷键对话框 -->
    <div v-if="isDialogVisible" class="dialog-overlay" @click="closeDialog">
      <div class="dialog-content" @click.stop>
        <h3 class="dialog-title">{{ editingShortcut ? '编辑全局快捷键' : '添加全局快捷键' }}</h3>

        <div class="dialog-body">
          <!-- 快捷键录制 -->
          <div class="form-item">
            <label class="form-label">快捷键</label>
            <div class="hotkey-input" :class="{ recording: isRecording }" @click="startRecording">
              {{ displayHotkey }}
            </div>
            <span class="form-hint">点击上方输入框录制快捷键</span>
          </div>

          <!-- 目标指令输入 -->
          <div class="form-item">
            <label class="form-label">目标指令</label>
            <input
              v-model="targetCommand"
              type="text"
              class="text-input"
              placeholder="格式: 插件描述/cmd名称，例如: 翻译插件/翻译"
            />
            <span class="form-hint">格式: 插件描述/cmd名称</span>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="cancel-btn" @click="closeDialog">取消</button>
          <button
            class="confirm-btn"
            :disabled="!recordedShortcut || !targetCommand"
            @click="handleAdd"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface GlobalShortcut {
  id: string
  shortcut: string
  target: string
  enabled: boolean
}

// 快捷键列表
const shortcuts = ref<GlobalShortcut[]>([])
const isDeleting = ref(false)

// 添加/编辑对话框
const isDialogVisible = ref(false)
const isRecording = ref(false)
const recordedShortcut = ref('')
const recordedKeys = ref<string[]>([])
const targetCommand = ref('')
const editingShortcut = ref<GlobalShortcut | null>(null) // 正在编辑的快捷键

// 显示的快捷键文本
const displayHotkey = computed(() => {
  if (isRecording.value) {
    return recordedKeys.value.length > 0 ? recordedKeys.value.join('+') : '请按下快捷键组合...'
  }
  return recordedShortcut.value || '点击录制快捷键'
})

// 加载快捷键列表
async function loadShortcuts(): Promise<void> {
  try {
    const data = await window.ztools.dbGet('global-shortcuts')
    shortcuts.value = data || []
    console.log('加载全局快捷键:', shortcuts.value)
  } catch (error) {
    console.error('加载全局快捷键失败:', error)
  }
}

// 保存快捷键列表
async function saveShortcuts(): Promise<void> {
  try {
    await window.ztools.dbPut('global-shortcuts', JSON.parse(JSON.stringify(shortcuts.value)))
    console.log('保存全局快捷键成功')
  } catch (error) {
    console.error('保存全局快捷键失败:', error)
  }
}

// 显示添加对话框
function showAddDialog(): void {
  editingShortcut.value = null
  isDialogVisible.value = true
  recordedShortcut.value = ''
  targetCommand.value = ''
}

// 显示编辑对话框
function handleEdit(shortcut: GlobalShortcut): void {
  editingShortcut.value = shortcut
  isDialogVisible.value = true
  recordedShortcut.value = shortcut.shortcut
  targetCommand.value = shortcut.target
}

// 关闭对话框
function closeDialog(): void {
  isDialogVisible.value = false
  editingShortcut.value = null
  stopRecording()
}

// 开始录制快捷键
function startRecording(): void {
  isRecording.value = true
  recordedKeys.value = []
  recordedShortcut.value = ''
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

  // 主键
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
    let mainKey = ''

    if (e.code.startsWith('Key')) {
      mainKey = e.code.replace('Key', '')
    } else if (e.code.startsWith('Digit')) {
      mainKey = e.code.replace('Digit', '')
    } else if (e.code.startsWith('Numpad')) {
      mainKey = e.code
    } else {
      mainKey = e.code
    }

    if (mainKey) {
      keys.push(mainKey)
    }
  }

  recordedKeys.value = keys
}

// 按键抬起时确认快捷键
function handleKeyUp(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()

  if (recordedKeys.value.length > 1) {
    // 至少需要一个修饰键 + 一个主键
    recordedShortcut.value = recordedKeys.value.join('+')
    stopRecording()
  }
}

// 添加或编辑快捷键
async function handleAdd(): Promise<void> {
  if (!recordedShortcut.value || !targetCommand.value) {
    return
  }

  // 如果是编辑模式
  if (editingShortcut.value) {
    // 检查新快捷键是否与其他快捷键冲突（排除自己）
    const exists = shortcuts.value.some(
      (s) => s.id !== editingShortcut.value!.id && s.shortcut === recordedShortcut.value
    )
    if (exists) {
      alert('该快捷键已被其他指令占用，请使用其他快捷键')
      return
    }

    const oldShortcut = editingShortcut.value.shortcut

    try {
      // 如果快捷键改变了，需要先注销旧的
      if (oldShortcut !== recordedShortcut.value) {
        await window.ztools.unregisterGlobalShortcut(oldShortcut)
      }

      // 注册新快捷键
      const result = await window.ztools.registerGlobalShortcut(
        recordedShortcut.value,
        targetCommand.value
      )

      if (result.success) {
        // 更新列表
        const index = shortcuts.value.findIndex((s) => s.id === editingShortcut.value!.id)
        if (index >= 0) {
          shortcuts.value[index].shortcut = recordedShortcut.value
          shortcuts.value[index].target = targetCommand.value
        }

        // 保存到数据库
        await saveShortcuts()
        alert('快捷键更新成功!')
        closeDialog()
      } else {
        // 注册失败，恢复旧快捷键
        if (oldShortcut !== recordedShortcut.value) {
          await window.ztools.registerGlobalShortcut(oldShortcut, editingShortcut.value.target)
        }
        alert(`快捷键注册失败: ${result.error}`)
      }
    } catch (error: any) {
      // 注册失败，恢复旧快捷键
      if (oldShortcut !== recordedShortcut.value) {
        await window.ztools.registerGlobalShortcut(oldShortcut, editingShortcut.value.target)
      }
      console.error('更新快捷键失败:', error)
      alert(`更新快捷键失败: ${error.message || '未知错误'}`)
    }
    return
  }

  // 添加模式：检查快捷键是否已存在
  const exists = shortcuts.value.some((s) => s.shortcut === recordedShortcut.value)
  if (exists) {
    alert('该快捷键已存在，请使用其他快捷键')
    return
  }

  // 添加到列表
  const newShortcut: GlobalShortcut = {
    id: Date.now().toString(),
    shortcut: recordedShortcut.value,
    target: targetCommand.value,
    enabled: true
  }

  shortcuts.value.push(newShortcut)

  // 保存到数据库
  await saveShortcuts()

  // 注册全局快捷键
  try {
    const result = await window.ztools.registerGlobalShortcut(
      recordedShortcut.value,
      targetCommand.value
    )
    if (result.success) {
      alert('快捷键添加成功!')
      closeDialog()
    } else {
      // 如果注册失败，从列表中移除
      shortcuts.value = shortcuts.value.filter((s) => s.id !== newShortcut.id)
      await saveShortcuts()
      alert(`快捷键注册失败: ${result.error}`)
    }
  } catch (error: any) {
    // 如果注册失败，从列表中移除
    shortcuts.value = shortcuts.value.filter((s) => s.id !== newShortcut.id)
    await saveShortcuts()
    console.error('注册快捷键失败:', error)
    alert(`注册快捷键失败: ${error.message || '未知错误'}`)
  }
}

// 删除快捷键
async function handleDelete(id: string): Promise<void> {
  const shortcut = shortcuts.value.find((s) => s.id === id)
  if (!shortcut) return

  if (!confirm(`确定要删除快捷键"${shortcut.shortcut}"吗？`)) {
    return
  }

  isDeleting.value = true
  try {
    // 注销全局快捷键
    const result = await window.ztools.unregisterGlobalShortcut(shortcut.shortcut)
    if (result.success) {
      // 从列表中移除
      shortcuts.value = shortcuts.value.filter((s) => s.id !== id)
      await saveShortcuts()
      alert('快捷键删除成功!')
    } else {
      alert(`快捷键删除失败: ${result.error}`)
    }
  } catch (error: any) {
    console.error('删除快捷键失败:', error)
    alert(`删除快捷键失败: ${error.message || '未知错误'}`)
  } finally {
    isDeleting.value = false
  }
}

// 初始化
onMounted(() => {
  loadShortcuts()
})

// 清理
onUnmounted(() => {
  stopRecording()
})
</script>

<style scoped>
.content-panel {
  max-width: 600px;
}

/* 顶部按钮 */
.panel-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 20px;
}

.add-btn {
  padding: 8px 16px;
  border: 1.5px solid var(--primary-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-color);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.add-btn:hover {
  background: var(--primary-light-bg);
}

/* 快捷键列表 */
.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  padding: 16px;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  gap: 12px;
  transition: all 0.2s;
}

.shortcut-item:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px var(--shadow-color);
}

.shortcut-key {
  padding: 6px 12px;
  background: var(--active-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  font-family: monospace;
  white-space: nowrap;
}

.shortcut-arrow {
  font-size: 18px;
  color: var(--text-secondary);
}

.shortcut-target {
  flex: 1;
  font-size: 14px;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-btn {
  padding: 4px 12px;
  border: 1px solid var(--primary-color);
  border-radius: 4px;
  background: var(--bg-color);
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
  margin-right: 8px;
}

.edit-btn:hover:not(:disabled) {
  background: var(--primary-color);
  color: var(--text-on-primary);
}

.edit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.delete-btn {
  padding: 4px 12px;
  border: 1px solid var(--danger-color);
  border-radius: 4px;
  background: var(--bg-color);
  color: var(--danger-color);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.delete-btn:hover:not(:disabled) {
  background: var(--danger-color);
  color: var(--text-on-primary);
}

.delete-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
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

/* 对话框 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog-content {
  background: var(--dialog-bg);
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 10px 40px var(--shadow-color);
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  margin: 0;
}

.dialog-body {
  padding: 24px;
}

.form-item {
  margin-bottom: 20px;
}

.form-item:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 8px;
}

.form-hint {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.hotkey-input {
  width: 100%;
  padding: 10px 16px;
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

.text-input {
  width: 100%;
  padding: 10px 16px;
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

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
}

.cancel-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-color);
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-btn:hover {
  background: var(--hover-bg);
  border-color: var(--border-color);
  color: var(--text-color);
}

.confirm-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: var(--primary-color);
  color: var(--text-on-primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.confirm-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
