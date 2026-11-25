import { applyPrimaryColor, normalizePrimaryColor, normalizeTheme } from '@/utils'

type AppearanceSettings = {
  theme?: unknown
  primaryColor?: unknown
  customColor?: unknown
}

type ThemeValue = 'system' | 'light' | 'dark'
type WindowMaterialValue = 'acrylic' | 'none'

export type ApplyInitialAppearanceDeps = {
  dbGet: (key: string) => Promise<AppearanceSettings | undefined>
  setTheme: (theme: ThemeValue) => Promise<void>
  getWindowMaterial: () => Promise<WindowMaterialValue>
  isWindows: boolean
}

/**
 * 初始化设置页主题，并让 Windows 页面样式跟随宿主窗口材质。
 * @param deps 读取外观、应用主题和查询宿主材质的接口。
 * @returns 页面外观应用完成后结束的 Promise。
 */
export async function applyInitialAppearance(deps: ApplyInitialAppearanceDeps): Promise<void> {
  // 启动时从通用设置读取外观，保持与设置页持久化字段一致。
  const data = await deps.dbGet('settings-general')
  const theme = normalizeTheme(data?.theme)
  const primaryColor = normalizePrimaryColor(data?.primaryColor)
  const customColor = typeof data?.customColor === 'string' ? data.customColor : undefined

  await deps.setTheme(theme)
  applyPrimaryColor(primaryColor, customColor)

  if (!deps.isWindows) {
    return
  }

  // 使用宿主构造窗口时采用的材质更新页面样式。
  const material = await deps.getWindowMaterial()
  document.documentElement.setAttribute('data-material', material)
}
