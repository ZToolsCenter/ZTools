import { platform } from '@electron-toolkit/utils'
import { BrowserWindow, screen } from 'electron'

/**
 * 将隐藏的 macOS 面板登记到当前 Space，正式显示前恢复其独立窗口状态。
 * @param panel 即将显示的主窗口或超级面板。
 * @returns 无返回值；非 macOS、已销毁或已经可见的面板不执行迁移。
 * @throws Electron 创建窗口或迁移失败时抛出原始错误。
 */
export function prepareMacPanelForShow(panel: BrowserWindow): void {
  // AX 全屏信息可能缺失；普通桌面和全屏 Space 均执行同一迁移流程。
  if (!platform.isMacOS || panel.isDestroyed() || panel.isVisible()) return

  const [x, y] = panel.getPosition()
  const { workArea } = screen.getDisplayNearestPoint({ x, y })
  const opacity = panel.getOpacity()
  const parent = panel.getParentWindow()
  let anchor: BrowserWindow | null = null

  try {
    // 每次创建新锚点，避免复用曾绑定到已退出全屏 Space 的原生窗口。
    anchor = new BrowserWindow({
      type: 'panel',
      width: 1,
      height: 1,
      x: workArea.x,
      y: workArea.y,
      frame: false,
      transparent: true,
      opacity: 0,
      show: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false
    })
    // 跳过异步进程类型变换，保持非激活 panel，避免把前台应用带回旧桌面。
    anchor.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    anchor.setAlwaysOnTop(true, 'modal-panel', 1)
    anchor.showInactive()

    // 子窗口跟随父窗口登记 Space；透明迁移期间由调用方抑制焦点和失焦处理。
    panel.setOpacity(0)
    panel.setParentWindow(anchor)
    panel.showInactive()
  } finally {
    // 在正式 show 前解除挂接并恢复透明度，让正常唤出仍保留系统动画。
    try {
      if (!panel.isDestroyed()) {
        try {
          panel.hide()
        } finally {
          try {
            panel.setParentWindow(parent)
          } finally {
            panel.setOpacity(opacity)
          }
        }
      }
    } finally {
      // 成功和失败均释放锚点，避免长期运行积累窗口或旧 Space 归属。
      if (anchor && !anchor.isDestroyed()) anchor.destroy()
    }
  }
}
