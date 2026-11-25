import type { Session } from 'electron'

/**
 * 为插件主视图与独立窗口使用的共享 Session 注册宿主 preload。
 * @param session 当前插件 Session。
 * @param filePath 宿主 preload 的绝对路径。
 * @returns 无返回值。
 * @throws Electron 查询或注册 Session preload 失败时抛出原始错误。
 */
export function ensurePluginSessionPreload(
  session: Pick<Session, 'getPreloads' | 'setPreloads'>,
  filePath: string
): void {
  // Electron 34 的 setPreloads 会替换整份列表，追加宿主脚本时须保留已注册的脚本。
  const existingPreloads = session.getPreloads()
  if (!existingPreloads.includes(filePath)) {
    session.setPreloads([...existingPreloads, filePath])
  }
}
