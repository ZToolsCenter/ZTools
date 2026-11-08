/** 定时任务的触发规则，日历类规则按设备当前时区的本地时间计算。 */
export type ScheduledTaskSchedule =
  | { kind: 'once'; at: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'interval'; minutes: number }

/** 最近一次触发的结果；missed 表示到点时未能运行且不满足补执行条件。 */
export interface ScheduledTaskLastRun {
  at: number
  status: 'success' | 'failed' | 'missed'
  error?: string
}

/** 持久化的定时任务。 */
export interface ScheduledTask {
  id: string
  name: string
  /** 指令目标，格式与全局快捷键相同：「插件名称/指令名称」或应用名称。 */
  target: string
  enabled: boolean
  schedule: ScheduledTaskSchedule
  /** 错过触发时间后，是否在下次有机会时补执行一次。 */
  catchUp: boolean
  /** 只有晚于该时间的触发点才会运行；触发、修改规则或重新启用时前移。 */
  anchorAt: number
  lastRun?: ScheduledTaskLastRun
}

/** 设置页提交的任务内容，运行状态由主进程维护。 */
export type ScheduledTaskDraft = Pick<
  ScheduledTask,
  'name' | 'target' | 'enabled' | 'schedule' | 'catchUp'
> & { id?: string }

/** 设置页展示用的任务，附带计算出的下次运行时间。 */
export interface ScheduledTaskView extends ScheduledTask {
  nextRunAt: number | null
}

/** 系统插件名称，电源指令只在该插件下生效。 */
export const SYSTEM_PLUGIN_NAME = 'system'

/** 会让设备关闭或中断当前会话的系统指令，不允许补执行和按间隔重复。 */
export const POWER_FEATURE_CODES: ReadonlySet<string> = new Set([
  'shutdown',
  'reboot',
  'logoff',
  'sleep'
])

const MINUTE_MS = 60 * 1000
const MAX_INTERVAL_MINUTES = 365 * 24 * 60
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * 判断指令是否为电源指令。
 * @param command 指令所属插件名称与功能代码
 * @returns 系统插件的关机、重启、注销或睡眠时为 true
 */
export function isPowerCommand(command: { pluginName?: string; featureCode?: string }): boolean {
  return command.pluginName === SYSTEM_PLUGIN_NAME && POWER_FEATURE_CODES.has(command.featureCode!)
}

/**
 * 校验触发规则。
 * @param schedule 待校验的规则，可能来自存储或 IPC
 * @returns 规则有效时为 null，否则为错误说明
 */
export function validateSchedule(schedule: ScheduledTaskSchedule): string | null {
  switch (schedule?.kind) {
    case 'once':
      return Number.isFinite(schedule.at) ? null : '请选择运行时间'
    case 'daily':
      return TIME_PATTERN.test(schedule.time) ? null : '请选择运行时间'
    case 'weekly':
      if (!TIME_PATTERN.test(schedule.time)) return '请选择运行时间'
      return Array.isArray(schedule.days) &&
        schedule.days.length > 0 &&
        schedule.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        ? null
        : '请至少选择一天'
    case 'interval':
      return Number.isInteger(schedule.minutes) &&
        schedule.minutes >= 1 &&
        schedule.minutes <= MAX_INTERVAL_MINUTES
        ? null
        : '间隔需为 1 到 525600 之间的整数分钟'
    default:
      return '不支持的触发规则'
  }
}

/**
 * 计算某个本地日期上的触发时刻。
 * @param year 本地年份
 * @param month 本地月份
 * @param date 本地日
 * @param time HH:mm 格式的本地时间
 * @returns 触发时刻的时间戳
 */
function occurrenceOn(year: number, month: number, date: number, time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month, date, hour, minute).getTime()
}

/**
 * 依次列出从某天起若干天内符合日历规则的触发时刻。
 * @param schedule 每日或每周规则
 * @param from 起始时刻所在的本地日期
 * @param step 日期步进，1 向后、-1 向前
 * @returns 按步进方向排列的触发时刻
 */
function calendarOccurrences(
  schedule: Extract<ScheduledTaskSchedule, { kind: 'daily' | 'weekly' }>,
  from: number,
  step: 1 | -1
): number[] {
  const base = new Date(from)
  const occurrences: number[] = []
  // 每周规则最多相隔 7 天，多取一天覆盖起始日当天时间已过的情况。
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset * step)
    if (schedule.kind === 'weekly' && !schedule.days.includes(day.getDay())) continue
    occurrences.push(occurrenceOn(day.getFullYear(), day.getMonth(), day.getDate(), schedule.time))
  }
  return occurrences
}

/**
 * 计算晚于给定时刻的下一次触发时间。
 * @param schedule 触发规则
 * @param anchorAt 任务锚点，只有晚于它的触发点才有效
 * @param after 查询时刻
 * @returns 下一次触发时间戳，单次任务已过期时为 null
 */
export function nextRunAfter(
  schedule: ScheduledTaskSchedule,
  anchorAt: number,
  after: number
): number | null {
  const floor = Math.max(anchorAt, after)
  switch (schedule.kind) {
    case 'once':
      return schedule.at > floor ? schedule.at : null
    case 'interval': {
      const period = schedule.minutes * MINUTE_MS
      return anchorAt + (Math.floor((floor - anchorAt) / period) + 1) * period
    }
    default:
      return calendarOccurrences(schedule, floor, 1).find((at) => at > floor) ?? null
  }
}

/**
 * 计算锚点之后、当前时刻之前最近的一次触发时间；错过多次时只关心最近一次。
 * @param schedule 触发规则
 * @param anchorAt 任务锚点
 * @param now 当前时刻
 * @returns 最近的待处理触发时间戳，没有到期时为 null
 */
export function latestDueRun(
  schedule: ScheduledTaskSchedule,
  anchorAt: number,
  now: number
): number | null {
  let latest: number | undefined
  switch (schedule.kind) {
    case 'once':
      latest = schedule.at <= now ? schedule.at : undefined
      break
    case 'interval': {
      const period = schedule.minutes * MINUTE_MS
      latest = anchorAt + Math.floor((now - anchorAt) / period) * period
      break
    }
    default:
      latest = calendarOccurrences(schedule, now, -1).find((at) => at <= now)
  }
  return latest !== undefined && latest > anchorAt ? latest : null
}
