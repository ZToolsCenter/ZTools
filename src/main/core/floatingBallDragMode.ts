/**
 * 判断悬浮球右键菜单是否需要显示“移动悬浮球”入口。
 *
 * 仅当 Linux 平台、Wayland 会话且已开启 CSS app-region 系统拖拽时，
 * 悬浮球才能交给合成器进行原生拖拽。
 *
 * @param isLinux 是否为 Linux 平台。
 * @param isWayland 是否为 Wayland 会话（沿用仓库 WAYLAND_DISPLAY 环境变量约定）。
 * @param cssAppRegionDragEnabled 是否已在设置中开启 CSS app-region 系统拖拽。
 * @returns 是否满足显示“移动悬浮球”菜单项的条件。
 */
export function shouldShowFloatingBallMoveMenu(
  isLinux: boolean,
  isWayland: boolean,
  cssAppRegionDragEnabled: boolean
): boolean {
  return isLinux && isWayland && cssAppRegionDragEnabled
}
