import { exec } from 'child_process'
import os from 'os'
import type { PluginManager } from '../../managers/pluginManager'
import { BrowserWindow, clipboard, nativeImage, Notification, shell } from 'electron'
import { promisify } from 'util'
import { GLOBAL_SCROLLBAR_CSS } from '../../core/globalStyles'
import { screenCapture } from '../../core/screenCapture'
import windowManager from '../../managers/windowManager'
import databaseAPI from '../shared/database'
import * as terminalLauncher from '../../utils/terminalLauncher'
import { ColorPicker } from '../../core/native/index.js'
import { getExplorerFolderPathFromWindow } from '../../utils/common'

interface SystemCommandContext {
  mainWindow: Electron.BrowserWindow | null
  pluginManager: PluginManager | null
}

function getSingleFilePathParam(param: any): string | undefined {
  if (param?.type !== 'files' || !Array.isArray(param.payload) || param.payload.length !== 1) {
    return undefined
  }

  return typeof param.payload[0]?.path === 'string' ? param.payload[0].path : undefined
}

/**
 * Windows 窗口信息类型
 */
interface WindowsWindowInfo {
  hwnd?: number
  className?: string
}

/**
 * 获取 Windows 资源管理器当前文件夹路径
 * 支持标准 Explorer 窗口（通过 COM）和桌面窗口（回退到桌面路径）
 */
export function getWindowsExplorerPath(windowInfo: WindowsWindowInfo): string | null {
  return getExplorerFolderPathFromWindow(windowInfo, 'SystemCmd')
}

/**
 * 执行系统内置指令
 */
export async function executeSystemCommand(
  command: string,
  ctx: SystemCommandContext,
  param?: any
): Promise<any> {
  const execAsync = promisify(exec)

  const platform = process.platform

  let cmd = ''

  switch (command) {
    case 'clear':
      return handleClear(ctx)

    case 'clear-history':
      return handleClearHistory(ctx)

    case 'reboot':
      if (platform === 'darwin') {
        cmd = 'osascript -e "tell application \\"System Events\\" to restart"'
      } else if (platform === 'win32') {
        cmd = 'shutdown /r /t 0'
      } else if (platform === 'linux') {
        cmd = 'systemctl reboot'
      }
      break

    case 'shutdown':
      if (platform === 'darwin') {
        cmd = 'osascript -e "tell application \\"System Events\\" to shut down"'
      } else if (platform === 'win32') {
        cmd = 'shutdown /s /t 0'
      } else if (platform === 'linux') {
        cmd = 'systemctl poweroff'
      }
      break

    case 'logoff':
      if (platform === 'darwin') {
        cmd = 'osascript -e "tell application \\"System Events\\" to log out"'
      } else if (platform === 'win32') {
        cmd = 'shutdown /l'
      } else if (platform === 'linux') {
        cmd =
          'gnome-session-quit --logout --no-prompt || xfce4-session-logout --logout || qdbus org.kde.ksmserver /KSMServer logout 0 0 0 || loginctl terminate-user $USER'
      }
      break

    case 'sleep':
      if (platform === 'darwin') {
        cmd = 'osascript -e "tell application \\"System Events\\" to sleep"'
      } else if (platform === 'win32') {
        ctx.mainWindow?.hide()
        cmd = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"`
      } else if (platform === 'linux') {
        cmd = 'systemctl suspend'
      }
      break

    // 锁定屏幕：macOS 使用 AppleScript 模拟 Ctrl+Cmd+Q，Windows 调用 user32.dll LockWorkStation
    case 'lock-screen':
      if (platform === 'darwin') {
        cmd =
          'osascript -e "tell application \\"System Events\\" to keystroke \\"q\\" using {control down, command down}"'
      } else if (platform === 'win32') {
        cmd = 'rundll32.exe user32.dll,LockWorkStation'
      } else if (platform === 'linux') {
        cmd = 'xdg-screensaver lock || gnome-screensaver-command -l'
      }
      break

    case 'search':
    case 'bing-search':
      // 旧的硬编码搜索指令，保留向后兼容
      if (command === 'search') {
        return handleTemplateSearch(ctx, param, 'https://www.baidu.com/s?wd={q}', '百度搜索')
      }
      return handleTemplateSearch(ctx, param, 'https://www.bing.com/search?q={q}', '必应搜索')

    case 'open-url':
      return handleOpenUrl(ctx, param)

    case 'open-folder':
      return handleOpenFolder(ctx, param)

    case 'window-info':
      return handleWindowInfo(ctx)

    case 'copy-path':
      return handleCopyPath(ctx, execAsync, param)

    case 'open-terminal':
      return handleOpenTerminal(ctx, execAsync, param)

    case 'color-picker':
      return handleColorPicker(ctx)

    case 'screenshot':
      return handleScreenshot(ctx)

    case 'add-to-wakeup-blacklist':
      return handleAddToWakeupBlacklist(ctx)

    default:
      return { success: false, error: `Unknown system command: ${command}` }
  }

  if (!cmd) {
    return { success: false, error: `Unsupported platform: ${platform}` }
  }

  console.log('[SystemCmd] 执行系统命令:', cmd)

  try {
    const { stdout, stderr } = await execAsync(cmd)
    if (stderr) console.error('[SystemCmd] 系统命令错误输出:', stderr)
    if (stdout) console.log('[SystemCmd] 系统命令输出:', stdout)

    ctx.mainWindow?.webContents.send('app-launched')
    ctx.mainWindow?.hide()

    return { success: true }
  } catch (error) {
    console.error('[SystemCmd] 执行系统命令失败:', error)
    return { success: false, error: String(error) }
  }
}

function handleClear(ctx: SystemCommandContext): any {
  console.log('[SystemCmd] 执行 Clear 指令：停止所有插件')
  if (ctx.pluginManager) {
    ctx.pluginManager.killAllPlugins()
  }
  ctx.mainWindow?.webContents.send('app-launched')
  return { success: true }
}

function handleClearHistory(ctx: SystemCommandContext): any {
  console.log('[SystemCmd] 执行清除使用记录')
  try {
    // 清空历史记录
    databaseAPI.dbPut('command-history', [])

    // 通知渲染进程刷新历史记录
    ctx.mainWindow?.webContents.send('history-changed')

    // 触发 app-launched 事件（隐藏窗口）
    ctx.mainWindow?.webContents.send('app-launched')
    ctx.mainWindow?.hide()

    console.log('[SystemCmd] 使用记录已清除')
    return { success: true }
  } catch (error) {
    console.error('[SystemCmd] 清除使用记录失败:', error)
    return { success: false, error: String(error) }
  }
}

async function handleTemplateSearch(
  ctx: SystemCommandContext,
  param: any,
  urlTemplate: string,
  label: string
): Promise<any> {
  console.log(`[SystemCmd] 执行${label}:`, param)
  if (param?.payload) {
    const query = encodeURIComponent(param.payload)
    const url = urlTemplate.replace('{q}', query)
    await shell.openExternal(url)
    ctx.mainWindow?.webContents.send('app-launched')
    ctx.mainWindow?.hide()
    return { success: true }
  }
  return { success: false, error: '缺少搜索关键词' }
}

async function handleScreenshot(ctx: SystemCommandContext): Promise<any> {
  console.log('[SystemCmd] 执行截图')

  try {
    const result = await screenCapture(ctx.mainWindow || undefined, false)
    if (!result.image) {
      return { success: false, error: '未获取到截图内容' }
    }

    clipboard.writeImage(nativeImage.createFromDataURL(result.image))

    new Notification({
      title: 'ZTools',
      body: '截图已复制到剪贴板'
    }).show()

    return { success: true }
  } catch (error) {
    console.error('[SystemCmd] 截图失败:', error)
    return { success: false, error: String(error) }
  }
}

async function handleOpenUrl(ctx: SystemCommandContext, param: any): Promise<any> {
  console.log('[SystemCmd] 打开网址:', param)
  if (param?.payload) {
    let url = param.payload.trim()
    if (!url.match(/^https?:\/\//i)) {
      url = `https://${url}`
    }
    await shell.openExternal(url)
    ctx.mainWindow?.webContents.send('app-launched')
    ctx.mainWindow?.hide()
    return { success: true }
  }
  return { success: false, error: '缺少网址' }
}

function handleWindowInfo(ctx: SystemCommandContext): any {
  console.log('[SystemCmd] 执行窗口信息')
  const winInfo = windowManager.getPreviousActiveWindow()

  ctx.mainWindow?.hide()

  const items = [
    { label: '窗口标题', value: winInfo?.title || '未知' },
    { label: '坐标 X', value: winInfo?.x ?? '未知' },
    { label: '坐标 Y', value: winInfo?.y ?? '未知' },
    { label: '窗口宽度', value: winInfo?.width ?? '未知' },
    { label: '窗口高度', value: winInfo?.height ?? '未知' },
    { label: '进程 ID', value: winInfo?.pid ?? '未知' },
    { label: '应用', value: winInfo?.app || '未知' },
    { label: '应用位置', value: winInfo?.appPath || '未知' }
  ]

  // macOS 平台添加 Bundle ID
  if (process.platform === 'darwin' && winInfo?.bundleId) {
    items.push({ label: '应用 ID', value: winInfo.bundleId })
  }

  const infoRows = items
    .map(
      (item) =>
        `<div class="row"><span class="label">${item.label}</span><span class="value">${item.value}</span></div>`
    )
    .join('')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
  }
  .container {
    padding: 32px 40px;
    min-width: 420px;
    -webkit-app-region: no-drag;
    user-select: text;
    cursor: text;
  }
  .title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 24px;
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: 0.5px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .row:last-child { border-bottom: none; }
  .label {
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
    flex-shrink: 0;
    margin-right: 20px;
  }
  .value {
    color: rgba(255, 255, 255, 0.95);
    font-size: 13px;
    font-family: "SF Mono", "Menlo", monospace;
    text-align: right;
    word-break: break-all;
  }
  .hint {
    margin-top: 20px;
    text-align: center;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.3);
  }
</style>
</head>
<body>
  <div class="container">
    <div class="title">窗口信息</div>
    ${infoRows}
    <div class="hint">点击窗口外部区域关闭</div>
  </div>
</body>
</html>`

  const infoWindow = new BrowserWindow({
    width: 500,
    height: 460,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  infoWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

  infoWindow.webContents.on('did-finish-load', () => {
    infoWindow.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS)
  })

  infoWindow.on('blur', () => {
    if (!infoWindow.isDestroyed()) {
      infoWindow.close()
    }
  })

  return { success: true }
}

async function handleCopyPath(
  ctx: SystemCommandContext,
  execAsync: (cmd: string) => Promise<{ stdout: string; stderr: string }>,
  param?: any
): Promise<any> {
  const filePath = getSingleFilePathParam(param)
  console.log('[SystemCmd] 执行复制路径', filePath ? `(剪贴板文件: ${filePath})` : '(从窗口获取)')

  if (filePath) {
    clipboard.writeText(filePath)
    console.log('[SystemCmd] 已复制路径:', filePath)
    ctx.mainWindow?.hide()
    return { success: true, path: filePath }
  }

  const windowInfo =
    (param?.type === 'window' && param?.payload) || windowManager.getPreviousActiveWindow()

  if (!windowInfo) {
    return { success: false, error: '无法获取当前窗口信息' }
  }

  if (process.platform === 'win32') {
    const folderPath = getWindowsExplorerPath(windowInfo as WindowsWindowInfo)
    if (!folderPath) {
      return { success: false, error: '未读取到当前 "文件资源管理器" 窗口目录' }
    }

    clipboard.writeText(folderPath)
    console.log('[SystemCmd] 已复制路径:', folderPath)
    ctx.mainWindow?.hide()
    return { success: true, path: folderPath }
  }

  if (process.platform === 'darwin') {
    try {
      const script = `
      tell application "Finder"
        if (count of Finder windows) is 0 then
          return POSIX path of (desktop as alias)
        else
          return POSIX path of (target of front window as alias)
        end if
      end tell
    `
      const { stdout } = await execAsync(`osascript -e '${script}'`)
      const folderPath = stdout.trim()
      clipboard.writeText(folderPath)
      console.log('[SystemCmd] 已复制路径:', folderPath)
      ctx.mainWindow?.hide()
      return { success: true, path: folderPath }
    } catch (error) {
      console.error('[SystemCmd] 获取 Finder 路径失败:', error)
      return { success: false, error: String(error) }
    }
  }
  return { success: false, error: `不支持的平台: ${process.platform}` }
}

/**
 * 从窗口信息获取 macOS 访达当前目录路径
 */
async function getMacFinderPath(
  execAsync: (cmd: string) => Promise<{ stdout: string; stderr: string }>
): Promise<string> {
  const script = `
    tell application "Finder"
      if (count of Finder windows) is 0 then
        return POSIX path of (desktop as alias)
      else
        return POSIX path of (target of front window as alias)
      end if
    end tell
  `
  const { stdout } = await execAsync(`osascript -e '${script}'`)
  return stdout.trim()
}

async function handleOpenTerminal(
  ctx: SystemCommandContext,
  execAsync: (cmd: string) => Promise<{ stdout: string; stderr: string }>,
  param?: any
): Promise<any> {
  const folderPath = getSingleFilePathParam(param)
  console.log(
    '[SystemCmd] 执行在终端打开',
    folderPath ? `(剪贴板文件夹: ${folderPath})` : '(从窗口获取)'
  )

  try {
    let targetPath: string | null = folderPath ?? null

    // 如果没有提供路径，从窗口获取
    if (!targetPath) {
      const windowInfo =
        (param?.type === 'window' && param?.payload) || windowManager.getPreviousActiveWindow()
      if (!windowInfo) {
        return { success: false, error: '无法获取当前窗口信息' }
      }

      if (process.platform === 'darwin') {
        targetPath = await getMacFinderPath(execAsync)
      } else if (process.platform === 'win32') {
        targetPath = getWindowsExplorerPath(windowInfo as WindowsWindowInfo)
        if (!targetPath) {
          return { success: false, error: '无法获取资源管理器路径' }
        }
      } else if (process.platform === 'linux') {
        // linux获取当前目录路径的方式待定，先写home目录
        targetPath = os.homedir()
      }
    }

    if (!targetPath) {
      return { success: false, error: '无法确定目标路径' }
    }

    // 打开终端（统一走 terminalLauncher，按用户配置分发）
    const launched = await terminalLauncher.openInTerminal(targetPath)
    if (!launched) {
      return { success: false, error: '无法启动终端' }
    }

    console.log('[SystemCmd] 已在终端打开:', targetPath)
    ctx.mainWindow?.webContents.send('app-launched')
    ctx.mainWindow?.hide()
    return { success: true }
  } catch (error) {
    console.error('[SystemCmd] 在终端打开失败:', error)
    return { success: false, error: String(error) }
  }
}

async function handleOpenFolder(ctx: SystemCommandContext, param: any): Promise<any> {
  console.log('[SystemCmd] 前往文件夹:', param)
  if (!param?.payload) {
    return { success: false, error: '缺少路径' }
  }

  let targetPath: string = param.payload.trim()

  // 展开 ~ 为用户主目录
  if (targetPath.startsWith('~')) {
    const os = await import('os')
    targetPath = os.homedir() + targetPath.slice(1)
  }

  const fs = await import('fs')
  let stat: import('fs').Stats | null = null
  try {
    stat = fs.statSync(targetPath)
  } catch {
    // 路径不存在，仍尝试 openPath（让系统报错）
  }

  if (stat && stat.isFile()) {
    // 是文件：在 Finder/Explorer 中高亮显示文件
    shell.showItemInFolder(targetPath)
    ctx.mainWindow?.webContents.send('app-launched')
    ctx.mainWindow?.hide()
    return { success: true }
  }

  const errorMessage = await shell.openPath(targetPath)
  if (errorMessage) {
    console.error('[SystemCmd] 前往文件夹失败:', errorMessage)
    return { success: false, error: errorMessage }
  }

  ctx.mainWindow?.webContents.send('app-launched')
  ctx.mainWindow?.hide()
  return { success: true }
}

function handleColorPicker(ctx: SystemCommandContext): Promise<any> {
  console.log('[SystemCmd] 执行屏幕取色')
  ctx.mainWindow?.hide()

  return new Promise((resolve) => {
    try {
      ColorPicker.start((result) => {
        if (result.success && result.hex) {
          clipboard.writeText(result.hex)
          console.log('[SystemCmd] 已复制颜色值:', result.hex)
          if (Notification.isSupported()) {
            new Notification({ title: 'ZTools', body: `已复制颜色值: ${result.hex}` }).show()
          }
          resolve({ success: true, hex: result.hex })
        } else {
          console.log('[SystemCmd] 取色已取消')
          resolve({ success: false, error: '取色已取消' })
        }
      })
    } catch (error) {
      console.error('[SystemCmd] 取色失败:', error)
      resolve({ success: false, error: String(error) })
    }
  })
}

/**
 * 添加到唤醒黑名单：将唤醒前活动窗口的应用加入黑名单
 */
function handleAddToWakeupBlacklist(ctx: SystemCommandContext): any {
  const winInfo = windowManager.getPreviousActiveWindow()
  if (!winInfo?.app) {
    return { success: false, error: '无法获取当前窗口信息' }
  }

  const settings = databaseAPI.dbGet('settings-general') || {}
  const blacklist: Array<{ app: string; bundleId?: string; label?: string }> =
    settings.wakeupBlacklist ?? []

  const appName = winInfo.app

  // 去重：macOS 按 bundleId，Windows 按 app 名称
  const isDuplicate =
    process.platform === 'darwin' && winInfo.bundleId
      ? blacklist.some((item) => item.bundleId === winInfo.bundleId)
      : blacklist.some((item) => item.app.toLowerCase() === appName.toLowerCase())

  if (isDuplicate) {
    ctx.mainWindow?.hide()
    if (Notification.isSupported()) {
      new Notification({ title: 'ZTools', body: `${appName} 已在唤醒黑名单中` }).show()
    }
    return { success: false, error: '该应用已在唤醒黑名单中' }
  }

  const label = appName.replace(/\.(exe|app)$/i, '')
  blacklist.push({
    app: appName,
    bundleId: winInfo.bundleId,
    label
  })

  databaseAPI.dbPut('settings-general', { ...settings, wakeupBlacklist: blacklist })
  windowManager.updateWakeupBlacklist(blacklist)

  ctx.mainWindow?.hide()
  if (Notification.isSupported()) {
    new Notification({
      title: 'ZTools',
      body: `已将 ${label} 添加到唤醒黑名单`
    }).show()
  }
  return { success: true }
}
