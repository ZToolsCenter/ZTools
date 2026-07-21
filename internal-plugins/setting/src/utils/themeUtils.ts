import type { PrimaryColor, ThemeType } from '@/constants'

/**
 * 规范化主题值，防止非法数据导致主题应用失败。
 */
export function normalizeTheme(theme: unknown): ThemeType {
  return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'
}

/**
 * 规范化主题色值，非法值回退为 green。
 */
export function normalizePrimaryColor(color: unknown): PrimaryColor {
  return color === 'blue' ||
    color === 'purple' ||
    color === 'green' ||
    color === 'orange' ||
    color === 'red' ||
    color === 'pink' ||
    color === 'custom'
    ? color
    : 'green'
}

export function normalizeWindowMaterial(material: unknown): 'mica' | 'acrylic' | 'none' {
  // 对旧版本或非法持久化值做兜底，避免初始化阶段直接使用异常值。
  return material === 'mica' || material === 'acrylic' || material === 'none' ? material : 'none'
}

/**
 * 按当前明暗环境对颜色进行轻度矫正，避免极亮/极暗自定义色不可读。
 */
function adjustColorForTheme(color: string): string {
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches
  const rgb = hexToRgb(color)
  if (!rgb) return color

  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  if (!isDarkMode && luminance > 0.9) return adjustBrightness(color, 0.4)
  if (isDarkMode && luminance < 0.15) return adjustBrightness(color, 0.6)

  return color
}

/**
 * 应用自定义主题色到 CSS 变量。
 */
export function applyCustomColor(color: string): void {
  const adjustedColor = adjustColorForTheme(color)
  document.documentElement.style.setProperty('--primary-color', adjustedColor)
}

/**
 * 应用主题色类名；当主题色为 custom 时同步写入自定义色变量。
 */
export function applyPrimaryColor(primaryColor: PrimaryColor, customColor?: string): void {
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim()
  document.body.classList.add(`theme-${primaryColor}`)

  if (primaryColor === 'custom' && typeof customColor === 'string' && customColor) {
    applyCustomColor(customColor)
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return null

  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  }
}

function adjustBrightness(hex: string, targetLuminance: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex

  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  hsl.l = targetLuminance
  const adjustedRgb = hslToRgb(hsl.h, hsl.s, hsl.l)

  return rgbToHex(adjustedRgb.r, adjustedRgb.g, adjustedRgb.b)
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0

  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0)
      break
    case g:
      h = (b - r) / d + 2
      break
    case b:
      h = (r - g) / d + 4
      break
  }
  h /= 6

  return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (p1: number, q1: number, t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p1 + (q1 - p1) * 6 * tt
    if (tt < 1 / 2) return q1
    if (tt < 2 / 3) return p1 + (q1 - p1) * (2 / 3 - tt) * 6
    return p1
  }

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}
