import type { ProgressInfo } from 'electron-updater'

export interface PlatformUpdateInfo {
  version: string
  changelog: string
  releaseNotes?: string
  downloadUrl?: string
  migrationRequired?: boolean
  releaseUrl?: string
}

export interface PlatformUpdateResult {
  success?: boolean
  status?: string
  hasUpdate: boolean
  currentVersion?: string
  latestVersion?: string
  updateInfo?: PlatformUpdateInfo
  migrationRequired?: boolean
  migrationReasons?: string[]
  releaseUrl?: string
  error?: string
}

export interface PlatformUpdateActionResult {
  success: boolean
  migrationRequired?: boolean
  error?: string
}

export interface PlatformDownloadStatus {
  hasDownloaded: boolean
  version?: string
  changelog?: string
  status?: string
}

export interface PlatformUpdaterCallbacks {
  onDownloadStart: (info: { version: string }) => void
  onDownloadProgress: (info: ProgressInfo) => void
  onDownloaded: (info: PlatformUpdateInfo, showWindow: boolean) => void
  onDownloadFailed: (error: string) => void
  onBeforeInstall: () => void
}

export interface PlatformUpdaterService {
  initialize(): Promise<void>
  checkForUpdates(downloadWhenAvailable: boolean): Promise<PlatformUpdateResult>
  startUpdate(updateInfo?: PlatformUpdateInfo): Promise<PlatformUpdateActionResult>
  installDownloadedUpdate(): Promise<PlatformUpdateActionResult> | PlatformUpdateActionResult
  getDownloadStatus(): PlatformDownloadStatus
  cleanup(): void
}

export type CreatePlatformUpdater = (callbacks: PlatformUpdaterCallbacks) => PlatformUpdaterService
