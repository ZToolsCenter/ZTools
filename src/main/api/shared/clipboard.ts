import { ipcMain } from 'electron'
import clipboardManager from '../../clipboardManager.js'
import windowManager from '../../windowManager.js'
import appleScriptHelper from '../../utils/appleScriptHelper.js'

/**
 * 剪贴板历史管理API - 主程序和插件共享
 */
export class ClipboardAPI {
  public init(): void {
    this.setupIPC()
  }

  private setupIPC(): void {
    // 获取剪贴板历史
    ipcMain.handle(
      'clipboard:get-history',
      async (_event, page: number, pageSize: number, filter?: any) => {
        try {
          return await clipboardManager.getHistory(page, pageSize, filter)
        } catch (error) {
          console.error('获取剪贴板历史失败:', error)
          return { items: [], total: 0, page, pageSize }
        }
      }
    )

    // 搜索剪贴板
    ipcMain.handle('clipboard:search', async (_event, keyword: string) => {
      try {
        return await clipboardManager.search(keyword)
      } catch (error) {
        console.error('搜索剪贴板失败:', error)
        return []
      }
    })

    // 删除剪贴板记录
    ipcMain.handle('clipboard:delete', async (_event, id: string) => {
      try {
        const result = await clipboardManager.deleteItem(id)
        return { success: result }
      } catch (error) {
        console.error('删除剪贴板记录失败:', error)
        return { success: false }
      }
    })

    // 清空剪贴板历史
    ipcMain.handle('clipboard:clear', async (_event, type?: string) => {
      try {
        const count = await clipboardManager.clear(type as any)
        return { success: true, count }
      } catch (error) {
        console.error('清空剪贴板历史失败:', error)
        return { success: false, count: 0 }
      }
    })

    // 获取剪贴板状态
    ipcMain.handle('clipboard:get-status', async () => {
      try {
        return await clipboardManager.getStatus()
      } catch (error) {
        console.error('获取剪贴板状态失败:', error)
        return {
          isRunning: false,
          itemCount: 0,
          imageCount: 0,
          imageStorageSize: 0
        }
      }
    })

    // 写回剪贴板
    ipcMain.handle('clipboard:write', async (_event, id: string) => {
      // 先隐藏窗口
      windowManager.hideWindow()
      // 设置窗口激活状态
      const previousActiveWindow = windowManager.getPreviousActiveWindow()
      if (previousActiveWindow) {
        clipboardManager.activateApp(previousActiveWindow)
      }
      try {
        const result = await clipboardManager.writeToClipboard(id)
        appleScriptHelper.paste()
        return { success: result }
      } catch (error) {
        console.error('写回剪贴板失败:', error)
        return { success: false }
      }
    })

    // 更新剪贴板配置
    ipcMain.handle('clipboard:update-config', (_event, config: any) => {
      try {
        clipboardManager.updateConfig(config)
        return { success: true }
      } catch (error) {
        console.error('更新剪贴板配置失败:', error)
        return { success: false }
      }
    })
  }
}

export default new ClipboardAPI()
