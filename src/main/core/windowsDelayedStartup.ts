import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildWindowsDelayedStartupScript, buildWindowsStartupScriptPath } from './launchAtLogin'

/**
 * 解析当前用户的 Windows Startup 文件夹。
 * @returns Startup 目录的绝对路径。
 */
function getCurrentUserStartupDir(): string {
  return path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  )
}

/**
 * 在当前用户 Startup 目录写入或删除延迟启动脚本。
 * @param enable 是否在登录后启动。
 * @param execPath 打包后的可执行文件路径。
 * @returns 无返回值
 */
export function applyWindowsDelayedStartup(enable: boolean, execPath: string): void {
  if (process.platform !== 'win32') {
    return
  }

  const scriptPath = buildWindowsStartupScriptPath(getCurrentUserStartupDir())
  if (!enable) {
    try {
      fs.unlinkSync(scriptPath)
      console.log('[Settings] 已删除 Windows 延迟启动脚本:', scriptPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[Settings] 删除 Windows 延迟启动脚本失败:', error)
      }
    }
    return
  }

  try {
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true })
    fs.writeFileSync(scriptPath, buildWindowsDelayedStartupScript(execPath), 'utf8')
    console.log('[Settings] 已写入 Windows 延迟启动脚本:', scriptPath)
  } catch (error) {
    console.error('[Settings] 写入 Windows 延迟启动脚本失败:', error)
  }
}
