export interface Command {
  name: string
  path: string
  icon?: string
  aliases?: string[]
  acronym?: string // 英文首字母缩写（用于搜索）
}

export interface ApplicationScanResult {
  apps: Command[]
  complete: boolean
  errors: string[]
}

export interface AppScanner {
  scanApplications(): Promise<ApplicationScanResult>
}
