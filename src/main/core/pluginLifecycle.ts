import type { WebContentsView } from 'electron'
import type { PluginEnterPayload } from '../../shared/pluginLaunch'
import { setPluginInstanceContext } from './commands/pluginLaunchContext'

export type PluginLifecycleEvent = 'PluginEnter' | 'PluginOut' | 'PluginDetach'

/**
 * 按调用顺序发送插件生命周期通知，不等待插件回调完成。
 * @param view 接收事件的插件实例
 * @param eventName 生命周期名称
 * @param payload 本次进入参数或退出状态
 * @returns 无返回值；视图不可用或发送失败时记录日志并结束
 */
export function sendPluginLifecycle(
  view: WebContentsView,
  eventName: PluginLifecycleEvent,
  payload?: PluginEnterPayload | boolean
): void {
  // 已销毁的实例无法接收通知，直接跳过以允许宿主继续清理。
  const contents = view?.webContents
  if (!contents || contents.isDestroyed()) {
    console.warn('[插件][生命周期] 跳过派发：视图不可用或已销毁', { eventName })
    return
  }

  try {
    console.log('[插件][生命周期] 派发事件', { webContentsId: contents.id, eventName })
    if (eventName === 'PluginEnter') {
      // 先绑定本次实例参数，确保插件收到进入通知后查询到同一份快照。
      setPluginInstanceContext(contents, payload)
      contents.send('on-plugin-enter', payload)
    } else if (eventName === 'PluginOut') {
      contents.send('plugin-out', !!payload)
    } else {
      contents.send('plugin-detach')
    }
  } catch (error) {
    // 通知失败不得阻断视图切换、销毁等宿主清理流程。
    console.error('[插件][生命周期] 派发失败', { webContentsId: contents.id, eventName }, error)
  }
}
