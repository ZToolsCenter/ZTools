export const STANDARD_MAIN_WINDOW_HEADER_HEIGHT = 58
export const COMPACT_MAIN_WINDOW_HEADER_HEIGHT = 44
export const STANDARD_DETACHED_WINDOW_TITLEBAR_HEIGHT = 52
export const COMPACT_DETACHED_WINDOW_TITLEBAR_HEIGHT = 40

/**
 * 将持久化值归一化为主窗口紧凑顶部栏开关。
 * @param value 数据库或 IPC 传入的原始设置值。
 * @returns 仅当设置值严格为 true 时启用紧凑模式。
 */
export function normalizeCompactMainWindowHeader(value: unknown): boolean {
  return value === true
}

/**
 * 根据布局偏好解析主窗口顶部栏高度。
 * @param compactMainWindowHeader 是否启用主窗口紧凑顶部栏。
 * @returns 当前布局应使用的顶部栏高度，单位为像素。
 */
export function resolveMainWindowHeaderHeight(compactMainWindowHeader: unknown): number {
  return normalizeCompactMainWindowHeader(compactMainWindowHeader)
    ? COMPACT_MAIN_WINDOW_HEADER_HEIGHT
    : STANDARD_MAIN_WINDOW_HEADER_HEIGHT
}

/**
 * 根据布局偏好解析分离插件窗口标题栏高度。
 * @param compactMainWindowHeader 是否启用主窗口紧凑顶部栏设置。
 * @returns 分离窗口标题栏应使用的高度，单位为像素。
 */
export function resolveDetachedWindowTitlebarHeight(compactMainWindowHeader: unknown): number {
  return normalizeCompactMainWindowHeader(compactMainWindowHeader)
    ? COMPACT_DETACHED_WINDOW_TITLEBAR_HEIGHT
    : STANDARD_DETACHED_WINDOW_TITLEBAR_HEIGHT
}
