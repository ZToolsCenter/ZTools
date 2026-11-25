import { OpenDialogOptions, OpenDialogReturnValue, BrowserWindow, dialog } from 'electron'
import os from 'os'

/**
 * 检测是否为 Windows 11
 * Windows 11 的版本号为 10.0.22000 或更高
 */
export function isWindows11(): boolean {
  if (process.platform !== 'win32') {
    return false
  }

  try {
    const release = os.release()
    const parts = release.split('.')
    const major = parseInt(parts[0], 10)
    const minor = parseInt(parts[1], 10)
    const build = parseInt(parts[2], 10)

    // Windows 11 的版本号是 10.0.22000 或更高
    return major === 10 && minor === 0 && build >= 22000
  } catch (error) {
    console.error('[WindowUtils] 检测 Windows 版本失败:', error)
    return false
  }
}

/**
 * 获取宿主窗口按操作系统使用的 Windows 背景材质。
 * @returns Windows 11 使用亚克力，其余系统使用无材质。
 */
export function getSystemWindowMaterial(): 'acrylic' | 'none' {
  return isWindows11() ? 'acrylic' : 'none'
}

/**
 * 生成 Windows 宿主窗口使用的背景构造参数。
 * @returns 要传入 BrowserWindow 的背景颜色和可选材质。
 */
export function getWindowsWindowOptions(): Pick<
  Electron.BrowserWindowConstructorOptions,
  'backgroundColor' | 'backgroundMaterial'
> {
  const material = getSystemWindowMaterial()

  // 创建原生窗口时由 Electron 初始化半透明状态，透明底色让系统材质可见。
  return material === 'acrylic'
    ? { backgroundColor: '#00000000', backgroundMaterial: material }
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
