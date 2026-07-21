/** 插件市场共享类型定义 */

export interface Plugin {
  name: string
  title: string
  description: string
  iconText?: string
  iconColor?: string
  logo?: string
  version: string
  downloadUrl?: string
  downloadCount?: number
  installed: boolean
  path?: string
  localVersion?: string
}

export interface CategoryInfo {
  key: string
  title: string
  description?: string
  icon?: string
  plugins: Plugin[]
}

export interface CategoryLayoutSection {
  type: string
  title?: string
  count?: number
  plugins?: string[]
}

export type PluginDownloadStatus = 'downloading' | 'installing' | 'success' | 'error' | 'cancelled'

export interface PluginDownloadState {
  taskId?: string
  status: PluginDownloadStatus
  progress: number | null
  receivedBytes?: number
  totalBytes?: number
  error?: string
}
