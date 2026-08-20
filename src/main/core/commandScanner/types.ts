export interface Command {
  name: string
  path: string
  icon?: string
  aliases?: string[]
  acronym?: string // 英文首字母缩写（用于搜索）
  isSystemApp?: boolean // macOS /System/Applications 下的系统自带应用
}

export interface AppScanner {
  scanApplications(): Promise<Command[]>
}
