import type { ConfirmDialogOptions } from './types'

// 重新导出类型
export type { ConfirmDialogOptions } from './types'

// 平台检测并导出对应的启动函数
export async function launchApp(
  appPath: string,
  confirmDialog?: ConfirmDialogOptions
): Promise<void> {
  const platform = process.platform

  if (platform === 'darwin') {
    // macOS
    const { launchApp: macLaunch } = await import('./macLauncher')
    return macLaunch(appPath, confirmDialog)
  } else if (platform === 'win32') {
    // Windows
    const { launchApp: winLaunch } = await import('./windowsLauncher')
    return winLaunch(appPath, confirmDialog)
  } else {
    console.warn(`不支持的平台: ${platform}`)
    throw new Error(`Unsupported platform: ${platform}`)
  }
}
