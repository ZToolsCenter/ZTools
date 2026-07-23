import { spawn } from 'child_process'
import { dialog, shell } from 'electron'
import { UwpManager, WindowsShellLauncher } from '../native'
import type { ConfirmDialogOptions } from './types'

type ElectronShellFallback = 'openPath' | 'openExternal'

async function openWithElectronShell(
  appPath: string,
  fallback: ElectronShellFallback
): Promise<void> {
  if (fallback === 'openExternal') {
    await shell.openExternal(appPath)
    return
  }

  const error = await shell.openPath(appPath)
  if (!error) {
    return
  }

  if (appPath.toLowerCase().endsWith('.exe')) {
    try {
      await shell.openExternal(appPath)
      return
    } catch (externalError) {
      console.error('[Launcher] openExternal 启动也失败:', externalError)
    }
  }

  throw new Error(`启动失败: ${error}`)
}

async function openApplicationViaExplorer(
  appPath: string,
  fallback: ElectronShellFallback
): Promise<void> {
  try {
    const result = await WindowsShellLauncher.launch({
      target: appPath,
      showCommand: 1
    })
    if (result.success) {
      console.log(`[Launcher] 已通过 Explorer 启动: ${appPath}`)
      return
    }

    const hresultHex = `0x${(result.hresult >>> 0).toString(16).padStart(8, '0')}`
    console.warn('[Launcher] Explorer COM 启动失败，回退 Electron Shell:', {
      target: appPath,
      hresult: result.hresult,
      hresultHex,
      stage: result.stage,
      fallback
    })
  } catch (error) {
    console.warn('[Launcher] Explorer COM 调用异常，回退 Electron Shell:', {
      target: appPath,
      fallback,
      error
    })
  }

  await openWithElectronShell(appPath, fallback)
}

async function openUwpApplicationViaExplorer(appId: string): Promise<void> {
  const target = `shell:AppsFolder\\${appId}`

  try {
    const result = await WindowsShellLauncher.launch({ target, showCommand: 1 })
    if (result.success) {
      console.log(`[Launcher] 已通过 Explorer 启动 UWP 应用: ${appId}`)
      return
    }

    console.warn('[Launcher] Explorer COM 启动 UWP 应用失败，回退原生激活 API:', {
      appId,
      hresult: result.hresult,
      stage: result.stage
    })
  } catch (error) {
    console.warn('[Launcher] Explorer COM 启动 UWP 应用异常，回退原生激活 API:', {
      appId,
      error
    })
  }

  if (!UwpManager.launchUwpApp(appId)) {
    throw new Error(`启动 UWP 应用失败: ${appId}`)
  }
  console.log(`[Launcher] 已通过原生 API 启动 UWP 应用: ${appId}`)
}

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

  // 捕获子进程错误（如 EACCES），避免变成 uncaught exception
  subprocess.on('error', (err) => {
    console.error(`[Launcher] 执行命令失败 [${command}]:`, err)
  })

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
      console.log('[Launcher] 用户取消了操作')
      return
    }
  }

  // 检查是否是 UWP 应用（uwp: 前缀）
  if (appPath.startsWith('uwp:')) {
    const appId = appPath.slice(4)
    try {
      await openUwpApplicationViaExplorer(appId)
      return
    } catch (error) {
      console.error('[Launcher] 启动 UWP 应用失败:', error)
      throw error
    }
  }

  // 检查是否是协议链接（如 ms-settings:, steam://, battlenet:// 等）
  // 协议链接失败时必须回退 openExternal，openPath 可能卡住。
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(appPath) && !appPath.includes('\\')) {
    try {
      await openApplicationViaExplorer(appPath, 'openExternal')
      return
    } catch (error) {
      console.error('[Launcher] 打开协议链接失败:', error)
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

      console.log(`[Launcher] 成功执行 PowerShell 命令: ${appPath}`)
      return
    } catch (error) {
      console.error('[Launcher] 执行 PowerShell 命令失败:', error)
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
      console.log(`[Launcher] 成功执行系统命令: ${appPath}`)
      return
    } catch (error) {
      console.error('[Launcher] 执行系统命令失败:', error)
      throw error
    }
  }

  // 检查是否是系统命令（.cpl, .msc, .exe 等）
  const ext = appPath.toLowerCase().split('.').pop()

  // .cpl 文件 - 使用 control.exe 启动
  if (ext === 'cpl') {
    try {
      execCommand('control.exe', [appPath])
      console.log(`[Launcher] 成功打开控制面板项: ${appPath}`)
      return
    } catch (error) {
      console.error('[Launcher] 打开控制面板项失败:', error)
      throw error
    }
  }

  // .msc 文件 - 通过 cmd.exe /c 启动 mmc.exe，让 cmd 正确解析 PATH
  if (ext === 'msc') {
    try {
      execCommand(`mmc.exe ${appPath}`)
      console.log(`[Launcher] 成功打开管理工具: ${appPath}`)
      return
    } catch (error) {
      console.error('[Launcher] 打开管理工具失败:', error)
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
    console.log(`[Launcher] 成功启动系统命令: ${appPath}`)
    return
  }

  if (appPath.toLowerCase().endsWith('.exe') || appPath.toLowerCase().endsWith('.lnk')) {
    await openApplicationViaExplorer(appPath, 'openPath')
    return
  }

  await openWithElectronShell(appPath, 'openPath')
}
