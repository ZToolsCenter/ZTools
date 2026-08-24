import { app } from 'electron'
import { DEFAULT_SYNC_SERVER_URL, syncServerUrlToHttp } from './renderer/pluginMarketConfig'
import { httpRequest } from '../utils/httpRequest'
import type { PlatformUpdateInfo, UpdateDownloadSource } from './platformUpdater/types'
import databaseAPI from './shared/database'
import { HOST_STORAGE_KEYS } from '../../shared/storageKeys'
import { resolveUpdateChannel, type UpdateChannel } from '../../shared/updateChannel'

export interface ServerUpdateInfo {
  available: boolean
  latestVersion: string
  releaseNotes: string
  publishedAt: number
}

interface ServerUpdateResponse {
  update: ServerUpdateInfo | null
}

interface ServerDownloadsResponse {
  version: string
  systemType: string
  sources: UpdateDownloadSource[]
}

/**
 * 返回服务端更新目录使用的系统类型。
 * @param platform 待匹配的平台，默认使用当前 Electron 运行平台。
 * @param arch 待匹配的架构，默认使用当前 Electron 运行架构。
 * @returns 当前 Electron 运行平台与架构对应的系统类型。
 */
export function getUpdateSystemType(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string {
  if (platform === 'win32') {
    return arch === 'arm64' ? 'windows-arm64-installer' : 'windows-x64-installer'
  }
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  return `${platform}-${arch}`
}

/**
 * 根据当前应用版本和本地更新偏好选择服务端更新通道。
 * @returns 当前应使用的 stable 或 beta 通道。
 */
export function getUpdateChannel(): UpdateChannel {
  const version = app.getVersion()
  try {
    // Beta 订阅属于设备级更新偏好，所有更新查询和心跳统一读取同一设置。
    const settings = databaseAPI.dbGet(HOST_STORAGE_KEYS.settingsGeneral)
    return resolveUpdateChannel(version, settings?.receiveBetaUpdates === true)
  } catch (error) {
    console.warn('[Updater] 读取 Beta 更新偏好失败，使用版本默认通道:', error)
    return resolveUpdateChannel(version)
  }
}

/**
 * 从官方服务端执行一次主动更新检查。
 * @returns 服务端返回的最新版本信息；没有适用版本时为 null。
 */
export async function fetchLatestServerUpdate(): Promise<ServerUpdateInfo | null> {
  const query = new URLSearchParams({
    systemType: getUpdateSystemType(),
    currentVersion: app.getVersion(),
    updateChannel: getUpdateChannel()
  })
  const response = await httpRequest(
    `${syncServerUrlToHttp(DEFAULT_SYNC_SERVER_URL)}/api/updates/latest?${query.toString()}`
  )
  return (response.data as ServerUpdateResponse)?.update ?? null
}

/**
 * 获取指定版本在当前系统上的 GitHub 和人工下载入口。
 * @param version 服务端心跳返回的目标版本号。
 * @returns 当前系统可用的下载源列表。
 */
export async function fetchServerUpdateSources(version: string): Promise<UpdateDownloadSource[]> {
  const query = new URLSearchParams({
    version,
    systemType: getUpdateSystemType(),
    updateChannel: getUpdateChannel()
  })
  const response = await httpRequest(
    `${syncServerUrlToHttp(DEFAULT_SYNC_SERVER_URL)}/api/updates/downloads?${query.toString()}`
  )
  const data = response.data as ServerDownloadsResponse
  return Array.isArray(data?.sources) ? data.sources : []
}

/**
 * 将服务端版本信息和下载源转换为现有更新窗口使用的数据结构。
 * @param update 服务端返回的版本信息。
 * @returns 可交给平台更新器和更新窗口使用的统一信息。
 */
export async function resolvePlatformUpdateInfo(
  update: ServerUpdateInfo
): Promise<PlatformUpdateInfo> {
  const sources = await fetchServerUpdateSources(update.latestVersion)
  const directSource = sources.find((source) => source.isDirect && source.feedUrl)
  const fallbackSource = sources.find((source) => !source.isDirect) ?? sources[0]
  return {
    version: update.latestVersion,
    changelog: update.releaseNotes,
    releaseNotes: update.releaseNotes,
    downloadUrl: directSource?.downloadUrl,
    feedUrl: directSource?.feedUrl,
    releaseUrl: fallbackSource?.downloadUrl ?? directSource?.downloadUrl,
    manualDownloadRequired: !directSource,
    sources
  }
}
