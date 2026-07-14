/**
 * 正式插件来源协调器。
 *
 * 本文件负责把本地、市场与 NPM 输入转换为安装单元服务可提交的暂存实体；
 * 正式插件的物理切换和注册表写入统一由事务服务完成，避免来源流程提前破坏旧版本。
 */

import type { PluginManager } from '../../managers/pluginManager'
import type { PluginDevProjectsAPI } from './pluginDevProjects'
import type { InstalledPluginRecord } from '../../core/pluginInstallUnit/types'
import type { PluginInstallUnitService } from '../../core/pluginInstallUnit/service'
import { app, shell, type WebContents } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import * as tar from 'tar'
import AdmZip from 'adm-zip'
import { isValidZpx, readTextFromZpx, readFileFromZpx } from '../../utils/zpxArchive.js'
import { DownloadCancelledError, downloadFile } from '../../utils/download.js'
import { httpGet } from '../../utils/httpRequest.js'
import { sleep } from '../../utils/common.js'
import { openDialog } from '../../utils/windowUtils'
import { getPluginMarketApiBase, requestPluginMarket } from './pluginMarketConfig'

const MARKET_DOWNLOAD_PROGRESS_CHANNEL = 'plugin-market-download-progress'
const MAX_DOWNLOAD_RETRIES = 3
const DOWNLOAD_RETRY_DELAY_MS = 500

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

/** 插件功能配置中安装器日志所需的字段。 */
interface PluginFeatureConfig {
  /** 功能稳定代码。 */
  code?: string
  /** 功能说明。 */
  explain?: string
  /** 可触发该功能的命令。 */
  cmds?: unknown[]
}

/** 安装来源边界接受的 plugin.json 结构。 */
interface PluginPackageConfig extends Record<string, unknown> {
  /** 插件稳定名称。 */
  name: string
  /** 用户可见标题。 */
  title?: string
  /** 插件版本。 */
  version?: string
  /** 插件说明。 */
  description?: string
  /** 插件作者。 */
  author?: string
  /** 插件主页。 */
  homepage?: string
  /** 相对插件根路径的图标。 */
  logo?: string
  /** 相对插件根路径的页面入口。 */
  main?: string
  /** 相对插件根路径的 preload。 */
  preload?: string
  /** 插件功能列表。 */
  features?: PluginFeatureConfig[]
}

/** 插件安装成功结果。 */
interface PluginInstallSuccess {
  /** 安装事务已经提交。 */
  success: true
  /** 已写入注册表的插件记录。 */
  plugin: InstalledPluginRecord
  /** 提交成功后的非关键清理警告。 */
  warning?: string
}

/** 插件安装失败或取消结果。 */
interface PluginInstallFailure {
  /** 安装事务未提交。 */
  success: false
  /** 可直接展示的失败原因。 */
  error: string
  /** 市场下载是否由用户取消。 */
  cancelled?: boolean
}

/** 所有正式安装入口共享的结果类型。 */
type PluginInstallResult = PluginInstallSuccess | PluginInstallFailure

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
  /** 正式插件的规范存储、事务提交与导出服务 */
  readonly pluginInstallUnits: PluginInstallUnitService
  /** 获取非内置插件列表 */
  getPlugins(): Promise<InstalledPluginRecord[]>
  /** 读取当前已安装插件列表 */
  readInstalledPlugins(): InstalledPluginRecord[]
  /** 通知渲染进程插件列表已变更 */
  notifyPluginsChanged(): void
  /** 校验插件配置的合法性 */
  validatePluginConfig(
    config: PluginPackageConfig,
    existing: InstalledPluginRecord[]
  ): { valid: true } | { valid: false; error: string }
}

// ━━━ PluginInstallerAPI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 插件安装器 API。
 * 负责 ZPX/ZIP/NPM/市场等多种来源的插件安装，以及插件打包和导出。
 * 通过 PluginInstallerDeps 依赖注入与主 PluginsAPI 解耦。
 */
export class PluginInstallerAPI {
  private marketDownloadTasks = new Map<string, MarketDownloadTask>()

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
      const { config, isZpx } = await this.readPluginJson(zpxPath)
      const logoBase64 = await this.readPluginLogoDataUrl({
        filePath: zpxPath,
        isZpx,
        logo: config.logo
      })
      const existingPlugins = await this.deps.getPlugins()
      const isInstalled = existingPlugins.some((plugin) => plugin.name === config.name)

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
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 读取插件 logo，并转换为预览协议可直接展示的 data URL。 */
  private async readPluginLogoDataUrl(options: {
    filePath: string
    isZpx: boolean
    logo: unknown
  }): Promise<string> {
    if (typeof options.logo !== 'string' || !options.logo) return ''
    try {
      const logoBuffer = options.isZpx
        ? await readFileFromZpx(options.filePath, options.logo)
        : new AdmZip(options.filePath).readFile(options.logo)
      if (!logoBuffer) return ''
      const mimeType = this.resolveImageMimeType(options.logo)
      return `data:${mimeType};base64,${logoBuffer.toString('base64')}`
    } catch (error) {
      console.warn('[Plugins] 提取插件 logo 失败:', error)
      return ''
    }
  }

  /** 根据 logo 扩展名生成现有预览协议使用的图片 MIME 类型。 */
  private resolveImageMimeType(logoPath: string): string {
    const extension = path.extname(logoPath).toLowerCase().replace('.', '')
    if (extension === 'svg') return 'image/svg+xml'
    if (extension === 'png') return 'image/png'
    return `image/${extension}`
  }

  /**
   * 从指定文件路径安装插件。
   * ZPX 与 ZIP 都保留既有覆盖能力，分别提交为 ASAR 与目录安装单元。
   * @param filePath 插件包的绝对路径
   * @returns {success: boolean, plugin?: object, error?: string}
   */
  public async installPluginFromPath(filePath: string): Promise<PluginInstallResult> {
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
   * @param plugin - 市场插件对象，必须包含 name 字段
   * @returns {success: boolean, plugin?: object, error?: string}
   */
  public async installPluginFromMarket(
    plugin: { name?: string },
    webContents?: WebContents
  ): Promise<PluginInstallResult> {
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
      if (!downloadUrl) return { success: false, error: '无效的下载链接' }

      console.log('[Plugins] 插件下载链接:', downloadUrl)
      await fs.mkdir(tempDir, { recursive: true })
      await this.downloadMarketPackage(task, downloadUrl, tempFilePath)
      return await this.installDownloadedMarketPackage(task, tempFilePath)
    } catch (error: unknown) {
      return this.handleMarketDownloadFailure(task, error)
    } finally {
      this.marketDownloadTasks.delete(pluginName)
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (e) {
        console.error('[Plugins] 清理下载临时文件失败:', e)
      }
    }
  }

  /** 下载市场归档并把每次进度映射到当前任务。 */
  private async downloadMarketPackage(
    task: MarketDownloadTask,
    downloadUrl: string,
    tempFilePath: string
  ): Promise<void> {
    this.emitMarketDownloadProgress(task, {
      pluginName: task.pluginName,
      taskId: task.taskId,
      status: 'downloading',
      progress: 0
    })
    for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
      try {
        await downloadFile(downloadUrl, tempFilePath, {
          signal: task.controller.signal,
          onProgress: (progress) => {
            this.emitMarketDownloadProgress(task, {
              pluginName: task.pluginName,
              taskId: task.taskId,
              status: 'downloading',
              progress: progress.percent,
              receivedBytes: progress.receivedBytes,
              totalBytes: progress.totalBytes
            })
          }
        })
        return
      } catch (error) {
        if (error instanceof DownloadCancelledError || task.controller.signal.aborted) throw error
        console.error(`下载失败，重试第 ${attempt} 次:`, error)
        if (attempt === MAX_DOWNLOAD_RETRIES) throw error
        await fs.rm(tempFilePath, { force: true })
        await sleep(DOWNLOAD_RETRY_DELAY_MS)
      }
    }
  }

  /** 检测已下载市场包的格式并进入统一安装事务。 */
  private async installDownloadedMarketPackage(
    task: MarketDownloadTask,
    tempFilePath: string
  ): Promise<PluginInstallResult> {
    console.log('[Plugins] 插件下载完成:', tempFilePath)
    this.emitMarketDownloadProgress(task, {
      pluginName: task.pluginName,
      taskId: task.taskId,
      status: 'installing',
      progress: 100
    })
    const { config, isZpx } = await this.readPluginJson(tempFilePath)
    console.log(`[Plugins] 市场插件格式: ${isZpx ? 'ZPX' : 'ZIP（兼容）'}`)
    const result = await this.installFromPackageFile(tempFilePath, isZpx, config)
    this.emitMarketDownloadProgress(task, {
      pluginName: task.pluginName,
      taskId: task.taskId,
      status: result.success ? 'success' : 'error',
      progress: result.success ? 100 : null,
      error: result.success ? undefined : result.error || '安装失败'
    })
    return result
  }

  /** 将取消和失败映射为稳定的市场安装结果与进度状态。 */
  private handleMarketDownloadFailure(
    task: MarketDownloadTask,
    error: unknown
  ): PluginInstallFailure {
    if (error instanceof DownloadCancelledError || task.controller.signal.aborted) {
      console.log('[Plugins] 市场插件下载已取消:', task.pluginName)
      this.emitMarketDownloadProgress(task, {
        pluginName: task.pluginName,
        taskId: task.taskId,
        status: 'cancelled',
        progress: null
      })
      return { success: false, cancelled: true, error: '已取消下载' }
    }
    console.error('[Plugins] 从市场安装插件失败:', error)
    const message = error instanceof Error ? error.message : '安装失败'
    this.emitMarketDownloadProgress(task, {
      pluginName: task.pluginName,
      taskId: task.taskId,
      status: 'error',
      progress: null,
      error: message
    })
    return { success: false, error: message }
  }

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

  private async resolveMarketDownloadUrl(plugin: { name?: string }): Promise<string> {
    const pluginName = typeof plugin?.name === 'string' ? plugin.name : ''
    if (!pluginName) {
      return ''
    }

    const marketApiBase = getPluginMarketApiBase()
    const response = await requestPluginMarket(
      `${marketApiBase}/plugins/download?name=${encodeURIComponent(pluginName)}`
    )
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    if (typeof data?.downloadUrl === 'string' && data.downloadUrl.trim()) {
      return data.downloadUrl.trim()
    }

    return ''
  }

  /**
   * 从 npm 安装插件
   * @param packageName npm 包名（支持作用域包，如 @ztools/example）
   * @param useChinaMirror 是否使用国内镜像（默认 false）
   */
  public async installPluginFromNpm(
    packageName: string,
    useChinaMirror = false
  ): Promise<PluginInstallResult> {
    let tempDir = ''
    try {
      console.log('[Plugins] 开始从 npm 安装插件:', packageName)
      const registryBase = useChinaMirror
        ? 'https://registry.npmmirror.com'
        : 'https://registry.npmjs.org'
      const registryUrl = `${registryBase}/${packageName}`
      console.log('[Plugins] 获取包信息:', registryUrl, useChinaMirror ? '(国内镜像)' : '')
      const { latestVersion, tarballUrl } = await this.resolveNpmTarball(registryUrl)
      console.log('[Plugins] 最新版本:', latestVersion)
      console.log('[Plugins] Tarball URL:', tarballUrl)

      tempDir = await this.createInstallTempDir('ztools-npm-download-')
      const tarballPath = path.join(tempDir, 'plugin.tgz')
      await this.downloadWithRetry(tarballUrl, tarballPath)
      const packageDir = await this.extractNpmTarball(tarballPath, tempDir)
      const pluginConfig = await this.readNpmPluginConfig(packageDir)
      const result = await this.installDirectoryPackage(packageDir, pluginConfig, {
        installedFrom: 'npm'
      })
      if (!result.success) return result

      this.logInstalledFeatures(pluginConfig, `从 npm 安装插件成功\nnpm 包名: ${packageName}`)
      return result
    } catch (error: unknown) {
      console.error('[Plugins] 从 npm 安装插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '安装失败' }
    } finally {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch((error) => {
          console.error('[Plugins] 清理 NPM 安装临时文件失败:', error)
        })
      }
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
    failures?: Array<{ pluginName: string; error: string }>
    error?: string
  }> {
    try {
      const plugins = this.deps.readInstalledPlugins()

      const { isBundledInternalPlugin } = await import('../../core/internalPlugins')
      const exportablePlugins = plugins.filter(
        (plugin) => !plugin.isDevelopment && !isBundledInternalPlugin(plugin.name)
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
      const failures: Array<{ pluginName: string; error: string }> = []
      for (const plugin of exportablePlugins) {
        const pluginPath: string = plugin.path
        const baseName: string = plugin.name || path.basename(pluginPath)
        const folderName: string = plugin.version ? `${baseName}-v${plugin.version}` : baseName
        const destPath = path.join(exportDir, folderName)
        try {
          await this.deps.pluginInstallUnits.exportPlugin({ plugin, destinationDir: destPath })
          successCount++
        } catch (err) {
          console.error(`[Plugins] 导出插件失败: ${folderName}`, err)
          failures.push({
            pluginName: plugin.name,
            error: err instanceof Error ? err.message : '导出失败'
          })
        }
      }

      if (successCount === 0) {
        return {
          success: false,
          exportPath: exportDir,
          count: 0,
          failures,
          error: '所有插件导出失败'
        }
      }

      shell.showItemInFolder(exportDir)

      console.log('[Plugins] 插件导出完成:', exportDir)
      return { success: true, exportPath: exportDir, count: successCount, failures }
    } catch (error: unknown) {
      console.error('[Plugins] 导出所有插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '导出失败' }
    }
  }

  // ━━━ Private ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private findMarketDownloadTask(pluginNameOrTaskId: string): MarketDownloadTask | undefined {
    const directTask = this.marketDownloadTasks.get(pluginNameOrTaskId)
    if (directTask) return directTask

    for (const task of this.marketDownloadTasks.values()) {
      if (task.taskId === pluginNameOrTaskId) return task
    }

    return undefined
  }

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
   * @throws 若 plugin.json 缺失、解析失败或缺少 name 字段则抛出带描述的 Error
   */
  private async readPluginJson(
    filePath: string
  ): Promise<{ config: PluginPackageConfig; isZpx: boolean }> {
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
    let config: unknown
    try {
      config = JSON.parse(content)
    } catch {
      throw new Error('无效的插件文件：plugin.json 格式错误')
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('无效的插件文件：plugin.json 必须是对象')
    }
    if (typeof (config as Record<string, unknown>).name !== 'string') {
      throw new Error('无效的插件文件：缺少 name 字段')
    }
    return { config: config as PluginPackageConfig, isZpx }
  }

  /** 根据已校验配置构建待事务写入的插件记录。 */
  private createPluginRecord(
    config: PluginPackageConfig,
    pluginPath: string,
    extra: Record<string, unknown> = {}
  ): InstalledPluginRecord {
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
      isDevelopment: false,
      installedAt: new Date().toISOString(),
      ...extra
    }
  }

  /**
   * 将插件包交给对应存储形态的事务流程。
   * @param filePath - 插件包路径（ZPX 或 ZIP）
   * @param isZpx - 是否为 ZPX 格式（由 readPluginJson 返回）
   * @param pluginConfig - 已解析的 plugin.json 配置
   */
  private async installFromPackageFile(
    filePath: string,
    isZpx: boolean,
    pluginConfig: PluginPackageConfig
  ): Promise<PluginInstallResult> {
    try {
      if (isZpx) return await this.installZpxPackage(filePath, pluginConfig)
      return await this.installZipPackage(filePath, pluginConfig)
    } catch (error: unknown) {
      console.error('[Plugins] 安装插件失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '安装失败' }
    }
  }

  /** 将正式 ZPX 准备并提交为规范 ASAR 安装单元。 */
  private async installZpxPackage(
    zpxPath: string,
    pluginConfig: PluginPackageConfig
  ): Promise<PluginInstallResult> {
    const previousPlugin = this.findInstalledPlugin(pluginConfig.name)
    const validation = this.validateReplacement(pluginConfig, previousPlugin)
    if (!validation.valid) return { success: false, error: validation.error }

    const prepared = await this.deps.pluginInstallUnits.prepareZpx({ zpxPath, pluginConfig })
    const pluginInfo = this.createPluginRecord(pluginConfig, prepared.canonicalAsarPath, {
      storageKind: 'asar'
    })
    const mutation = await this.deps.pluginInstallUnits.commitPrepared({
      prepared,
      previousPlugin,
      nextPlugin: pluginInfo,
      stopPrevious: () => this.stopPreviousPlugin(previousPlugin)
    })
    this.logInstalledFeatures(pluginConfig)
    this.deps.notifyPluginsChanged()
    return { success: true, plugin: pluginInfo, warning: mutation.warning }
  }

  /** 将 ZIP 解压到隔离临时目录后按目录事务安装。 */
  private async installZipPackage(
    filePath: string,
    pluginConfig: PluginPackageConfig
  ): Promise<PluginInstallResult> {
    const tempDir = await this.createInstallTempDir('ztools-zip-install-')
    try {
      new AdmZip(filePath).extractAllTo(tempDir, true)
      return await this.installDirectoryPackage(tempDir, pluginConfig)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  /** 将受控来源目录通过安装单元事务提交为规范目录插件。 */
  private async installDirectoryPackage(
    sourceDir: string,
    pluginConfig: PluginPackageConfig,
    extra: Record<string, unknown> = {}
  ): Promise<PluginInstallResult> {
    const previousPlugin = this.findInstalledPlugin(pluginConfig.name)
    const validation = this.validateReplacement(pluginConfig, previousPlugin)
    if (!validation.valid) return { success: false, error: validation.error }

    const prepared = await this.deps.pluginInstallUnits.prepareDirectory({
      sourceDir,
      pluginConfig
    })
    const pluginInfo = this.createPluginRecord(pluginConfig, prepared.canonicalDirectoryPath, {
      storageKind: 'directory',
      ...extra
    })
    const mutation = await this.deps.pluginInstallUnits.commitPreparedDirectory({
      prepared,
      previousPlugin,
      nextPlugin: pluginInfo,
      stopPrevious: () => this.stopPreviousPlugin(previousPlugin)
    })
    this.deps.notifyPluginsChanged()
    return { success: true, plugin: pluginInfo, warning: mutation.warning }
  }

  /** 在配置冲突检查中排除即将被本次事务替换的旧记录。 */
  private validateReplacement(
    pluginConfig: PluginPackageConfig,
    previousPlugin: InstalledPluginRecord | null
  ): { valid: true } | { valid: false; error: string } {
    const remainingPlugins = this.deps
      .readInstalledPlugins()
      .filter((plugin) => plugin !== previousPlugin && plugin.name !== previousPlugin?.name)
    return this.deps.validatePluginConfig(pluginConfig, remainingPlugins)
  }

  /** 获取当前同名正式插件记录。 */
  private findInstalledPlugin(pluginName: string): InstalledPluginRecord | null {
    return this.deps.readInstalledPlugins().find((plugin) => plugin.name === pluginName) || null
  }

  /** 仅在事务已准备完成并进入提交时停止旧运行实例。 */
  private async stopPreviousPlugin(previousPlugin: InstalledPluginRecord | null): Promise<void> {
    if (!previousPlugin) return
    await this.deps.pluginManager?.stopPluginByName(previousPlugin.name)
  }

  /** 创建来源处理使用的独立临时目录，避免并发安装共享中间文件。 */
  private async createInstallTempDir(prefix: string): Promise<string> {
    const tempRoot = app.getPath('temp')
    await fs.mkdir(tempRoot, { recursive: true })
    return await fs.mkdtemp(path.join(tempRoot, prefix))
  }

  /** 从 NPM 注册表响应中取得唯一可安装的最新版本归档。 */
  private async resolveNpmTarball(
    registryUrl: string
  ): Promise<{ latestVersion: string; tarballUrl: string }> {
    let packageInfo: unknown
    try {
      const response = await httpGet(registryUrl)
      const responseData: unknown = response.data
      packageInfo = typeof responseData === 'string' ? JSON.parse(responseData) : responseData
    } catch (error) {
      console.error('[Plugins] 获取包信息失败:', error)
      throw new Error('无法获取包信息，请检查包名是否正确')
    }

    return this.readNpmTarballMetadata(packageInfo)
  }

  /** 在网络输入边界逐层校验 NPM 最新版本与归档地址。 */
  private readNpmTarballMetadata(packageInfo: unknown): {
    latestVersion: string
    tarballUrl: string
  } {
    const registry = toUnknownRecord(packageInfo)
    const distTags = toUnknownRecord(registry?.['dist-tags'])
    const latestVersion = readRequiredString(distTags?.latest, '无法获取最新版本信息')
    const versions = toUnknownRecord(registry?.versions)
    const versionInfo = toUnknownRecord(versions?.[latestVersion])
    const distribution = toUnknownRecord(versionInfo?.dist)
    const tarballUrl = readHttpUrl(distribution?.tarball, '无法获取下载链接')
    return { latestVersion, tarballUrl }
  }

  /** 下载文件并在明确失败时按既有次数重试。 */
  private async downloadWithRetry(url: string, destinationPath: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
      try {
        await downloadFile(url, destinationPath)
        return
      } catch (error) {
        console.error(`下载失败，重试第 ${attempt} 次:`, error)
        if (attempt === MAX_DOWNLOAD_RETRIES) throw error
        await sleep(DOWNLOAD_RETRY_DELAY_MS)
      }
    }
  }

  /** 解开 NPM tarball 并返回 package/ 实体目录。 */
  private async extractNpmTarball(tarballPath: string, tempDir: string): Promise<string> {
    const extractDir = path.join(tempDir, 'extracted')
    await fs.mkdir(extractDir, { recursive: true })
    await tar.extract({ file: tarballPath, cwd: extractDir })
    return path.join(extractDir, 'package')
  }

  /** 读取并校验 NPM 包边界上的 plugin.json 基本结构。 */
  private async readNpmPluginConfig(packageDir: string): Promise<PluginPackageConfig> {
    const pluginJsonPath = path.join(packageDir, 'plugin.json')
    let content: string
    try {
      content = await fs.readFile(pluginJsonPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('这不是一个有效的 ZTools 插件包（缺少 plugin.json）')
      }
      throw error
    }
    const config = JSON.parse(content) as unknown
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('plugin.json 格式错误')
    }
    if (typeof (config as Record<string, unknown>).name !== 'string') {
      throw new Error('plugin.json 缺少 name 字段')
    }
    return config as PluginPackageConfig
  }

  /**
   * 输出新安装插件的功能指令列表到控制台。
   * @param pluginConfig - 插件配置对象（包含 name、version、features）
   * @param header - 可选的日志标题（默认“新增插件指令”）
   */
  private logInstalledFeatures(pluginConfig: PluginPackageConfig, header?: string): void {
    console.log(`[Plugins] \n=== ${header || '新增插件指令'} ===`)
    console.log(`插件名称: ${pluginConfig.name}`)
    console.log(`插件版本: ${pluginConfig.version}`)
    console.log('[Plugins] 新增指令列表:')
    pluginConfig.features?.forEach((feature, index) => {
      console.log(`  [${index + 1}] ${feature.code} - ${feature.explain || '无说明'}`)

      const formattedCmds = (feature.cmds || []).map(formatFeatureCommand).join(', ')

      console.log(`      关键词: ${formattedCmds}`)
    })
    console.log('[Plugins] =========================\n')
  }
}

/** 将插件命令配置转换为只用于诊断日志的稳定文本。 */
function formatFeatureCommand(command: unknown): string {
  if (typeof command === 'string') return command
  if (!command || typeof command !== 'object') return String(command)
  const value = command as Record<string, unknown>
  const type = typeof value.type === 'string' ? value.type : 'unknown'
  const label = typeof value.label === 'string' ? value.label : type
  return `[${type}] ${label}`
}

/** 将未知外部值收窄为普通对象，数组不属于注册表对象结构。 */
function toUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** 校验网络元数据中的必填字符串，并返回去除边界空白后的值。 */
function readRequiredString(value: unknown, errorMessage: string): string {
  if (typeof value !== 'string') throw new Error(errorMessage)
  const normalized = value.trim()
  if (!normalized) throw new Error(errorMessage)
  return normalized
}

/** 校验下载地址只使用 HTTP(S)，阻止注册表响应触发本地或自定义协议。 */
function readHttpUrl(value: unknown, errorMessage: string): string {
  const normalized = readRequiredString(value, errorMessage)
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(errorMessage)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(errorMessage)
  }
  return parsed.href
}
