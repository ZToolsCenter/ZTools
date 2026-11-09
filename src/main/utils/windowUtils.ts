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
 * 获取 Windows 默认窗口材质
 * Windows 11 默认使用亚克力材质，其他系统默认无材质
 */
export function getDefaultWindowMaterial(): 'mica' | 'acrylic' | 'none' {
  return isWindows11() ? 'acrylic' : 'none'
}

/**
 * 应用窗口材质（Windows 11）
 *
 * @param win 目标窗口
 * @param material 材质类型 'mica' | 'acrylic' | 'none'
 */
export function applyWindowMaterial(
  win: BrowserWindow,
  material: 'mica' | 'acrylic' | 'none'
): void {
  if (!win || win.isDestroyed()) return

  const isWindows = process.platform === 'win32'

  switch (material) {
    case 'mica':
      try {
        if (isWindows) {
          win.setBackgroundColor('#00000000') // 先设置透明背景
        }
        win.setBackgroundMaterial('mica')
        // console.log(`✅ 窗口 ${win.id} Mica 材质已启用`)
      } catch (error) {
        console.error(`[WindowUtils] 窗口 ${win.id} 设置 Mica 失败:`, error)
        win.setBackgroundColor('#f4f4f4')
      }
      break
    case 'acrylic':
      try {
        if (isWindows) {
          win.setBackgroundColor('#00000000') // 先设置透明背景
        }
        win.setBackgroundMaterial('acrylic')
        // console.log(`✅ 窗口 ${win.id} Acrylic 材质已启用`)
      } catch (error) {
        console.error(`[WindowUtils] 窗口 ${win.id} 设置 Acrylic 失败:`, error)
        win.setBackgroundColor('#f4f4f4')
      }
      break
    case 'none':
    default:
      try {
        win.setBackgroundMaterial('none')
        win.setBackgroundColor('#f4f4f4')
        // console.log(`✅ 窗口 ${win.id} 已禁用窗口材质`)
      } catch (error) {
        console.error(`[WindowUtils] 窗口 ${win.id} 设置背景失败:`, error)
      }
      break
  }
}
/**
 * 打开文件选择窗口
 *
 * @param parentWindow 父窗口
 * @param options 文件窗口选项
 * @param errorMessage 未选择任何文件时，返回错误信息
 */
export async function openDialog(
  parentWindow: BrowserWindow,
  options: OpenDialogOptions,
  errorMessage: string
): Promise<{
  success: boolean
  data?: OpenDialogReturnValue
  error?: string
}> {
  // 原生模态对话框会抢占焦点触发主窗口 blur；若不抑制，blur 自动隐藏会连带隐藏并销毁
  // 发起调用的插件视图（如设置插件），导致对话框结果无法回到渲染层，表现为“选完不生效”。
  const { default: windowManager } = await import('../managers/windowManager')
  const result = await windowManager.withBlurHideSuppressed(() =>
    dialog.showOpenDialog(parentWindow, options)
  )
  if (!parentWindow.isDestroyed()) {
    parentWindow.show()
  }
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: errorMessage }
  }
  return { success: true, data: result }
}
