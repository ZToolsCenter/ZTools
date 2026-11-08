import { Notification, powerMonitor } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import databaseAPI from '../../api/shared/database'
import { getCommandService } from '../commands/runtime'
import { isPowerCommand } from '../../../shared/scheduledTasks'
import { HOST_STORAGE_KEYS } from '../../../shared/storageKeys'
import { ScheduledTaskService } from './service'

let service: ScheduledTaskService | undefined
let onResume: (() => void) | undefined

/**
 * 获取已初始化的定时任务服务。
 * @returns 共享服务
 * @throws 初始化前访问时抛错
 */
export function getScheduledTaskService(): ScheduledTaskService {
  if (!service) throw new Error('定时任务服务尚未初始化')
  return service
}

/**
 * 连接存储、指令服务和系统事件，并开始调度。
 * @param pluginManager 用于向设置页推送变更的插件管理器
 * @returns 已启动的服务
 */
export function startScheduledTasks(pluginManager: PluginManager | null): ScheduledTaskService {
  const started = new ScheduledTaskService({
    read: () => databaseAPI.dbGet(HOST_STORAGE_KEYS.scheduledTasks),
    write: (tasks) => databaseAPI.dbPut(HOST_STORAGE_KEYS.scheduledTasks, tasks),
    execute: (target) =>
      getCommandService().execute('scheduled-task', { target, source: 'scheduled-task' }),
    isPowerTarget: async (target) =>
      (await getCommandService().getTargetCandidates(target)).some(isPowerCommand),
    notifyFailure: (task, error) => {
      if (!Notification.isSupported()) return
      new Notification({
        title: `定时任务运行失败：${task.name || task.target}`,
        body: error
      }).show()
    },
    changed: () =>
      pluginManager?.getPluginWebContentsByName('setting')?.send('scheduled-tasks-changed')
  })
  service = started
  started.start()
  // 休眠期间定时器不走，唤醒后立即检查，避免最多再等一个定时器周期。
  onResume = () => started.check()
  powerMonitor.on('resume', onResume)
  return started
}

/**
 * 停止调度并释放系统事件监听。
 * @returns 无返回值
 */
export function stopScheduledTasks(): void {
  service?.stop()
  if (onResume) powerMonitor.removeListener('resume', onResume)
  onResume = undefined
}
