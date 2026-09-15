import { execFileSync } from 'child_process'
import { buildWindowsStartupApprovedRegArgs } from './launchAtLogin'

/**
 * 在 Electron 写入 Run 键之后，补写或删除 StartupApproved 批准标记。
 * @param valueName 与 Run 键相同的启动项名称。
 * @param enable 是否批准登录启动。
 * @returns 无返回值
 */
export function applyWindowsStartupApproved(valueName: string, enable: boolean): void {
  if (process.platform !== 'win32') {
    return
  }

  const { command, args } = buildWindowsStartupApprovedRegArgs(valueName, enable)
  try {
    // Electron 删除批准值后必须立刻写回 0x02，否则下次登录 Explorer 不会拉起应用。
    execFileSync(command, args, { windowsHide: true, stdio: 'pipe' })
    console.log('[Settings] 已写入 Windows StartupApproved:', valueName, enable)
  } catch (error) {
    console.error('[Settings] 写入 Windows StartupApproved 失败:', error)
  }
}
