import { app, dialog, shell } from 'electron'
import type { ElectronUpdaterService } from '../electronUpdater'
import {
  getWindowsInstallCompatibility,
  WINDOWS_RELEASE_URL,
  type WindowsInstallCompatibility
} from '../windowsInstallCompatibility'
import type {
  CreatePlatformUpdater,
  PlatformDownloadStatus,
  PlatformUpdateActionResult,
  PlatformUpdateInfo,
  PlatformUpdateResult,
  PlatformUpdaterCallbacks,
  PlatformUpdaterService
} from './types'

class WindowsPlatformUpdater implements PlatformUpdaterService {
  private updater: ElectronUpdaterService | null = null
  private compatibility: WindowsInstallCompatibility | null = null
  private migrationPromptShown = false

  constructor(private readonly callbacks: PlatformUpdaterCallbacks) {}

  /**
   * 校验 Windows 完整安装状态，并为兼容安装初始化共享标准更新器。
   * @returns 初始化完成后结束的 Promise。
   */
  public async initialize(): Promise<void> {
    // 先完成 NSIS 安装兼容校验，避免 portable 或 legacy 安装进入标准更新流程。
    this.compatibility = await getWindowsInstallCompatibility()
    if (this.compatibility.migrationRequired) {
      await this.showMigrationPrompt()
      return
    }
    if (!this.compatibility.compatible) return

    // 兼容性通过后再注册 electron-updater 事件。
    const { ElectronUpdaterService } = await import('../electronUpdater')
    this.updater = new ElectronUpdaterService(this.callbacks)
  }

  private async showMigrationPrompt(): Promise<void> {
    if (this.migrationPromptShown) return
    this.migrationPromptShown = true

    const result = await dialog.showMessageBox({
      type: 'info',
      title: '需要更新 ZTools',
      message: '请安装一次最新完整版本',
      detail:
        '当前版本使用的是较早的更新方式，无法直接完成本次升级。安装最新完整版本后，即可继续正常接收更新，您的数据、设置和插件都会保留。',
      buttons: ['下载最新版本', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })

    if (result.response === 0) await shell.openExternal(WINDOWS_RELEASE_URL)
  }

  public async checkForUpdates(downloadWhenAvailable: boolean): Promise<PlatformUpdateResult> {
    if (this.updater) return this.updater.checkForUpdates(downloadWhenAvailable)

    if (this.compatibility?.migrationRequired) {
      return {
        success: true,
        status: 'migration-required',
        hasUpdate: false,
        currentVersion: app.getVersion(),
        migrationRequired: true,
        migrationReasons: this.compatibility.reasons,
        releaseUrl: WINDOWS_RELEASE_URL
      }
    }

    return { success: true, status: 'not-available', hasUpdate: false }
  }

  public async startUpdate(updateInfo?: PlatformUpdateInfo): Promise<PlatformUpdateActionResult> {
    if (this.updater) return this.updater.downloadAndInstall()

    await shell.openExternal(updateInfo?.releaseUrl || WINDOWS_RELEASE_URL)
    return { success: true, migrationRequired: true }
  }

  public installDownloadedUpdate(): PlatformUpdateActionResult {
    if (this.updater) return this.updater.installDownloadedUpdate()
    return { success: false, error: '当前安装需要完整版本迁移' }
  }

  public getDownloadStatus(): PlatformDownloadStatus {
    if (this.updater) return this.updater.getDownloadStatus()
    return {
      hasDownloaded: false,
      status: this.compatibility?.migrationRequired ? 'migration-required' : 'idle'
    }
  }

  public cleanup(): void {
    return
  }
}

const createWindowsUpdater: CreatePlatformUpdater = (callbacks) =>
  new WindowsPlatformUpdater(callbacks)

export default createWindowsUpdater
