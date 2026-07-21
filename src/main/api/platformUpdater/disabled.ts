import type {
  CreatePlatformUpdater,
  PlatformDownloadStatus,
  PlatformUpdateActionResult,
  PlatformUpdateResult,
  PlatformUpdaterService
} from './types'

class DisabledPlatformUpdater implements PlatformUpdaterService {
  public async initialize(): Promise<void> {
    return
  }

  public async checkForUpdates(): Promise<PlatformUpdateResult> {
    return { success: true, status: 'not-available', hasUpdate: false }
  }

  public async startUpdate(): Promise<PlatformUpdateActionResult> {
    return { success: false, error: '当前平台不支持应用内更新' }
  }

  public installDownloadedUpdate(): PlatformUpdateActionResult {
    return { success: false, error: '当前平台不支持应用内更新' }
  }

  public getDownloadStatus(): PlatformDownloadStatus {
    return { hasDownloaded: false, status: 'not-available' }
  }

  public cleanup(): void {
    return
  }
}

const createDisabledUpdater: CreatePlatformUpdater = () => new DisabledPlatformUpdater()

export default createDisabledUpdater
