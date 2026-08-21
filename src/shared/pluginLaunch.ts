/**
 * 插件启动来源，用于决定是否允许本次启动唤起主窗口。
 */
export type PluginLaunchSource = 'search' | 'global-shortcut' | 'super-panel'

/**
 * 判断一次插件启动是否应保持主窗口隐藏。
 * @param source 插件启动来源。
 * @param mainHide feature 是否声明了 `mainHide: true`。
 * @returns 由全局快捷键或超级面板触发 mainHide feature 时返回 true，否则返回 false。
 */
export function shouldKeepMainWindowHiddenForLaunch(
  source: PluginLaunchSource | undefined,
  mainHide: boolean
): boolean {
  return (source === 'global-shortcut' || source === 'super-panel') && mainHide
}
