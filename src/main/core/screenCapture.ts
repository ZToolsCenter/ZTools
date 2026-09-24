import { clipboard, BrowserWindow } from 'electron'
import { exec, execSync, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ScreenCapture, ScreenCaptureOptions } from './native'
import windowManager from '../managers/windowManager'

// 原生截图（Windows/macOS：覆盖层选区 + 编辑态工具栏/标注/翻译）
export const screenWindow = (
  cb: (image: string, bounds?: { x: number; y: number; width: number; height: number }) => void,
  options?: ScreenCaptureOptions
): void => {
  // 透传 autoConfirm 选项；旧签名仅传 callback 时走默认 true 自动出图
  ScreenCapture.start(options ?? {}, (result) => {
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
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return false
  }

  try {
    return ScreenCapture.prime()
  } catch (error) {
    console.warn('[ScreenCapture] 预抓取屏幕失败:', error)
    return false
  }
}

// macOS 主窗口隐藏后，等待 WindowServer 完成合成、窗口真正离开屏幕的缓冲时长。
// orderOut 只是把窗口从窗口服务器移除，屏幕像素要等下一次合成才更新；
// 不等待就截屏，选区冻结帧里会残留主窗口（搜索框）画面。
const MAC_WINDOW_DISMISS_SETTLE_MS = 250

/**
 * 统一截图入口：隐藏主窗口后启动平台对应的截图流程，结束后恢复窗口显示。
 * macOS 上主窗口刚隐藏时需先等待屏幕合成完成（见 MAC_WINDOW_DISMISS_SETTLE_MS），
 * 再启动原生截图，避免冻结帧带上搜索框。
 * @param mainWindow 截图期间需要隐藏的主窗口；省略或不可见时直接开始截图
 * @param restoreShowWindow 截图结束后是否恢复主窗口显示
 * @param options 原生截图选项（如 autoConfirm），透传给原生模块
 * @returns 截图流程结束后 resolve 为 { image, bounds } 的 Promise；image 为 dataURL 或空串
 */
export const screenCapture = (
  mainWindow?: BrowserWindow,
  restoreShowWindow: boolean = true,
  options?: ScreenCaptureOptions
): Promise<{ image: string; bounds?: { x: number; y: number; width: number; height: number } }> => {
  return new Promise((resolve) => {
    // 隐藏主窗口（记录隐藏前可见性，用于后续恢复与 macOS 等待判断）
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

    // 启动平台截图并透传结果
    const startCapture = (): void => {
      if (process.platform === 'darwin' || process.platform === 'win32') {
        // 原生截图（两平台全功能对等）：透传 autoConfirm 选项，false 时进入编辑态
        // 由用户标注/翻译后再出图（macOS 会话阻塞主线程直至收束，为原生模块既定行为）
        screenWindow((image, bounds) => {
          restoreWindow()
          resolve({ image, bounds })
        }, options)
      } else {
        // Linux
        handleLinuxScreenShot((image) => {
          restoreWindow()
          resolve({ image, bounds: undefined })
        })
      }
    }

    // macOS：主窗口刚被隐藏时，等待其真正离开屏幕再截；窗口本就不可见则无需等待
    if (process.platform === 'darwin' && wasVisible) {
      setTimeout(startCapture, MAC_WINDOW_DISMISS_SETTLE_MS)
      return
    }

    startCapture()
  })
}
