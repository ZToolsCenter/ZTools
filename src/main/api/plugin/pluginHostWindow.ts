import { BrowserWindow, type WebContents } from 'electron'
import detachedWindowManager from '../../core/detachedWindowManager'

/**
 * 查找插件内容的宿主，允许尚未附加的缓存视图读取预定主窗口。
 * @param contents 发起请求的插件内容。
 * @param mainWindow 当前主窗口；休眠时可能为空。
 * @returns 分离宿主、插件自建窗口或当前主窗口。
 */
export function getPluginHostWindow(
  contents: WebContents,
  mainWindow: BrowserWindow | null
): BrowserWindow | null {
  // 分离映射先于视图迁移完成，优先使用它而不是迁移前的窗口归属。
  return (
    detachedWindowManager.getWindowByPluginWebContents(contents.id) ??
    BrowserWindow.fromWebContents(contents) ??
    mainWindow
  )
}
