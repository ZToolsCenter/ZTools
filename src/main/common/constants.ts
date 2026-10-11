/**
 * 应用全局常量
 */

// 窗口尺寸常量
export const WINDOW_WIDTH = 800
export const WINDOW_DEFAULT_HEIGHT = 600

// 搜索框缩放常量：百分比表示窗口宽度占屏幕宽度的比例
export const SEARCH_BOX_SCALE_MIN = 20
export const SEARCH_BOX_SCALE_MAX = 80

let searchBoxScale = 0 // 0 表示尚未初始化（将按屏幕宽度反推默认值）
let searchBoxScaleOnScreen = false // 数值是否已按“占屏幕宽度”语义存储

/**
 * 将缩放百分比夹取到允许范围。
 * @param value 缩放百分比
 * @returns 夹取后的整数百分比
 */
export function clampSearchBoxScale(value: number): number {
  return Math.min(SEARCH_BOX_SCALE_MAX, Math.max(SEARCH_BOX_SCALE_MIN, Math.round(value)))
}

/**
 * 记录搜索框缩放百分比（不夹取，供后续按基准宽度解析）。
 * @param scale 百分比数值
 * @param onScreen 是否已按“占屏幕宽度”语义存储（旧数据为 false）
 * @returns 无返回值
 */
export function setSearchBoxScaleValue(scale: number, onScreen = false): void {
  const n = Number(scale)
  if (!Number.isFinite(n)) return
  searchBoxScale = n
  searchBoxScaleOnScreen = onScreen
}

/**
 * 依据屏幕宽度反推默认百分比，使窗口约等于 800px。
 * @param baseWidth 基准宽度（屏幕宽度，DIP）
 * @returns 默认缩放百分比
 */
export function defaultSearchBoxScale(baseWidth: number): number {
  const width = Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : WINDOW_WIDTH
  return clampSearchBoxScale((WINDOW_WIDTH / width) * 100)
}

/**
 * 在当前屏幕宽度下解析出最终缩放百分比（含旧数据迁移与范围夹取）。
 * @param baseWidth 基准宽度（屏幕宽度，DIP）
 * @returns 解析后的缩放百分比
 */
export function resolveSearchBoxScale(baseWidth: number): number {
  const width = Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : WINDOW_WIDTH
  if (searchBoxScale <= 0) return defaultSearchBoxScale(width)
  // 旧数据以 800px 为基准，换算为“占屏幕宽度”的百分比
  const percent = searchBoxScaleOnScreen
    ? searchBoxScale
    : ((WINDOW_WIDTH * searchBoxScale) / 100 / width) * 100
  return clampSearchBoxScale(percent)
}

// 已解析的缩放百分比与基准宽度
let resolvedSearchBoxScale = defaultSearchBoxScale(WINDOW_WIDTH)
let searchBoxBaseWidth = WINDOW_WIDTH

/**
 * 设置已解析的当前缩放百分比。
 * @param scale 缩放百分比
 * @returns 无返回值
 */
export function setResolvedSearchBoxScale(scale: number): void {
  resolvedSearchBoxScale = clampSearchBoxScale(scale)
}

/**
 * 获取当前搜索框缩放百分比（占屏幕宽度）。
 * @returns 缩放百分比
 */
export function getSearchBoxScale(): number {
  return resolvedSearchBoxScale
}

/**
 * 设置缩放基准宽度（屏幕宽度）。
 * @param width 屏幕宽度（DIP）
 * @returns 无返回值
 */
export function setSearchBoxBaseWidth(width: number): void {
  const n = Number(width)
  searchBoxBaseWidth = Number.isFinite(n) && n > 0 ? n : WINDOW_WIDTH
}

/**
 * 按当前缩放百分比与屏幕宽度计算主窗口宽度。
 * @returns 主窗口宽度（像素）
 */
export function getWindowWidth(): number {
  return Math.round(searchBoxBaseWidth * (resolvedSearchBoxScale / 100))
}

/**
 * 获取窗口相对设计宽度（800px）的缩放系数，用于设置页等比缩放。
 * @returns 缩放系数
 */
export function getSearchBoxScaleFactor(): number {
  return getWindowWidth() / WINDOW_WIDTH
}
