import type { PluginManager } from '../../managers/pluginManager'
import type { PluginDevProjectsAPI } from './pluginDevProjects'
import { app, shell, type WebContents } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'url'
import * as tar from 'tar'
import AdmZip from 'adm-zip'
import {
  extractAsar,
  isValidZpx,
  prepareZpxAsar,
  readTextFromZpx,
  readFileFromZpx
} from '../../utils/zpxArchive.js'
import { physicalFs } from '../../utils/physicalFs.js'
import {
  assertSafePluginArtifactPart,
  createAsarArtifactPath,
  removePluginArtifact,
  resolvePluginStorageKind,
  type PluginStorageKind
} from '../../utils/pluginStorage.js'
import { DownloadCancelledError, downloadFile } from '../../utils/download.js'
import { httpGet } from '../../utils/httpRequest.js'
import { sleep } from '../../utils/common.js'
import databaseAPI from '../shared/database'
import { openDialog } from '../../utils/windowUtils'
import {
  PluginMarketAuthMode,
  getPluginMarketApiBase,
  requestPluginMarket
} from './pluginMarketConfig'
import { getPluginsPath } from '../../core/appData/appDataPaths'

/** 插件的本地安装目录 */
const PLUGIN_DIR = getPluginsPath()
const artifactFs = physicalFs.promises
const MARKET_DOWNLOAD_PROGRESS_CHANNEL = 'plugin-market-download-progress'

type MarketDownloadStatus = 'downloading' | 'installing' | 'success' | 'error' | 'cancelled'

interface MarketDownloadProgressPayload {
  pluginName: string
  taskId: string
  status: MarketDownloadStatus
  progress: number | null
  receivedBytes?: number
  totalBytes?: number
  error?: string
}

interface MarketDownloadTask {
  pluginName: string
  taskId: string
  controller: AbortController
  webContents?: WebContents
}

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 插件安装器的外部依赖接口。
 * 通过依赖注入解耦与 PluginsAPI 主类，便于测试。
 */
export interface PluginInstallerDeps {
  /** 主窗口实例，用于弹出对话框 */
  readonly mainWindow: Electron.BrowserWindow | null
  /** 插件管理器实例，用于覆盖安装时终止旧插件 */
  readonly pluginManager: PluginManager | null
  /** 开发项目 API 实例，用于打包时委托调用 */
  readonly devProjects: PluginDevProjectsAPI
  /** 获取非内置插件列表 */
  getPlugins(): Promise<any[]>
  /** 读取当前已安装插件列表 */
  readInstalledPlugins(): any[]
  /** 写入已安装插件列表到数据库 */
  writeInstalledPlugins(plugins: any[]): void
  /** 通知渲染进程插件列表已变更 */
  notifyPluginsChanged(): void
  /** 将仍然保存旧物理路径的插件状态更新为新路径 */
  replacePluginPathReferences(pluginName: string, oldPath: string, newPath: string): void
  /** 校验插件配置的合法性 */
  validatePluginConfig(config: any, existing: any[]): { valid: boolean; error?: string }
}

// ━━━ PluginInstallerAPI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 插件安装器 API。
 * 负责 ZPX/ZIP/NPM/市场等多种来源的插件安装，以及插件打包和导出。
 * 通过 PluginInstallerDeps 依赖注入与主 PluginsAPI 解耦。
 */
export class PluginInstallerAPI {
  private marketDownloadTasks = new Map<string, MarketDownloadTask>()
  private installingPluginNames = new Set<string>()

  constructor(private deps: PluginInstallerDeps) {}

  /**
   * 选择插件文件（不安装，仅返回文件路径）。
   * 用于“导入本地插件”场景，先让用户选择文件再展示预览。
   * @returns {success: boolean, filePath?: string, error?: string}
   */
  public async selectPluginFile(): Promise<any> {
    try {
      const result = await openDialog(
        this.deps.mainWindow!,
        {
          title: '选择插件文件',
          filters: [{ name: '插件文件', extensions: ['zpx', 'zip'] }],
          properties: ['openFile']
        },
        '未选择文件'
      )

      if (!result.success) {
        return result
      }

      return { success: true, filePath: result.data!.filePaths[0] }
    } catch (error: unknown) {
      console.error('[Plugins] 选择插件文件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 导入 ZPX 插件（直接安装不预览）。
   * 保留用于兼容性，新流程应使用 selectPluginFile + installPluginFromPath。
   * @returns {success: boolean, plugin?: object, error?: string}
   */
  public async importPlugin(): Promise<any> {
    try {
      const result = await openDialog(
        this.deps.mainWindow!,
        {
          title: '选择插件文件',
          filters: [{ name: '插件文件', extensions: ['zpx', 'zip'] }],
          properties: ['openFile']
        },
        '未选择文件'
      )

      if (!result.success) {
        return result
      }

      return await this.installPluginFromPath(result.data!.filePaths[0])
    } catch (error: unknown) {
      console.error('[Plugins] 导入插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 从 ZPX 文件中读取插件信息（不安装）。
   * 用于安装前预览插件详情，logo 转换为 base64 data URL。
   * @param zpxPath - .zpx 文件的绝对路径
   * @returns {success: boolean, pluginInfo?: object, error?: string}
   */
  public async readPluginInfoFromZpx(zpxPath: string): Promise<any> {
    try {
      let config: any
      let isZpx: boolean
      try {
        ;({ config, isZpx } = await this.readPluginJson(zpxPath))
      } catch (e: any) {
        return { success: false, error: e.message }
      }

      // 尝试提取 logo 为 base64
      let logoBase64 = ''
      if (config.logo) {
        try {
          const logoBuffer: Buffer = isZpx
            ? await readFileFromZpx(zpxPath, config.logo)
            : (new AdmZip(zpxPath).readFile(config.logo) as Buffer)
          if (logoBuffer) {
            const ext = path.extname(config.logo).toLowerCase().replace('.', '')
            const mimeType =
              ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : `image/${ext}`
            logoBase64 = `data:${mimeType};base64,${logoBuffer.toString('base64')}`
          }
        } catch (error) {
          console.warn('[Plugins] 提取插件 logo 失败:', error)
        }
      }

      const existingPlugins = await this.deps.getPlugins()
      const isInstalled = existingPlugins.some((p: any) => p.name === config.name)

      return {
        success: true,
        pluginInfo: {
          name: config.name,
          title: config.title || config.name,
          version: config.version || '未知',
          description: config.description || '',
          author: config.author || '未知',
          logo: logoBase64,
          features: config.features || [],
          isInstalled
        }
      }
    } catch (error: unknown) {
      console.error('[Plugins] 读取插件信息失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '读取失败' }
    }
  }

  /**
   * 从本地 ZPX 或 ZIP 文件安装、升级插件。
   * @param filePath 插件包绝对路径
   * @returns 安装结果；成功时包含新的插件记录
   */
  public async installPluginFromPath(filePath: string): Promise<any> {
    try {
      const { config, isZpx } = await this.readPluginJson(filePath)
      return await this.installFromPackageFile(filePath, isZpx, config)
    } catch (error: unknown) {
      console.error('[Plugins] 安装插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '安装失败' }
    }
  }

  /**
   * 从插件市场安装插件。
   * 流程：调用市场下载接口获取下载地址 → 下载 .zpx 文件（最多重试 3 次）→ 自动检测 ZPX/ZIP 格式 → 安装 → 清理临时文件。
   * @param plugin 市场插件对象，必须包含 name 字段
   * @param webContents 接收下载进度的渲染进程
   * @returns 安装结果；成功时包含新的插件记录
   */
  public async installPluginFromMarket(plugin: any, webContents?: WebContents): Promise<any> {
    const pluginName = plugin?.name
    if (!pluginName) {
      return { success: false, error: '无效的插件信息' }
    }

    if (this.marketDownloadTasks.has(pluginName)) {
      return { success: false, error: '该插件正在下载中' }
    }

    const safePluginName = String(pluginName).replace(/[\\/]/g, '_')
    const taskId = `${safePluginName}-${Date.now()}`
    const controller = new AbortController()
    const task: MarketDownloadTask = {
      pluginName,
      taskId,
      controller,
      webContents
    }
    this.marketDownloadTasks.set(pluginName, task)

    const tempDir = path.join(app.getPath('temp'), 'ztools-plugin-download', taskId)
    const tempFilePath = path.join(tempDir, `${safePluginName}.zpx`)

    try {
      console.log('[Plugins] 开始从市场安装插件:', pluginName)
      const downloadUrl = await this.resolveMarketDownloadUrl(plugin)
      if (!downloadUrl) {
        return { success: false, error: '无效的下载链接' }
      }

      console.log('[Plugins] 插件下载链接:', downloadUrl)

      await fs.mkdir(tempDir, { recursive: true })
      this.emitMarketDownloadProgress(task, {
        pluginName,
        taskId,
        status: 'downloading',
        progress: 0
      })

      let retryCount = 0
      const maxRetries = 3
      while (retryCount < maxRetries) {
        try {
          await downloadFile(downloadUrl, tempFilePath, {
            signal: controller.signal,
            onProgress: (progress) => {
              this.emitMarketDownloadProgress(task, {
                pluginName,
                taskId,
                status: 'downloading',
                progress: progress.percent,
                receivedBytes: progress.receivedBytes,
                totalBytes: progress.totalBytes
              })
            }
          })
          break
        } catch (error) {
          if (error instanceof DownloadCancelledError || controller.signal.aborted) {
            throw error
          }
          retryCount++
          console.error(`下载失败，重试第 ${retryCount} 次:`, error)
          if (retryCount >= maxRetries) throw error
          await fs.rm(tempFilePath, { force: true })
          await sleep(500)
        }
      }

      console.log('[Plugins] 插件下载完成:', tempFilePath)
      this.emitMarketDownloadProgress(task, {
        pluginName,
        taskId,
        status: 'installing',
        progress: 100
      })

      // 自动检测格式并安装
      const { config: marketConfig, isZpx } = await this.readPluginJson(tempFilePath)
      console.log(`[Plugins] 市场插件格式: ${isZpx ? 'ZPX' : 'ZIP（兼容）'}`)

      const result = await this.installFromPackageFile(tempFilePath, isZpx, marketConfig)
      this.emitMarketDownloadProgress(task, {
        pluginName,
        taskId,
        status: result.success ? 'success' : 'error',
        progress: result.success ? 100 : null,
        error: result.success ? undefined : result.error || '安装失败'
      })

      return result
    } catch (error: unknown) {
      if (error instanceof DownloadCancelledError || controller.signal.aborted) {
        console.log('[Plugins] 市场插件下载已取消:', pluginName)
        this.emitMarketDownloadProgress(task, {
          pluginName,
          taskId,
          status: 'cancelled',
          progress: null
        })
        return { success: false, cancelled: true, error: '已取消下载' }
      }

      console.error('[Plugins] 从市场安装插件失败:', error)
      const message = error instanceof Error ? error.message : '安装失败'
      this.emitMarketDownloadProgress(task, {
        pluginName,
        taskId,
        status: 'error',
        progress: null,
        error: message
      })
      return { success: false, error: message }
    } finally {
      this.marketDownloadTasks.delete(pluginName)
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (e) {
        console.error('[Plugins] 清理下载临时文件失败:', e)
      }
    }
  }

  /**
   * 取消指定插件或任务 ID 对应的市场下载。
   * @param pluginNameOrTaskId 插件名或下载任务 ID
   * @returns 取消结果
   */
  public cancelPluginMarketDownload(pluginNameOrTaskId: string): {
    success: boolean
    error?: string
  } {
    const task = this.findMarketDownloadTask(pluginNameOrTaskId)
    if (!task) {
      return { success: false, error: '没有找到正在下载的插件' }
    }

    task.controller.abort()
    return { success: true }
  }

  /**
   * 请求插件市场并优先解析 ZPX 下载地址。
   * @param plugin 市场插件对象
   * @returns ZPX 下载地址；服务端未提供时回退 ZIP，插件信息无效时返回空字符串
   */
  private async resolveMarketDownloadUrl(plugin: any): Promise<string> {
    const pluginName = typeof plugin?.name === 'string' ? plugin.name : ''
    if (!pluginName) {
      return ''
    }

    const marketApiBase = getPluginMarketApiBase()
    const response = await requestPluginMarket(
      `${marketApiBase}/plugins/download?name=${encodeURIComponent(pluginName)}`,
      {},
      PluginMarketAuthMode.OPTIONAL
    )
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    // 新版优先安装 ZPX；回退 ZIP 仅用于服务端滚动升级和历史插件数据。
    if (typeof data?.zpxDownloadUrl === 'string' && data.zpxDownloadUrl.trim()) {
      return data.zpxDownloadUrl.trim()
    }
    if (typeof data?.downloadUrl === 'string' && data.downloadUrl.trim()) {
      return data.downloadUrl.trim()
    }

    return ''
  }

  /**
   * 从 npm 安装插件
   * @param packageName npm 包名（支持作用域包，如 @ztools/example）
   * @param useChinaMirror 是否使用国内镜像（默认 false）
   * @returns 安装结果；成功时包含新的插件记录
   */
  public async installPluginFromNpm(packageName: string, useChinaMirror = false): Promise<any> {
    try {
      console.log('[Plugins] 开始从 npm 安装插件:', packageName)

      // 1. 从 npm registry 获取包信息
      const registryBase = useChinaMirror
        ? 'https://registry.npmmirror.com'
        : 'https://registry.npmjs.org'
      const registryUrl = `${registryBase}/${packageName}`
      console.log('[Plugins] 获取包信息:', registryUrl, useChinaMirror ? '(国内镜像)' : '')

      let packageInfo: any
      try {
        const response = await httpGet(registryUrl)
        packageInfo = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
      } catch (error) {
        console.error('[Plugins] 获取包信息失败:', error)
        return { success: false, error: '无法获取包信息，请检查包名是否正确' }
      }

      // 2. 获取最新版本的 tarball URL
      const latestVersion = packageInfo['dist-tags']?.latest
      if (!latestVersion) {
        return { success: false, error: '无法获取最新版本信息' }
      }

      const versionInfo = packageInfo.versions?.[latestVersion]
      if (!versionInfo) {
        return { success: false, error: '无法获取版本详情' }
      }

      const tarballUrl = versionInfo.dist?.tarball
      if (!tarballUrl) {
        return { success: false, error: '无法获取下载链接' }
      }

      console.log('[Plugins] 最新版本:', latestVersion)
      console.log('[Plugins] Tarball URL:', tarballUrl)

      // 3. 创建临时目录并下载 tarball
      const tempDir = path.join(app.getPath('temp'), 'ztools-npm-download')
      await fs.mkdir(tempDir, { recursive: true })

      const tarballPath = path.join(tempDir, `${Date.now()}.tgz`)
      console.log('[Plugins] 下载 tarball 到:', tarballPath)

      let retryCount = 0
      const maxRetries = 3
      while (retryCount < maxRetries) {
        try {
          await downloadFile(tarballUrl, tarballPath)
          break
        } catch (error) {
          retryCount++
          console.error(`下载失败，重试第 ${retryCount} 次:`, error)
          if (retryCount >= maxRetries) throw error
          await sleep(500)
        }
      }

      // 4. 解压 tarball 到临时目录
      const extractDir = path.join(tempDir, `extract-${Date.now()}`)
      await fs.mkdir(extractDir, { recursive: true })

      console.log('[Plugins] 解压 tarball 到:', extractDir)
      await tar.extract({
        file: tarballPath,
        cwd: extractDir
      })

      // 5. npm tarball 的内容在 package/ 目录下
      const packageDir = path.join(extractDir, 'package')
      const pluginJsonPath = path.join(packageDir, 'plugin.json')

      // 6. 检查 plugin.json 是否存在
      try {
        await fs.access(pluginJsonPath)
      } catch {
        // 清理临时文件
        await fs.rm(tempDir, { recursive: true, force: true })
        return { success: false, error: '这不是一个有效的 ZTools 插件包（缺少 plugin.json）' }
      }

      // 7. 读取并验证 plugin.json
      const pluginJsonContent = await fs.readFile(pluginJsonPath, 'utf-8')
      let pluginConfig: any
      try {
        pluginConfig = JSON.parse(pluginJsonContent)
      } catch {
        await fs.rm(tempDir, { recursive: true, force: true })
        return { success: false, error: 'plugin.json 格式错误' }
      }

      if (!pluginConfig.name) {
        await fs.rm(tempDir, { recursive: true, force: true })
        return { success: false, error: 'plugin.json 缺少 name 字段' }
      }

      const pluginName = pluginConfig.name
      const targetPath = path.join(PLUGIN_DIR, pluginName)

      // 8. 检查是否已安装（覆盖安装逻辑）
      const existingPlugins: any[] = databaseAPI.dbGet('plugins') || []
      const existingIndex = existingPlugins.findIndex((p: any) => p.name === pluginName)

      if (existingIndex !== -1) {
        console.log('[Plugins] 插件已存在，执行覆盖安装:', pluginName)

        // 终止正在运行的插件
        try {
          this.deps.pluginManager?.killPluginByName(pluginName)
        } catch {
          // 忽略终止错误
        }

        // 从数据库中移除旧记录
        existingPlugins.splice(existingIndex, 1)
        databaseAPI.dbPut('plugins', existingPlugins)

        // 删除旧目录
        try {
          await fs.rm(targetPath, { recursive: true, force: true })
          console.log('[Plugins] 已删除旧插件目录:', targetPath)
        } catch {
          // 忽略删除错误
        }
      }

      // 9. 移动到插件目录
      await fs.mkdir(PLUGIN_DIR, { recursive: true })
      await fs.rename(packageDir, targetPath)

      console.log('[Plugins] 插件已安装到:', targetPath)

      // 10. 验证插件配置
      const validation = this.deps.validatePluginConfig(pluginConfig, existingPlugins)
      if (!validation.valid) {
        // 安装失败，清理目录
        await fs.rm(targetPath, { recursive: true, force: true })
        await fs.rm(tempDir, { recursive: true, force: true })
        return { success: false, error: validation.error }
      }

      // 11. 保存到数据库
      const pluginInfo = this.persistPlugin(pluginConfig, targetPath, { installedFrom: 'npm' })

      // 12. 清理临时文件
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (e) {
        console.error('[Plugins] 清理临时文件失败:', e)
      }

      // 13. 输出新增的指令
      this.logInstalledFeatures(pluginConfig, `从 npm 安装插件成功\nnpm 包名: ${packageName}`)

      this.deps.notifyPluginsChanged()
      return { success: true, plugin: pluginInfo }
    } catch (error: unknown) {
      console.error('[Plugins] 从 npm 安装插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '安装失败' }
    }
  }

  /**
   * 导出所有非开发、非内置插件到下载目录。
   * 导出后自动在 Finder/Explorer 中显示导出文件夹。
   * @returns {success: boolean, exportPath?: string, count?: number, error?: string}
   */
  public async exportAllPlugins(): Promise<{
    success: boolean
    exportPath?: string
    count?: number
    error?: string
  }> {
    try {
      const plugins: any = databaseAPI.dbGet('plugins')
      if (!plugins || !Array.isArray(plugins)) {
        return { success: false, error: '插件列表不存在' }
      }

      const { isBundledInternalPlugin } = await import('../../core/internalPlugins')
      const exportablePlugins = plugins.filter(
        (p: any) => !p.isDevelopment && !isBundledInternalPlugin(p.name)
      )

      if (exportablePlugins.length === 0) {
        return { success: false, error: '没有可导出的插件' }
      }

      const now = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      const timestamp =
        `${now.getFullYear()}` +
        `${pad(now.getMonth() + 1)}` +
        `${pad(now.getDate())}` +
        `${pad(now.getHours())}` +
        `${pad(now.getMinutes())}` +
        `${pad(now.getSeconds())}`

      const downloadsDir = app.getPath('downloads')
      const exportDir = path.join(downloadsDir, `ztools-plugins-${timestamp}`)

      await fs.mkdir(exportDir, { recursive: true })

      let successCount = 0
      for (const plugin of exportablePlugins) {
        const pluginPath: string = plugin.path
        const baseName: string = plugin.name || path.basename(pluginPath)
        const folderName: string = plugin.version ? `${baseName}-v${plugin.version}` : baseName
        const destPath = path.join(exportDir, folderName)
        try {
          if (resolvePluginStorageKind(plugin) === 'asar') {
            await extractAsar(pluginPath, destPath)
          } else {
            await fs.cp(pluginPath, destPath, { recursive: true })
          }
          successCount++
        } catch (err) {
          console.error(`[Plugins] 导出插件失败: ${folderName}`, err)
        }
      }

      shell.showItemInFolder(exportDir)

      console.log('[Plugins] 插件导出完成:', exportDir)
      return { success: true, exportPath: exportDir, count: successCount }
    } catch (error: unknown) {
      console.error('[Plugins] 导出所有插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '导出失败' }
    }
  }

  // ━━━ Private ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 按插件名或任务 ID 查找市场下载任务。
   * @param pluginNameOrTaskId 插件名或下载任务 ID
   * @returns 匹配的下载任务；未找到时返回 undefined
   */
  private findMarketDownloadTask(pluginNameOrTaskId: string): MarketDownloadTask | undefined {
    const directTask = this.marketDownloadTasks.get(pluginNameOrTaskId)
    if (directTask) return directTask

    for (const task of this.marketDownloadTasks.values()) {
      if (task.taskId === pluginNameOrTaskId) return task
    }

    return undefined
  }

  /**
   * 将市场下载进度发送给任务来源窗口或主窗口。
   * @param task 市场下载任务
   * @param payload 下载进度数据
   * @returns 无返回值
   */
  private emitMarketDownloadProgress(
    task: MarketDownloadTask,
    payload: MarketDownloadProgressPayload
  ): void {
    const target = task.webContents?.isDestroyed() ? undefined : task.webContents
    const fallback = this.deps.mainWindow?.webContents
    const sender = target || (fallback && !fallback.isDestroyed() ? fallback : undefined)

    sender?.send(MARKET_DOWNLOAD_PROGRESS_CHANNEL, payload)
  }

  /**
   * 从插件包文件（ZPX 或 ZIP）中读取并解析 plugin.json，同时返回格式标识。
   * @param filePath 插件包绝对路径
   * @returns 插件配置和是否为 ZPX
   * @throws 若 plugin.json 缺失、解析失败或缺少 name 字段则抛出带描述的 Error
   */
  private async readPluginJson(filePath: string): Promise<{ config: any; isZpx: boolean }> {
    const isZpx = await isValidZpx(filePath)
    let content: string
    try {
      if (isZpx) {
        content = await readTextFromZpx(filePath, 'plugin.json')
      } else {
        const zip = new AdmZip(filePath)
        content = zip.readAsText('plugin.json')
        if (!content) throw new Error()
      }
    } catch {
      throw new Error('无效的插件文件：缺少 plugin.json')
    }
    let config: any
    try {
      config = JSON.parse(content)
    } catch {
      throw new Error('无效的插件文件：plugin.json 格式错误')
    }
    if (!config.name) throw new Error('无效的插件文件：缺少 name 字段')
    return { config, isZpx }
  }

  /**
   * 根据权威插件配置构建正式插件注册记录。
   * @param config 从待发布实体中读取的 plugin.json
   * @param pluginPath 正式插件实体路径
   * @param storageKind 插件实体存储类型
   * @param extra 安装来源等附加字段
   * @returns 可写入插件注册表的记录
   */
  private buildPluginInfo(
    config: any,
    pluginPath: string,
    storageKind: PluginStorageKind,
    extra?: Record<string, any>
  ): any {
    return {
      name: config.name,
      title: config.title,
      version: config.version,
      description: config.description || '',
      author: config.author || '',
      homepage: config.homepage || '',
      logo: config.logo ? pathToFileURL(path.join(pluginPath, config.logo)).href : '',
      main: config.main,
      preload: config.preload,
      features: config.features,
      path: pluginPath,
      storageKind,
      isDevelopment: false,
      installedAt: new Date().toISOString(),
      ...extra
    }
  }

  /**
   * 保存 NPM 目录插件记录。
   * @param config 插件配置
   * @param pluginPath 插件目录路径
   * @param extra 安装来源等附加字段
   * @returns 已写入注册表的插件记录
   */
  private persistPlugin(config: any, pluginPath: string, extra?: Record<string, any>): any {
    const pluginInfo = this.buildPluginInfo(config, pluginPath, 'directory', extra)
    let plugins: any = databaseAPI.dbGet('plugins')
    if (!plugins) plugins = []
    plugins.push(pluginInfo)
    databaseAPI.dbPut('plugins', plugins)
    return pluginInfo
  }

  /**
   * 准备并发布 ZPX/ZIP 插件，然后把注册记录切换到新实体。
   * @param filePath 插件包绝对路径
   * @param isZpx 是否为 ZPX 格式
   * @param pluginConfig 预览阶段读取的插件配置
   * @param extra 安装来源等附加字段
   * @returns 安装结果；成功后旧实体仅作为非关键清理处理
   */
  private async installFromPackageFile(
    filePath: string,
    isZpx: boolean,
    pluginConfig: any,
    extra?: Record<string, any>
  ): Promise<any> {
    const previewName = pluginConfig?.name
    if (typeof previewName !== 'string' || !previewName) {
      return { success: false, error: '无效的插件文件：缺少 name 字段' }
    }
    // 同名安装不排队，直接拒绝重复请求。
    if (this.installingPluginNames.has(previewName)) {
      return { success: false, error: '该插件正在安装中' }
    }

    this.installingPluginNames.add(previewName)
    const operationId = randomUUID()
    const workDir = path.join(PLUGIN_DIR, '.installing', operationId)
    let publishedPath = ''
    const publishedKind: PluginStorageKind = isZpx ? 'asar' : 'directory'
    let directoryBackupPath = ''
    let registryCommitted = false

    try {
      // 所有新实体先在插件根目录内的临时目录完成准备。
      await fs.mkdir(workDir, { recursive: true })
      let authoritativeConfig = pluginConfig
      let stagedAsarPath = ''
      let stagedUnpackedPath: string | undefined
      let stagedDirectoryPath = ''

      // ZPX 准备为 ASAR；ZIP 保持普通目录结构。
      if (isZpx) {
        const prepared = await prepareZpxAsar(filePath, workDir)
        authoritativeConfig = prepared.pluginConfig
        stagedAsarPath = prepared.asarPath
        stagedUnpackedPath = prepared.unpackedPath
      } else {
        stagedDirectoryPath = path.join(workDir, 'plugin')
        new AdmZip(filePath).extractAllTo(stagedDirectoryPath, true)
        authoritativeConfig = JSON.parse(
          await fs.readFile(path.join(stagedDirectoryPath, 'plugin.json'), 'utf-8')
        )
      }

      // 发布前重新读取包内配置，防止预览后源文件被替换。
      if (authoritativeConfig.name !== previewName) {
        throw new Error('插件包内容在预览与安装之间发生变化')
      }
      assertSafePluginArtifactPart(authoritativeConfig.name, '插件名称')
      assertSafePluginArtifactPart(authoritativeConfig.version, '插件版本')

      // 升级校验排除当前同名旧版本，避免自身标题被判断为冲突。
      const existingPlugins = this.deps.readInstalledPlugins()
      const existingIndex = existingPlugins.findIndex((plugin: any) => plugin.name === previewName)
      const previousPlugin = existingIndex >= 0 ? existingPlugins[existingIndex] : undefined
      const validation = this.deps.validatePluginConfig(
        authoritativeConfig,
        existingPlugins.filter((plugin: any) => plugin.name !== previewName)
      )
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }

      const pluginPath = isZpx
        ? createAsarArtifactPath(
            PLUGIN_DIR,
            authoritativeConfig.name as string,
            authoritativeConfig.version as string,
            operationId.slice(0, 8)
          )
        : path.join(PLUGIN_DIR, authoritativeConfig.name as string)

      // 新实体已经完整准备后，才停止仍在运行的旧插件实例。
      this.deps.pluginManager?.killPluginByName(previewName)

      // 发布只移动本次准备结果，不重命名或覆盖版本化 ASAR。
      if (isZpx) {
        await this.publishAsar(stagedAsarPath, stagedUnpackedPath, pluginPath)
      } else {
        directoryBackupPath = await this.publishDirectory(stagedDirectoryPath, pluginPath, workDir)
      }
      publishedPath = pluginPath

      // 用一次注册表写入替换同名插件记录，写入失败时旧记录保持有效。
      const pluginInfo = this.buildPluginInfo(authoritativeConfig, pluginPath, publishedKind, extra)
      const nextPlugins = [...existingPlugins]
      if (existingIndex >= 0) nextPlugins[existingIndex] = pluginInfo
      else nextPlugins.push(pluginInfo)

      this.deps.writeInstalledPlugins(nextPlugins)
      registryCommitted = true
      const warnings: string[] = []
      // 注册切换后刷新仍保存物理路径的兼容数据。
      if (previousPlugin?.path && previousPlugin.path !== pluginPath) {
        try {
          this.deps.replacePluginPathReferences(previewName, previousPlugin.path, pluginPath)
        } catch (error) {
          console.error('[Plugins] 更新插件路径引用失败:', error)
          warnings.push('部分历史记录仍引用旧插件路径')
        }
      }

      // 旧实体和界面通知都属于提交后的非关键步骤，失败只返回警告。
      const cleanupWarning = await this.cleanupPreviousPlugin(previousPlugin, pluginPath)
      if (cleanupWarning) warnings.push(cleanupWarning)
      try {
        this.logInstalledFeatures(authoritativeConfig)
        this.deps.notifyPluginsChanged()
      } catch (error) {
        console.error('[Plugins] 通知插件列表更新失败:', error)
        warnings.push('插件已安装，但界面刷新失败')
      }
      return {
        success: true,
        plugin: pluginInfo,
        ...(warnings.length > 0 ? { warning: warnings.join('；') } : {})
      }
    } catch (error: unknown) {
      if (!registryCommitted && publishedPath) {
        // 注册表尚未切换时，删除新实体并恢复 ZIP 的旧目录。
        try {
          await this.rollbackPublishedPackage(publishedPath, publishedKind, directoryBackupPath)
        } catch (rollbackError) {
          console.error('[Plugins] 清理安装失败后的新实体失败:', rollbackError)
        }
      }
      console.error('[Plugins] 安装插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '安装失败' }
    } finally {
      this.installingPluginNames.delete(previewName)
      // 正常、失败和提前返回都只清理本次工作目录。
      try {
        await artifactFs.rm(workDir, { recursive: true, force: true })
      } catch (error) {
        console.error('[Plugins] 清理安装临时目录失败:', error)
      }
    }
  }

  /**
   * 将准备完成的 ASAR 及其可选 sidecar 发布到正式路径。
   * @param stagedAsarPath 临时 ASAR 实体路径
   * @param stagedUnpackedPath 临时 unpack 目录路径
   * @param destinationPath 正式版本化 ASAR 路径
   * @returns 发布完成后结束的 Promise
   */
  private async publishAsar(
    stagedAsarPath: string,
    stagedUnpackedPath: string | undefined,
    destinationPath: string
  ): Promise<void> {
    const destinationUnpackedPath = `${destinationPath}.unpacked`
    // sidecar 先移动；ASAR 只有在配套内容就位后才对后续注册步骤可用。
    if (stagedUnpackedPath) {
      await artifactFs.rename(stagedUnpackedPath, destinationUnpackedPath)
    }
    try {
      await artifactFs.rename(stagedAsarPath, destinationPath)
    } catch (error) {
      // ASAR 发布失败时删除已经移动的 sidecar，避免留下半个新实体。
      await artifactFs.rm(destinationUnpackedPath, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * 将准备完成的 ZIP 目录发布到固定插件目录。
   * @param stagedDirectoryPath 临时插件目录
   * @param destinationPath 正式插件目录
   * @param workDir 本次安装工作目录
   * @returns 旧目录备份路径；没有旧目录时返回空字符串
   */
  private async publishDirectory(
    stagedDirectoryPath: string,
    destinationPath: string,
    workDir: string
  ): Promise<string> {
    const backupPath = path.join(workDir, 'previous-directory')
    let hasBackup = false
    try {
      // ZIP 使用固定目录名，发布前暂时保留同路径旧目录。
      await artifactFs.access(destinationPath)
      await artifactFs.rename(destinationPath, backupPath)
      hasBackup = true
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }

    try {
      await artifactFs.rename(stagedDirectoryPath, destinationPath)
      return hasBackup ? backupPath : ''
    } catch (error) {
      // 新目录移动失败时立即恢复旧目录，不依赖后续启动恢复。
      try {
        await artifactFs.rename(backupPath, destinationPath)
      } catch {
        // backup 不存在时无需恢复
      }
      throw error
    }
  }

  /**
   * 回滚尚未写入插件注册表的新实体。
   * @param pluginPath 已发布的新实体路径
   * @param storageKind 新实体存储类型
   * @param directoryBackupPath ZIP 发布时保留的旧目录路径
   * @returns 回滚完成后结束的 Promise
   */
  private async rollbackPublishedPackage(
    pluginPath: string,
    storageKind: PluginStorageKind,
    directoryBackupPath: string
  ): Promise<void> {
    // 先删除未注册的新实体，再按需恢复 ZIP 的固定目录。
    await removePluginArtifact({ path: pluginPath, storageKind })
    if (storageKind === 'directory' && directoryBackupPath) {
      try {
        await artifactFs.rename(directoryBackupPath, pluginPath)
      } catch (error) {
        console.error('[Plugins] 恢复旧插件目录失败:', error)
      }
    }
  }

  /**
   * 在注册表切换成功后清理旧插件实体。
   * @param previousPlugin 切换前的插件记录
   * @param currentPath 当前插件实体路径
   * @returns 清理成功时返回 undefined，失败时返回用户可见警告
   */
  private async cleanupPreviousPlugin(
    previousPlugin: any,
    currentPath: string
  ): Promise<string | undefined> {
    if (!previousPlugin?.path || previousPlugin.path === currentPath) return undefined
    try {
      await removePluginArtifact(previousPlugin)
      return undefined
    } catch (error) {
      console.error('[Plugins] 清理旧插件实体失败:', error)
      return '插件已安装，但旧版本文件清理失败'
    }
  }

  /**
   * 输出新安装插件的功能指令列表到控制台。
   * @param pluginConfig - 插件配置对象（包含 name、version、features）
   * @param header - 可选的日志标题（默认“新增插件指令”）
   * @returns 无返回值
   */
  private logInstalledFeatures(pluginConfig: any, header?: string): void {
    console.log(`[Plugins] \n=== ${header || '新增插件指令'} ===`)
    console.log(`插件名称: ${pluginConfig.name}`)
    console.log(`插件版本: ${pluginConfig.version}`)
    console.log('[Plugins] 新增指令列表:')
    pluginConfig.features?.forEach((feature: any, index: number) => {
      console.log(`  [${index + 1}] ${feature.code} - ${feature.explain || '无说明'}`)

      const formattedCmds = feature.cmds
        .map((cmd: any) => {
          if (typeof cmd === 'string') {
            return cmd
          } else if (typeof cmd === 'object' && cmd !== null) {
            const type = cmd.type || 'unknown'
            const label = cmd.label || type
            return `[${type}] ${label}`
          }
          return String(cmd)
        })
        .join(', ')

      console.log(`      关键词: ${formattedCmds}`)
    })
    console.log('[Plugins] =========================\n')
  }
}
