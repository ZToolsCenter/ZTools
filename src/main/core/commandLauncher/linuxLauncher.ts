import { spawn, exec } from 'child_process'
import { dialog } from 'electron'
import { WindowManager } from '../native'
import type { ConfirmDialogOptions } from './types'
import fs from 'fs'

/**
 * 将可能包含参数的命令字符串拆分为 [可执行文件, ...参数列表]
 * 例如: "/usr/bin/ghostty --gtk-single-instance=true" → ["/usr/bin/ghostty", "--gtk-single-instance=true"]
 */
function parseCommandString(cmd: string): [string, string[]] {
  const parts: string[] = []
  let current = ''
  let inQuote: string | null = null

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (/\s/.test(ch)) {
      if (current) {
        parts.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)

  return [parts[0], parts.slice(1)]
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

  // 拆分可执行文件路径和参数
  const [executable, args] = parseCommandString(appPath)

  // Linux 平台窗口激活增强：
  // 先尝试寻找已经打开的窗口并激活它
  try {
    const isAlreadyRunning = await new Promise<boolean>((resolve) => {
      exec('wmctrl -lp', (err, stdout) => {
        if (err || !stdout) return resolve(false)

        const lines = stdout.split('\n')
        for (const line of lines) {
          const parts = line.split(/\s+/).filter(Boolean)
          if (parts.length >= 3) {
            const wid = parts[0]
            const pid = parts[2]
            try {
              // 检查该进程的可执行文件是否匹配
              const exePath = fs.readlinkSync(`/proc/${pid}/exe`)
              // 检查路径是否匹配（考虑到软链接或相对路径，对比真实绝对路径）
              if (exePath === fs.realpathSync(executable)) {
                console.log(`[Launcher] 发现应用已运行 (PID: ${pid}), 尝试通过 WID ${wid} 激活窗口`)
                WindowManager.activateWindow(wid)
                return resolve(true)
              }
            } catch {
              // 忽略权限不足或进程突发关闭导致的错误
            }
          }
        }
        resolve(false)
      })
    })

    if (isAlreadyRunning) {
      console.log('[Launcher] 应用已通过窗口激活方式打开')
      return
    }
  } catch (error) {
    console.warn('[Launcher] 尝试激活窗口时发生错误:', error)
  }

  return new Promise((resolve, reject) => {
    // Linux 环境下启动 GUI 自定义优化的方案：
    // 使用 spawn + detached: true + stdio: 'ignore'
    // 这样不会阻塞主进程，且不会因为应用退出码非 0 而报错（常见于 WeChat 等应用）
    try {
      const child = spawn(executable, args, {
        detached: true,
        stdio: 'ignore'
      })

      // 让子进程独立运行
      child.unref()

      // 监听错误（例如命令不存在）
      child.on('error', (err) => {
        console.error('[Launcher] 启动应用失败:', err)
        reject(err)
      })

      // 对于 GUI 程序，只要没有立即报错（比如找不到文件），就认为启动成功了
      console.log(`[Launcher] 已尝试启动应用: ${appPath}`)
      resolve()
    } catch (error) {
      console.error('[Launcher] 启动应用异常:', error)
      reject(error)
    }
  })
}
