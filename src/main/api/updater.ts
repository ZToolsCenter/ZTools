import { BrowserWindow, ipcMain, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getPreloadPath, getRendererPath } from '../utils/appBundlePath'
import createPlatformUpdater from '@platform-updater'
import type { PlatformUpdateInfo, PlatformUpdaterService } from './platformUpdater/types'
import databaseAPI from './shared/database.js'
import windowManager from '../managers/windowManager'
import { applyWindowMaterial, getDefaultWindowMaterial } from '../utils/windowUtils.js'

export class UpdaterAPI {
  private mainWindow: BrowserWindow | null = null
  private checkTimer: NodeJS.Timeout | null = null
  private availableUpdateInfo: PlatformUpdateInfo | null = null
  private downloadedUpdateInfo: PlatformUpdateInfo | null = null
  private updateWindow: BrowserWindow | null = null
  private platformUpdater: PlatformUpdaterService | null = null
  private initializationPromise: Promise<void> = Promise.resolve()

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.platformUpdater = createPlatformUpdater({
      onDownloadStart: (info) => this.sendUpdateEvent('update-download-start', info),
      onDownloadProgress: (info) => this.sendUpdateEvent('update-download-progress', info),
      onDownloaded: (info, showWindow) => this.handleUpdateDownloaded(info, showWindow),
      onDownloadFailed: (error) => this.sendUpdateEvent('update-download-failed', { error }),
      onBeforeInstall: () => windowManager.setQuitting(true)
    })
    this.initializationPromise = this.platformUpdater.initialize().catch((error) => {
      console.error('[Updater] 初始化平台更新器失败:', error)
    })

    this.setupIPC()
    this.startAutoCheck()
  }

  private handleUpdateDownloaded(info: PlatformUpdateInfo, showWindow: boolean): void {
    this.availableUpdateInfo = info
    this.downloadedUpdateInfo = info
    this.sendUpdateEvent('update-downloaded', info)
    if (showWindow) this.createUpdateWindow()
  }

  private sendUpdateEvent(channel: string, payload: unknown): void {
    this.mainWindow?.webContents.send(channel, payload)
    if (this.updateWindow && !this.updateWindow.isDestroyed()) {
      this.updateWindow.webContents.send(channel, payload)
    }
  }

  private showAvailableUpdate(info: PlatformUpdateInfo): void {
    this.notifyAvailableUpdate(info)
    this.createUpdateWindow()
  }

  private notifyAvailableUpdate(info: PlatformUpdateInfo): void {
    this.availableUpdateInfo = info
    this.sendUpdateEvent('update-available', info)
  }

  private setupIPC(): void {
    ipcMain.handle('updater:check-update', () => this.checkUpdate())
    ipcMain.handle('updater:show-update-window', () => this.showUpdateWindow())
    ipcMain.handle('updater:start-update', () => this.startUpdate())
    ipcMain.handle('updater:install-downloaded-update', () => this.installDownloadedUpdate())
    ipcMain.handle('updater:get-download-status', () => this.getDownloadStatus())

    ipcMain.on('updater:quit-and-install', () => void this.installDownloadedUpdate())
    ipcMain.on('updater:close-window', () => this.closeUpdateWindow())
    ipcMain.on('updater:window-ready', () => {
      const info = this.availableUpdateInfo ?? this.downloadedUpdateInfo
      if (this.updateWindow && info) {
        this.updateWindow.webContents.send('update-info', {
          ...info,
          downloadStatus: this.getDownloadStatus()
        })
      }
    })
  }

  private startAutoCheck(): void {
    try {
      const settings = databaseAPI.dbGet('settings-general')
      const autoCheck = settings?.autoCheckUpdate ?? true

      if (!autoCheck) {
        console.log('[Updater] 自动检查更新已禁用')
        return
      }

      void this.autoCheckAndNotify()
      this.cleanupTimer()
      this.checkTimer = setInterval(() => void this.autoCheckAndNotify(), 30 * 60 * 1000)
    } catch (error) {
      console.error('[Updater] 启动自动检查更新失败:', error)
      void this.autoCheckAndNotify()
      this.checkTimer = setInterval(() => void this.autoCheckAndNotify(), 30 * 60 * 1000)
    }
  }

  private stopAutoCheck(): void {
    this.cleanupTimer()
    console.log('[Updater] 自动检查更新已停止')
  }

  /**
   * 启用或停止自动检查更新，并将最新开关状态同步给主窗口。
   * @param enabled 是否启用自动检查更新
   * @returns 无返回值
   */
  public setAutoCheck(enabled: boolean): void {
    // 根据持久化设置切换自动检查任务。
    if (enabled) this.startAutoCheck()
    else this.stopAutoCheck()

    // 通知主窗口立即更新提示可见性，无需等待下次启动重新读取设置。
    this.sendUpdateEvent('auto-check-update-changed', enabled)
  }

  private async autoCheckAndNotify(): Promise<void> {
    await this.initializationPromise
    if (!this.platformUpdater) return

    const result = await this.platformUpdater.checkForUpdates(false)
    if (result.error) console.error('[Updater] 自动检查更新失败:', result.error)
    if (result.hasUpdate && result.updateInfo) this.notifyAvailableUpdate(result.updateInfo)
  }

  private getDownloadStatus(): ReturnType<PlatformUpdaterService['getDownloadStatus']> & {
    hasUpdate: boolean
  } {
    const status = this.platformUpdater?.getDownloadStatus() ?? {
      hasDownloaded: false,
      status: 'idle'
    }
    const info = this.downloadedUpdateInfo ?? this.availableUpdateInfo
    return {
      ...status,
      hasUpdate: Boolean(info),
      version: status.version ?? info?.version,
      changelog: status.changelog ?? info?.changelog,
      status: status.hasDownloaded ? 'downloaded' : info ? 'available' : status.status
    }
  }

  private async installDownloadedUpdate(): Promise<{
    success: boolean
    migrationRequired?: boolean
    error?: string
  }> {
    await this.initializationPromise
    if (!this.platformUpdater) return { success: false, error: '更新器尚未初始化' }
    return this.platformUpdater.installDownloadedUpdate()
  }

  public cleanup(): void {
    this.cleanupTimer()
    this.platformUpdater?.cleanup()
  }

  private cleanupTimer(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  public async checkUpdate(): Promise<
    Awaited<ReturnType<PlatformUpdaterService['checkForUpdates']>>
  > {
    await this.initializationPromise
    if (!this.platformUpdater) {
      return { success: false, hasUpdate: false, status: 'error', error: '更新器尚未初始化' }
    }
    const result = await this.platformUpdater.checkForUpdates(false)
    if (result.hasUpdate && result.updateInfo) this.showAvailableUpdate(result.updateInfo)
    return result
  }

  public async startUpdate(): Promise<{
    success: boolean
    migrationRequired?: boolean
    error?: string
  }> {
    await this.initializationPromise
    if (!this.platformUpdater) return { success: false, error: '更新器尚未初始化' }
    const updateInfo = this.availableUpdateInfo ?? this.downloadedUpdateInfo
    if (!updateInfo) return { success: false, error: '没有可用的更新' }
    return this.platformUpdater.startUpdate(updateInfo)
  }

  private showUpdateWindow(): { success: boolean; error?: string } {
    if (!this.availableUpdateInfo && !this.downloadedUpdateInfo) {
      return { success: false, error: '没有可用的更新' }
    }
    this.createUpdateWindow()
    return { success: true }
  }

  private applyMaterialToUpdateWindow(win: BrowserWindow): void {
    try {
      const settings = databaseAPI.dbGet('settings-general')
      const material = settings?.windowMaterial || getDefaultWindowMaterial()
      applyWindowMaterial(win, material)
    } catch (error) {
      console.error('[Updater] 应用窗口材质失败:', error)
    }
  }

  private createUpdateWindow(): void {
    if (this.updateWindow && !this.updateWindow.isDestroyed()) {
      this.updateWindow.show()
      this.updateWindow.focus()
      return
    }

    const width = 500
    const height = 450
    const { workArea } = screen.getPrimaryDisplay()
    const windowConfig: Electron.BrowserWindowConstructorOptions = {
      width,
      height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      alwaysOnTop: true,
      hasShadow: true,
      type: 'panel',
      webPreferences: {
        preload: getPreloadPath(),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    }

    if (process.platform === 'darwin') {
      windowConfig.transparent = true
      windowConfig.vibrancy = 'fullscreen-ui'
    } else if (process.platform === 'win32') {
      windowConfig.backgroundColor = '#00000000'
    }

    this.updateWindow = new BrowserWindow(windowConfig)
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void this.updateWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/updater.html`)
    } else {
      void this.updateWindow.loadFile(getRendererPath('updater.html'))
    }

    if (process.platform === 'win32') this.applyMaterialToUpdateWindow(this.updateWindow)
    this.updateWindow.once('ready-to-show', () => this.updateWindow?.show())
    this.updateWindow.on('closed', () => {
      this.updateWindow = null
    })
  }

  private closeUpdateWindow(): void {
    if (this.updateWindow && !this.updateWindow.isDestroyed()) this.updateWindow.close()
  }
}

export default new UpdaterAPI()
