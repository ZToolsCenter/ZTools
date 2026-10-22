import type { Session } from 'electron'

/**
 * 为插件主视图与独立窗口使用的共享 Session 注册宿主 preload。
 * @param session 当前插件 Session。
 * @param filePath 宿主 preload 的绝对路径。
 * @returns 已注册 preload 的 ID。
 * @throws Electron 查询或注册 Session preload 失败时抛出原始错误。
 */
export function ensurePluginSessionPreload(session: Session, filePath: string): string {
  // 同一 Session 会被主视图、独立窗口和重建流程复用，避免每次创建都追加脚本。
  const registered = session
    .getPreloadScripts()
    .find((script) => script.type === 'frame' && script.filePath === filePath)
  return registered?.id ?? session.registerPreloadScript({ type: 'frame', filePath })
}
