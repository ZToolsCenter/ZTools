import { clipboard, BrowserWindow } from 'electron'
import { exec, execSync, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ScreenCapture } from './native'
import windowManager from '../managers/windowManager'

// 截图方法windows
export const screenWindow = (
  cb: (image: string, bounds?: { x: number; y: number; width: number; height: number }) => void
): void => {
  ScreenCapture.start((result) => {
    if (result.success) {
      const image = clipboard.readImage()
      const bounds = {
        x: result.x!,
        y: result.y!,
        width: result.width!,
        height: result.height!
      }
      cb && cb(image.isEmpty() ? '' : image.toDataURL(), bounds)
    } else {
      cb && cb('')
    }
  })
}

// 截图方法mac
export const handleScreenShots = (
  cb: (image: string, bounds?: { x: number; y: number; width: number; height: number }) => void
): void => {
  const tmpPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.png`)
  exec(`screencapture -i -r "${tmpPath}"`, () => {
    if (fs.existsSync(tmpPath)) {
      try {
        const imageBuffer = fs.readFileSync(tmpPath)
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`
        cb(base64Image)
        fs.unlinkSync(tmpPath)
      } catch {
        cb('')
      }
    } else {
      cb('')
    }
  })
}

// 检测某个命令是否存在
function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// 读取临时文件并返回 base64 图片，读完后删除临时文件
function readTmpImage(tmpPath: string): string {
  try {
    const imageBuffer = fs.readFileSync(tmpPath)
    const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`
    fs.unlinkSync(tmpPath)
    return base64Image
  } catch {
    return ''
  }
}

/**
 * Linux 截图：
 * - 自动检测会话类型（X11 / Wayland）
 * - 只调用系统中存在的工具
 * - 带超时兜底（60s），防止工具挂起导致应用"卡死"
 */
export const handleLinuxScreenShot = (cb: (image: string) => void): void => {
  const tmpPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.png`)
  const isWayland = !!process.env.WAYLAND_DISPLAY

  // 按优先级构建候选工具列表
  const candidates: Array<() => ChildProcess | null> = []

  if (isWayland) {
    // Wayland 优先：grim + slurp
    if (commandExists('grim') && commandExists('slurp')) {
      candidates.push(() => exec(`grim -g "$(slurp)" "${tmpPath}"`))
    }
    // Wayland 下的 gnome-screenshot（GNOME 42+）
    if (commandExists('gnome-screenshot')) {
      candidates.push(() => exec(`gnome-screenshot -a -f "${tmpPath}"`))
    }
  } else {
    // X11：scrot 最轻量可靠
    if (commandExists('scrot')) {
      candidates.push(() => exec(`scrot -s "${tmpPath}"`))
    }
    // maim 次选
    if (commandExists('maim')) {
      candidates.push(() => exec(`maim -s "${tmpPath}"`))
    }
    // gnome-screenshot 最后尝试（X11 上偶尔有问题）
    if (commandExists('gnome-screenshot')) {
      candidates.push(() => exec(`gnome-screenshot -a -f "${tmpPath}"`))
    }
    // KDE spectacle
    if (commandExists('spectacle')) {
      candidates.push(() => exec(`spectacle -r -b -o "${tmpPath}"`))
    }
  }

  if (candidates.length === 0) {
    console.warn('[ScreenCapture] Linux 上未找到可用的截图工具（scrot/maim/gnome-screenshot/grim）')
    cb('')
    return
  }

  // 只尝试第一个可用工具（避免多个工具同时等待用户交互造成卡死）
  const TIMEOUT_MS = 60_000 // 最长等待 60 秒
  let done = false
  let childProc: ChildProcess | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const finish = (image: string): void => {
    if (done) return
    done = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    cb(image)
  }

  try {
    childProc = candidates[0]()
    if (!childProc) {
      finish('')
      return
    }

    childProc.on('close', () => {
      if (fs.existsSync(tmpPath)) {
        finish(readTmpImage(tmpPath))
      } else {
        // 工具退出但没有写出文件（用户取消 or 出错）
        finish('')
      }
    })

    childProc.on('error', () => {
      finish('')
    })

    // 超时兜底：60s 后强制结束，防止工具无响应导致卡死
    timer = setTimeout(() => {
      console.warn('[ScreenCapture] 截图工具超时（60s），强制终止')
      if (childProc && !childProc.killed) {
        childProc.kill('SIGTERM')
      }
      // 清理可能残留的临时文件
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {
        /* noop */
      }
      finish('')
    }, TIMEOUT_MS)
  } catch {
    finish('')
  }
}

export const primeScreenCaptureFrame = (): boolean => {
  if (process.platform !== 'win32') {
    return false
  }

  try {
    return ScreenCapture.prime()
  } catch (error) {
    console.warn('[ScreenCapture] 预抓取屏幕失败:', error)
    return false
  }
}

export const screenCapture = (
  mainWindow?: BrowserWindow,
  restoreShowWindow: boolean = true
): Promise<{ image: string; bounds?: { x: number; y: number; width: number; height: number } }> => {
  return new Promise((resolve) => {
    // 隐藏主窗口
    const wasVisible = mainWindow?.isVisible() || false
    if (mainWindow && wasVisible) {
      mainWindow.hide()
    }

    // 恢复窗口显示
    const restoreWindow = (): void => {
      if (mainWindow && wasVisible && restoreShowWindow) {
        windowManager.showWindow()
      }
    }

    // 接收到截图后的执行程序
    if (process.platform === 'darwin') {
      handleScreenShots((image, bounds) => {
        restoreWindow()
        resolve({ image, bounds })
      })
    } else if (process.platform === 'win32') {
      screenWindow((image, bounds) => {
        restoreWindow()
        resolve({ image, bounds })
      })
    } else {
      // Linux
      handleLinuxScreenShot((image) => {
        restoreWindow()
        resolve({ image, bounds: undefined })
      })
    }
  })
}
