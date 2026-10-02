import { app } from 'electron'
import { execFileSync } from 'child_process'

/**
 * Linux/Wayland 全局唤起快捷键：交给 GNOME 自定义快捷键持有。
 *
 * Wayland 下应用无法自行抢占全局快捷键 —— Electron 的 portal 路径因缺少
 * Registry.Register 被拒（electron#51875），XWayland 的 X11 抓键又只在
 * XWayland 窗口有焦点时生效。因此改为让桌面环境持有按键并执行 `--toggle`，
 * 由 second-instance 通知已运行的主实例切换窗口（见 appMain）。
 */

/**
 * 当前是否为 GNOME 桌面（自定义快捷键是 GNOME 特有机制）。
 */
export function isGnomeDesktop(): boolean {
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase()
  return desktop.includes('gnome') || desktop.includes('ubuntu')
}

/**
 * 把 Electron accelerator 转换成 GNOME 写法，如 `Option+Z` → `<Alt>z`。
 *
 * @param accelerator Electron 风格快捷键。
 * @returns GNOME 风格快捷键；无双击修饰键对应的主键时返回 null。
 */
export function toGnomeAccelerator(accelerator: string): string | null {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

  const modifiers: string[] = []
  let key = ''

  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'command':
      case 'cmd':
      case 'super':
      case 'meta':
        modifiers.push('<Super>')
        break
      case 'ctrl':
      case 'control':
      case 'commandorcontrol':
      case 'cmdorctrl':
        modifiers.push('<Primary>')
        break
      case 'alt':
      case 'option':
        modifiers.push('<Alt>')
        break
      case 'shift':
        modifiers.push('<Shift>')
        break
      default:
        key = part
    }
  }

  // 双击修饰键（如 Command+Command）没有主键，无法映射为系统快捷键
  if (!key) return null

  return modifiers.join('') + key.toLowerCase()
}

/**
 * 生成系统快捷键调用的命令行。开发模式下需要同时带上 Electron 与项目路径。
 */
export function getToggleCommand(): string {
  // AppImage 下 execPath 指向临时挂载点（/tmp/.mount_xxx），进程退出后即失效，
  // 必须改用 APPIMAGE 记录的 .AppImage 本体路径，否则写入的快捷键会失效。
  const appImagePath = process.env.APPIMAGE
  if (appImagePath) {
    return `"${appImagePath}" --toggle`
  }

  if (app.isPackaged) {
    return `"${process.execPath}" --toggle`
  }

  return `"${process.execPath}" "${app.getAppPath()}" --toggle`
}

const MEDIA_KEYS_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys'
const CUSTOM_KEYBINDING_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding'
const CUSTOM_KEYBINDING_PATH_PREFIX =
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/'

function gsettings(args: string[]): string {
  try {
    return execFileSync('gsettings', args, { encoding: 'utf-8' }).trim()
  } catch (error) {
    // execFileSync 的 message 只有命令行，失败原因在 stderr，不透出去无法排查
    const stderr = (error as { stderr?: Buffer | string }).stderr
    throw new Error(stderr ? String(stderr).trim() : String(error))
  }
}

/**
 * 编码为 GVariant 字符串字面量。
 *
 * gsettings 会把参数当 GVariant 解析，命令里的路径引号（为兼容含空格路径而加）
 * 会被当成字符串起始，导致 `expected end of input`，故需再包一层单引号。
 */
function toGVariantString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * 读取 GNOME 现有的自定义快捷键路径列表。
 */
function getCustomKeybindingPaths(): string[] {
  const raw = gsettings(['get', MEDIA_KEYS_SCHEMA, 'custom-keybindings'])
  return [...raw.matchAll(/'([^']*)'/g)].map((match) => match[1])
}

/**
 * 找出尚未占用的 customN 槽位。
 */
function findFreeSlot(existing: string[]): number {
  for (let i = 0; i < 32; i++) {
    if (!existing.some((path) => path.endsWith(`custom${i}/`))) {
      return i
    }
  }
  throw new Error('GNOME 自定义快捷键槽位已用满（custom0-31）')
}

/**
 * 把唤出快捷键注册为 GNOME 自定义快捷键。
 *
 * 追加到用户已有的自定义快捷键之后，不覆盖既有配置。
 *
 * @param accelerator 当前唤出快捷键（Electron 风格）。
 * @returns 执行结果与面向用户的说明。
 */
export function installGnomeShortcut(accelerator: string): {
  success: boolean
  message: string
} {
  if (!isGnomeDesktop()) {
    return {
      success: false,
      message: `当前桌面环境不是 GNOME，无法自动配置系统快捷键。请手动把快捷键绑定到命令：${getToggleCommand()}`
    }
  }

  const binding = toGnomeAccelerator(accelerator)
  if (!binding) {
    return {
      success: false,
      message: `无法把「${accelerator}」转换为系统快捷键格式（双击修饰键无法注册为系统快捷键）。请改用 Ctrl/Alt + 单键的组合。`
    }
  }

  let command = ''
  try {
    command = getToggleCommand()
    const existing = getCustomKeybindingPaths()
    const bindingPath = `${CUSTOM_KEYBINDING_PATH_PREFIX}custom${findFreeSlot(existing)}/`
    const schemaWithPath = `${CUSTOM_KEYBINDING_SCHEMA}:${bindingPath}`

    gsettings(['set', schemaWithPath, 'name', toGVariantString('ZTools')])
    gsettings(['set', schemaWithPath, 'command', toGVariantString(command)])
    gsettings(['set', schemaWithPath, 'binding', toGVariantString(binding)])

    // 最后并入总表，避免中途失败留下半配置状态
    gsettings([
      'set',
      MEDIA_KEYS_SCHEMA,
      'custom-keybindings',
      `[${[...existing, bindingPath].map((path) => `'${path}'`).join(', ')}]`
    ])

    console.log(`[LinuxShortcut] 已注册 GNOME 自定义快捷键 ${binding} -> ${command}`)

    return {
      success: true,
      message: `已把系统快捷键 ${binding} 绑定到 ZTools 的显示/隐藏。若未生效，请在「设置 → 键盘 → 自定义快捷键」中检查是否与其它快捷键冲突。`
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[LinuxShortcut] 注册 GNOME 自定义快捷键失败:', error)
    return {
      success: false,
      message: `注册系统快捷键失败：${reason}。可手动在「设置 → 键盘 → 自定义快捷键」中把 ${binding} 绑定到命令：${command || getToggleCommand()}`
    }
  }
}
