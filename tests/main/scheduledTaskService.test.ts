import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  ScheduledTaskService,
  SCHEDULER_MAX_WAIT_MS,
  SCHEDULER_STARTUP_DELAY_MS,
  type ScheduledTaskServiceDependencies
} from '../../src/main/core/scheduledTasks/service'
import { getStorageScopeForKey } from '../../src/main/core/storage/storageRouting'
import {
  isPowerCommand,
  latestDueRun,
  nextRunAfter,
  validateSchedule,
  type ScheduledTask,
  type ScheduledTaskDraft
} from '../../src/shared/scheduledTasks'
import { HOST_STORAGE_KEYS, toHostDocId } from '../../src/shared/storageKeys'

type MockedDependencies = {
  [K in keyof ScheduledTaskServiceDependencies]: Mock<ScheduledTaskServiceDependencies[K]>
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * 按本地时间构造时间戳，规则都按本地时区解释。
 * @param day 2026 年 11 月的日期，2026-11-02 为周一
 * @param hour 小时
 * @param minute 分钟
 * @returns 时间戳
 */
function at(day: number, hour = 0, minute = 0): number {
  return new Date(2026, 10, day, hour, minute).getTime()
}

/**
 * 创建使用内存存储的调度器。
 * @param stored 启动时已有的任务
 * @param power 解析结果为电源指令的目标
 * @returns 调度器与依赖观察器
 */
function createService(
  stored: unknown = [],
  power: string[] = []
): {
  service: ScheduledTaskService
  dependencies: MockedDependencies
  stored: () => unknown
} {
  let storage = stored
  const dependencies: MockedDependencies = {
    read: vi.fn(() => storage),
    write: vi.fn((tasks: ScheduledTask[]) => {
      storage = tasks
    }),
    execute: vi.fn(async () => ({ success: true })),
    isPowerTarget: vi.fn(async (target: string) => power.includes(target)),
    notifyFailure: vi.fn(),
    changed: vi.fn()
  }
  return { service: new ScheduledTaskService(dependencies), dependencies, stored: () => storage }
}

/**
 * 构造一条已持久化的任务。
 * @param overrides 需要覆盖的字段
 * @returns 任务记录
 */
function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task',
    name: '',
    target: 'demo/open',
    enabled: true,
    schedule: { kind: 'daily', time: '09:00' },
    catchUp: false,
    anchorAt: at(1),
    ...overrides
  }
}

/**
 * 构造设置页提交的任务内容。
 * @param overrides 需要覆盖的字段
 * @returns 任务内容
 */
function draft(overrides: Partial<ScheduledTaskDraft> = {}): ScheduledTaskDraft {
  return {
    name: '',
    target: 'demo/open',
    enabled: true,
    schedule: { kind: 'daily', time: '09:00' },
    catchUp: false,
    ...overrides
  }
}

describe('schedule calculation', () => {
  it('finds the next daily run today or tomorrow', () => {
    const schedule = { kind: 'daily', time: '09:00' } as const
    expect(nextRunAfter(schedule, at(1), at(3, 8))).toBe(at(3, 9))
    expect(nextRunAfter(schedule, at(1), at(3, 9))).toBe(at(4, 9))
  })

  it('skips to the next selected weekday', () => {
    // 2026-11-02 是周一，只选周一和周三。
    const schedule = { kind: 'weekly', days: [1, 3], time: '09:00' } as const
    expect(nextRunAfter(schedule, at(1), at(2, 10))).toBe(at(4, 9))
    expect(nextRunAfter(schedule, at(1), at(4, 10))).toBe(at(9, 9))
  })

  it('anchors intervals to the anchor rather than the query time', () => {
    const schedule = { kind: 'interval', minutes: 30 } as const
    expect(nextRunAfter(schedule, at(3, 8), at(3, 8, 10))).toBe(at(3, 8, 30))
    expect(nextRunAfter(schedule, at(3, 8), at(3, 8, 30))).toBe(at(3, 9))
  })

  it('has no next run for an expired one-off', () => {
    const schedule = { kind: 'once', at: at(3, 9) } as const
    expect(nextRunAfter(schedule, at(1), at(3, 8))).toBe(at(3, 9))
    expect(nextRunAfter(schedule, at(1), at(3, 9))).toBeNull()
  })

  it('reports only the latest occurrence after the anchor', () => {
    const daily = { kind: 'daily', time: '09:00' } as const
    expect(latestDueRun(daily, at(1), at(3, 10))).toBe(at(3, 9))
    expect(latestDueRun(daily, at(3, 9), at(3, 10))).toBeNull()
    expect(latestDueRun(daily, at(3, 10), at(3, 11))).toBeNull()

    const weekly = { kind: 'weekly', days: [1], time: '09:00' } as const
    expect(latestDueRun(weekly, at(1), at(6, 10))).toBe(at(2, 9))

    const interval = { kind: 'interval', minutes: 30 } as const
    expect(latestDueRun(interval, at(3, 8), at(3, 9, 10))).toBe(at(3, 9))
    expect(latestDueRun(interval, at(3, 8), at(3, 8, 10))).toBeNull()

    const once = { kind: 'once', at: at(3, 9) } as const
    expect(latestDueRun(once, at(1), at(3, 10))).toBe(at(3, 9))
    expect(latestDueRun(once, at(3, 10), at(3, 11))).toBeNull()
  })

  it('rejects invalid schedules', () => {
    expect(validateSchedule({ kind: 'daily', time: '09:00' })).toBeNull()
    expect(validateSchedule({ kind: 'daily', time: '24:00' })).not.toBeNull()
    expect(validateSchedule({ kind: 'weekly', days: [], time: '09:00' })).not.toBeNull()
    expect(validateSchedule({ kind: 'weekly', days: [7], time: '09:00' })).not.toBeNull()
    expect(validateSchedule({ kind: 'interval', minutes: 0 })).not.toBeNull()
    expect(validateSchedule({ kind: 'interval', minutes: 1.5 })).not.toBeNull()
    expect(validateSchedule({ kind: 'once', at: Number.NaN })).not.toBeNull()
    expect(validateSchedule({ kind: 'cron' } as never)).not.toBeNull()
  })

  it('recognises power commands by plugin and feature rather than display name', () => {
    expect(isPowerCommand({ pluginName: 'system', featureCode: 'shutdown' })).toBe(true)
    expect(isPowerCommand({ pluginName: 'system', featureCode: 'lock-screen' })).toBe(false)
    expect(isPowerCommand({ pluginName: 'other', featureCode: 'shutdown' })).toBe(false)
  })
})

describe('scheduled task service', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps tasks on this device instead of syncing them to other devices', () => {
    // 同步到其他设备后，定时关机会在不相关的设备上触发。
    expect(getStorageScopeForKey(toHostDocId(HOST_STORAGE_KEYS.scheduledTasks))).toBe('device')
  })

  it('runs a task at its scheduled time and then waits for the next day', async () => {
    vi.setSystemTime(at(3, 8, 59))
    const { service, dependencies } = createService([task({ anchorAt: at(3, 8) })])
    service.start()

    await vi.advanceTimersByTimeAsync(MINUTE - 1)
    expect(dependencies.execute).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(dependencies.execute).toHaveBeenCalledExactlyOnceWith('demo/open')

    await vi.advanceTimersByTimeAsync(23 * HOUR)
    expect(dependencies.execute).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(dependencies.execute).toHaveBeenCalledTimes(2)
    expect(service.list()[0].lastRun).toEqual({ at: at(4, 9), status: 'success' })
    service.stop()
  })

  it('persists consumption before executing so a shutdown cannot repeat after restart', async () => {
    vi.setSystemTime(at(3, 9))
    const { service, dependencies } = createService([task({ anchorAt: at(3, 8) })])
    let anchorWhenExecuted: number | undefined
    dependencies.execute.mockImplementation(async () => {
      anchorWhenExecuted = dependencies.write.mock.lastCall?.[0][0].anchorAt
      return { success: true }
    })
    service.start()
    await vi.advanceTimersByTimeAsync(SCHEDULER_STARTUP_DELAY_MS)

    expect(anchorWhenExecuted).toBe(at(3, 9) + SCHEDULER_STARTUP_DELAY_MS)
    service.stop()
  })

  it('disables a one-off after it runs', async () => {
    vi.setSystemTime(at(3, 8, 59))
    const { service, dependencies } = createService([
      task({ schedule: { kind: 'once', at: at(3, 9) }, anchorAt: at(3, 8) })
    ])
    service.start()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(dependencies.execute).toHaveBeenCalledTimes(1)
    expect(service.list()[0]).toMatchObject({ enabled: false, nextRunAt: null })
    expect(vi.getTimerCount()).toBe(0)
    service.stop()
  })

  it('runs a slightly late task on startup but records a stale one as missed', async () => {
    vi.setSystemTime(at(3, 9, 1))
    const recent = createService([task({ anchorAt: at(3, 8) })])
    recent.service.start()
    await vi.advanceTimersByTimeAsync(SCHEDULER_STARTUP_DELAY_MS)
    expect(recent.dependencies.execute).toHaveBeenCalledTimes(1)
    recent.service.stop()

    vi.setSystemTime(at(3, 12))
    const stale = createService([task({ anchorAt: at(3, 8) })])
    stale.service.start()
    await vi.advanceTimersByTimeAsync(SCHEDULER_STARTUP_DELAY_MS)
    expect(stale.dependencies.execute).not.toHaveBeenCalled()
    expect(stale.service.list()[0].lastRun).toEqual({ at: at(3, 9), status: 'missed' })
    expect(stale.dependencies.notifyFailure).not.toHaveBeenCalled()
    stale.service.stop()
  })

  it('catches up once when enabled, however many runs were missed', async () => {
    vi.setSystemTime(at(6, 12))
    const { service, dependencies } = createService([task({ catchUp: true, anchorAt: at(1) })])
    service.start()
    await vi.advanceTimersByTimeAsync(HOUR)

    expect(dependencies.execute).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('never catches up a power command, even when stored with catch-up enabled', async () => {
    vi.setSystemTime(at(3, 12))
    const { service, dependencies } = createService(
      [task({ target: 'system/关机', catchUp: true, anchorAt: at(3, 8) })],
      ['system/关机']
    )
    service.start()
    await vi.advanceTimersByTimeAsync(SCHEDULER_STARTUP_DELAY_MS)

    expect(dependencies.execute).not.toHaveBeenCalled()
    expect(service.list()[0].lastRun?.status).toBe('missed')
    service.stop()
  })

  it('uses a shorter on-time window for power commands', async () => {
    // 迟到 1 分钟对普通指令仍算准点，对电源指令可能是刚开机。
    vi.setSystemTime(at(3, 9, 1))
    const { service, dependencies } = createService(
      [task({ target: 'system/关机', anchorAt: at(3, 8) })],
      ['system/关机']
    )
    service.start()
    await vi.advanceTimersByTimeAsync(SCHEDULER_STARTUP_DELAY_MS)

    expect(dependencies.execute).not.toHaveBeenCalled()
    service.stop()
  })

  it('treats an unresolved target as a power command when deciding on a late run', async () => {
    vi.setSystemTime(at(3, 12))
    const { service, dependencies } = createService([task({ catchUp: true, anchorAt: at(3, 8) })])
    dependencies.isPowerTarget.mockRejectedValue(new Error('目录不可用'))
    service.start()
    await vi.advanceTimersByTimeAsync(SCHEDULER_STARTUP_DELAY_MS)

    expect(dependencies.execute).not.toHaveBeenCalled()
    service.stop()
  })

  it('notifies and records a failed run', async () => {
    vi.setSystemTime(at(3, 9))
    const { service, dependencies } = createService([task({ anchorAt: at(3, 8) })])
    dependencies.execute.mockResolvedValue({ success: false, error: '指令已删除' } as never)
    service.start()
    await vi.advanceTimersByTimeAsync(SCHEDULER_STARTUP_DELAY_MS)

    expect(dependencies.notifyFailure).toHaveBeenCalledOnce()
    expect(service.list()[0].lastRun).toMatchObject({ status: 'failed', error: '指令已删除' })
    service.stop()
  })

  it('records a thrown execution as failed rather than rejecting', async () => {
    vi.setSystemTime(at(3, 9))
    const { service, dependencies } = createService([task({ anchorAt: at(3, 8) })])
    dependencies.execute.mockRejectedValue(new Error('服务未就绪'))
    service.start()
    await vi.advanceTimersByTimeAsync(SCHEDULER_STARTUP_DELAY_MS)

    expect(service.list()[0].lastRun).toMatchObject({ status: 'failed', error: '服务未就绪' })
    service.stop()
  })

  it('rechecks at least once a minute so clock changes are noticed', async () => {
    vi.setSystemTime(at(3, 8))
    const { service, dependencies } = createService([task({ anchorAt: at(3, 8) })])
    service.start()
    await vi.advanceTimersByTimeAsync(SCHEDULER_STARTUP_DELAY_MS)
    expect(dependencies.execute).not.toHaveBeenCalled()

    // 假定时器不会因系统时间跳变而提前触发，由周期检查发现已到期的任务。
    vi.setSystemTime(at(3, 9))
    await vi.advanceTimersByTimeAsync(SCHEDULER_MAX_WAIT_MS)
    expect(dependencies.execute).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('still fires after the clock moved back past the anchor', async () => {
    vi.setSystemTime(at(3, 8, 59))
    const { service, dependencies } = createService([task({ anchorAt: at(10) })])
    service.start()
    await vi.advanceTimersByTimeAsync(MINUTE)

    expect(dependencies.execute).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('catches a due run when check is called on resume', async () => {
    vi.setSystemTime(at(3, 8))
    const { service, dependencies } = createService([task({ anchorAt: at(3, 8) })])
    service.start()

    vi.setSystemTime(at(3, 9, 1))
    service.check()
    await vi.advanceTimersByTimeAsync(0)

    expect(dependencies.execute).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('does not fire after stop', async () => {
    vi.setSystemTime(at(3, 8, 59))
    const { service, dependencies } = createService([task({ anchorAt: at(3, 8) })])
    service.start()
    service.stop()
    await vi.advanceTimersByTimeAsync(HOUR)
    service.check()

    expect(dependencies.execute).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores malformed stored records without losing valid ones', () => {
    const { service } = createService([
      null,
      { id: 'broken' },
      task({ id: 'bad', schedule: { kind: 'daily', time: 'noon' } }),
      task()
    ])
    service.start()

    expect(service.list().map((item) => item.id)).toEqual(['task'])
    service.stop()
  })

  it('saves a new task and schedules it from now', async () => {
    vi.setSystemTime(at(3, 8, 59))
    const { service, dependencies, stored } = createService()
    service.start()

    const result = await service.save(draft())

    expect(result).toMatchObject({ success: true, task: { anchorAt: at(3, 8, 59) } })
    expect(stored()).toHaveLength(1)
    expect(dependencies.changed).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(dependencies.execute).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('rejects invalid input', async () => {
    vi.setSystemTime(at(3, 9))
    const { service } = createService()
    service.start()

    expect((await service.save(draft({ target: ' ' }))).success).toBe(false)
    expect(
      (await service.save(draft({ schedule: { kind: 'interval', minutes: 0 } }))).success
    ).toBe(false)
    expect((await service.save(draft({ schedule: { kind: 'once', at: at(3, 8) } }))).success).toBe(
      false
    )
    expect((await service.save(draft({ id: 'unknown' }))).success).toBe(false)
    expect(service.list()).toEqual([])
    service.stop()
  })

  it('refuses a repeating interval or catch-up on a power command', async () => {
    vi.setSystemTime(at(3, 9))
    const { service } = createService([], ['system/关机'])
    service.start()

    const interval = await service.save(
      draft({ target: 'system/关机', schedule: { kind: 'interval', minutes: 60 } })
    )
    const catchUp = await service.save(draft({ target: 'system/关机', catchUp: true }))
    const daily = await service.save(draft({ target: 'system/关机' }))

    expect(interval.success).toBe(false)
    expect(catchUp.success).toBe(false)
    expect(daily.success).toBe(true)
    service.stop()
  })

  it('does not run triggers that passed while disabled once re-enabled', async () => {
    vi.setSystemTime(at(3, 8))
    const { service, dependencies } = createService([
      task({ enabled: false, catchUp: true, anchorAt: at(1) })
    ])
    service.start()

    vi.setSystemTime(at(3, 12))
    await service.save(draft({ id: 'task', catchUp: true }))
    await vi.advanceTimersByTimeAsync(HOUR)

    expect(dependencies.execute).not.toHaveBeenCalled()
    expect(service.list()[0].anchorAt).toBe(at(3, 12))
    service.stop()
  })

  it('keeps the plan when only the name changes', async () => {
    vi.setSystemTime(at(3, 8))
    const { service } = createService([task({ anchorAt: at(3, 7) })])
    service.start()

    await service.save(draft({ id: 'task', name: '日报' }))

    expect(service.list()[0]).toMatchObject({ name: '日报', anchorAt: at(3, 7) })
    service.stop()
  })

  it('runs now without changing the schedule', async () => {
    vi.setSystemTime(at(3, 8))
    const { service, dependencies } = createService([task({ anchorAt: at(3, 7) })])
    service.start()

    await expect(service.runNow('task')).resolves.toEqual({ success: true })
    await expect(service.runNow('missing')).resolves.toMatchObject({ success: false })

    expect(dependencies.execute).toHaveBeenCalledTimes(1)
    expect(service.list()[0]).toMatchObject({ anchorAt: at(3, 7), nextRunAt: at(3, 9) })
    service.stop()
  })

  it('drops the result of a task deleted while it was running', async () => {
    vi.setSystemTime(at(3, 8))
    const { service, dependencies, stored } = createService([task({ anchorAt: at(3, 7) })])
    let finish: (value: { success: boolean }) => void = () => undefined
    dependencies.execute.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    service.start()

    const running = service.runNow('task')
    service.remove('task')
    finish({ success: true })
    await running

    expect(stored()).toEqual([])
    service.stop()
  })
})
