import { ipcMain, app, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import { getLanzouDownloadLink, getLanzouFolderFileList } from '../utils/lanzou.js'
import { downloadFile } from '../utils/download.js'
import { spawn } from 'child_process'

/**
 * 更新路径配置
 */
interface UpdatePaths {
  updaterPath: string
  asarSrc: string
  asarDst: string
  unpackedSrc: string
  unpackedDst: string
  appPath: string
}

/**
 * 升级管理 API
 */
export class UpdaterAPI {
  private updateCheckUrl = 'https://ilt.lanzouu.com/b0pn8htad'
  private updateCheckPwd = '1f8i'
  private mainWindow: BrowserWindow | null = null
  private checkTimer: NodeJS.Timeout | null = null
  private downloadedUpdateInfo: any = null
  private downloadedUpdatePath: string | null = null

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
    this.startAutoCheck()
  }

  private setupIPC(): void {
    ipcMain.handle('updater:check-update', () => this.checkUpdate())
    ipcMain.handle('updater:start-update', (_event, updateInfo) => this.startUpdate(updateInfo))
    ipcMain.handle('updater:install-downloaded-update', () => this.installDownloadedUpdate())
    ipcMain.handle('updater:get-download-status', () => this.getDownloadStatus())
  }

  /**
   * 启动自动检查（30分钟一次）
   */
  private startAutoCheck(): void {
    // 应用启动后立即进行首次检查
    this.autoCheckAndDownload()

    // 每30分钟检查一次
    this.checkTimer = setInterval(() => this.autoCheckAndDownload(), 30 * 60 * 1000)
  }

  /**
   * 自动检查并下载更新
   */
  private async autoCheckAndDownload(): Promise<void> {
    try {
      console.log('开始自动检查更新...')

      // 如果已经下载过更新，不再重复下载
      if (this.downloadedUpdateInfo) {
        console.log('已有下载的更新，跳过检查')
        return
      }

      const result = await this.checkUpdate()

      if (result.hasUpdate && result.updateInfo) {
        console.log('发现新版本，开始自动下载...', result.updateInfo)

        // 通知渲染进程开始下载
        this.mainWindow?.webContents.send('update-download-start', {
          version: result.updateInfo.version
        })

        // 执行下载
        const downloadResult = await this.downloadAndExtractUpdate(result.updateInfo)

        if (downloadResult.success) {
          this.downloadedUpdateInfo = result.updateInfo
          this.downloadedUpdatePath = downloadResult.extractPath

          // 通知渲染进程下载完成
          this.mainWindow?.webContents.send('update-downloaded', {
            version: result.updateInfo.version,
            changelog: result.updateInfo.changelog
          })

          console.log('更新下载完成，等待用户安装')
        } else {
          console.error('更新下载失败:', downloadResult.error)
          this.mainWindow?.webContents.send('update-download-failed', {
            error: downloadResult.error
          })
        }
      }
    } catch (error) {
      console.error('自动检查更新失败:', error)
    }
  }

  /**
   * 获取下载状态
   */
  private getDownloadStatus(): any {
    if (this.downloadedUpdateInfo) {
      return {
        hasDownloaded: true,
        version: this.downloadedUpdateInfo.version,
        changelog: this.downloadedUpdateInfo.changelog
      }
    }
    return { hasDownloaded: false }
  }

  /**
   * 根据平台选择下载URL
   */
  private selectDownloadUrl(updateInfo: any): string {
    const isMac = process.platform === 'darwin'
    const isWin = process.platform === 'win32'
    const isArm64 = process.arch === 'arm64'

    let downloadUrl = updateInfo.downloadUrl

    if (isWin && updateInfo.downloadUrlWin64) {
      downloadUrl = updateInfo.downloadUrlWin64
    } else if (isMac && isArm64 && updateInfo.downloadUrlMacArm) {
      downloadUrl = updateInfo.downloadUrlMacArm
    }

    if (!downloadUrl) {
      throw new Error(`未找到适配当前系统(${process.platform}-${process.arch})的下载地址`)
    }

    return downloadUrl
  }

  /**
   * 下载并解压更新包
   */
  private async downloadAndExtractUpdate(updateInfo: any): Promise<any> {
    try {
      // 1. 选择下载URL
      const downloadUrl = this.selectDownloadUrl(updateInfo)

      // 2. 获取真实下载链接
      const realDownloadUrl = await getLanzouDownloadLink(downloadUrl)

      // 3. 下载更新包
      const tempDir = path.join(app.getPath('userData'), 'ztools-update-pkg')
      await fs.mkdir(tempDir, { recursive: true })
      const tempZipPath = path.join(tempDir, `update-${Date.now()}.zip`)
      const extractPath = path.join(tempDir, `extracted-${Date.now()}`)

      console.log('下载更新包...', realDownloadUrl)
      await downloadFile(realDownloadUrl, tempZipPath)

      // 4. 解压
      console.log('解压更新包...')
      await fs.mkdir(extractPath, { recursive: true })

      const zip = new AdmZip(tempZipPath)
      await new Promise<void>((resolve, reject) => {
        zip.extractAllToAsync(extractPath, true, (error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })

      // 5. 重命名 app.asar.tmp -> app.asar
      const appAsarTmp = path.join(extractPath, 'app.asar.tmp')
      const appAsar = path.join(extractPath, 'app.asar')
      try {
        await fs.access(appAsarTmp)
        await fs.rename(appAsarTmp, appAsar)
        console.log('成功重命名: app.asar.tmp -> app.asar')
      } catch (e) {
        console.log('未找到 app.asar.tmp，可能直接是 app.asar 或位置不同')
        console.log(e)
      }

      // 6. 删除 zip 文件节省空间
      try {
        await fs.unlink(tempZipPath)
      } catch (e) {
        console.error('删除 zip 文件失败:', e)
      }

      return { success: true, extractPath }
    } catch (error: unknown) {
      console.error('下载更新失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 获取更新路径配置
   */
  private getUpdatePaths(extractPath: string): UpdatePaths {
    const isMac = process.platform === 'darwin'
    const isWin = process.platform === 'win32'
    const appPath = process.execPath

    const asarSrc = path.join(extractPath, 'app.asar')
    const unpackedSrc = path.join(extractPath, 'app.asar.unpacked')

    let updaterPath = ''
    let asarDst = ''
    let unpackedDst = ''

    if (isMac) {
      const contentsDir = path.dirname(path.dirname(appPath))
      const resourcesDir = path.join(contentsDir, 'Resources')

      if (!app.isPackaged) {
        updaterPath = path.join(app.getAppPath(), 'src/updater/mac-arm64/ztools-updater')
      } else {
        updaterPath = path.join(path.dirname(appPath), 'ztools-updater')
      }

      asarDst = path.join(resourcesDir, 'app.asar')
      unpackedDst = path.join(resourcesDir, 'app.asar.unpacked')
    } else if (isWin) {
      updaterPath = path.join(path.dirname(appPath), 'ztools-updater.exe')
      const resourcesDir = path.join(path.dirname(appPath), 'resources')

      asarDst = path.join(resourcesDir, 'app.asar')
      unpackedDst = path.join(resourcesDir, 'app.asar.unpacked')
    }

    return { updaterPath, asarSrc, asarDst, unpackedSrc, unpackedDst, appPath }
  }

  /**
   * 启动 updater 并退出应用
   */
  private async launchUpdater(paths: UpdatePaths): Promise<void> {
    // 检查 updater 是否存在
    try {
      await fs.access(paths.updaterPath)
    } catch {
      throw new Error(`找不到升级程序: ${paths.updaterPath}`)
    }

    // 构建参数
    const args = ['--asar-src', paths.asarSrc, '--asar-dst', paths.asarDst, '--app', paths.appPath]

    if (paths.unpackedSrc) {
      args.push('--unpacked-src', paths.unpackedSrc)
      args.push('--unpacked-dst', paths.unpackedDst)
    }

    console.log('启动升级程序:', paths.updaterPath, args)

    // 启动 updater
    const subprocess = spawn(paths.updaterPath, args, {
      detached: true,
      stdio: 'ignore'
    })

    subprocess.unref()

    // 退出应用
    console.log('应用即将退出进行更新...')
    app.quit()
  }

  /**
   * 安装已下载的更新
   */
  private async installDownloadedUpdate(): Promise<any> {
    try {
      if (!this.downloadedUpdatePath || !this.downloadedUpdateInfo) {
        throw new Error('没有可用的更新')
      }

      const paths = this.getUpdatePaths(this.downloadedUpdatePath)
      await this.launchUpdater(paths)

      return { success: true }
    } catch (error: unknown) {
      console.error('安装更新失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 清理定时器
   */
  public cleanup(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  /**
   * 检查更新
   */
  private async checkUpdate(): Promise<any> {
    try {
      // 1. 获取文件列表
      const fileList = await getLanzouFolderFileList(this.updateCheckUrl, this.updateCheckPwd)
      if (!Array.isArray(fileList) || fileList.length === 0) {
        throw new Error('更新文件列表为空')
      }

      // 2. 查找最新的更新信息文件
      // 格式: ztools_update_1.0.1.txt
      let latestFile: any = null
      let latestVersion = '0.0.0'
      const versionRegex = /ztools_update_(\d+(\.\d+)*)\.txt/

      for (const file of fileList) {
        const match = file.name_all.match(versionRegex)
        if (match) {
          const version = match[1]
          if (this.compareVersions(version, latestVersion) > 0) {
            latestVersion = version
            latestFile = file
          }
        }
      }

      if (!latestFile) {
        console.log('没有找到更新文件')
        // 没有找到更新文件
        return { hasUpdate: false }
      }

      // 3. 比较当前版本
      const currentVersion = app.getVersion()
      if (this.compareVersions(latestVersion, currentVersion) <= 0) {
        return { hasUpdate: false, latestVersion, currentVersion }
      }

      console.log(`发现新版本: ${latestVersion}, 当前版本: ${currentVersion}`)

      // 4. 下载并解析更新信息
      const filePageUrl = 'https://ilt.lanzouu.com/' + latestFile.id
      const downloadLink = await getLanzouDownloadLink(filePageUrl)

      const tempDir = path.join(app.getPath('userData'), 'ztools-update-check')
      await fs.mkdir(tempDir, { recursive: true })
      const tempFilePath = path.join(tempDir, `update-info-${Date.now()}.json`)

      try {
        await downloadFile(downloadLink, tempFilePath)
        const content = await fs.readFile(tempFilePath, 'utf-8')
        // Lanzou text files might have BOM or weird encoding, but usually utf8 is fine
        // Sometimes JSON might be malformed if uploaded as txt, but we assume it's valid JSON content
        const updateInfo = JSON.parse(content)

        // 确保包含必要字段
        const hasDownloadUrl =
          updateInfo.downloadUrl || updateInfo.downloadUrlWin64 || updateInfo.downloadUrlMacArm
        if (!updateInfo.version || !hasDownloadUrl) {
          throw new Error('更新信息格式错误')
        }

        return {
          hasUpdate: true,
          currentVersion,
          latestVersion,
          updateInfo
        }
      } finally {
        // 清理临时文件
        try {
          await fs.rm(tempDir, { recursive: true, force: true })
        } catch (e) {
          console.error(e)
        }
      }
    } catch (error: unknown) {
      console.error('检查更新失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '检查更新失败'
      }
    }
  }

  /**
   * 开始更新（手动升级）
   */
  private async startUpdate(updateInfo: any): Promise<any> {
    try {
      console.log('开始更新流程...', updateInfo)

      // 1. 下载并解压更新包
      const downloadResult = await this.downloadAndExtractUpdate(updateInfo)
      if (!downloadResult.success) {
        return downloadResult
      }

      // 2. 获取更新路径配置
      const paths = this.getUpdatePaths(downloadResult.extractPath)

      // 3. 启动 updater 并退出应用
      await this.launchUpdater(paths)

      return { success: true }
    } catch (error: unknown) {
      console.error('更新流程失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number)
    const parts2 = v2.split('.').map(Number)

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0
      const p2 = parts2[i] || 0
      if (p1 > p2) return 1
      if (p1 < p2) return -1
    }
    return 0
  }
}

export default new UpdaterAPI()
