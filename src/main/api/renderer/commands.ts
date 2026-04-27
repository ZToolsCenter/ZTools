import { app, ipcMain, shell } from 'electron'
import { execFile } from 'child_process'
import type { PluginManager } from '../../managers/pluginManager'
import { promises as fs } from 'fs'
import path from 'path'
import { normalizeIconPath } from '../../common/iconUtils'
import { launchApp, type ConfirmDialogOptions } from '../../core/commandLauncher'
import { scanApplications } from '../../core/commandScanner'
import { UwpManager } from '../../core/native'
import { pluginFeatureAPI } from '../plugin/feature'
import databaseAPI from '../shared/database'
import { WINDOWS_SETTINGS } from '../../core/systemSettings/windowsSettings.js'
import pluginsAPI from './plugins'
import { executeSystemCommand } from './systemCommands'
import { findCommandIndex, filterOutCommand, hasCommand } from './commandMatchers'
import { systemSettingsAPI } from './systemSettings'

/**
 * 上次匹配状态接口
 */
interface LastMatchState {
  searchQuery: string
  pastedImage: string | null
  pastedFiles: any[] | null
  pastedText: string | null
  timestamp: number
}

/**
 * 应用管理API - 主程序专用
 */
export class AppsAPI {
  private static readonly APP_CACHE_VERSION = 3
  private static readonly APP_CACHE_VERSION_KEY = 'cached-commands-version'
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: PluginManager | null = null
  private launchParam: any = null
  private lastMatchState: LastMatchState | null = null
  private isLocalAppSearchEnabled = true
  private cachedCommandsResult: { commands: any[]; regexCommands: any[]; plugins: any[] } | null =
    null
  /** 由外部注入，用于在多屏场景下正确显示窗口（跟随光标所在屏幕） */
  private showWindowCallback?: () => void

  public setShowWindowCallback(callback: () => void): void {
    this.showWindowCallback = callback
  }

  /**
   * 安全地向渲染进程发送消息
   */
  private notifyRenderer(channel: string, ...args: any[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args)
    }
  }

  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
    this.loadLastMatchState()
    // 异步加载本地应用搜索设置
    this.loadLocalAppSearchSetting()
  }

  public getLaunchParam(): any {
    return this.launchParam
  }

  public invalidateCommandsCache(notifyRenderer = false): void {
    this.cachedCommandsResult = null
    console.log('[Commands] 指令缓存已清空:', { notifyRenderer })

    if (notifyRenderer) {
      console.log('[Commands] 发送 apps-changed 通知，触发主窗口重载指令与 alias 搜索索引')
      this.notifyRenderer('apps-changed')
    }
  }

  /**
   * 根据名称查找直接启动指令（系统应用、系统设置等）
   */
  public async findDirectCommandByName(name: string): Promise<any | null> {
    const { commands } = await this.getCommands()
    return commands.find((cmd: any) => cmd.type === 'direct' && cmd.name === name) || null
  }

  private setupIPC(): void {
    ipcMain.handle('get-apps', () => this.getApps())
    ipcMain.handle('get-commands', () => this.getCommands())
    ipcMain.handle('launch', (_event, options: any) => this.launch(options))
    ipcMain.handle('launch-as-admin', (_event, appPath: string, name?: string) =>
      this.launchAsAdmin(appPath, name)
    )
    ipcMain.handle('refresh-apps-cache', () => this.refreshAppsCache())

    // 历史记录管理
    ipcMain.handle(
      'remove-from-history',
      (_event, appPath: string, featureCode?: string, name?: string) =>
        this.removeFromHistory(appPath, featureCode, name)
    )

    // 固定应用管理
    ipcMain.handle('pin-app', (_event, app: any) => this.pinApp(app))
    ipcMain.handle('unpin-app', (_event, appPath: string, featureCode?: string, name?: string) =>
      this.unpinApp(appPath, featureCode, name)
    )
    ipcMain.handle('update-pinned-order', (_event, newOrder: any[]) =>
      this.updatePinnedOrder(newOrder)
    )

    // 上次匹配状态管理
    ipcMain.handle('get-last-match-state', () => this.getLastMatchState())
    ipcMain.handle('restore-last-match', () => this.restoreLastMatch())

    // 使用统计管理
    ipcMain.handle('get-usage-stats', () => this.getUsageStats())
  }

  /**
   * 设置本地应用搜索开启状态
   */
  public setLocalAppSearch(enabled: boolean): void {
    this.isLocalAppSearchEnabled = enabled
    this.invalidateCommandsCache(true)
    console.log('[Commands] 本地应用搜索已' + (enabled ? '开启' : '关闭'))
  }

  /**
   * 加载本地应用搜索设置
   */
  private loadLocalAppSearchSetting(): void {
    try {
      const data = databaseAPI.dbGet('settings-general')
      if (data && typeof data.localAppSearch === 'boolean') {
        this.isLocalAppSearchEnabled = data.localAppSearch
      }
      console.log('[Commands] 加载本地应用搜索设置:', this.isLocalAppSearchEnabled)
    } catch (error) {
      console.error('[Commands] 加载本地应用搜索设置失败:', error)
    }
  }

  /**
   * 获取使用统计
   */
  private getUsageStats(): any[] {
    try {
      const stats = databaseAPI.dbGet('command-usage-stats')
      return stats || []
    } catch (error) {
      console.error('[Commands] 获取使用统计失败:', error)
      return []
    }
  }

  /**
   * 获取系统应用列表，并处理图标缓存
   * 优先从数据库缓存读取，没有缓存时才扫描
   */
  private async getApps(): Promise<any[]> {
    console.log('[Commands] 收到获取应用列表请求')

    // 如果本地应用搜索被禁用，直接返回空列表
    if (!this.isLocalAppSearchEnabled) {
      console.log('[Commands] 本地应用搜索已关闭，返回空列表')
      return []
    }

    // 开发模式下强制重新扫描（方便调试）
    if (!app.isPackaged) {
      console.log('[Commands] 开发模式：跳过缓存，重新扫描应用...')
      return await this.scanAndCacheApps()
    }

    // 尝试从数据库缓存读取
    try {
      const cachedApps = databaseAPI.dbGet('cached-commands')
      const cacheVersion = databaseAPI.dbGet(AppsAPI.APP_CACHE_VERSION_KEY)
      if (cachedApps && Array.isArray(cachedApps) && cachedApps.length > 0) {
        // 检查缓存的图标格式是否为新协议
        // 只要有一个应用使用了旧的文件路径格式（且不是 .png 结尾的静态资源），就视为旧缓存
        const hasOldFormat = cachedApps.some(
          (app) =>
            app.icon &&
            !app.icon.startsWith('ztools-icon://') &&
            !app.icon.startsWith('data:') &&
            !app.icon.startsWith('http') &&
            // Windows 上的静态 png 资源除外（通常是手动转换的）
            !(
              process.platform === 'win32' &&
              app.icon.startsWith('file:') &&
              app.icon.endsWith('.png')
            )
        )

        if (cacheVersion !== AppsAPI.APP_CACHE_VERSION) {
          console.log('[Commands] 检测到旧版应用缓存，将重新扫描以刷新本地化名称索引...')
        } else if (hasOldFormat) {
          console.log('[Commands] 检测到旧格式图标缓存，将重新扫描并更新为 ztools-icon 协议...')
        } else {
          console.log(`从缓存读取到 ${cachedApps.length} 个应用`)
          return cachedApps
        }
      }
    } catch (error) {
      console.log('[Commands] 读取应用缓存失败，将进行扫描:', error)
    }

    // 缓存不存在，执行扫描
    console.log('[Commands] 缓存不存在，开始扫描应用...')
    return await this.scanAndCacheApps()
  }

  /**
   * 扫描应用并缓存到数据库
   */
  private async scanAndCacheApps(): Promise<any[]> {
    const apps = await scanApplications()
    console.log(`扫描到 ${apps.length} 个应用`)

    // Windows 平台：获取 UWP 应用并合并
    if (process.platform === 'win32') {
      try {
        const uwpApps = UwpManager.getUwpApps()
        console.log(`获取到 ${uwpApps.length} 个 UWP 应用`)

        // 将 UWP 应用转换为 Command 格式，使用 uwp: 前缀标识
        for (const uwpApp of uwpApps) {
          const uwpPath = `uwp:${uwpApp.appId}`
          // 按 name|path 组合去重，与 windowsScanner.deduplicateCommands 策略一致
          const dedupeKey = `${uwpApp.name.toLowerCase()}|${uwpPath.toLowerCase()}`
          const isDuplicate = apps.some(
            (a) => `${a.name.toLowerCase()}|${a.path.toLowerCase()}` === dedupeKey
          )
          if (isDuplicate) continue

          apps.push({
            name: uwpApp.name,
            path: uwpPath,
            icon: uwpApp.icon || ''
          })
        }
        console.log(`合并 UWP 后共 ${apps.length} 个应用`)
      } catch (error) {
        console.error('[Commands] 获取 UWP 应用失败:', error)
      }
    }

    // 注意：windowsScanner 已经在扫描时生成了 ztools-icon:// 协议 URL
    // 不需要再进行图标提取或文件转换，直接使用扫描结果即可

    // 保存到数据库缓存
    try {
      databaseAPI.dbPut('cached-commands', apps)
      databaseAPI.dbPut(AppsAPI.APP_CACHE_VERSION_KEY, AppsAPI.APP_CACHE_VERSION)
      console.log('[Commands] 应用列表已缓存到数据库')
    } catch (error) {
      console.error('[Commands] 缓存应用列表失败:', error)
    }

    return apps
  }

  /**
   * 刷新应用缓存（当检测到应用文件夹变化时调用）
   */
  public async refreshAppsCache(): Promise<void> {
    if (!this.isLocalAppSearchEnabled) {
      console.log('[Commands] 本地应用搜索已关闭，跳过刷新缓存')
      return
    }

    console.log('[Commands] 开始刷新应用缓存...')
    try {
      await this.scanAndCacheApps()
      this.invalidateCommandsCache(true)
      console.log('[Commands] 应用缓存刷新成功')
    } catch (error) {
      console.error('[Commands] 刷新应用缓存失败:', error)
    }
  }

  /**
   * 纯启动编排：负责管理插件载入前的主窗口占位、自动分离、复用已分离窗口等逻辑
   */
  private async preparePluginLaunch(
    options: {
      path: string
      featureCode: string
      name?: string
    },
    pluginConfig: any
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.pluginManager) {
      return { success: false, error: 'Plugin Manager 未初始化' }
    }
    const { path: appPath, featureCode, name } = options
    const plugin = this.getPluginsFromDB().find((p: any) => p.path === appPath)
    const effectiveName = plugin?.name
    // 检查是否配置为自动分离
    let shouldAutoDetach = false
    if (pluginConfig && effectiveName) {
      try {
        const autoDetachPlugins: string[] = databaseAPI.dbGet('autoDetachPlugin') || []
        if (Array.isArray(autoDetachPlugins) && autoDetachPlugins.includes(effectiveName)) {
          shouldAutoDetach = true
          console.log(`插件 ${effectiveName} 配置为自动分离，直接在独立窗口中创建`)
        }
      } catch (error) {
        console.error('[Commands] 检查自动分离配置失败:', error)
      }
    }

    // 先预检查目标插件是否已在分离窗口中运行。
    // 这里必须发生在主窗口 show / placeholder 之前，否则“只是聚焦已有分离窗口”的场景也会把主窗口 UI 弄脏。
    const reusedDetached = await this.pluginManager.reuseDetachedSingletonIfExists(
      appPath,
      featureCode,
      'launch-precheck'
    )

    if (reusedDetached) {
      console.log('[Commands] 目标插件已在分离窗口运行，跳过主窗口占位态:', {
        path: appPath,
        featureCode
      })
      return { success: true }
    }

    if (shouldAutoDetach) {
      const result = await this.pluginManager.createPluginInDetachedWindow(appPath, featureCode)

      if (!result.success) {
        console.error('[Commands] 在独立窗口中创建插件失败:', result.error)
        // 如果创建失败，降级到主窗口模式
        this.notifyRenderer('show-plugin-placeholder')
        await this.pluginManager.createPluginView(appPath, featureCode, name)
      } else {
        // 创建成功，隐藏主窗口
        this.mainWindow?.hide()
      }
    } else {
      // 先通知渲染进程切换到插件视图模式
      // 必须在 show() 之前发送，否则 show() 触发的 focus-search 事件
      // 会在渲染进程中因 currentView 仍为 Search 而调用 hidePlugin()
      this.notifyRenderer('show-plugin-placeholder')
      // 检查主窗口是否可见
      if (!this.mainWindow?.isVisible()) {
        // 使用注入的回调（会跟随光标所在屏幕），降级到直接 show()
        if (this.showWindowCallback) {
          this.showWindowCallback()
        } else {
          this.mainWindow?.show()
        }
      }

      // 在主窗口中创建插件
      await this.pluginManager.createPluginView(appPath, featureCode, name)
    }

    return { success: true }
  }

  /**
   * 启动应用或插件（统一接口）
   */
  public async launch(options: {
    path: string
    type?: 'direct' | 'plugin' | 'builtin' | 'file'
    featureCode?: string
    param?: any
    name?: string // cmd 名称（用于历史记录显示）
    cmdType?: string // cmd 类型（用于判断是否添加历史记录）
    confirmDialog?: ConfirmDialogOptions // 确认对话框配置
  }): Promise<any> {
    const { path: appPath, type, param, name, cmdType, confirmDialog } = options
    let { featureCode } = options
    this.launchParam = param || {}

    try {
      // 判断是插件还是直接启动
      if (type === 'plugin') {
        if (pluginsAPI.isPluginDisabled(appPath)) {
          return { success: false, error: '插件已禁用' }
        }
        // 如果没有传 featureCode，自动查找第一个非匹配 feature
        if (!featureCode) {
          const result = await this.getDefaultFeatureCode(appPath)
          if (!result.success) {
            // 返回错误给前端
            return { success: false, error: result.error }
          }
          featureCode = result.featureCode
        }

        // 插件启动参数中添加 featureCode
        this.launchParam.code = featureCode || ''

        console.log('[Commands] 启动插件:', {
          path: appPath,
          featureCode,
          name,
          launchParam: this.launchParam
        })

        // 更新指令使用统计（所有指令都统计，用于匹配推荐排序）
        this.updateUsageStats({ path: appPath, type, featureCode, name })

        // 判断命令类型并决定是否添加历史记录
        if (cmdType === 'window') {
          // window 类型：不记录历史，不保存状态（仅用于窗口匹配）
          console.log('[Commands] window 类型命令，跳过历史记录')
        } else if (['img', 'over', 'files', 'regex'].includes(cmdType || '')) {
          // 匹配指令：保存状态并添加"上次匹配"到历史记录
          // 从param中提取完整的输入状态
          const inputState = param?.inputState || {}

          if (param?.inputState) {
            // 保存上次匹配状态（内存+数据库）
            this.lastMatchState = {
              searchQuery: inputState.searchQuery || '',
              pastedImage: inputState.pastedImage || null,
              pastedFiles: inputState.pastedFiles || null,
              pastedText: inputState.pastedText || null,
              timestamp: Date.now()
            }
            console.log('[Commands] 保存上次匹配状态:', this.lastMatchState)
            // 持久化到数据库
            this.saveLastMatchState()

            // 先删除历史记录中旧的"上次匹配"
            this.removeFromHistory('special:last-match')

            // 将"上次匹配"作为普通指令加入历史记录
            this.addToHistory({
              path: 'special:last-match',
              type: 'plugin',
              name: '上次匹配',
              cmdType: 'text'
            })
          }
        } else {
          // 非匹配指令，正常添加到历史记录
          this.addToHistory({ path: appPath, type, featureCode, param, name, cmdType })
        }

        // 读取 plugin.json（一次性读取，后续复用）
        let pluginConfig: any = null
        try {
          const pluginJsonPath = path.join(appPath, 'plugin.json')
          pluginConfig = JSON.parse(await fs.readFile(pluginJsonPath, 'utf-8'))
        } catch (error) {
          console.error('[Commands] 读取 plugin.json 失败:', error)
        }

        // 检查是否为 system 插件（特殊处理：执行系统命令而不是创建视图）
        if (pluginConfig?.name === 'system') {
          console.log('[Commands] 检测到 system 插件，执行系统命令:', featureCode)
          return await executeSystemCommand(
            featureCode || '',
            {
              mainWindow: this.mainWindow,
              pluginManager: this.pluginManager
            },
            param
          )
        }
        return await this.preparePluginLaunch(
          {
            path: appPath,
            featureCode: featureCode || '',
            name
          },
          pluginConfig
        )
      } else if (type === 'file') {
        // 文件/文件夹类型：在文件管理器中定位
        console.log('[Commands] 在文件管理器中定位:', appPath)
        shell.showItemInFolder(appPath)

        // 添加到历史记录
        this.addToHistory({ path: appPath, type: 'file', name, cmdType: 'text' })

        // 隐藏当前插件视图（如果有）
        this.pluginManager?.hidePluginView()
        // 通知渲染进程应用已启动（清空搜索框等）
        this.notifyRenderer('app-launched')
        this.mainWindow?.hide()
      } else {
        // 直接启动（app / system-setting / local-shortcut / UWP / 协议链接）
        // 检查是否为本地启动项（需要 shell.openPath 而非 launchApp）
        const localShortcuts = databaseAPI.dbGet('local-shortcuts')
        const isLocalShortcut = localShortcuts?.some((s: any) => s.path === appPath)

        if (isLocalShortcut) {
          const result = await shell.openPath(appPath)
          if (result) {
            console.error('[Commands] 打开本地启动项失败:', result)
            throw new Error(`打开失败: ${result}`)
          }
        } else {
          // 统一走 launchApp（内部处理 uwp: / 协议链接 / 普通应用等）
          await launchApp(appPath, confirmDialog)
        }

        // 添加到历史记录
        this.addToHistory({ path: appPath, type: type || 'app', name, cmdType: 'text' })

        // 隐藏当前插件视图（如果有）
        this.pluginManager?.hidePluginView()
        // 通知渲染进程应用已启动（清空搜索框等）
        this.notifyRenderer('app-launched')
        this.mainWindow?.hide()
      }
    } catch (error) {
      console.error('[Commands] 启动失败:', error)
      throw error
    }
  }

  /**
   * 以管理员身份启动应用（仅 Windows）
   */
  private launchAsAdmin(appPath: string, name?: string): void {
    if (process.platform !== 'win32') {
      throw new Error('仅支持 Windows 平台')
    }

    try {
      const escapedPath = appPath.replace(/'/g, "''")
      let psCommand: string

      if (appPath.toLowerCase().endsWith('.lnk')) {
        // .lnk 快捷方式：先解析目标路径，再对目标可执行文件进行提权启动
        // 注意：$args 是 PowerShell 保留变量，必须用其他变量名
        psCommand = [
          `$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut('${escapedPath}');`,
          `$sp = @{ FilePath = $lnk.TargetPath; Verb = 'RunAs' };`,
          `if ($lnk.Arguments) { $sp.ArgumentList = $lnk.Arguments };`,
          `Start-Process @sp`
        ].join(' ')
      } else {
        // 非 .lnk 文件：直接提权启动
        psCommand = `Start-Process -FilePath '${escapedPath}' -Verb RunAs`
      }

      console.log(`[Commands] 以管理员身份启动: ${appPath}`)
      console.log(`[Commands] PowerShell 命令: ${psCommand}`)

      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
        (error, _stdout, stderr) => {
          if (error) {
            console.error('[Commands] 管理员启动失败:', error.message)
          }
          if (stderr) {
            console.error('[Commands] 管理员启动 stderr:', stderr)
          }
        }
      )

      console.log(`[Commands] 以管理员身份启动: ${appPath}`)

      // 添加到历史记录
      this.addToHistory({ path: appPath, type: 'direct', name, cmdType: 'text' })

      // 隐藏当前插件视图（如果有）
      this.pluginManager?.hidePluginView()
      // 通知渲染进程应用已启动
      this.notifyRenderer('app-launched')
      this.mainWindow?.hide()
    } catch (error) {
      console.error('[Commands] 管理员启动失败:', error)
      throw error
    }
  }

  /**
   * 添加到历史记录
   */
  private async addToHistory(options: {
    path: string
    type?: 'app' | 'direct' | 'plugin' | 'builtin' | 'file'
    featureCode?: string
    param?: any
    name?: string // cmd 名称（用于历史记录显示）
    cmdType?: string // cmd 类型（用于判断是否添加历史记录）
  }): Promise<void> {
    try {
      const { path: appPath, type = 'app', featureCode, name: cmdName, cmdType } = options

      console.log('[Commands] 添加指令到历史记录:', cmdName, '类型:', cmdType || 'text')

      const now = Date.now()

      // 获取应用/插件信息
      let appInfo: any = null

      // 特殊指令和内置指令不需要查找应用信息，前端会处理显示
      if (appPath.startsWith('special:') || appPath.startsWith('builtin:')) {
        // 尝试从缓存的应用列表中获取完整信息（包括图标）
        const cachedApps = databaseAPI.dbGet('cached-commands')
        const cachedBuiltin = cachedApps?.find((a: any) => a.path === appPath)

        appInfo = {
          name: cmdName || appPath,
          path: appPath,
          icon: cachedBuiltin?.icon, // 从缓存中获取图标
          type: 'builtin',
          cmdType: cmdType || 'text'
        }
      } else if (type === 'plugin') {
        // 从插件列表中查找
        const dbPlugins = this.getPluginsFromDB()

        // 先从运行中的插件查找
        const plugin = dbPlugins.find((p: any) => p.path === appPath)

        if (plugin) {
          // 读取插件配置获取完整信息
          const pluginJsonPath = path.join(appPath, 'plugin.json')
          try {
            const pluginConfig = JSON.parse(await fs.readFile(pluginJsonPath, 'utf-8'))

            // 查找对应的 feature（从 plugin.json）
            let feature = pluginConfig.features?.find((f: any) => f.code === featureCode)

            // 如果在 plugin.json 中没找到，尝试从动态 features 中查找
            if (!feature) {
              const dynamicFeatures = pluginFeatureAPI.loadDynamicFeatures(plugin.name)
              feature = dynamicFeatures.find((f: any) => f.code === featureCode)
            }

            // 优先使用 feature 的 icon，如果没有则使用 plugin 的 logo
            let featureIcon = feature?.icon || plugin.logo || ''

            // 标准化 icon 路径（处理相对路径、base64、http等）
            if (featureIcon) {
              featureIcon = normalizeIconPath(featureIcon, appPath)
            }

            appInfo = {
              name: cmdName || pluginConfig.name, // 优先使用传入的 cmd 名称
              path: appPath,
              icon: featureIcon,
              type: 'plugin',
              featureCode: featureCode,
              pluginName: plugin.name, // 有效名（开发版含 __dev 后缀）
              pluginExplain: feature?.explain || '',
              cmdType: cmdType || 'text'
            }
          } catch (error) {
            console.error('[Commands] 读取插件配置失败:', error)
            return
          }
        }
      } else {
        // 从系统应用列表中查找
        const cachedApps = databaseAPI.dbGet('cached-commands')
        const app = cachedApps?.find((a: any) => a.path === appPath)

        if (app) {
          appInfo = {
            name: cmdName || app.name, // 优先使用传入的 cmd 名称
            originalName: app.name,
            path: app.path,
            icon: app.icon,
            pinyin: app.pinyin,
            pinyinAbbr: app.pinyinAbbr,
            type: 'direct',
            subType: 'app',
            cmdType: cmdType || 'text'
          }
        } else {
          // 如果不是普通应用，尝试从系统设置中查找
          if (process.platform === 'win32') {
            const setting = WINDOWS_SETTINGS.find((s: any) => s.uri === appPath)

            if (setting) {
              appInfo = {
                name: cmdName || setting.name,
                path: setting.uri,
                icon: setting.icon,
                type: 'system-setting',
                category: setting.category
              }
            }
          }
        }

        // 如果仍未找到，尝试从本地启动项中查找
        if (!appInfo) {
          const localShortcuts = databaseAPI.dbGet('local-shortcuts')
          const shortcut = localShortcuts?.find((s: any) => s.path === appPath)
          if (shortcut) {
            appInfo = {
              name: cmdName || shortcut.alias || shortcut.name,
              path: shortcut.path,
              icon: shortcut.icon || '',
              type: 'direct',
              subType: 'local-shortcut',
              pinyin: shortcut.pinyin || '',
              pinyinAbbr: shortcut.pinyinAbbr || ''
            }
          }
        }
      }

      if (!appInfo) {
        console.warn('[Commands] 未找到应用信息，跳过添加历史记录:', appPath)
        return
      }

      // 读取历史记录
      const history: any[] = databaseAPI.dbGet('command-history') || []

      // 查找是否已存在（非插件类型需要同时匹配 name 和 path，支持同路径不同名应用）
      const historyMatchType =
        appInfo.type === 'direct' && appInfo.subType === 'app' ? 'app' : appInfo.type
      const existingIndex = findCommandIndex(
        history,
        appPath,
        historyMatchType,
        featureCode,
        appInfo.pluginName || appInfo.name
      )

      if (existingIndex >= 0) {
        // 已存在，更新使用时间和次数
        history[existingIndex].lastUsed = now
        history[existingIndex].useCount = (history[existingIndex].useCount || 0) + 1
        // 更新可能变化的信息（包括 path，确保开发/生产模式切换后路径同步）
        history[existingIndex].path = appInfo.path
        history[existingIndex].name = appInfo.name
        history[existingIndex].icon = appInfo.icon
        history[existingIndex].type = appInfo.type
        history[existingIndex].subType = appInfo.subType
        history[existingIndex].cmdType = appInfo.cmdType
        history[existingIndex].pluginName = appInfo.pluginName
        history[existingIndex].pluginExplain = appInfo.pluginExplain
        history[existingIndex].originalName = appInfo.originalName
      } else {
        // 新记录
        history.push({
          ...appInfo,
          lastUsed: now,
          useCount: 1
        })
      }

      // 按最近使用时间排序
      history.sort((a, b) => b.lastUsed - a.lastUsed)

      // 保存历史记录
      databaseAPI.dbPut('command-history', history)

      console.log('[Commands] 历史记录已更新:', appInfo.name)

      // 通知前端重新加载历史记录
      this.notifyRenderer('history-changed')
    } catch (error) {
      console.error('[Commands] 添加历史记录失败:', error)
    }
  }

  /**
   * 更新指令使用统计（独立于历史记录，用于匹配推荐排序）
   */
  private updateUsageStats(options: {
    path: string
    type?: 'app' | 'plugin'
    featureCode?: string
    name?: string
  }): void {
    try {
      const { path: cmdPath, type = 'app', featureCode, name: cmdName } = options

      console.log('[Commands] 更新指令使用统计:', cmdName || cmdPath)

      const now = Date.now()

      // 读取使用统计
      const stats: any[] = databaseAPI.dbGet('command-usage-stats') || []

      // 查找是否已存在（非插件类型需要同时匹配 name 和 path，支持同路径不同名应用）
      const existingIndex = findCommandIndex(stats, cmdPath, type, featureCode, cmdName || cmdPath)

      if (existingIndex >= 0) {
        // 已存在，更新使用时间和次数
        stats[existingIndex].lastUsed = now
        stats[existingIndex].useCount = (stats[existingIndex].useCount || 0) + 1
        console.log(`更新统计: ${cmdName || cmdPath}, 使用${stats[existingIndex].useCount}次`)
      } else {
        // 新记录
        stats.push({
          path: cmdPath,
          type,
          featureCode: featureCode || null,
          name: cmdName || cmdPath,
          lastUsed: now,
          useCount: 1
        })
        console.log(`新增统计: ${cmdName || cmdPath}, 使用1次`)
      }

      // 保存统计数据
      databaseAPI.dbPut('command-usage-stats', stats)

      console.log('[Commands] 使用统计已更新')
    } catch (error) {
      console.error('[Commands] 更新使用统计失败:', error)
    }
  }

  /**
   * 从数据库获取插件列表
   */
  private getPluginsFromDB(): any[] {
    try {
      const plugins = databaseAPI.dbGet('plugins')
      return plugins || []
    } catch (error) {
      console.error('[Commands] 从数据库获取插件列表失败:', error)
      return []
    }
  }

  /**
   * 获取插件的默认 featureCode（第一个非匹配 feature）
   */
  private async getDefaultFeatureCode(
    pluginPath: string
  ): Promise<{ success: boolean; featureCode?: string; error?: string }> {
    try {
      const pluginJsonPath = path.join(pluginPath, 'plugin.json')
      const pluginConfig = JSON.parse(await fs.readFile(pluginJsonPath, 'utf-8'))

      if (!pluginConfig.features || pluginConfig.features.length === 0) {
        return {
          success: false,
          error: '该插件没有配置任何功能'
        }
      }

      // 查找第一个非匹配 feature
      for (const feature of pluginConfig.features) {
        if (!feature.cmds || feature.cmds.length === 0) {
          // 没有 cmds 的 feature，使用它
          return { success: true, featureCode: feature.code }
        }

        // 检查是否有非匹配型命令
        const hasNonMatchCmd = feature.cmds.some((cmd: any) => {
          // 如果是字符串，就是文本命令（非匹配）
          if (typeof cmd === 'string') return true
          // 如果是对象但没有 type 字段，也算非匹配
          if (typeof cmd === 'object' && !cmd.type) return true
          // 否则是匹配型命令（regex 或 over）
          return false
        })

        if (hasNonMatchCmd) {
          return { success: true, featureCode: feature.code }
        }
      }

      // 如果都是匹配型 feature，返回错误
      return {
        success: false,
        error: '该插件所有功能都需要通过指令触发，无法直接打开'
      }
    } catch (error) {
      console.error('[Commands] 读取插件配置失败:', error)
      return {
        success: false,
        error: '读取插件配置失败'
      }
    }
  }

  /**
   * 从历史记录中删除
   */
  private removeFromHistory(appPath: string, featureCode?: string, name?: string): void {
    try {
      const originalHistory: any[] = databaseAPI.dbGet('command-history') || []

      const history = filterOutCommand(originalHistory, appPath, featureCode, name)

      databaseAPI.dbPut('command-history', history)
      console.log('[Commands] 已从历史记录删除:', appPath, featureCode)

      // 通知前端重新加载历史记录
      this.notifyRenderer('history-changed')
    } catch (error) {
      console.error('[Commands] 从历史记录删除失败:', error)
    }
  }

  /**
   * 固定应用
   */
  public pinApp(app: any): void {
    try {
      const pinnedApps: any[] = databaseAPI.dbGet('pinned-commands') || []

      const isDirectApp = app.type === 'direct' && app.subType === 'app'
      const persistedName = isDirectApp ? app.persistedName || app.name : undefined
      const matchName =
        app.type === 'plugin' ? app.pluginName || app.name : persistedName || app.name

      // 检查是否已固定（非插件类型需要同时匹配 name 和 path，支持同路径不同名应用）
      const exists = hasCommand(pinnedApps, app.path, app.featureCode, matchName)

      if (exists) {
        console.log('[Commands] 应用已固定:', app.path)
        return
      }

      // 添加到固定列表
      pinnedApps.push({
        name: persistedName || app.name,
        path: app.path,
        icon: app.icon,
        type: app.type,
        subType: app.subType,
        featureCode: app.featureCode,
        pluginExplain: app.pluginExplain,
        pinyin: app.pinyin,
        pinyinAbbr: app.pinyinAbbr,
        pluginName: app.pluginName,
        cmdType: app.cmdType,
        originalName: app.originalName,
        persistedName: app.persistedName
      })

      databaseAPI.dbPut('pinned-commands', pinnedApps)
      console.log('[Commands] 已固定应用:', app.name)

      // 通知前端重新加载固定列表
      this.notifyRenderer('pinned-changed')
    } catch (error) {
      console.error('[Commands] 固定应用失败:', error)
    }
  }

  /**
   * 取消固定
   */
  public unpinApp(appPath: string, featureCode?: string, name?: string): void {
    try {
      const originalPinnedApps: any[] = databaseAPI.dbGet('pinned-commands') || []

      const pinnedApps = filterOutCommand(originalPinnedApps, appPath, featureCode, name)

      databaseAPI.dbPut('pinned-commands', pinnedApps)
      console.log('[Commands] 已取消固定:', appPath, featureCode)

      // 通知前端重新加载固定列表
      this.notifyRenderer('pinned-changed')
    } catch (error) {
      console.error('[Commands] 取消固定失败:', error)
    }
  }

  /**
   * 更新固定列表顺序
   */
  private updatePinnedOrder(newOrder: any[]): void {
    try {
      // 清理数据，只保存必要字段
      const cleanData = newOrder.map((app) => {
        const isDirectApp = app.type === 'direct' && app.subType === 'app'
        return {
          name: isDirectApp ? app.persistedName || app.name : app.name,
          path: app.path,
          icon: app.icon,
          type: app.type,
          subType: app.subType,
          featureCode: app.featureCode,
          pluginExplain: app.pluginExplain,
          pinyin: app.pinyin,
          pinyinAbbr: app.pinyinAbbr,
          pluginName: app.pluginName,
          cmdType: app.cmdType,
          originalName: app.originalName,
          persistedName: app.persistedName
        }
      })

      databaseAPI.dbPut('pinned-commands', cleanData)
      console.log('[Commands] 固定列表顺序已更新')

      // 通知前端重新加载固定列表
      this.notifyRenderer('pinned-changed')
    } catch (error) {
      console.error('[Commands] 更新固定列表顺序失败:', error)
    }
  }

  /**
   * 从数据库加载上次匹配状态
   */
  private loadLastMatchState(): void {
    try {
      const state = databaseAPI.dbGet('last-match-state')
      if (state) {
        this.lastMatchState = state
        console.log('[Commands] 加载上次匹配状态:', state)
      }
    } catch (error) {
      console.log('[Commands] 加载上次匹配状态失败:', error)
    }
  }

  /**
   * 保存上次匹配状态到数据库
   */
  private saveLastMatchState(): void {
    try {
      if (this.lastMatchState) {
        databaseAPI.dbPut('last-match-state', this.lastMatchState)
        console.log('[Commands] 保存上次匹配状态到数据库')
      }
    } catch (error) {
      console.error('[Commands] 保存上次匹配状态失败:', error)
    }
  }

  /**
   * 获取上次匹配状态
   */
  private getLastMatchState(): LastMatchState | null {
    return this.lastMatchState
  }

  /**
   * 恢复上次匹配
   */
  private restoreLastMatch(): LastMatchState | null {
    return this.lastMatchState
  }

  /**
   * 获取所有指令（供 AllCommands 页面和设置页 alias 目标选择使用）
   * 返回处理后的 commands、regexCommands 和 plugins
   * 结果会被缓存，直到应用列表、插件状态或 alias 映射发生变化时清除
   */
  public async getCommands(): Promise<{
    commands: any[]
    regexCommands: any[]
    plugins: any[]
  }> {
    // 命中缓存直接返回
    if (this.cachedCommandsResult) {
      console.log('[Commands] 命中指令缓存，直接返回 getCommands 结果')
      return this.cachedCommandsResult
    }

    console.log('[Commands] 指令缓存未命中，开始重建 getCommands 结果')
    try {
      const rawApps = await this.getApps()

      // 调用 pluginsAPI 获取所有插件列表（包括 system 插件）
      const plugins = await pluginsAPI.getAllPlugins()

      const commands: any[] = []
      const regexCommands: any[] = []

      // 处理应用指令
      for (const app of rawApps) {
        commands.push({
          name: app.name,
          path: app.path,
          icon: app.icon,
          type: 'direct',
          subType: 'app'
        })
      }

      // 调用 systemSettingsAPI 获取系统设置指令
      const systemSettings = await systemSettingsAPI.getSystemSettings()
      for (const setting of systemSettings) {
        commands.push({
          name: setting.name,
          path: setting.uri,
          icon: undefined, // 图标由前端统一渲染
          type: 'direct',
          subType: 'system-setting'
        })
      }

      // 处理本地启动项
      try {
        const localShortcuts = databaseAPI.dbGet('local-shortcuts')
        if (localShortcuts && Array.isArray(localShortcuts)) {
          for (const shortcut of localShortcuts) {
            commands.push({
              name: shortcut.alias || shortcut.name,
              path: shortcut.path,
              icon: shortcut.icon || '',
              type: 'direct',
              subType: 'local-shortcut'
            })
          }
        }
      } catch (error) {
        console.error('[Commands] 获取本地启动项失败:', error)
      }

      // 处理插件指令。
      for (const plugin of plugins) {
        if (!plugin.features || !Array.isArray(plugin.features)) {
          continue
        }

        for (const feature of plugin.features) {
          if (!feature.cmds || !Array.isArray(feature.cmds)) {
            continue
          }

          for (const cmd of feature.cmds) {
            if (typeof cmd === 'string') {
              // 功能指令
              commands.push({
                name: cmd,
                path: plugin.path,
                icon: feature.icon || plugin.logo,
                type: 'plugin',
                featureCode: feature.code,
                pluginName: plugin.name,
                pluginTitle: plugin.title,
                pluginExplain: feature.explain,
                cmdType: 'text'
              })
            } else if (typeof cmd === 'object') {
              // 匹配指令
              regexCommands.push({
                name: cmd.label || feature.explain || '',
                path: plugin.path,
                icon: feature.icon || plugin.logo,
                type: 'plugin',
                featureCode: feature.code,
                pluginName: plugin.name,
                pluginTitle: plugin.title,
                pluginExplain: feature.explain,
                cmdType: cmd.type,
                matchCmd: {
                  type: cmd.type,
                  match: cmd.match || cmd.regex || ''
                }
              })
            }
          }
        }
      }

      const result = { commands, regexCommands, plugins }
      this.cachedCommandsResult = result
      console.log('[Commands] 指令列表重建完成:', {
        commands: commands.length,
        regexCommands: regexCommands.length,
        plugins: plugins.length
      })
      return result
    } catch (error) {
      console.error('[Commands] 获取指令列表失败:', error)
      return { commands: [], regexCommands: [], plugins: [] }
    }
  }
}

export default new AppsAPI()
