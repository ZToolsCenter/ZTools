export interface MacWindowBackground {
  light: string
  dark: string
}

export const DEFAULT_MAC_WINDOW_BACKGROUND: Readonly<MacWindowBackground> = {
  light: '#f4f4f45c',
  dark: '#3031335c'
}

const LEGACY_MAC_WINDOW_BACKGROUND_ALPHA = 'ab'

/**
 * 读取带 Alpha 的八位色值，并保留旧六位色值原先使用的透明度。
 * @param value 持久化的原始色值
 * @param fallback 色值无效时使用的默认 RGBA
 * @returns 可直接应用的八位十六进制 RGBA 色值
 */
function normalizeRgba(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  if (/^#[0-9a-f]{8}$/i.test(value)) return value.toLowerCase()
  // 六位颜色沿用旧版渲染时固定使用的 Alpha。
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase() + LEGACY_MAC_WINDOW_BACKGROUND_ALPHA
  return fallback
}

/**
 * 规范化两种主题的 RGBA 背景配置。
 * @param value 持久化的原始配置
 * @returns 两种主题的有效颜色，缺失或无效的值使用各自默认值
 */
export function normalizeMacWindowBackground(value: unknown): MacWindowBackground {
  const colors = value && typeof value === 'object' ? (value as Partial<MacWindowBackground>) : {}

  return {
    light: normalizeRgba(colors.light, DEFAULT_MAC_WINDOW_BACKGROUND.light),
    dark: normalizeRgba(colors.dark, DEFAULT_MAC_WINDOW_BACKGROUND.dark)
  }
}
