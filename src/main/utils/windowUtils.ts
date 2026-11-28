import { OpenDialogOptions, OpenDialogReturnValue, BrowserWindow, dialog } from 'electron'
import os from 'os'

/**
 * 判断当前系统是否达到 Windows 11 的最低版本。
 * @returns Windows 11 Build 22000 或更高版本时返回 true。
 */
export function isWindows11(): boolean {
  return hasWindowsBuild(22000)
}

/**
 * 比较当前 Windows 版本与指定的最低 Build。
 * @param minimumBuild 功能所需的最低 Build。
 * @returns 当前为受支持的 Windows 版本时返回 true。
 */
function hasWindowsBuild(minimumBuild: number): boolean {
  if (process.platform !== 'win32') return false

  try {
    // Windows 11 仍报告主版本 10，使用第三段 Build 区分功能门槛。
    const [major, , build] = os.release().split('.').map(Number)
    return major >= 10 && build >= minimumBuild
  } catch (error) {
    console.error('[WindowUtils] 检测 Windows 版本失败:', error)
    return false
  }
}

/**
 * 生成继续使用 Electron 内置材质的 Windows 窗口背景参数。
 * @returns 要传入 BrowserWindow 的背景颜色和可选材质。
 */
export function getWindowsWindowOptions(): Pick<
  Electron.BrowserWindowConstructorOptions,
  'backgroundColor' | 'backgroundMaterial'
> {
  // Electron 内置背景材质从 22621 开始生效，与原生 Accent 的门槛不同。
  return hasWindowsBuild(22621)
    ? { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' }
    : { backgroundColor: '#f4f4f4' }
}

/**
 * 打开文件选择窗口
 *
 * @param parentWindow 可用的父窗口；主窗口休眠时允许为空。
 * @param options 文件窗口选项
 * @param errorMessage 未选择任何文件时返回的错误信息。
 * @returns 文件选择结果或取消信息。
 */
export async function openDialog(
  parentWindow: BrowserWindow | null,
  options: OpenDialogOptions,
  errorMessage: string
): Promise<{
  success: boolean
  data?: OpenDialogReturnValue
  error?: string
}> {
  // 设置插件可独立于主界面运行，休眠时仍可打开系统文件选择器。
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)
  if (parentWindow && !parentWindow.isDestroyed()) {
    parentWindow.show()
  }
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: errorMessage }
  }
  return { success: true, data: result }
}
