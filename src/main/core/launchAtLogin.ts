import path from 'path'

export const WINDOWS_LOGIN_ITEM_NAME = 'top.z-tools'

export interface LoginItemWriteContext {
  isPackaged: boolean
  platform: NodeJS.Platform | string
  execPath: string
  appUserModelId?: string
}

export interface LoginItemSnapshot {
  openAtLogin?: boolean
  executableWillLaunchAtLogin?: boolean
  status?: string
  launchItems?: Array<{ name?: string; enabled?: boolean }>
}

export interface LoginItemWritePayload {
  openAtLogin: boolean
  enabled?: boolean
  name?: string
  path?: string
  args?: string[]
  type?: 'mainAppService'
}

export interface StartupLaunchAtLoginSync {
  apply: boolean
  enable: boolean
  persist?: boolean
}

/**
 * 从通用设置中读取用户保存的开机启动偏好。
 * @param settings `settings-general` 文档内容。
 * @returns 已保存的布尔偏好；未设置时返回 undefined。
 */
export function readStoredLaunchAtLoginPreference(settings: unknown): boolean | undefined {
  if (!settings || typeof settings !== 'object') {
    return undefined
  }

  const value = (settings as { launchAtLogin?: unknown }).launchAtLogin
  return typeof value === 'boolean' ? value : undefined
}

/**
 * 构造写入系统登录项的 Electron 参数。
 * 开发态进程与正式安装共用 AppUserModelID，因此未打包时不写系统项。
 * @param enable 是否在登录时启动。
 * @param context 当前进程的打包状态、平台和可执行文件路径。
 * @returns 可供 `app.setLoginItemSettings` 使用的参数；开发态返回 null。
 */
export function buildLoginItemSettings(
  enable: boolean,
  context: LoginItemWriteContext
): LoginItemWritePayload | null {
  if (!context.isPackaged) {
    return null
  }

  if (context.platform === 'win32') {
    const payload: LoginItemWritePayload = {
      openAtLogin: enable,
      name: context.appUserModelId || WINDOWS_LOGIN_ITEM_NAME,
      path: context.execPath,
      args: []
    }
    if (enable) {
      payload.enabled = true
    }
    return payload
  }

  if (context.platform === 'darwin') {
    return {
      openAtLogin: enable,
      type: 'mainAppService'
    }
  }

  return { openAtLogin: enable }
}

/**
 * 根据系统登录项快照判断应用是否真的会在登录时启动。
 * Windows 以 StartupApproved 为准，macOS 以 SMAppService status 为准。
 * @param snapshot `app.getLoginItemSettings()` 返回值。
 * @param platform 当前操作系统。
 * @returns 系统将会自动启动时为 true。
 */
export function isLaunchAtLoginActive(
  snapshot: LoginItemSnapshot,
  platform: NodeJS.Platform | string
): boolean {
  if (platform === 'win32') {
    if (typeof snapshot.executableWillLaunchAtLogin === 'boolean') {
      return snapshot.executableWillLaunchAtLogin
    }
    return snapshot.openAtLogin === true
  }

  if (platform === 'darwin') {
    if (snapshot.status === 'enabled') {
      return true
    }
    if (snapshot.status) {
      return false
    }
    return snapshot.openAtLogin === true
  }

  return snapshot.openAtLogin === true
}

/**
 * 决定设置页应展示的开机启动开关状态。
 * 已保存的用户偏好优先，避免 Windows 禁用启动项后界面被同步成关闭。
 * @param stored 数据库中的用户偏好。
 * @param osActive 系统当前是否会真正自动启动。
 * @returns 开关应显示的布尔值。
 */
export function resolveDisplayedLaunchAtLogin(
  stored: boolean | undefined,
  osActive: boolean
): boolean {
  return typeof stored === 'boolean' ? stored : osActive
}

export interface WindowsStartupApprovedRegCommand {
  command: string
  args: string[]
}

export const WINDOWS_STARTUP_APPROVED_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'

export const WINDOWS_STARTUP_SCRIPT_NAME = 'ZTools-startup.vbs'
export const WINDOWS_LOGIN_LAUNCH_DELAY_MS = 30_000

/**
 * 构造写入 Windows StartupApproved 的 reg 命令。
 * Electron 在 `enabled: true` 时会删除该值，Windows 11 没有 0x02 批准标记就不会登录启动。
 * @param valueName 与 Run 键相同的启动项名称。
 * @param enable 是否批准登录启动。
 * @returns 供 `reg.exe` 执行的命令和参数。
 */
export function buildWindowsStartupApprovedRegArgs(
  valueName: string,
  enable: boolean
): WindowsStartupApprovedRegCommand {
  if (enable) {
    return {
      command: 'reg',
      args: [
        'add',
        WINDOWS_STARTUP_APPROVED_KEY,
        '/v',
        valueName,
        '/t',
        'REG_BINARY',
        '/d',
        '020000000000000000000000',
        '/f'
      ]
    }
  }

  return {
    command: 'reg',
    args: ['delete', WINDOWS_STARTUP_APPROVED_KEY, '/v', valueName, '/f']
  }
}

/**
 * 构造登录后延迟启动的 VBScript 内容。
 * Explorer 会立刻拉起 Run 键进程，但该进程会在写日志前退出；Startup 目录里的脚本推迟 30 秒再启动。
 * @param execPath 打包后的可执行文件路径。
 * @param delayMs 登录后等待的毫秒数。
 * @returns 可写入 Startup 目录的 VBScript 文本。
 */
export function buildWindowsDelayedStartupScript(
  execPath: string,
  delayMs: number = WINDOWS_LOGIN_LAUNCH_DELAY_MS
): string {
  const exeDir = path.dirname(execPath)
  const vbsString = (value: string) => value.replace(/"/g, '""')
  return [
    `WScript.Sleep ${delayMs}`,
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${vbsString(exeDir)}"`,
    `sh.Run """${vbsString(execPath)}""", 0, False`,
    ''
  ].join('\r\n')
}

/**
 * 构造当前用户 Startup 目录中延迟启动脚本的完整路径。
 * @param startupDir 当前用户的 Startup 文件夹路径。
 * @returns `ZTools-startup.vbs` 的绝对路径。
 */
export function buildWindowsStartupScriptPath(startupDir: string): string {
  return path.join(startupDir, WINDOWS_STARTUP_SCRIPT_NAME)
}

/**
 * 决定启动时是否需要把登录项重新写回系统，以及是否补写偏好。
 * @param stored 数据库中的用户偏好。
 * @param snapshot 当前系统登录项快照。
 * @returns 需要同步时返回动作；无需处理时返回 null。
 */
export function resolveStartupLaunchAtLoginSync(
  stored: boolean | undefined,
  snapshot: LoginItemSnapshot
): StartupLaunchAtLoginSync | null {
  if (stored === true) {
    return { apply: true, enable: true }
  }

  if (stored === false) {
    return { apply: true, enable: false }
  }

  // 旧版只写了 Run 键、没有本地偏好：只要注册表里还有启动项就补写并重新启用。
  if (snapshot.openAtLogin === true || snapshot.executableWillLaunchAtLogin === true) {
    return { apply: true, enable: true, persist: true }
  }

  return null
}
