import { spawn } from 'child_process'
import { dialog, shell } from 'electron'
import type { ConfirmDialogOptions } from './types'

/**
 * 执行系统命令（不等待进程结束，适用于 GUI 应用）
 * @param command 完整命令字符串（如 "rundll32 shell32.dll,Control_RunDLL"）或命令名
 * @param args 命令参数数组（如果提供了 command 作为命令名）
 */
function execCommand(command: string, args: string[] = []): void {
  let subprocess

  if (args.length > 0) {
    // 如果提供了 args，command 是命令名，直接使用 spawn
    subprocess = spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    })
  } else {
    // 否则，command 是完整命令字符串，使用 shell 执行
    // 在 Windows 上使用 cmd.exe /c 来执行完整命令
    subprocess = spawn('cmd.exe', ['/c', command], {
      detached: true,
      stdio: 'ignore',
      shell: false
    })
  }

  // 不等待子进程，让 Node.js 可以继续执行
  subprocess.unref()
}

export async function launchApp(
  appPath: string,
  confirmDialog?: ConfirmDialogOptions
): Promise<void> {
  // 如果需要确认，先显示确认对话框
  if (confirmDialog) {
    const result = await dialog.showMessageBox({
      type: confirmDialog.type,
      buttons: confirmDialog.buttons,
      defaultId: confirmDialog.defaultId ?? 0,
      cancelId: confirmDialog.cancelId ?? 0,
      title: confirmDialog.title,
      message: confirmDialog.message,
      detail: confirmDialog.detail,
      noLink: true
    })

    // 如果用户点击取消按钮，则不执行
    if (result.response === confirmDialog.cancelId) {
      console.log('用户取消了操作')
      return
    }
  }

  // 检查是否是系统设置 URI
  if (appPath.startsWith('ms-settings:')) {
    try {
      await shell.openExternal(appPath)
      console.log(`成功打开系统设置: ${appPath}`)
      return
    } catch (error) {
      console.error('打开系统设置失败:', error)
      throw error
    }
  }

  // 检查是否是 PowerShell 命令（需要特殊处理，直接执行而不是通过 cmd.exe）
  if (appPath.startsWith('PowerShell.exe ') || appPath.startsWith('powershell.exe ')) {
    try {
      // 使用 shell: true 让系统自动解析命令行参数（包括引号）
      const subprocess = spawn(appPath, [], {
        detached: true,
        stdio: 'ignore',
        shell: true
      })
      subprocess.unref()

      console.log(`成功执行 PowerShell 命令: ${appPath}`)
      return
    } catch (error) {
      console.error('执行 PowerShell 命令失败:', error)
      throw error
    }
  }

  // 检查是否是其他带参数的系统命令（rundll32、control.exe、msdt.exe 等）
  if (
    appPath.startsWith('rundll32 ') ||
    appPath.startsWith('control.exe ') ||
    appPath.startsWith('msdt.exe ')
  ) {
    try {
      execCommand(appPath)
      console.log(`成功执行系统命令: ${appPath}`)
      return
    } catch (error) {
      console.error('执行系统命令失败:', error)
      throw error
    }
  }

  // 检查是否是系统命令（.cpl, .msc, .exe 等）
  const ext = appPath.toLowerCase().split('.').pop()

  // .cpl 文件 - 使用 control.exe 启动
  if (ext === 'cpl') {
    try {
      execCommand('control.exe', [appPath])
      console.log(`成功打开控制面板项: ${appPath}`)
      return
    } catch (error) {
      console.error('打开控制面板项失败:', error)
      throw error
    }
  }

  // .msc 文件 - 使用 mmc.exe 启动
  if (ext === 'msc') {
    try {
      execCommand('mmc.exe', [appPath])
      console.log(`成功打开管理工具: ${appPath}`)
      return
    } catch (error) {
      console.error('打开管理工具失败:', error)
      throw error
    }
  }

  // 系统可执行文件（不包含路径分隔符，说明在 PATH 中）
  if (ext === 'exe' && !appPath.includes('\\')) {
    // 对于 PATH 中的可执行文件，使用 shell.openPath（Electron 会自动在 PATH 中查找）
    // 这是最可靠的方式，避免路径解析问题
    const error = await shell.openPath(appPath)
    if (error) {
      throw new Error(`启动系统命令失败: ${error}`)
    }
    console.log(`成功启动系统命令: ${appPath}`)
    return
  }

  // 先尝试使用 shell.openPath()（适用于大多数情况，包括 .lnk 快捷方式）
  return new Promise((resolve, reject) => {
    shell
      .openPath(appPath)
      .then((error) => {
        if (error) {
          console.error('shell.openPath 失败:', error)

          // .lnk 文件如果失败，直接报错（不应该失败）
          if (appPath.toLowerCase().endsWith('.lnk')) {
            reject(new Error(`快捷方式启动失败: ${error}`))
            return
          }

          // 对于 .exe 文件，尝试使用 shell.openExternal()
          if (appPath.toLowerCase().endsWith('.exe')) {
            console.log('尝试使用 openExternal 启动...')
            shell
              .openExternal(appPath)
              .then(() => {
                console.log(`成功启动应用（openExternal）: ${appPath}`)
                resolve()
              })
              .catch((extError) => {
                console.error('openExternal 启动也失败:', extError)
                reject(new Error(`启动失败: ${error}`))
              })
          } else {
            reject(new Error(`启动失败: ${error}`))
          }
        } else {
          console.log(`成功启动应用: ${appPath}`)
          resolve()
        }
      })
      .catch((error) => {
        console.error('启动应用失败:', error)
        reject(error)
      })
  })
}
