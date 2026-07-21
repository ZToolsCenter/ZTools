import defaultAvatar from './assets/image/default.png'

// 默认配置常量
export const DEFAULT_PLACEHOLDER = '搜索应用和指令 / 粘贴文件或图片'
export const DEFAULT_AVATAR = defaultAvatar

// 自动粘贴选项类型
export type AutoPasteOption = 'off' | '1s' | '3s' | '5s' | '10s'

// 自动清空选项类型
export type AutoClearOption = 'immediately' | '1m' | '2m' | '3m' | '5m' | '10m' | 'never'

// 自动返回搜索选项类型
export type AutoBackToSearchOption = 'immediately' | '30s' | '1m' | '3m' | '5m' | '10m' | 'never'
export type WindowPositionStrategy = 'remember' | 'cursor' | 'primary' | 'lastActive'

// 主题类型
export type ThemeType = 'system' | 'light' | 'dark'

// 主题色类型
export type PrimaryColor = 'blue' | 'purple' | 'green' | 'orange' | 'red' | 'pink' | 'custom'

// 超级面板鼠标按键类型
export type MouseButtonType = 'middle' | 'right' | 'back' | 'forward'

/** 「在终端打开」使用的终端选择：'default' 系统默认 ｜ 'custom' 自定义命令 ｜ 其他预设 id */
export type TerminalType = 'default' | 'custom' | string
