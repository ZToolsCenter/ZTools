import type { ScheduledTaskSchedule } from '@shared/scheduledTasks'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 周选择器的显示顺序，从周一开始。 */
export const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((value) => ({
  value,
  label: WEEKDAY_LABELS[value]
}))

/**
 * 将时间戳格式化为 datetime-local 输入框使用的本地时间。
 * @param timestamp 时间戳
 * @returns YYYY-MM-DDTHH:mm 格式的本地时间
 */
export function toDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * 将时间戳格式化为列表展示的本地时间。
 * @param timestamp 时间戳
 * @returns YYYY-MM-DD HH:mm 格式的本地时间
 */
export function formatDateTime(timestamp: number): string {
  return toDateTimeLocal(timestamp).replace('T', ' ')
}

/**
 * 生成触发规则的中文说明。
 * @param schedule 触发规则
 * @returns 展示文案
 */
export function describeSchedule(schedule: ScheduledTaskSchedule): string {
  switch (schedule.kind) {
    case 'once':
      return `${formatDateTime(schedule.at)} 运行一次`
    case 'daily':
      return `每天 ${schedule.time}`
    case 'weekly': {
      const days = WEEKDAY_OPTIONS.filter((day) => schedule.days.includes(day.value))
      return `每周${days.map((day) => day.label).join('、')} ${schedule.time}`
    }
    case 'interval':
      return `每 ${schedule.minutes} 分钟`
  }
}
