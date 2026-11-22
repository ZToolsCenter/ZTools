import databaseAPI from '../api/shared/database'
import { normalizeMainWindowSleepSeconds } from '../../shared/mainWindowSleep'

/** 为单个窗口记录连续隐藏时间，按设备的节省模式配置安排回收。 */
export class HiddenWindowSleep {
  private hiddenSince: number | null = null
  private timer: NodeJS.Timeout | null = null

  /**
   * 绑定窗口自己的回收条件和清理逻辑。
   * @param onExpired 已达到隐藏期限时执行的回调。
   * @returns 独立于其他窗口的休眠计时器。
   */
  constructor(private readonly onExpired: () => void) {}

  /**
   * 开始计算本次连续隐藏时长。
   * @returns 无返回值。
   */
  hide(): void {
    this.hiddenSince ??= Date.now()
    this.refresh()
  }

  /**
   * 窗口显示或关闭后取消本次回收。
   * @returns 无返回值。
   */
  reset(): void {
    this.hiddenSince = null
    this.refresh()
  }

  /**
   * 按最初的隐藏时间重新应用设置，到期时交给窗口判断能否销毁。
   * @returns 无返回值。
   */
  refresh(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.hiddenSince === null) return
    const settings = databaseAPI.dbGet('settings-general')
    if (settings?.mainWindowSleepEnabled !== true) return
    const seconds = normalizeMainWindowSleepSeconds(settings.mainWindowSleepSeconds)
    const remaining = this.hiddenSince + seconds * 1000 - Date.now()
    if (remaining <= 0) {
      this.onExpired()
      return
    }
    // Node 的定时器上限为 32 位，每次到点重新读取设置并核对期限。
    this.timer = setTimeout(() => this.refresh(), Math.min(remaining, 2147483647))
    this.timer.unref()
  }
}
