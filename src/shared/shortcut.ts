/**
 * 将 ZTools 内部快捷键表示转换为 Electron 全局快捷键所需的加速键表示。
 * Windows 的 Windows 键在 Electron 中使用 Super 命名，而现有配置统一使用 Command。
 * @param shortcut ZTools 内部格式的快捷键字符串。
 * @param targetPlatform 目标运行平台。
 * @returns 可直接传给 Electron 快捷键 API 的快捷键字符串。
 */
export function toElectronAccelerator(shortcut: string, targetPlatform: string): string {
  if (targetPlatform !== 'win32') {
    return shortcut
  }

  return shortcut.replace(/(^|\+)(Command|Meta|Win|Windows)(?=\+|$)/g, '$1Super')
}

/**
 * 将快捷键字符串转换为设置界面面向用户的显示文本。
 * @param shortcut ZTools 内部格式的快捷键字符串。
 * @param targetPlatform 目标运行平台。
 * @returns 适合当前平台展示的快捷键文本。
 */
export function formatShortcutForDisplay(shortcut: string, targetPlatform: string): string {
  if (targetPlatform !== 'win32') {
    return shortcut
  }

  return shortcut.replace(/(^|\+)(Command|Meta|Super|Windows)(?=\+|$)/g, '$1Win')
}
