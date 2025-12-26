import { exec } from 'child_process'
import { createHash } from 'crypto'
import { app, ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { normalizeIconPath } from '../../common/iconUtils'
import { launchApp, type ConfirmDialogOptions } from '../../core/commandLauncher'
import { scanApplications } from '../../core/commandScanner'
import { pluginFeatureAPI } from '../plugin/feature'
import databaseAPI from '../shared/database'
import pluginsAPI from './plugins'
import { systemSettingsAPI } from './systemSettings'

const execAsync = promisify(exec)

// 图标缓存目录
const ICON_CACHE_DIR = path.join(app.getPath('userData'), 'icons')

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
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: any = null
  private launchParam: any = null
  private lastMatchState: LastMatchState | null = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: any): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
    // 异步加载上次匹配状态（不阻塞初始化）
    this.loadLastMatchState().catch((error) => {
      console.error('加载上次匹配状态失败:', error)
    })
  }

  public getLaunchParam(): any {
    return this.launchParam
  }

  private setupIPC(): void {
    ipcMain.handle('get-apps', () => this.getApps())
    ipcMain.handle('get-commands', () => this.getCommands())
    ipcMain.handle('launch', (_event, options: any) => this.launch(options))
    ipcMain.handle('refresh-apps-cache', () => this.refreshAppsCache())

    // 历史记录管理
    ipcMain.handle('remove-from-history', (_event, appPath: string, featureCode?: string) =>
      this.removeFromHistory(appPath, featureCode)
    )

    // 固定应用管理
    ipcMain.handle('pin-app', (_event, app: any) => this.pinApp(app))
    ipcMain.handle('unpin-app', (_event, appPath: string, featureCode?: string) =>
      this.unpinApp(appPath, featureCode)
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
   * 获取使用统计
   */
  private async getUsageStats(): Promise<any[]> {
    try {
      const stats = await databaseAPI.dbGet('command-usage-stats')
      return stats || []
    } catch (error) {
      console.error('获取使用统计失败:', error)
      return []
    }
  }

  /**
   * 获取系统应用列表，并处理图标缓存
   * 优先从数据库缓存读取，没有缓存时才扫描
   */
  private async getApps(): Promise<any[]> {
    console.log('收到获取应用列表请求')

    // 开发模式下强制重新扫描（方便调试）
    if (!app.isPackaged) {
      console.log('开发模式：跳过缓存，重新扫描应用...')
      return await this.scanAndCacheApps()
    }

    // 尝试从数据库缓存读取
    try {
      const cachedApps = await databaseAPI.dbGet('cached-commands')
      if (cachedApps && Array.isArray(cachedApps) && cachedApps.length > 0) {
        console.log(`从缓存读取到 ${cachedApps.length} 个应用`)
        return cachedApps
      }
    } catch (error) {
      console.log('读取应用缓存失败，将进行扫描:', error)
    }

    // 缓存不存在，执行扫描
    console.log('缓存不存在，开始扫描应用...')
    return await this.scanAndCacheApps()
  }

  /**
   * 扫描应用并缓存到数据库
   */
  private async scanAndCacheApps(): Promise<any[]> {
    const apps = await scanApplications()
    console.log(`扫描到 ${apps.length} 个应用,开始处理图标...`)

    let successCount = 0
    let failCount = 0

    // 并发处理图标
    const appsWithIcons = await Promise.all(
      apps.map(async (app) => {
        if (!app.icon) {
          failCount++
          return { ...app, icon: undefined }
        }

        const iconPath = await this.iconToCachedPath(app.icon)

        if (iconPath) {
          successCount++
          return { ...app, icon: iconPath }
        } else {
          failCount++
          return { ...app, icon: undefined }
        }
      })
    )

    console.log(`图标处理完成: 成功 ${successCount} 个, 失败 ${failCount} 个`)

    // 保存到数据库缓存
    try {
      await databaseAPI.dbPut('cached-commands', appsWithIcons)
      console.log('应用列表已缓存到数据库')
    } catch (error) {
      console.error('缓存应用列表失败:', error)
    }

    return appsWithIcons
  }

  /**
   * 刷新应用缓存（当检测到应用文件夹变化时调用）
   */
  public async refreshAppsCache(): Promise<void> {
    console.log('开始刷新应用缓存...')
    try {
      await this.scanAndCacheApps()
      console.log('应用缓存刷新成功')

      // 通知渲染进程应用列表已更新
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('apps-changed')
      }
    } catch (error) {
      console.error('刷新应用缓存失败:', error)
    }
  }

  /**
   * 将图标转换为 PNG 并缓存（平台自适应）
   */
  private async iconToCachedPath(iconPath: string): Promise<string | null> {
    try {
      // Windows: 图标已经是 PNG，直接返回 file:/// 路径
      if (process.platform === 'win32') {
        // Windows 扫描器已经生成了 PNG 图标，直接使用
        if (iconPath.endsWith('.png')) {
          return `file:///${iconPath}`
        }
        // 如果不是 PNG（意外情况），尝试复制到缓存目录
        const hash = createHash('md5').update(iconPath).digest('hex')
        const cachedFile = path.join(ICON_CACHE_DIR, `${hash}.png`)
        await fs.mkdir(ICON_CACHE_DIR, { recursive: true })
        await fs.copyFile(iconPath, cachedFile)
        return `file:///${cachedFile}`
      }

      // macOS: 将 ICNS 转换为 PNG
      const hash = createHash('md5').update(iconPath).digest('hex')
      const cachedFile = path.join(ICON_CACHE_DIR, `${hash}.png`)

      // 检查缓存是否存在
      try {
        await fs.access(cachedFile)
        // 缓存存在，直接返回 file:/// 协议路径
        return `file:///${cachedFile}`
      } catch {
        // 缓存不存在，需要转换
      }

      // 确保缓存目录存在
      await fs.mkdir(ICON_CACHE_DIR, { recursive: true })

      // 使用 sips 转换为 PNG
      await execAsync(
        `sips -s format png '${iconPath}' --out '${cachedFile}' --resampleHeightWidth 64 64 2>/dev/null`
      )

      // 返回 file:/// 协议路径
      return `file:///${cachedFile}`
    } catch (error) {
      console.error('图标转换失败:', iconPath, error)
      return null
    }
  }

  /**
   * 启动应用或插件（统一接口）
   */
  public async launch(options: {
    path: string
    type?: 'direct' | 'plugin'
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

        console.log('启动插件:', { path: appPath, featureCode, name })

        // 更新指令使用统计（所有指令都统计，用于匹配推荐排序）
        await this.updateUsageStats({ path: appPath, type, featureCode, name })

        // 判断是否为匹配指令，保存状态并添加"上次匹配"到历史记录
        const isMatchCommand = ['img', 'over', 'files', 'regex'].includes(cmdType || '')
        if (isMatchCommand && param) {
          // 从param中提取完整的输入状态
          const inputState = param.inputState || {}

          // 保存上次匹配状态（内存+数据库）
          this.lastMatchState = {
            searchQuery: inputState.searchQuery || '',
            pastedImage: inputState.pastedImage || null,
            pastedFiles: inputState.pastedFiles || null,
            pastedText: inputState.pastedText || null,
            timestamp: Date.now()
          }
          console.log('保存上次匹配状态:', this.lastMatchState)
          // 持久化到数据库
          await this.saveLastMatchState()

          // 先删除历史记录中旧的"上次匹配"
          await this.removeFromHistory('special:last-match')

          // 将"上次匹配"作为普通指令加入历史记录
          await this.addToHistory({
            path: 'special:last-match',
            type: 'plugin',
            name: '上次匹配',
            cmdType: 'text'
          })
        } else {
          // 非匹配指令，正常添加到历史记录
          await this.addToHistory({ path: appPath, type, featureCode, param, name, cmdType })
        }

        if (this.pluginManager) {
          // 检查是否配置为自动分离
          let shouldAutoDetach = false
          try {
            // 获取插件名称 (需从 path 读取 plugin.json)
            const pluginJsonPath = path.join(appPath, 'plugin.json')
            const pluginConfig = JSON.parse(await fs.readFile(pluginJsonPath, 'utf-8'))

            const autoDetachPlugins = await databaseAPI.dbGet('autoDetachPlugin')
            if (
              autoDetachPlugins &&
              Array.isArray(autoDetachPlugins) &&
              autoDetachPlugins.includes(pluginConfig.name)
            ) {
              shouldAutoDetach = true
              console.log(`插件 ${pluginConfig.name} 配置为自动分离，直接在独立窗口中创建`)
            }
          } catch (error) {
            console.error('检查自动分离配置失败:', error)
          }

          if (shouldAutoDetach) {
            // 直接在独立窗口中创建插件
            const result = await this.pluginManager.createPluginInDetachedWindow(
              appPath,
              featureCode || ''
            )

            if (!result.success) {
              console.error('在独立窗口中创建插件失败:', result.error)
              // 如果创建失败，降级到主窗口模式
              this.mainWindow?.webContents.send('show-plugin-placeholder')
              await this.pluginManager.createPluginView(appPath, featureCode || '')
            } else {
              // 创建成功，隐藏主窗口
              this.mainWindow?.hide()
            }
          } else {
            // 通知渲染进程准备显示插件占位区域
            this.mainWindow?.webContents.send('show-plugin-placeholder')

            // 在主窗口中创建插件
            await this.pluginManager.createPluginView(appPath, featureCode || '')
          }
        }

        return { success: true }
      } else {
        // 直接启动（app 或 system-setting）
        if (appPath.startsWith('ms-settings:')) {
          // 系统设置
          await shell.openExternal(appPath)
        } else {
          // 普通应用
          await launchApp(appPath, confirmDialog)
        }

        // 添加到历史记录
        await this.addToHistory({ path: appPath, type: 'app', name, cmdType: 'text' })

        // 通知渲染进程应用已启动（清空搜索框等）
        this.mainWindow?.webContents.send('app-launched')
        this.mainWindow?.hide()
        return { success: true }
      }
    } catch (error) {
      console.error('启动失败:', error)
      throw error
    }
  }

  /**
   * 添加到历史记录
   */
  private async addToHistory(options: {
    path: string
    type?: 'app' | 'plugin'
    featureCode?: string
    param?: any
    name?: string // cmd 名称（用于历史记录显示）
    cmdType?: string // cmd 类型（用于判断是否添加历史记录）
  }): Promise<void> {
    try {
      const { path: appPath, type = 'app', featureCode, name: cmdName, cmdType } = options

      console.log('添加指令到历史记录:', cmdName, '类型:', cmdType || 'text')

      const now = Date.now()

      // 获取应用/插件信息
      let appInfo: any = null

      // 特殊指令不需要查找应用信息，前端会处理显示
      if (appPath.startsWith('special:')) {
        appInfo = {
          name: cmdName || appPath,
          path: appPath,
          type: 'builtin',
          cmdType: cmdType || 'text'
        }
      } else if (type === 'plugin') {
        // 从插件列表中查找
        const dbPlugins = await this.getPluginsFromDB()

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
              const dynamicFeatures = pluginFeatureAPI.loadDynamicFeatures(pluginConfig.name)
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
              pluginExplain: feature?.explain || ''
            }
          } catch (error) {
            console.error('读取插件配置失败:', error)
            return
          }
        }
      } else {
        // 从系统应用列表中查找
        const cachedApps = await databaseAPI.dbGet('cached-commands')
        const app = cachedApps?.find((a: any) => a.path === appPath)

        if (app) {
          appInfo = {
            name: cmdName || app.name, // 优先使用传入的 cmd 名称
            path: app.path,
            icon: app.icon,
            pinyin: app.pinyin,
            pinyinAbbr: app.pinyinAbbr,
            type: 'app'
          }
        } else {
          // 如果不是普通应用，尝试从系统设置中查找
          if (process.platform === 'win32') {
            const { WINDOWS_SETTINGS } =
              await import('../../core/systemSettings/windowsSettings.js')
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
      }

      if (!appInfo) {
        console.warn('未找到应用信息，跳过添加历史记录:', appPath)
        return
      }

      // 读取历史记录
      let history: any[] = (await databaseAPI.dbGet('command-history')) || []

      // 查找是否已存在
      const existingIndex = history.findIndex((item) => {
        if (item.type === 'plugin' && type === 'plugin') {
          return item.path === appPath && item.featureCode === featureCode
        }
        return item.path === appPath
      })

      if (existingIndex >= 0) {
        // 已存在，更新使用时间和次数
        history[existingIndex].lastUsed = now
        history[existingIndex].useCount = (history[existingIndex].useCount || 0) + 1
        // 更新可能变化的信息
        history[existingIndex].name = appInfo.name
        history[existingIndex].icon = appInfo.icon
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

      // 限制历史记录数量（最多 27 个）
      if (history.length > 27) {
        history = history.slice(0, 27)
      }

      // 保存历史记录
      await databaseAPI.dbPut('command-history', history)

      console.log('历史记录已更新:', appInfo.name)

      // 通知前端重新加载历史记录
      this.mainWindow?.webContents.send('history-changed')
    } catch (error) {
      console.error('添加历史记录失败:', error)
    }
  }

  /**
   * 更新指令使用统计（独立于历史记录，用于匹配推荐排序）
   */
  private async updateUsageStats(options: {
    path: string
    type?: 'app' | 'plugin'
    featureCode?: string
    name?: string
  }): Promise<void> {
    try {
      const { path: cmdPath, type = 'app', featureCode, name: cmdName } = options

      console.log('更新指令使用统计:', cmdName || cmdPath)

      const now = Date.now()

      // 读取使用统计
      const stats: any[] = (await databaseAPI.dbGet('command-usage-stats')) || []

      // 查找是否已存在
      const existingIndex = stats.findIndex((item) => {
        if (item.type === 'plugin' && type === 'plugin') {
          return item.path === cmdPath && item.featureCode === featureCode
        }
        return item.path === cmdPath
      })

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
      await databaseAPI.dbPut('command-usage-stats', stats)

      console.log('使用统计已更新')
    } catch (error) {
      console.error('更新使用统计失败:', error)
    }
  }

  /**
   * 从数据库获取插件列表
   */
  private async getPluginsFromDB(): Promise<any[]> {
    try {
      const plugins = await databaseAPI.dbGet('plugins')
      return plugins || []
    } catch (error) {
      console.error('从数据库获取插件列表失败:', error)
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
      console.error('读取插件配置失败:', error)
      return {
        success: false,
        error: '读取插件配置失败'
      }
    }
  }

  /**
   * 从历史记录中删除
   */
  private async removeFromHistory(appPath: string, featureCode?: string): Promise<void> {
    try {
      const originalHistory: any[] = (await databaseAPI.dbGet('command-history')) || []

      console.log('删除前历史记录数量:', originalHistory.length)
      console.log('要删除的 path:', appPath)
      console.log('要删除的 featureCode:', featureCode)

      // 打印所有历史记录的 path，方便对比
      console.log('历史记录中的所有 path:')
      originalHistory.forEach((item, index) => {
        console.log(`  [${index}] ${item.name}: ${item.path}`)
      })

      // 过滤掉要删除的项
      const history = originalHistory.filter((item) => {
        // 对于插件，需要同时匹配 path 和 featureCode
        if (item.type === 'plugin' && featureCode !== undefined) {
          return !(item.path === appPath && item.featureCode === featureCode)
        }
        const shouldKeep = item.path !== appPath
        if (!shouldKeep) {
          console.log('找到匹配项，将删除:', item.name, item.path)
        }
        return shouldKeep
      })

      console.log('删除后历史记录数量:', history.length)

      await databaseAPI.dbPut('command-history', history)
      console.log('已从历史记录删除:', appPath, featureCode)

      // 通知前端重新加载历史记录
      this.mainWindow?.webContents.send('history-changed')
    } catch (error) {
      console.error('从历史记录删除失败:', error)
    }
  }

  /**
   * 固定应用
   */
  private async pinApp(app: any): Promise<void> {
    try {
      const pinnedApps: any[] = (await databaseAPI.dbGet('pinned-commands')) || []

      // 检查是否已固定
      const exists = pinnedApps.some((item) => {
        // 对于插件，需要同时匹配 path 和 featureCode
        if (item.type === 'plugin' && app.featureCode !== undefined) {
          return item.path === app.path && item.featureCode === app.featureCode
        }
        return item.path === app.path
      })

      if (exists) {
        console.log('应用已固定:', app.path)
        return
      }

      // 添加到固定列表
      pinnedApps.push({
        name: app.name,
        path: app.path,
        icon: app.icon,
        type: app.type,
        featureCode: app.featureCode,
        pluginExplain: app.pluginExplain,
        pinyin: app.pinyin,
        pinyinAbbr: app.pinyinAbbr
      })

      await databaseAPI.dbPut('pinned-commands', pinnedApps)
      console.log('已固定应用:', app.name)

      // 通知前端重新加载固定列表
      this.mainWindow?.webContents.send('pinned-changed')
    } catch (error) {
      console.error('固定应用失败:', error)
    }
  }

  /**
   * 取消固定
   */
  private async unpinApp(appPath: string, featureCode?: string): Promise<void> {
    try {
      const originalPinnedApps: any[] = (await databaseAPI.dbGet('pinned-commands')) || []

      // 过滤掉要删除的项
      const pinnedApps = originalPinnedApps.filter((item) => {
        // 对于插件，需要同时匹配 path 和 featureCode
        if (item.type === 'plugin' && featureCode !== undefined) {
          return !(item.path === appPath && item.featureCode === featureCode)
        }
        return item.path !== appPath
      })

      await databaseAPI.dbPut('pinned-commands', pinnedApps)
      console.log('已取消固定:', appPath, featureCode)

      // 通知前端重新加载固定列表
      this.mainWindow?.webContents.send('pinned-changed')
    } catch (error) {
      console.error('取消固定失败:', error)
    }
  }

  /**
   * 更新固定列表顺序
   */
  private async updatePinnedOrder(newOrder: any[]): Promise<void> {
    try {
      // 清理数据，只保存必要字段
      const cleanData = newOrder.map((app) => ({
        name: app.name,
        path: app.path,
        icon: app.icon,
        type: app.type,
        featureCode: app.featureCode,
        pluginExplain: app.pluginExplain,
        pinyin: app.pinyin,
        pinyinAbbr: app.pinyinAbbr
      }))

      await databaseAPI.dbPut('pinned-commands', cleanData)
      console.log('固定列表顺序已更新')

      // 通知前端重新加载固定列表
      this.mainWindow?.webContents.send('pinned-changed')
    } catch (error) {
      console.error('更新固定列表顺序失败:', error)
    }
  }

  /**
   * 从数据库加载上次匹配状态
   */
  private async loadLastMatchState(): Promise<void> {
    try {
      const state = await databaseAPI.dbGet('last-match-state')
      if (state) {
        this.lastMatchState = state
        console.log('加载上次匹配状态:', state)
      }
    } catch (error) {
      console.log('加载上次匹配状态失败:', error)
    }
  }

  /**
   * 保存上次匹配状态到数据库
   */
  private async saveLastMatchState(): Promise<void> {
    try {
      if (this.lastMatchState) {
        await databaseAPI.dbPut('last-match-state', this.lastMatchState)
        console.log('保存上次匹配状态到数据库')
      }
    } catch (error) {
      console.error('保存上次匹配状态失败:', error)
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
   * 获取所有指令（供 AllCommands 页面使用）
   * 返回处理后的 commands 和 regexCommands
   */
  private async getCommands(): Promise<{ commands: any[]; regexCommands: any[] }> {
    try {
      const rawApps = await this.getApps()

      // 调用 pluginsAPI 获取插件列表（已经过路径标准化处理）
      const plugins = await pluginsAPI.getPlugins()

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

      // 处理插件指令
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

      return { commands, regexCommands }
    } catch (error) {
      console.error('获取指令列表失败:', error)
      return { commands: [], regexCommands: [] }
    }
  }
}

export default new AppsAPI()
