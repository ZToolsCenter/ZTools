export interface PluginFeature {
  code: string
  name?: string
  explain?: string
  icon?: string
  cmds?: any[]
  mainPush?: boolean
}

export interface PluginItem {
  name: string
  title: string
  version?: string
  description?: string
  logo?: string
  features?: PluginFeature[]
  installed?: boolean
  isDevelopment?: boolean
  localVersion?: string
  path?: string
  size?: number
  downloadCount?: number
  author?: string
  homepage?: string
}

export interface DocItem {
  key: string
  type: 'document' | 'attachment'
}

export type TabId = 'detail' | 'commands' | 'data' | 'comments'

export interface TabItem {
  id: TabId
  label: string
}

export interface PluginDownloadState {
  taskId?: string
  status: 'downloading' | 'installing' | 'success' | 'error' | 'cancelled'
  progress: number | null
  receivedBytes?: number
  totalBytes?: number
  error?: string
}

export interface PluginUninstallOptions {
  deleteData: boolean
}
