/** 插件市场共享类型定义 */
import type { PluginDownloadState } from '@/components/common/PluginDetail/types'

export type { PluginDownloadState }

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
  sourceType?: 'open_source' | 'closed_source'
  sourceLabel?: string
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

export type PluginDownloadStatus = PluginDownloadState['status']
