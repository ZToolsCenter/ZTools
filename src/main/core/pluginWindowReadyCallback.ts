import type { Event, WebContents, WebContentsDidStartNavigationEventParams } from 'electron'

// Electron 41 的非隔离 Node preload 在首次加载后立即重载时可能崩溃，等待初始化收尾。
const PLUGIN_WINDOW_INITIALIZATION_DELAY_MS = 1000

/**
 * 在插件独立窗口加载完成并经过初始化间隔后通知创建者，取消过期文档的通知。
 * @param contents 独立窗口的 WebContents。
 * @param callback 通知父插件窗口就绪的回调。
 * @returns 无返回值。
 */
export function registerPluginWindowReadyCallback(
  contents: WebContents,
  callback: () => void
): void {
  let timer: ReturnType<typeof setTimeout> | undefined

  /**
   * 清除尚未送达的窗口就绪通知，避免重载或销毁后调用旧文档回调。
   * @returns 无返回值。
   */
  function cancelPending(): void {
    clearTimeout(timer)
    timer = undefined
  }

  /**
   * 为完成加载的文档安排通知，让 Node preload 与初始页面任务完成收尾。
   * @returns 无返回值。
   */
  function onLoaded(): void {
    cancelPending()
    timer = setTimeout(() => {
      timer = undefined
      // 期间关闭窗口时不再执行父窗口代码。
      if (!contents.isDestroyed()) callback()
    }, PLUGIN_WINDOW_INITIALIZATION_DELAY_MS)
  }

  /**
   * 主文档导航时取消其待送达通知，子框架和 hash 导航不影响初始化。
   * @param details Electron 导航事件及主框架标记。
   * @returns 无返回值。
   */
  function onNavigation(details: Event<WebContentsDidStartNavigationEventParams>): void {
    if (details.isMainFrame && !details.isSameDocument) cancelPending()
  }

  /**
   * 窗口销毁时释放计时器和加载监听，避免回调持有已释放的插件实例。
   * @returns 无返回值。
   */
  function onDestroyed(): void {
    cancelPending()
    contents.removeListener('did-finish-load', onLoaded)
    contents.removeListener('did-start-navigation', onNavigation)
  }

  // DOM 就绪早于页面和 Node preload 的初始化完成，不能在 dom-ready 中触发重载回调。
  contents.on('did-finish-load', onLoaded)
  contents.on('did-start-navigation', onNavigation)
  contents.once('destroyed', onDestroyed)
}
