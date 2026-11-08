<script setup lang="ts">
import { computed, ref } from 'vue'
import { DetailPanel } from '@/components'
import CommandTargetSelector from '@/views/ShortcutsSetting/components/CommandTargetSelector.vue'
import type { ShortcutsSettingShortcutTargetOption } from '@/views/ShortcutsSetting/ShortcutsSetting'
import {
  isPowerCommand,
  type ScheduledTaskDraft,
  type ScheduledTaskSchedule,
  type ScheduledTaskView
} from '@shared/scheduledTasks'
import { WEEKDAY_OPTIONS, toDateTimeLocal } from '../ScheduledTasksSetting'

type ScheduleKind = ScheduledTaskSchedule['kind']

const KIND_OPTIONS: Array<{ value: ScheduleKind; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'interval', label: '按间隔' },
  { value: 'once', label: '仅一次' }
]

const props = defineProps<{
  task?: ScheduledTaskView | null
  /** 编辑任务当前目标对应的选项，目标指令已不存在时为空。 */
  taskTarget?: ShortcutsSettingShortcutTargetOption | null
  targetOptions: ShortcutsSettingShortcutTargetOption[]
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'save', draft: ScheduledTaskDraft): void
}>()

const schedule = props.task?.schedule
const name = ref(props.task?.name ?? '')
const kind = ref<ScheduleKind>(schedule?.kind ?? 'daily')
const time = ref(
  schedule?.kind === 'daily' || schedule?.kind === 'weekly' ? schedule.time : '09:00'
)
const days = ref<number[]>(schedule?.kind === 'weekly' ? [...schedule.days] : [1, 2, 3, 4, 5])
const minutes = ref(schedule?.kind === 'interval' ? schedule.minutes : 60)
const onceAt = ref(
  toDateTimeLocal(schedule?.kind === 'once' ? schedule.at : Date.now() + 60 * 60 * 1000)
)
const catchUp = ref(props.task?.catchUp ?? false)
const target = ref<ShortcutsSettingShortcutTargetOption | null>(props.taskTarget ?? null)

const isPower = computed(() => !!target.value && isPowerCommand(target.value))
const powerIntervalBlocked = computed(() => isPower.value && kind.value === 'interval')
const canSave = computed(
  () =>
    !!target.value &&
    !props.saving &&
    !powerIntervalBlocked.value &&
    (kind.value !== 'weekly' || days.value.length > 0) &&
    (kind.value !== 'interval' || (Number.isInteger(minutes.value) && minutes.value >= 1)) &&
    (kind.value !== 'once' || !!onceAt.value) &&
    (kind.value === 'interval' || kind.value === 'once' || !!time.value)
)

/**
 * 切换周选择器中的某一天。
 * @param day 星期值，0 为周日
 * @returns 无返回值
 */
function toggleDay(day: number): void {
  days.value = days.value.includes(day)
    ? days.value.filter((item) => item !== day)
    : [...days.value, day]
}

/**
 * 按当前选择的类型生成触发规则。
 * @returns 触发规则
 */
function buildSchedule(): ScheduledTaskSchedule {
  switch (kind.value) {
    case 'once':
      return { kind: 'once', at: new Date(onceAt.value).getTime() }
    case 'weekly':
      return { kind: 'weekly', days: [...days.value].sort(), time: time.value }
    case 'interval':
      return { kind: 'interval', minutes: minutes.value }
    default:
      return { kind: 'daily', time: time.value }
  }
}

/**
 * 提交编辑结果，保存校验由主进程完成。
 * @returns 无返回值
 */
function handleSave(): void {
  if (!canSave.value || !target.value) return
  emit('save', {
    id: props.task?.id,
    name: name.value,
    target: target.value.value,
    // 编辑时保留停用状态；已结束的单次任务改期后等同重新启用。
    enabled: props.task?.schedule.kind === 'once' ? true : (props.task?.enabled ?? true),
    schedule: buildSchedule(),
    catchUp: catchUp.value && !isPower.value
  })
}
</script>

<template>
  <DetailPanel :title="task ? '编辑定时任务' : '添加定时任务'" @back="emit('back')">
    <div class="editor-wrapper">
      <div class="editor-main">
        <div class="editor-form">
          <div class="form-item">
            <label class="form-label">名称</label>
            <input v-model="name" class="input" type="text" placeholder="可选，默认显示目标指令" />
          </div>

          <div class="form-item">
            <label class="form-label">运行时间</label>
            <div class="kind-group">
              <button
                v-for="option in KIND_OPTIONS"
                :key="option.value"
                type="button"
                :class="['kind-btn', { active: kind === option.value }]"
                @click="kind = option.value"
              >
                {{ option.label }}
              </button>
            </div>

            <div v-if="kind === 'weekly'" class="weekday-group">
              <button
                v-for="day in WEEKDAY_OPTIONS"
                :key="day.value"
                type="button"
                :class="['kind-btn', { active: days.includes(day.value) }]"
                @click="toggleDay(day.value)"
              >
                {{ day.label }}
              </button>
            </div>

            <input
              v-if="kind === 'daily' || kind === 'weekly'"
              v-model="time"
              class="input schedule-input"
              type="time"
            />
            <input
              v-else-if="kind === 'once'"
              v-model="onceAt"
              class="input schedule-input"
              type="datetime-local"
            />
            <label v-else class="interval-row">
              每
              <input
                v-model.number="minutes"
                class="input interval-input"
                type="number"
                min="1"
                step="1"
              />
              分钟运行一次
            </label>
          </div>

          <div v-if="!isPower" class="form-item">
            <label class="form-label">错过后补执行</label>
            <label class="toggle editor-toggle">
              <input v-model="catchUp" type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
            <span class="form-hint">
              到点时设备休眠或 ZTools 未运行，则在下次恢复后运行一次；关闭时超过 2 分钟即跳过
            </span>
          </div>

          <div v-if="powerIntervalBlocked" class="form-notice danger">
            关机、重启等电源指令不支持按间隔重复，请选择其他运行时间
          </div>
          <div v-else-if="isPower" class="form-notice danger">
            到点后会直接执行，不再询问，未保存的工作可能丢失。错过时间不会补执行
          </div>
        </div>

        <div class="editor-selector">
          <CommandTargetSelector
            hide-empty
            :options="targetOptions"
            :selected-command-id="target?.commandId || null"
            :selected-option="target"
            @select="target = $event as ShortcutsSettingShortcutTargetOption"
            @escape="emit('back')"
          />
        </div>
      </div>

      <div class="editor-footer">
        <button class="btn" @click="emit('back')">取消</button>
        <button class="btn" :disabled="!canSave" @click="handleSave">确定</button>
      </div>
    </div>
  </DetailPanel>
</template>

<style scoped>
.editor-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-main {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;
  padding: 20px 24px;
  min-height: 0;
  overflow: hidden;
}

.editor-form {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.form-item {
  margin-bottom: 24px;
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

.form-notice {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}

.form-notice.danger {
  color: var(--danger-color);
  background: var(--danger-light-bg);
  border: 1px solid var(--danger-color);
}

.kind-group,
.weekday-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.weekday-group,
.schedule-input,
.interval-row {
  margin-top: 12px;
}

.kind-btn {
  min-width: 36px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-color);
  background: var(--control-bg);
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  cursor: pointer;
}

.kind-btn.active {
  color: var(--primary-color);
  background: var(--primary-light-bg);
  border-color: var(--primary-color);
}

.schedule-input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  max-width: 300px;
}

.interval-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-color);
}

.interval-input {
  width: 90px;
}

.editor-toggle {
  display: inline-flex;
}

.editor-selector {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--divider-color);
  background: var(--bg-color);
}
</style>
