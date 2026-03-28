import { app, IpcMainInvokeEvent, ipcMain } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import windowManager from '../../managers/windowManager.js'
import logCollector from '../../core/logCollector.js'
import clipboardManager from '../../managers/clipboardManager.js'
import detachedWindowManager from '../../core/detachedWindowManager.js'
import floatingBallManager from '../../core/floatingBallManager.js'
import httpServer from '../../core/httpServer.js'
import mcpServer from '../../core/mcpServer.js'
import superPanelManager from '../../core/superPanelManager.js'
import translationManager from '../../core/translationManager.js'
import aiModelsAPI from '../renderer/aiModels.js'
import commandsAPI from '../renderer/commands.js'
import pluginsAPI from '../renderer/plugins.js'
import settingsAPI from '../renderer/settings.js'
import systemAPI from '../renderer/system.js'
import webSearchAPI from '../renderer/webSearch.js'
import windowAPI from '../renderer/window.js'
import pluginToolsAPI from './tools'
import databaseAPI from '../shared/database'
import updaterAPI from '../updater.js'

/**
 * 权限错误类
 */
class PermissionDeniedError extends Error {
  constructor(apiName: string) {
    super(`API "${apiName}" 仅限内置插件调用`)
    this.name = 'PermissionDeniedError'
  }
}

/**
 * 检查是否为内置插件调用
 * @param pluginManager 插件管理器实例
 * @param event IPC 事件对象
 * @returns 是否允许调用（内置插件或主渲染进程）
 */
export function requireInternalPlugin(
  pluginManager: PluginManager | null,
  event: IpcMainInvokeEvent
): boolean {
  if (!pluginManager) return true // 没有 pluginManager，允许通过
  const pluginInfo = pluginManager.getPluginInfoByWebContents(event.sender)

  if (!pluginInfo) {
    // 不是插件调用（可能是主渲染进程），允许通过
    return true
  }

  // 检查是否为内置插件
  return pluginInfo.isInternal
}

/**
 * 内置插件专用 API 类
 * 提供与主渲染进程相同的 API，但仅限内置插件调用
 * 采用转发策略：将内置插件的 API 调用转发到已有的 renderer API
 */
export class InternalPluginAPI {
  private pluginManager: PluginManager | null = null
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  private setupIPC(): void {
    // ==================== 数据库 API (ZTOOLS/ 命名空间) ====================
    ipcMain.handle('internal:db-put', (event, key: string, value: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:db-put')
      }
      return databaseAPI.dbPut(key, value)
    })

    ipcMain.handle('internal:db-get', (event, key: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:db-get')
      }
      return databaseAPI.dbGet(key)
    })

    // ==================== 应用启动 API ====================
    ipcMain.handle('internal:launch', async (event, options: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:launch')
      }
      console.log('[Internal] 启动应用', options)
      return await (commandsAPI as any).launch(options)
    })

    ipcMain.handle('internal:quit-app', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:quit-app')
      }
      // 与托盘「退出」一致：设置退出标志后再 quit，否则 before-quit 会阻止并只隐藏窗口
      windowManager.setQuitting(true)
      app.quit()
      return { success: true }
    })

    // ==================== 指令管理 API ====================
    ipcMain.handle('internal:get-commands', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-commands')
      }
      return await (commandsAPI as any).getCommands()
    })

    // ==================== 插件管理 API ====================
    ipcMain.handle('internal:get-plugins', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugins')
      }
      return await (pluginsAPI as any).getPlugins()
    })

    ipcMain.handle('internal:get-all-plugins', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-all-plugins')
      }
      return await (pluginsAPI as any).getAllPlugins()
    })

    ipcMain.handle('internal:select-plugin-file', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:select-plugin-file')
      }
      return await (pluginsAPI as any).selectPluginFile()
    })

    ipcMain.handle('internal:import-plugin', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:import-plugin')
      }
      return await (pluginsAPI as any).importPlugin()
    })

    ipcMain.handle('internal:read-plugin-info-from-zpx', async (event, zpxPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:read-plugin-info-from-zpx')
      }
      return await (pluginsAPI as any).readPluginInfoFromZpx(zpxPath)
    })

    ipcMain.handle('internal:install-plugin-from-path', async (event, zpxPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:install-plugin-from-path')
      }
      return await (pluginsAPI as any).installPluginFromPath(zpxPath)
    })

    ipcMain.handle('internal:import-dev-plugin', async (event, pluginJsonPath?: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:import-dev-plugin')
      }
      return await (pluginsAPI as any).importDevPlugin(pluginJsonPath)
    })

    ipcMain.handle('internal:delete-plugin', async (event, pluginPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:delete-plugin')
      }
      return await (pluginsAPI as any).deletePlugin(pluginPath)
    })

    ipcMain.handle('internal:reload-plugin', async (event, pluginPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:reload-plugin')
      }
      return await (pluginsAPI as any).reloadPlugin(pluginPath)
    })

    ipcMain.handle('internal:get-running-plugins', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-running-plugins')
      }
      return await (pluginsAPI as any).getRunningPlugins()
    })

    ipcMain.handle('internal:kill-plugin', async (event, pluginPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:kill-plugin')
      }
      return await (pluginsAPI as any).killPlugin(pluginPath)
    })

    ipcMain.handle('internal:fetch-plugin-market', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:fetch-plugin-market')
      }
      return await (pluginsAPI as any).fetchPluginMarket()
    })

    ipcMain.handle('internal:install-plugin-from-market', async (event, plugin: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:install-plugin-from-market')
      }
      return await (pluginsAPI as any).installPluginFromMarket(plugin)
    })

    ipcMain.handle(
      'internal:install-plugin-from-npm',
      async (event, options: { packageName: string; useChinaMirror?: boolean }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:install-plugin-from-npm')
        }
        return await (pluginsAPI as any).installPluginFromNpm(
          options.packageName,
          options.useChinaMirror
        )
      }
    )

    ipcMain.handle(
      'internal:get-plugin-readme',
      async (event, pluginPathOrName: string, pluginName?: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:get-plugin-readme')
        }
        return await (pluginsAPI as any).getPluginReadme(pluginPathOrName, pluginName)
      }
    )

    ipcMain.handle('internal:get-plugin-doc-keys', async (event, pluginName: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugin-doc-keys')
      }
      return await databaseAPI.getPluginDocKeys(pluginName)
    })

    ipcMain.handle('internal:get-plugin-doc', async (event, pluginName: string, docKey: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugin-doc')
      }
      return await databaseAPI.getPluginDoc(pluginName, docKey)
    })

    ipcMain.handle('internal:get-plugin-data-stats', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugin-data-stats')
      }
      return await databaseAPI.getPluginDataStats()
    })

    ipcMain.handle('internal:clear-plugin-data', async (event, pluginName: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:clear-plugin-data')
      }
      return await databaseAPI.clearPluginData(pluginName)
    })

    ipcMain.handle('internal:package-plugin', async (event, pluginPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:package-plugin')
      }
      return await (pluginsAPI as any).packagePlugin(pluginPath)
    })

    ipcMain.handle('internal:get-plugin-memory-info', async (event, pluginPath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-plugin-memory-info')
      }
      try {
        const memoryInfo = await this.pluginManager?.getPluginMemoryInfo(pluginPath)
        return { success: true, data: memoryInfo }
      } catch (error: unknown) {
        console.error('[Internal API] 获取内存信息失败:', error)
        return { success: false, error: error instanceof Error ? error.message : '获取失败' }
      }
    })

    // ==================== AI 模型管理 API ====================
    ipcMain.handle('internal:ai-models-get-all', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:ai-models-get-all')
      }
      try {
        const models = (aiModelsAPI as any).getAllModels()
        return { success: true, data: models }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    ipcMain.handle('internal:ai-models-add', async (event, model: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:ai-models-add')
      }
      return await (aiModelsAPI as any).addModel(model)
    })

    ipcMain.handle('internal:ai-models-update', async (event, model: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:ai-models-update')
      }
      return await (aiModelsAPI as any).updateModel(model)
    })

    ipcMain.handle('internal:ai-models-delete', async (event, modelId: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:ai-models-delete')
      }
      return await (aiModelsAPI as any).deleteModel(modelId)
    })

    // ==================== 全局快捷键 API ====================
    ipcMain.handle(
      'internal:register-global-shortcut',
      async (event, shortcut: string, target: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:register-global-shortcut')
        }
        return (settingsAPI as any).registerGlobalShortcut(shortcut, target)
      }
    )

    ipcMain.handle('internal:unregister-global-shortcut', async (event, shortcut: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:unregister-global-shortcut')
      }
      return (settingsAPI as any).unregisterGlobalShortcut(shortcut)
    })

    ipcMain.handle('internal:start-hotkey-recording', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:start-hotkey-recording')
      }
      return await (settingsAPI as any).startHotkeyRecording()
    })

    ipcMain.handle('internal:update-shortcut', async (event, shortcut: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-shortcut')
      }
      return await (settingsAPI as any).updateShortcut(shortcut)
    })

    // ==================== 应用快捷键 API ====================
    ipcMain.handle(
      'internal:register-app-shortcut',
      async (event, shortcut: string, target: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:register-app-shortcut')
        }
        return (settingsAPI as any).registerAppShortcut(shortcut, target)
      }
    )

    ipcMain.handle('internal:unregister-app-shortcut', async (event, shortcut: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:unregister-app-shortcut')
      }
      return (settingsAPI as any).unregisterAppShortcut(shortcut)
    })

    // ==================== 系统设置 API ====================
    ipcMain.handle('internal:set-window-opacity', async (event, opacity: number) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-window-opacity')
      }
      return await (windowAPI as any).setWindowOpacity(opacity)
    })

    ipcMain.handle('internal:set-window-default-height', async (event, height: number) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-window-default-height')
      }
      return await (settingsAPI as any).setWindowDefaultHeight(height)
    })

    ipcMain.handle('internal:select-avatar', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:select-avatar')
      }
      return await (systemAPI as any).selectAvatar()
    })

    ipcMain.handle('internal:set-theme', async (event, theme: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-theme')
      }
      return await (settingsAPI as any).setTheme(theme)
    })

    ipcMain.handle('internal:set-tray-icon-visible', async (event, visible: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-tray-icon-visible')
      }
      return await (windowAPI as any).setTrayIconVisible(visible)
    })

    ipcMain.handle(
      'internal:set-window-material',
      async (event, material: 'mica' | 'acrylic' | 'none') => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:set-window-material')
        }
        return await (windowAPI as any).setWindowMaterial(material)
      }
    )

    ipcMain.handle('internal:get-window-material', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-window-material')
      }
      return await (windowAPI as any).getWindowMaterial()
    })

    ipcMain.handle('internal:set-launch-at-login', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:set-launch-at-login')
      }
      return await (settingsAPI as any).setLaunchAtLogin(enabled)
    })

    ipcMain.handle('internal:get-launch-at-login', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-launch-at-login')
      }
      return await (settingsAPI as any).getLaunchAtLogin()
    })

    // 设置代理配置
    ipcMain.handle(
      'internal:set-proxy-config',
      async (event, config: { enabled: boolean; url: string }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:set-proxy-config')
        }
        return await (settingsAPI as any).setProxyConfig(config)
      }
    )

    // 通知主渲染进程更新搜索框提示文字
    ipcMain.handle('internal:update-placeholder', async (event, placeholder: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-placeholder')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-placeholder', placeholder)
      return { success: true }
    })

    // 通知主渲染进程更新头像
    ipcMain.handle('internal:update-avatar', async (event, avatar: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-avatar')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-avatar', avatar)

      // 广播到超级面板窗口
      superPanelManager.broadcastToSuperPanel('update-avatar', avatar)

      return { success: true }
    })

    // 通知主渲染进程更新自动粘贴配置
    ipcMain.handle('internal:update-auto-paste', async (event, autoPaste: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-auto-paste')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-auto-paste', autoPaste)
      return { success: true }
    })

    // 通知主渲染进程更新自动清空配置
    ipcMain.handle('internal:update-auto-clear', async (event, autoClear: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-auto-clear')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-auto-clear', autoClear)
      return { success: true }
    })

    // 更新自动返回搜索配置（直接通知主进程）
    ipcMain.handle(
      'internal:update-auto-back-to-search',
      async (event, autoBackToSearch: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-auto-back-to-search')
        }
        // 直接通知 windowManager 更新配置
        await windowAPI.updateAutoBackToSearch(autoBackToSearch)
        return { success: true }
      }
    )

    // 通知主渲染进程更新显示最近使用配置
    ipcMain.handle(
      'internal:update-show-recent-in-search',
      async (event, showRecentInSearch: boolean) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-show-recent-in-search')
        }
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-show-recent-in-search', showRecentInSearch)
        return { success: true }
      }
    )

    // 通知主渲染进程更新匹配推荐配置
    ipcMain.handle(
      'internal:update-match-recommendation',
      async (event, showMatchRecommendation: boolean) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-match-recommendation')
        }
        this.mainWindow?.webContents.send('update-match-recommendation', showMatchRecommendation)
        return { success: true }
      }
    )

    // 通知主渲染进程更新最近使用行数
    ipcMain.handle('internal:update-recent-rows', async (event, rows: number) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-recent-rows')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-recent-rows', rows)
      return { success: true }
    })

    // 通知主渲染进程更新固定栏行数
    ipcMain.handle('internal:update-pinned-rows', async (event, rows: number) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-pinned-rows')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-pinned-rows', rows)
      return { success: true }
    })

    // 通知主渲染进程更新搜索框模式
    ipcMain.handle('internal:update-search-mode', async (event, mode: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-search-mode')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-search-mode', mode)
      return { success: true }
    })

    // 通知主渲染进程更新 Tab 键目标指令
    ipcMain.handle('internal:update-tab-target', async (event, target: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-tab-target')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-tab-target', target)
      return { success: true }
    })

    // 通知主渲染进程更新空格打开指令配置
    ipcMain.handle('internal:update-space-open-command', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-space-open-command')
      }
      // 广播到主渲染进程
      this.mainWindow?.webContents.send('update-space-open-command', enabled)
      return { success: true }
    })

    // 通知主渲染进程更新悬浮球双击目标指令
    ipcMain.handle(
      'internal:update-floating-ball-double-click-command',
      async (event, command: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-floating-ball-double-click-command')
        }
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-floating-ball-double-click-command', command)
        // 同步更新 floatingBallManager 的双击命令，使其立即生效
        floatingBallManager.setDoubleClickCommand(command)
        return { success: true }
      }
    )

    // 通知主渲染进程更新本地应用搜索配置
    ipcMain.handle('internal:update-local-app-search', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-local-app-search')
      }
      // 更新 commandsAPI 中的配置
      ;(commandsAPI as any).setLocalAppSearch(enabled)
      return { success: true }
    })

    // 通知主渲染进程更新主题色
    ipcMain.handle(
      'internal:update-primary-color',
      async (event, primaryColor: string, customColor?: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-primary-color')
        }
        const data = { primaryColor, customColor }
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-primary-color', data)

        // 广播到所有分离窗口
        detachedWindowManager.broadcastToAllWindows('update-primary-color', data)

        return { success: true }
      }
    )

    // 通知主渲染进程更新亚克力透明度
    ipcMain.handle(
      'internal:update-acrylic-opacity',
      async (event, lightOpacity: number, darkOpacity: number) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-acrylic-opacity')
        }
        // 广播到主渲染进程
        this.mainWindow?.webContents.send('update-acrylic-opacity', { lightOpacity, darkOpacity })

        // 广播到所有分离窗口
        detachedWindowManager.broadcastToAllWindows('update-acrylic-opacity', {
          lightOpacity,
          darkOpacity
        })

        return { success: true }
      }
    )

    ipcMain.on('internal:get-platform', (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        event.returnValue = null
        return
      }
      event.returnValue = process.platform
    })

    // ==================== 应用更新 API ====================
    ipcMain.handle('internal:updater-check-update', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:updater-check-update')
      }
      return await (updaterAPI as any).checkUpdate()
    })

    ipcMain.handle('internal:updater-start-update', async (event, updateInfo: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:updater-start-update')
      }
      return await (updaterAPI as any).startUpdate(updateInfo)
    })

    ipcMain.handle('internal:updater-set-auto-check', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:updater-set-auto-check')
      }
      ;(updaterAPI as any).setAutoCheck(enabled)
      return { success: true }
    })

    // ==================== 其他 API ====================
    ipcMain.handle('internal:reveal-in-finder', async (event, path: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:reveal-in-finder')
      }
      return await (systemAPI as any).revealInFinder(path)
    })

    // 通知主渲染进程禁用指令列表已更改
    ipcMain.handle('internal:notify-disabled-commands-changed', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:notify-disabled-commands-changed')
      }
      this.mainWindow?.webContents.send('disabled-commands-changed')
      return { success: true }
    })

    // 固定指令到搜索窗口
    ipcMain.handle('internal:pin-app', async (event, app: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:pin-app')
      }
      return (commandsAPI as any).pinApp(app)
    })

    // 取消固定指令
    ipcMain.handle(
      'internal:unpin-app',
      async (event, appPath: string, featureCode?: string, name?: string) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:unpin-app')
        }
        return (commandsAPI as any).unpinApp(appPath, featureCode, name)
      }
    )

    // ==================== 超级面板 API ====================
    ipcMain.handle(
      'internal:update-super-panel-config',
      async (event, config: { enabled: boolean; mouseButton: string; longPressMs: number }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-super-panel-config')
        }
        // 转发给 superPanelManager
        superPanelManager.updateConfig(config)
        return { success: true }
      }
    )

    ipcMain.handle(
      'internal:update-super-panel-blocked-apps',
      async (event, blockedApps: Array<{ app: string; bundleId?: string; label?: string }>) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-super-panel-blocked-apps')
        }
        superPanelManager.updateBlockedApps(blockedApps)
        return { success: true }
      }
    )

    ipcMain.handle('internal:get-current-window-info', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-current-window-info')
      }
      return clipboardManager.getCurrentWindow()
    })

    // ==================== 超级面板翻译 API ====================
    ipcMain.handle('internal:update-super-panel-translate', async (event, enabled: boolean) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:update-super-panel-translate')
      }
      translationManager.updateEnabled(enabled)
      return { success: true }
    })

    ipcMain.handle('internal:get-translation-status', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:get-translation-status')
      }
      return translationManager.getStatus()
    })

    // ==================== 剪贴板配置 API ====================
    ipcMain.handle(
      'internal:update-clipboard-config',
      async (event, config: { autoFormatText?: boolean }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:update-clipboard-config')
        }
        clipboardManager.updateConfig(config)
        return { success: true }
      }
    )

    // ==================== 图片分析 API ====================
    // 直接转发到共享的 analyze-image handler（已在 imageAnalysis.ts 中注册）
    ipcMain.handle('internal:analyze-image', async (event, imagePath: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:analyze-image')
      }
      // 直接调用主进程的 analyze-image handler
      // 通过触发器获取已注册的 handler 并调用
      const handler = (ipcMain as any)._invokeHandlers.get('analyze-image')
      if (handler) {
        return await handler(event, imagePath)
      }
      throw new Error('analyze-image handler not found')
    })

    // ==================== 网页快开 API ====================
    ipcMain.handle('internal:web-search-get-all', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-get-all')
      }
      try {
        const engines = (webSearchAPI as any).getAllEngines()
        return { success: true, data: engines }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    ipcMain.handle('internal:web-search-add', async (event, engine: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-add')
      }
      return await (webSearchAPI as any).addEngine(engine)
    })

    ipcMain.handle('internal:web-search-update', async (event, engine: any) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-update')
      }
      return await (webSearchAPI as any).updateEngine(engine)
    })

    ipcMain.handle('internal:web-search-delete', async (event, engineId: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-delete')
      }
      return await (webSearchAPI as any).deleteEngine(engineId)
    })

    ipcMain.handle('internal:web-search-fetch-favicon', async (event, url: string) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:web-search-fetch-favicon')
      }
      try {
        const icon = await (webSearchAPI as any).fetchFavicon(url)
        return { success: true, data: icon }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // ==================== 调试日志 API ====================
    ipcMain.handle('internal:log-enable', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-enable')
      }
      logCollector.enable(event.sender)
      return { success: true }
    })

    ipcMain.handle('internal:log-disable', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-disable')
      }
      logCollector.disable(event.sender)
      return { success: true }
    })

    ipcMain.handle('internal:log-get-buffer', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-get-buffer')
      }
      return logCollector.getBufferedLogs()
    })

    ipcMain.handle('internal:log-is-enabled', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-is-enabled')
      }
      return logCollector.isEnabled()
    })

    ipcMain.handle('internal:log-subscribe', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:log-subscribe')
      }
      logCollector.addSubscriber(event.sender)
      return { success: true }
    })

    // ==================== HTTP 服务 API ====================
    ipcMain.handle('internal:http-server-get-config', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:http-server-get-config')
      }
      try {
        const config = httpServer.getConfig()
        return { success: true, config }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '获取配置失败'
        }
      }
    })

    ipcMain.handle(
      'internal:http-server-save-config',
      async (event, config: { enabled: boolean; port: number; apiKey: string }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:http-server-save-config')
        }
        try {
          const wasRunning = httpServer.isRunning()
          const savedConfig = await httpServer.saveConfig(config)

          if (savedConfig.enabled && !wasRunning) {
            httpServer.start()
          } else if (!savedConfig.enabled && wasRunning) {
            httpServer.stop()
          } else if (savedConfig.enabled && wasRunning) {
            httpServer.stop()
            httpServer.start()
          }

          return { success: true, config: savedConfig }
        } catch (error: unknown) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '保存配置失败'
          }
        }
      }
    )

    ipcMain.handle('internal:http-server-regenerate-key', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:http-server-regenerate-key')
      }
      try {
        const newKey = httpServer.generateApiKey()
        await httpServer.saveConfig({ apiKey: newKey })
        return { success: true, apiKey: newKey }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '重新生成密钥失败'
        }
      }
    })

    ipcMain.handle('internal:http-server-status', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:http-server-status')
      }
      return { success: true, running: httpServer.isRunning() }
    })

    // ==================== MCP 服务 API ====================
    ipcMain.handle('internal:mcp-server-get-config', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:mcp-server-get-config')
      }
      try {
        // 读取当前 MCP 服务配置；缺失 API Key 时会在 getConfig 内补齐。
        const config = mcpServer.getConfig()
        return { success: true, config }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '获取配置失败'
        }
      }
    })

    ipcMain.handle(
      'internal:mcp-server-save-config',
      async (event, config: { enabled: boolean; port: number; apiKey: string }) => {
        if (!requireInternalPlugin(this.pluginManager, event)) {
          throw new PermissionDeniedError('internal:mcp-server-save-config')
        }
        try {
          const wasRunning = mcpServer.isRunning()
          const savedConfig = await mcpServer.saveConfig(config)

          // 配置变更后按运行状态决定启动、停止或重启服务。
          if (savedConfig.enabled && !wasRunning) {
            mcpServer.start()
          } else if (!savedConfig.enabled && wasRunning) {
            mcpServer.stop()
          } else if (savedConfig.enabled && wasRunning) {
            mcpServer.stop()
            mcpServer.start()
          }

          return { success: true, config: savedConfig }
        } catch (error: unknown) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '保存配置失败'
          }
        }
      }
    )

    ipcMain.handle('internal:mcp-server-regenerate-key', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:mcp-server-regenerate-key')
      }
      try {
        // 仅更新密钥，不直接改动启停状态，由现有服务继续使用新配置。
        const newKey = mcpServer.generateApiKey()
        await mcpServer.saveConfig({ apiKey: newKey })
        return { success: true, apiKey: newKey }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '重新生成密钥失败'
        }
      }
    })

    // 查询 MCP 服务运行状态
    ipcMain.handle('internal:mcp-server-status', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:mcp-server-status')
      }
      return { success: true, running: mcpServer.isRunning() }
    })

    // 获取所有已安装插件中声明的 MCP 工具列表
    ipcMain.handle('internal:mcp-server-tools', async (event) => {
      if (!requireInternalPlugin(this.pluginManager, event)) {
        throw new PermissionDeniedError('internal:mcp-server-tools')
      }
      return {
        success: true,
        // 返回所有已安装插件声明的工具，供设置页展示与调试。
        data: pluginToolsAPI.getAllDeclaredToolEntries()
      }
    })
  }
}

export default new InternalPluginAPI()
