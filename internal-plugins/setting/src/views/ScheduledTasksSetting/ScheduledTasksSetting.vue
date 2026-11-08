<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useToast } from '@/components'
import { useZtoolsSubInput } from '@/composables'
import { weightedSearch } from '@/utils'
import {
  buildShortcutTargetCandidates,
  buildShortcutTargetValue,
  loadCommandTargetOptions,
  normalizeShortcutTargetValue,
  type ShortcutsSettingShortcutTargetOption
} from '@/views/ShortcutsSetting/ShortcutsSetting'
import {
  isPowerCommand,
  type ScheduledTaskDraft,
  type ScheduledTaskView
} from '@shared/scheduledTasks'
import ScheduledTaskEditor from './components/ScheduledTaskEditor.vue'
import { describeSchedule, formatDateTime } from './ScheduledTasksSetting'

const { success, error, confirm } = useToast()

const tasks = ref<ScheduledTaskView[]>([])
const targetOptions = ref<ShortcutsSettingShortcutTargetOption[]>([])
const loading = ref(true)
const saving = ref(false)
const showEditor = ref(false)
const editingTask = ref<ScheduledTaskView | null>(null)
let unsubscribe: (() => void) | undefined

const { value: searchQuery } = useZtoolsSubInput('', '搜索定时任务...')

const filteredTasks = computed(() =>
  weightedSearch(tasks.value, searchQuery.value || '', [
    { value: (task) => task.name || '', weight: 10 },
    { value: (task) => task.target || '', weight: 5 }
  ])
)

/**
 * 查找任务目标对应的指令选项。
 * @param target 任务保存的目标字符串
 * @returns 指令选项，目标已不存在时为 null
 */
function findTarget(target: string): ShortcutsSettingShortcutTargetOption | null {
  const normalized = normalizeShortcutTargetValue(target)
  return (
    targetOptions.value.find((item) => buildShortcutTargetCandidates(item).includes(normalized)) ||
    null
  )
}

/**
 * 读取任务的显示名称。
 * @param task 定时任务
 * @returns 名称，未命名时为目标指令
 */
function taskTitle(task: ScheduledTaskView): string {
  return task.name || findTarget(task.target)?.label || task.target
}

/**
 * 生成任务的运行状态文案。
 * @param task 定时任务
 * @returns 下次运行与最近一次结果的说明
 */
function taskStatus(task: ScheduledTaskView): string {
  const parts = [task.nextRunAt ? `下次 ${formatDateTime(task.nextRunAt)}` : '未计划']
  const last = task.lastRun
  if (last?.status === 'success') parts.push(`上次 ${formatDateTime(last.at)} 成功`)
  if (last?.status === 'missed') parts.push(`${formatDateTime(last.at)} 已错过`)
  if (last?.status === 'failed') parts.push(`上次 ${formatDateTime(last.at)} 失败：${last.error}`)
  return parts.join(' · ')
}

/**
 * 确认电源指令的执行风险。
 * @param target 任务目标
 * @param message 确认文案
 * @returns 非电源指令或用户确认时为 true
 */
async function confirmPower(target: string, message: string): Promise<boolean> {
  const option = findTarget(target)
  if (!option || !isPowerCommand(option)) return true
  return confirm({
    title: `定时${option.cmdName}`,
    message,
    type: 'danger',
    confirmText: '继续',
    cancelText: '取消'
  })
}

/**
 * 重新读取任务列表，运行结果和单次任务结束都会触发。
 * @returns 读取完成的 Promise
 */
async function loadTasks(): Promise<void> {
  try {
    tasks.value = await window.ztools.internal.getScheduledTasks()
  } catch (err) {
    console.error('加载定时任务失败:', err)
  }
}

/**
 * 打开编辑面板。
 * @param task 待编辑任务，新建时不传
 * @returns 无返回值
 */
function openEditor(task?: ScheduledTaskView): void {
  editingTask.value = task ?? null
  showEditor.value = true
}

/**
 * 保存编辑结果。
 * @param draft 任务内容
 * @returns 保存完成的 Promise
 */
async function handleSave(draft: ScheduledTaskDraft): Promise<void> {
  const allowed = await confirmPower(
    draft.target,
    '到点后会直接执行且不再询问，未保存的工作可能丢失。确定要保存吗？'
  )
  if (!allowed) return
  saving.value = true
  try {
    const result = await window.ztools.internal.saveScheduledTask(draft)
    if (!result.success) {
      error(result.error || '保存失败')
      return
    }
    success(draft.id ? '定时任务已更新' : '定时任务已添加')
    showEditor.value = false
    await loadTasks()
  } finally {
    saving.value = false
  }
}

/**
 * 启用或停用任务；重新启用后只响应之后的触发点。
 * @param task 目标任务
 * @param enabled 期望的启用状态
 * @returns 操作完成的 Promise
 */
async function handleToggle(task: ScheduledTaskView, enabled: boolean): Promise<void> {
  const { id, name, target, schedule, catchUp } = task
  const result = await window.ztools.internal.saveScheduledTask(
    JSON.parse(JSON.stringify({ id, name, target, schedule, catchUp, enabled }))
  )
  if (!result.success) error(result.error || '操作失败')
  await loadTasks()
}

/**
 * 立即运行一次任务，不影响后续计划。
 * @param task 目标任务
 * @returns 操作完成的 Promise
 */
async function handleRun(task: ScheduledTaskView): Promise<void> {
  const allowed = await confirmPower(task.target, '将立即执行该指令，未保存的工作可能丢失。')
  if (!allowed) return
  const result = await window.ztools.internal.runScheduledTask(task.id)
  if (!result.success) error(result.error || '运行失败')
  await loadTasks()
}

/**
 * 删除任务。
 * @param task 目标任务
 * @returns 操作完成的 Promise
 */
async function handleDelete(task: ScheduledTaskView): Promise<void> {
  const confirmed = await confirm({
    title: '删除定时任务',
    message: `确定要删除“${taskTitle(task)}”吗？`,
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!confirmed) return
  await window.ztools.internal.deleteScheduledTask(task.id)
  await loadTasks()
}

onMounted(async () => {
  unsubscribe = window.ztools.internal.onScheduledTasksChanged(() => void loadTasks())
  try {
    const options = await loadCommandTargetOptions()
    // 定时触发没有输入内容，依赖匹配内容的指令无法运行。
    targetOptions.value = options
      .filter((item) => item.type === 'direct' || item.cmdType === 'text')
      .map((item) => ({ ...item, value: buildShortcutTargetValue(item) }))
  } catch (err) {
    console.error('加载指令目标失败:', err)
  }
  await loadTasks()
  loading.value = false
})

onUnmounted(() => unsubscribe?.())
</script>

<template>
  <div class="h-full content-panel">
    <div v-show="!showEditor" class="scrollable-content">
      <div class="panel-header">
        <span class="panel-hint">到点在后台运行指令，无需插件保持打开</span>
        <button class="btn" @click="openEditor()">添加任务</button>
      </div>

      <div v-if="filteredTasks.length > 0" class="task-list">
        <div v-for="task in filteredTasks" :key="task.id" class="card task-item">
          <div class="task-info">
            <div class="task-title">{{ taskTitle(task) }}</div>
            <div class="task-schedule">
              {{ describeSchedule(task.schedule) }}
              <span v-if="!findTarget(task.target) && !loading" class="task-invalid">
                目标指令不可用
              </span>
            </div>
            <div :class="['task-status', { failed: task.lastRun?.status === 'failed' }]">
              {{ taskStatus(task) }}
            </div>
          </div>
          <div class="task-actions">
            <button class="icon-btn" title="立即运行" @click="handleRun(task)">
              <div class="i-z-play font-size-14px" />
            </button>
            <button class="icon-btn edit-btn" title="编辑" @click="openEditor(task)">
              <div class="i-z-settings font-size-14px" />
            </button>
            <button class="icon-btn delete-btn" title="删除" @click="handleDelete(task)">
              <div class="i-z-trash font-size-14px" />
            </button>
            <label class="toggle" :title="task.enabled ? '停用' : '启用'">
              <input
                type="checkbox"
                :checked="task.enabled"
                @change="handleToggle(task, ($event.target as HTMLInputElement).checked)"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div v-else-if="!loading" class="empty-state">
        <div class="i-z-clock empty-icon" style="font-size: 64px" />
        <div class="empty-text">{{ searchQuery ? '未找到匹配的任务' : '暂无定时任务' }}</div>
        <div class="empty-hint">
          {{ searchQuery ? '换个关键词试试' : '点击“添加任务”，定时打开指令' }}
        </div>
      </div>
    </div>

    <ScheduledTaskEditor
      v-if="showEditor"
      :task="editingTask"
      :task-target="editingTask ? findTarget(editingTask.target) : null"
      :target-options="targetOptions"
      :saving="saving"
      @back="showEditor = false"
      @save="handleSave"
    />
  </div>
</template>

<style lang="less" scoped>
.content-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}

.scrollable-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.panel-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
}

.task-info {
  flex: 1;
  min-width: 0;
}

.task-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.task-schedule,
.task-status {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.task-status.failed,
.task-invalid {
  color: var(--danger-color);
}

.task-invalid {
  margin-left: 8px;
}

.task-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
}
</style>
