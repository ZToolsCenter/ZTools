import { BrowserWindow, ipcMain } from 'electron'

// 共享API（主程序和插件都能用）
import databaseAPI from './shared/database'
import clipboardAPI from './shared/clipboard'

// 主程序渲染进程专用API
import appsAPI from './renderer/apps'
import pluginsAPI from './renderer/plugins'
import windowAPI from './renderer/window'
import settingsAPI from './renderer/settings'
import systemAPI from './renderer/system'

// 插件专用API
import pluginLifecycleAPI from './plugin/lifecycle'
import pluginUIAPI from './plugin/ui'
import pluginClipboardAPI from './plugin/clipboard'
import pluginDialogAPI from './plugin/dialog'
import pluginWindowAPI from './plugin/window'
import pluginScreenAPI from './plugin/screen'
import pluginInputAPI from './plugin/input'
import pluginShellAPI from './plugin/shell'
import { pluginFeatureAPI } from './plugin/feature'

/**
 * API管理器 - 统一初始化和管理所有API模块
 */
class APIManager {
  private mainWindow: BrowserWindow | null = null
  private pluginManager: any = null

  /**
   * 初始化所有API模块
   */
  public init(mainWindow: BrowserWindow, pluginManager: any): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager

    // 初始化共享API
    databaseAPI.init(pluginManager)
    clipboardAPI.init()

    // 初始化主程序API
    appsAPI.init(mainWindow, pluginManager)
    pluginsAPI.init(mainWindow, pluginManager)
    windowAPI.init(mainWindow)
    settingsAPI.init(mainWindow)
    systemAPI.init(mainWindow)

    // 初始化插件API
    pluginLifecycleAPI.init(mainWindow, pluginManager)
    pluginUIAPI.init(mainWindow, pluginManager)
    pluginClipboardAPI.init()
    pluginDialogAPI.init(mainWindow)
    pluginWindowAPI.init(mainWindow, pluginManager)
    pluginScreenAPI.init()
    pluginInputAPI.init(pluginManager)
    pluginShellAPI.init()
    pluginFeatureAPI.init(pluginManager)

    // 设置一些特殊的IPC处理器
    this.setupSpecialHandlers()

    // 设置全局快捷键处理器（需要访问多个模块）
    settingsAPI.setGlobalShortcutHandler((target) => this.handleGlobalShortcut(target))
  }

  /**
   * 设置特殊的IPC处理器
   * 这些处理器需要协调多个模块，所以放在这里统一管理
   */
  private setupSpecialHandlers(): void {
    // 打开插件开发者工具
    ipcMain.handle('open-plugin-devtools', () => {
      try {
        if (this.pluginManager) {
          const result = this.pluginManager.openPluginDevTools()
          if (result) {
            return { success: true }
          } else {
            return { success: false, error: '没有活动的插件' }
          }
        }
        return { success: false, error: '功能不可用' }
      } catch (error: any) {
        console.error('打开开发者工具失败:', error)
        return { success: false, error: error.message || '未知错误' }
      }
    })
  }

  /**
   * 设置启动参数（用于插件进入时传递参数）
   */
  public setLaunchParam(param: any): void {
    pluginLifecycleAPI.setLaunchParam(param)
  }

  /**
   * 获取启动参数
   */
  public getLaunchParam(): any {
    return appsAPI.getLaunchParam()
  }

  /**
   * 数据库辅助方法（供其他模块使用）
   */
  public async dbPut(key: string, data: any): Promise<any> {
    return await databaseAPI.dbPut(key, data)
  }

  public async dbGet(key: string): Promise<any> {
    return await databaseAPI.dbGet(key)
  }

  /**
   * 调整窗口高度（供 pluginManager 使用）
   */
  public resizeWindow(height: number): void {
    windowAPI.resizeWindow(height)
  }

  /**
   * 处理全局快捷键触发
   * 这个方法协调多个模块，所以放在 APIManager 中
   */
  private async handleGlobalShortcut(target: string): Promise<void> {
    try {
      const parts = target.split('/')
      if (parts.length !== 2) {
        console.error('目标指令格式错误:', target)
        return
      }

      const [pluginDescription, cmdName] = parts
      const plugins: any = await databaseAPI.dbGet('plugins')
      if (!plugins || !Array.isArray(plugins)) {
        console.error('未找到插件列表')
        return
      }

      const plugin = plugins.find((p: any) => p.name === pluginDescription)
      if (!plugin) {
        console.error(`未找到插件: ${pluginDescription}`)
        return
      }

      let targetFeature: any = null
      for (const feature of plugin.features || []) {
        if (feature.cmds && Array.isArray(feature.cmds)) {
          for (const cmd of feature.cmds) {
            const cmdLabel = typeof cmd === 'string' ? cmd : cmd.label
            if (cmdLabel === cmdName) {
              targetFeature = feature
              break
            }
          }
          if (targetFeature) break
        }
      }

      if (!targetFeature) {
        console.error(`未找到命令: ${pluginDescription}/${cmdName}`)
        return
      }

      const launchOptions = {
        path: plugin.path,
        type: 'plugin' as const,
        featureCode: targetFeature.code,
        param: { code: targetFeature.code }
      }
      console.log(`启动插件:`, launchOptions)

      // 导入 windowManager（避免循环依赖，在运行时导入）
      const windowManager = await import('../windowManager.js')
      windowManager.default.refreshPreviousActiveWindow()

      setTimeout(() => {
        this.mainWindow?.show()
      }, 50)

      // 通过 IPC 触发启动（让 appsAPI 处理）
      this.mainWindow?.webContents.send('ipc-launch', launchOptions)
    } catch (error) {
      console.error('处理全局快捷键失败:', error)
    }
  }
}

// 导出单例
export default new APIManager()
