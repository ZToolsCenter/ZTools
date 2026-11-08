import { randomUUID } from 'node:crypto'
import {
  latestDueRun,
  nextRunAfter,
  validateSchedule,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type ScheduledTaskLastRun,
  type ScheduledTaskView
} from '../../../shared/scheduledTasks'
import type { CommandExecutionResult } from '../../../shared/commandService'

/** 启动后延迟首次检查，等待主窗口和插件管理器就绪。 */
export const SCHEDULER_STARTUP_DELAY_MS = 5 * 1000
/** 定时器最长等待时间，系统时钟或时区变化后最多这么久就会重新计算。 */
export const SCHEDULER_MAX_WAIT_MS = 60 * 1000
/** 晚于触发点多久仍算准点，覆盖休眠唤醒和定时器延迟。 */
export const SCHEDULER_RUN_GRACE_MS = 2 * 60 * 1000
/** 电源指令的准点窗口更短，刚开机或刚唤醒时不应因旧触发点再次关闭设备。 */
export const SCHEDULER_POWER_RUN_GRACE_MS = 30 * 1000

export interface ScheduledTaskServiceDependencies {
  read: () => unknown
  write: (tasks: ScheduledTask[]) => void
  execute: (target: string) => Promise<CommandExecutionResult>
  /** 判断目标是否解析到电源指令；无法确定时应抛错，调用方按电源指令保守处理。 */
  isPowerTarget: (target: string) => Promise<boolean>
  /** 任务运行失败时提示用户。 */
  notifyFailure: (task: ScheduledTask, error: string) => void
  /** 任务列表或运行状态变化时通知设置页刷新。 */
  changed: () => void
}

/**
 * 判断存储中的记录是否为可调度的任务，损坏记录不应影响其他任务。
 * @param value 存储中的单条记录
 * @returns 结构完整时为 true
 */
function isStoredTask(value: any): value is ScheduledTask {
  return (
    typeof value?.id === 'string' &&
    typeof value.target === 'string' &&
    Number.isFinite(value.anchorAt) &&
    validateSchedule(value.schedule) === null
  )
}

/**
 * 应用级定时任务调度器：在主进程按规则触发指令，不依赖任何插件或页面存活。
 */
export class ScheduledTaskService {
  private tasks: ScheduledTask[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private started = false

  /**
   * 注入存储和指令执行适配器，调度逻辑不直接依赖 Electron。
   * @param dependencies 平台适配器
   * @returns 调度器实例
   */
  constructor(private dependencies: ScheduledTaskServiceDependencies) {}

  /**
   * 载入任务并开始调度。
   * @returns 无返回值
   */
  start(): void {
    if (this.started) return
    this.started = true
    const stored = this.dependencies.read()
    this.tasks = Array.isArray(stored) ? stored.filter(isStoredTask) : []
    this.rewindAnchors(Date.now())
    this.arm(SCHEDULER_STARTUP_DELAY_MS)
  }

  /**
   * 停止调度，已进入指令队列的任务不受影响。
   * @returns 无返回值
   */
  stop(): void {
    this.started = false
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /**
   * 列出任务及其下次运行时间。
   * @returns 任务展示快照
   */
  list(): ScheduledTaskView[] {
    const now = Date.now()
    return this.tasks.map((task) => ({
      ...structuredClone(task),
      nextRunAt: task.enabled
        ? nextRunAfter(task.schedule, Math.min(task.anchorAt, now), now)
        : null
    }))
  }

  /**
   * 创建或更新任务，规则变化或重新启用时从当前时刻开始计时。
   * @param draft 设置页提交的任务内容
   * @returns 保存后的任务或校验错误
   */
  async save(
    draft: ScheduledTaskDraft
  ): Promise<{ success: boolean; task?: ScheduledTask; error?: string }> {
    const target = typeof draft?.target === 'string' ? draft.target.trim() : ''
    if (!target) return { success: false, error: '请选择目标指令' }
    const invalid = validateSchedule(draft.schedule)
    if (invalid) return { success: false, error: invalid }
    const now = Date.now()
    const enabled = draft.enabled !== false
    if (enabled && draft.schedule.kind === 'once' && draft.schedule.at <= now)
      return { success: false, error: '运行时间需晚于当前时间' }

    const catchUp = draft.catchUp === true
    // 补执行和按间隔重复都可能在开机后立即再次关闭设备，保存时就拒绝。
    if (draft.schedule.kind === 'interval' || catchUp) {
      const power = await this.dependencies.isPowerTarget(target).catch(() => false)
      if (power && draft.schedule.kind === 'interval')
        return { success: false, error: '关机、重启等电源指令不支持按间隔重复' }
      if (power && catchUp) return { success: false, error: '关机、重启等电源指令不支持补执行' }
    }

    const existing = draft.id ? this.tasks.find((task) => task.id === draft.id) : undefined
    if (draft.id && !existing) return { success: false, error: '任务不存在' }
    // 只改名称或目标时沿用原计划，否则暂停期间错过的触发点不应在启用后运行。
    const keepAnchor =
      existing &&
      (!enabled || existing.enabled) &&
      JSON.stringify(existing.schedule) === JSON.stringify(draft.schedule)
    const task: ScheduledTask = {
      id: existing?.id ?? randomUUID(),
      name: typeof draft.name === 'string' ? draft.name.trim() : '',
      target,
      enabled,
      schedule: structuredClone(draft.schedule),
      catchUp,
      anchorAt: keepAnchor ? existing.anchorAt : now,
      lastRun: existing?.lastRun
    }
    this.tasks = existing
      ? this.tasks.map((item) => (item.id === task.id ? task : item))
      : [...this.tasks, task]
    this.commit()
    return { success: true, task: structuredClone(task) }
  }

  /**
   * 删除任务，已在运行的指令不会被中断。
   * @param id 任务标识
   * @returns 操作结果
   */
  remove(id: string): { success: boolean } {
    this.tasks = this.tasks.filter((task) => task.id !== id)
    this.commit()
    return { success: true }
  }

  /**
   * 立即运行一次任务，不改变后续的触发计划。
   * @param id 任务标识
   * @returns 指令执行结果
   */
  async runNow(id: string): Promise<CommandExecutionResult> {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) return { success: false, error: '任务不存在' }
    return this.run(task, Date.now())
  }

  /**
   * 检查到期任务并安排下一次检查；休眠唤醒后也由此立即补查。
   * @returns 无返回值
   */
  check(): void {
    if (!this.started) return
    const now = Date.now()
    const rewound = this.rewindAnchors(now)
    const due: Array<{ task: ScheduledTask; dueAt: number }> = []
    for (const task of this.tasks) {
      if (!task.enabled) continue
      const dueAt = latestDueRun(task.schedule, task.anchorAt, now)
      if (dueAt === null) continue
      task.anchorAt = now
      if (task.schedule.kind === 'once') task.enabled = false
      due.push({ task, dueAt })
    }
    // 先落盘再执行：关机类指令执行后进程可能来不及写入，下次启动不能重复触发。
    if (due.length || rewound) this.commit()
    else this.arm()
    for (const { task, dueAt } of due) void this.handleDue(task, dueAt, now)
  }

  /**
   * 系统时钟回拨后锚点会落在未来，将其拉回当前时刻，否则要等时钟重新走过锚点才会触发。
   * @param now 当前时刻
   * @returns 有锚点被调整时为 true
   */
  private rewindAnchors(now: number): boolean {
    let rewound = false
    for (const task of this.tasks) {
      if (task.anchorAt <= now) continue
      task.anchorAt = now
      rewound = true
    }
    return rewound
  }

  /**
   * 处理一次到期的触发，按迟到时长决定运行还是记为错过。
   * @param task 到期任务
   * @param dueAt 触发点
   * @param now 检查时刻
   * @returns 处理完成的 Promise
   */
  private async handleDue(task: ScheduledTask, dueAt: number, now: number): Promise<void> {
    if (await this.shouldRun(task, now - dueAt)) await this.run(task, now)
    else this.record(task.id, { at: dueAt, status: 'missed' })
  }

  /**
   * 判断迟到的触发是否仍应运行。
   * @param task 到期任务
   * @param lateMs 迟到毫秒数
   * @returns 应运行时为 true
   */
  private async shouldRun(task: ScheduledTask, lateMs: number): Promise<boolean> {
    if (lateMs <= SCHEDULER_POWER_RUN_GRACE_MS) return true
    if (lateMs > SCHEDULER_RUN_GRACE_MS && !task.catchUp) return false
    // 目标无法解析时按电源指令处理，宁可错过也不能意外关闭设备。
    return !(await this.dependencies.isPowerTarget(task.target).catch(() => true))
  }

  /**
   * 运行任务目标并记录结果，失败时提示用户。
   * @param task 目标任务
   * @param at 运行时刻
   * @returns 指令执行结果
   */
  private async run(task: ScheduledTask, at: number): Promise<CommandExecutionResult> {
    const result = await this.dependencies.execute(task.target).catch(
      (error: unknown): CommandExecutionResult => ({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    )
    if (result.success) {
      this.record(task.id, { at, status: 'success' })
    } else {
      const error = result.error || '指令启动失败'
      this.record(task.id, { at, status: 'failed', error })
      this.dependencies.notifyFailure(task, error)
    }
    return result
  }

  /**
   * 记录触发结果；任务可能已在运行期间被编辑或删除，按标识写回当前记录。
   * @param id 任务标识
   * @param lastRun 触发结果
   * @returns 无返回值
   */
  private record(id: string, lastRun: ScheduledTaskLastRun): void {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) return
    task.lastRun = lastRun
    this.commit()
  }

  /**
   * 持久化当前任务、重新安排定时器并通知设置页。
   * @returns 无返回值
   */
  private commit(): void {
    this.dependencies.write(structuredClone(this.tasks))
    this.arm()
    this.dependencies.changed()
  }

  /**
   * 安排下一次检查；没有可运行任务时不保留定时器。
   * @param minDelay 最短等待毫秒数，用于启动延迟
   * @returns 无返回值
   */
  private arm(minDelay = 0): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.started || !this.tasks.some((task) => task.enabled)) return
    const now = Date.now()
    let delay = SCHEDULER_MAX_WAIT_MS
    for (const task of this.tasks) {
      if (!task.enabled) continue
      const anchorAt = Math.min(task.anchorAt, now)
      // 已到期的任务也要尽快检查，例如启动时错过的触发点。
      if (latestDueRun(task.schedule, anchorAt, now) !== null) delay = 0
      const next = nextRunAfter(task.schedule, anchorAt, now)
      if (next !== null) delay = Math.min(delay, next - now)
    }
    this.timer = setTimeout(() => this.check(), Math.max(delay, minDelay))
  }
}
