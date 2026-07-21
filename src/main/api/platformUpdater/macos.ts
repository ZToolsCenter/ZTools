import { app, dialog, shell } from 'electron'
import type { ElectronUpdaterService } from '../electronUpdater'
import {
  getMacInstallCompatibility,
  MAC_RELEASE_URL,
  type MacInstallCompatibility
} from '../macInstallCompatibility'
import type {
  CreatePlatformUpdater,
  PlatformDownloadStatus,
  PlatformUpdateActionResult,
  PlatformUpdateInfo,
  PlatformUpdateResult,
  PlatformUpdaterCallbacks,
  PlatformUpdaterService
} from './types'

class MacPlatformUpdater implements PlatformUpdaterService {
  private updater: ElectronUpdaterService | null = null
  private compatibility: MacInstallCompatibility | null = null
  private migrationPromptShown = false

  /**
   * 创建 macOS 标准更新适配器。
   * @param callbacks 更新生命周期回调。
   * @returns 创建的 macOS 更新适配器实例。
   */
  constructor(private readonly callbacks: PlatformUpdaterCallbacks) {}

  /**
   * 校验完整安装状态，并为兼容安装初始化 electron-updater。
   * @returns 初始化完成后结束的 Promise。
   */
  public async initialize(): Promise<void> {
    // legacy 安装不能直接进入 Squirrel.Mac，否则签名和运行时可能不一致。
    this.compatibility = await getMacInstallCompatibility()
    if (this.compatibility.migrationRequired) {
      await this.showMigrationPrompt()
      return
    }
    if (!this.compatibility.compatible) return

    // 兼容性通过后再加载标准更新器，避免 legacy 安装提前注册更新事件。
    const { ElectronUpdaterService } = await import('../electronUpdater')
    this.updater = new ElectronUpdaterService(this.callbacks)
  }

  /**
   * 向 legacy 或磁盘映像安装展示一次完整安装迁移提示。
   * @returns 提示处理完成后结束的 Promise。
   */
  private async showMigrationPrompt(): Promise<void> {
    if (this.migrationPromptShown) return
    this.migrationPromptShown = true

    const result = await dialog.showMessageBox({
      type: 'info',
      title: '需要更新 ZTools',
      message: '请安装一次最新完整版本',
      detail:
        '当前版本使用的是较早的 macOS 更新方式，无法直接切换到签名整包更新。安装最新 DMG 后即可继续正常接收更新，您的数据、设置和插件都会保留。',
      buttons: ['下载最新版本', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })

    if (result.response === 0) await shell.openExternal(MAC_RELEASE_URL)
  }

  /**
   * 检查 macOS 标准更新，legacy 安装则返回迁移状态。
   * @param downloadWhenAvailable 发现更新后是否立即下载。
   * @returns 更新检查或迁移结果。
   */
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
        releaseUrl: MAC_RELEASE_URL
      }
    }

    return { success: true, status: 'not-available', hasUpdate: false }
  }

  /**
   * 下载并安装 macOS 完整更新，legacy 安装则打开完整安装页面。
   * @param updateInfo 当前可用更新信息。
   * @returns 更新启动结果。
   */
  public async startUpdate(updateInfo?: PlatformUpdateInfo): Promise<PlatformUpdateActionResult> {
    if (this.updater) return this.updater.downloadAndInstall()

    await shell.openExternal(updateInfo?.releaseUrl || MAC_RELEASE_URL)
    return { success: true, migrationRequired: true }
  }

  /**
   * 安装已经下载完成的 macOS 完整更新。
   * @returns 安装启动结果。
   */
  public installDownloadedUpdate(): PlatformUpdateActionResult {
    if (this.updater) return this.updater.installDownloadedUpdate()
    return { success: false, error: '当前 macOS 安装需要完整版本迁移' }
  }

  /**
   * 获取 macOS 更新下载或迁移状态。
   * @returns 当前下载状态。
   */
  public getDownloadStatus(): PlatformDownloadStatus {
    if (this.updater) return this.updater.getDownloadStatus()
    return {
      hasDownloaded: false,
      status: this.compatibility?.migrationRequired ? 'migration-required' : 'idle'
    }
  }

  /**
   * 清理 macOS 更新适配器持有的资源。
   * @returns 无返回值。
   */
  public cleanup(): void {
    return
  }
}

/**
 * 创建 macOS 平台更新适配器。
 * @param callbacks 更新生命周期回调。
 * @returns macOS 平台更新服务。
 */
const createMacUpdater: CreatePlatformUpdater = (callbacks) => new MacPlatformUpdater(callbacks)

export default createMacUpdater
