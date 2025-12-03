import { ipcMain } from 'electron'
import { createHash } from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import path from 'path'
import { app } from 'electron'
import { scanApplications } from '../../appScanner.js'
import { launchApp } from '../../appLauncher.js'

const execAsync = promisify(exec)

// 图标缓存目录
const ICON_CACHE_DIR = path.join(app.getPath('userData'), 'icons')

/**
 * 应用管理API - 主程序专用
 */
export class AppsAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: any = null
  private launchParam: any = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: any): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  public getLaunchParam(): any {
    return this.launchParam
  }

  private setupIPC(): void {
    ipcMain.handle('get-apps', () => this.getApps())
    ipcMain.handle('launch', (_event, path: string, param: any) => this.launch(path, param))
  }

  /**
   * 获取系统应用列表，并处理图标缓存
   */
  private async getApps(): Promise<any[]> {
    console.log('收到获取应用列表请求')
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
    return appsWithIcons
  }

  /**
   * 将 ICNS 图标转换为 PNG 并缓存
   */
  private async iconToCachedPath(iconPath: string): Promise<string | null> {
    try {
      // 生成图标路径的 hash 作为缓存文件名
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
  private async launch(options: {
    path: string
    type?: 'app' | 'plugin'
    featureCode?: string
    param?: any
  }): Promise<any> {
    const { path, type, featureCode, param } = options
    this.launchParam = param || {}

    try {
      // 判断是插件还是应用
      if (type === 'plugin') {
        // 插件启动参数中添加 featureCode
        this.launchParam.code = featureCode || ''

        console.log('启动插件:', { path, featureCode })

        // 通知渲染进程准备显示插件占位区域
        this.mainWindow?.webContents.send('show-plugin-placeholder')

        if (this.pluginManager) {
          this.pluginManager.createPluginView(path, featureCode || '')
        }
      } else {
        // 普通应用
        await launchApp(path)
        // 通知渲染进程应用已启动（清空搜索框等）
        this.mainWindow?.webContents.send('app-launched')
        this.mainWindow?.hide()
      }
    } catch (error) {
      console.error('启动失败:', error)
      throw error
    }
  }
}

export default new AppsAPI()
