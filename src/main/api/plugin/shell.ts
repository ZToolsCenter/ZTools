import { execFile } from 'child_process'
import os from 'os'
import { ipcMain, shell } from 'electron'
import { getFileIconAsBase64 } from '../../core/iconProtocol'
import { WindowManager } from '../../core/native/index.js'
import type ClipboardManager from '../../managers/clipboardManager'
import { getExplorerFolderPathFromWindow } from '../../utils/common'

const MAC_BROWSER_APP_MAP = {
  'com.apple.Safari': 'Safari',
  'com.google.Chrome': 'Google Chrome',
  'com.microsoft.edgemac': 'Microsoft Edge',
  'com.operasoftware.Opera': 'Opera',
  'com.vivaldi.Vivaldi': 'Vivaldi',
  'com.brave.Browser': 'Brave Browser'
} as const

const WINDOWS_BROWSER_PROCESS_MAP = {
  'chrome.exe': 'chrome',
  'firefox.exe': 'firefox',
  'MicrosoftEdge.exe': 'microsoftedge',
  'iexplore.exe': 'iexplore',
  'opera.exe': 'opera',
  'brave.exe': 'brave',
  'msedge.exe': 'msedge'
} as const

/**
 * Shell API - 插件专用
 * 提供系统 shell 相关操作，包括文件管理器路径读取
 */
export class PluginShellAPI {
  /** 剪贴板管理器，用于获取当前活动窗口信息 */
  private clipboardManager: typeof ClipboardManager | null = null

  public init(clipboardManager: typeof ClipboardManager): void {
    this.clipboardManager = clipboardManager
    this.setupIPC()
  }

  private setupIPC(): void {
    // 使用系统默认程序打开 URL
    ipcMain.on('shell-open-external', async (event, url: string) => {
      try {
        await shell.openExternal(url)
        event.returnValue = { success: true }
      } catch (error: unknown) {
        console.error('[PluginShell] 打开 URL 失败:', error)
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 在文件管理器中显示文件
    ipcMain.on('shell-show-item-in-folder', (event, fullPath: string) => {
      try {
        shell.showItemInFolder(fullPath)
      } catch (error: unknown) {
        console.error('[PluginShell] 在文件管理器中显示文件失败:', error)
      }
      event.returnValue = undefined
    })

    // 使用系统默认方式打开文件或文件夹
    ipcMain.on('shell-open-path', async (event, fullPath: string) => {
      try {
        const errorMessage = await shell.openPath(fullPath)
        event.returnValue = {
          success: !errorMessage,
          error: errorMessage || undefined
        }
      } catch (error: unknown) {
        console.error('[PluginShell] 使用系统默认方式打开文件失败:', error)
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 获取文件系统图标（返回 base64 Data URL，同步）
    ipcMain.on('get-file-icon', (event, filePath: string) => {
      getFileIconAsBase64(filePath)
        .then((icon) => {
          event.returnValue = icon
        })
        .catch((error: unknown) => {
          console.error('[PluginShell] 获取文件图标失败:', filePath, error)
          event.returnValue = null
        })
    })

    // 播放系统提示音（同步）
    ipcMain.on('shell-beep', (event) => {
      try {
        shell.beep()
        event.returnValue = { success: true }
      } catch (error: unknown) {
        console.error('[PluginShell] 播放系统提示音失败:', error)
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 将文件移动到回收站（异步）
    ipcMain.handle('shell-trash-item', async (_event, fullPath: string) => {
      try {
        await shell.trashItem(fullPath)
        return { success: true }
      } catch (error: unknown) {
        console.error('[PluginShell] 移动文件到回收站失败:', fullPath, error)
        throw new Error(error instanceof Error ? error.message : '移动文件到回收站失败')
      }
    })

    // 读取当前文件管理器窗口路径（异步）
    // macOS: 通过 AppleScript 查询 Finder 前台窗口路径
    // Windows: 通过窗口类名判断 + COM IShellWindows 查询 Explorer 路径
    ipcMain.handle('plugin:read-current-folder-path', async () => {
      return this.readCurrentFolderPath()
    })

    // 读取当前浏览器窗口 URL（异步）
    // macOS: 通过 AppleScript 查询前台标签页 URL
    // Windows: 通过原生自动化能力读取地址栏 URL
    ipcMain.handle('plugin:read-current-browser-url', async () => {
      return this.readCurrentBrowserUrl()
    })
  }

  /**
   * 读取当前文件管理器窗口的文件夹路径
   * - macOS: 检查 Finder 并通过 osascript 获取路径
   * - Windows: 检查 Explorer 并通过 COM 或桌面路径获取
   * - Linux: 不支持
   * @returns 文件夹路径字符串
   * @throws 当前窗口不是文件管理器、无法读取路径、或平台不支持时抛出 Error
   */
  private async readCurrentFolderPath(): Promise<string> {
    const currentPlatform = os.platform()

    if (currentPlatform === 'darwin') {
      return this.readCurrentFolderPathMac()
    } else if (currentPlatform === 'win32') {
      return this.readCurrentFolderPathWindows()
    } else {
      throw new Error('该平台不支持')
    }
  }

  /**
   * 读取当前浏览器窗口的 URL
   * - macOS: AppleScript 读取当前前台标签页 URL
   * - Windows: 原生层读取当前浏览器地址栏 URL
   * - Linux: 不支持
   */
  private async readCurrentBrowserUrl(): Promise<string> {
    const currentPlatform = os.platform()

    if (currentPlatform === 'darwin') {
      return this.readCurrentBrowserUrlMac()
    } else if (currentPlatform === 'win32') {
      return this.readCurrentBrowserUrlWindows()
    } else {
      throw new Error('该平台不支持')
    }
  }

  /**
   * macOS: 通过 AppleScript 查询 Finder 前台窗口路径
   * 先尝试获取前台窗口路径，失败则回退到桌面路径
   */
  private async readCurrentFolderPathMac(): Promise<string> {
    // 1. 获取当前活动窗口信息
    const windowInfo = this.clipboardManager?.getCurrentWindow()
    if (!windowInfo) {
      console.warn('[PluginShell] readCurrentFolderPath: 未识别到当前活动窗口')
      throw new Error('未识别到当前活动窗口')
    }

    // 2. 检查是否为 Finder 窗口
    if (windowInfo.bundleId !== 'com.apple.finder') {
      console.log(
        `[PluginShell] readCurrentFolderPath: 当前窗口非 Finder (bundleId=${windowInfo.bundleId})`
      )
      throw new Error('当前活动窗口非 "访达" 窗口')
    }

    // 3. 先尝试获取 Finder 前台窗口路径
    try {
      const frontWindowPath = await this.execAppleScript(
        'tell application "Finder" to get the POSIX path of (target of front window as alias)'
      )
      const result = frontWindowPath.trim().replace(/\/$/, '')
      console.log(`[PluginShell] readCurrentFolderPath: Finder 窗口路径=${result}`)
      return result
    } catch {
      // Finder 前台窗口查询失败（例如仅显示桌面），回退到桌面路径
      console.log('[PluginShell] readCurrentFolderPath: Finder 前台窗口查询失败，回退到桌面路径')
    }

    // 4. 回退：获取桌面路径
    try {
      const desktopPath = await this.execAppleScript(
        'tell application "Finder" to get the POSIX path of (path to desktop)'
      )
      const result = desktopPath.trim().replace(/\/$/, '')
      console.log(`[PluginShell] readCurrentFolderPath: 桌面路径=${result}`)
      return result
    } catch (error: unknown) {
      // 清理 AppleScript 错误信息：去掉错误码前缀（如 "execution error: ..."）
      const errMsg = error instanceof Error ? error.message : String(error)
      const cleanMsg = errMsg.replace(/^\d+:\d+:\s*execution error:\s*/i, '').trim()
      console.error('[PluginShell] readCurrentFolderPath: AppleScript 执行失败:', cleanMsg)
      throw new Error(cleanMsg)
    }
  }

  /**
   * macOS: 通过 AppleScript 获取当前浏览器前台标签页 URL
   * 参考 uTools 行为：
   * - Safari 读取 front document
   * - 其他受支持浏览器读取 front window 的 active tab
   */
  private async readCurrentBrowserUrlMac(): Promise<string> {
    const windowInfo = this.clipboardManager?.getCurrentWindow()
    if (!windowInfo) {
      console.warn('[PluginShell] readCurrentBrowserUrl: 未识别到当前活动窗口')
      throw new Error('未识别到当前活动窗口')
    }

    const bundleId = windowInfo.bundleId
    if (!bundleId || !(bundleId in MAC_BROWSER_APP_MAP)) {
      console.log(
        `[PluginShell] readCurrentBrowserUrl: 当前窗口非受支持浏览器 (bundleId=${bundleId})`
      )
      throw new Error('当前活动窗口非可识别浏览器')
    }

    const appName = MAC_BROWSER_APP_MAP[bundleId as keyof typeof MAC_BROWSER_APP_MAP]
    const script =
      bundleId === 'com.apple.Safari'
        ? 'tell application "Safari" to return URL of front document'
        : `tell application "${appName}" to return URL of active tab of front window`

    try {
      const result = (await this.execAppleScript(script)).trim()
      if (!result) {
        console.error('[PluginShell] readCurrentBrowserUrl: AppleScript 返回空 URL')
        throw new Error('未读取到 URL')
      }
      console.log(
        `[PluginShell] readCurrentBrowserUrl: macOS 浏览器 URL 读取成功 (bundleId=${bundleId})`
      )
      return result
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      const cleanMsg = errMsg
        .replace(/^\d+:\d+:\s*execution error:\s*/i, '')
        .replace(/\(-?\d+\)\s*$/i, '')
        .trim()
      console.error('[PluginShell] readCurrentBrowserUrl: AppleScript 执行失败:', cleanMsg)
      throw new Error(cleanMsg || '未读取到 URL')
    }
  }

  /**
   * Windows: 检查当前窗口是否为文件资源管理器，并获取路径
   * - CabinetWClass/ExploreWClass: 标准 Explorer 窗口，通过 COM 查询路径
   * - Progman/WorkerW: 桌面窗口，返回桌面路径
   */
  private readCurrentFolderPathWindows(): string {
    // 1. 获取当前活动窗口信息
    const windowInfo = this.clipboardManager?.getCurrentWindow()
    if (!windowInfo) {
      console.warn('[PluginShell] readCurrentFolderPath: 未识别到当前活动窗口')
      throw new Error('未识别到当前活动窗口')
    }

    // 2. 检查是否为文件资源管理器相关进程
    // explorer.exe 是核心进程，其他进程是 Windows 搜索相关
    const EXPLORER_APPS = [
      'explorer.exe',
      'SearchApp.exe',
      'SearchHost.exe',
      'FESearchHost.exe',
      'prevhost.exe'
    ]
    if (!EXPLORER_APPS.includes(windowInfo.app)) {
      console.log(
        `[PluginShell] readCurrentFolderPath: 当前窗口非 Explorer (app=${windowInfo.app})`
      )
      throw new Error('当前活动窗口非 "文件资源管理器" 窗口')
    }

    // 3. 根据窗口类名判断并获取路径
    const folderPath = getExplorerFolderPathFromWindow(windowInfo, 'PluginShell')
    if (folderPath) {
      console.log(`[PluginShell] readCurrentFolderPath: Explorer 窗口路径=${folderPath}`)
      return folderPath
    }

    console.warn(
      `[PluginShell] readCurrentFolderPath: 未识别的窗口类 "${windowInfo.className}" (app=${windowInfo.app})`
    )
    throw new Error(`当前活动窗口类 "${windowInfo.className}" 未识别`)
  }

  /**
   * Windows: 读取当前浏览器窗口 URL
   * 参考 uTools 行为：
   * - 按进程名识别浏览器
   * - 原生层按 hwnd 读取 URL
   * - Chrome 首次失败时 50ms 后重试一次
   */
  private async readCurrentBrowserUrlWindows(): Promise<string> {
    const windowInfo = this.clipboardManager?.getCurrentWindow()
    if (!windowInfo) {
      console.warn('[PluginShell] readCurrentBrowserUrl: 未识别到当前活动窗口')
      throw new Error('未识别到当前活动窗口')
    }

    const browserName =
      WINDOWS_BROWSER_PROCESS_MAP[windowInfo.app as keyof typeof WINDOWS_BROWSER_PROCESS_MAP]
    if (!browserName) {
      console.log(
        `[PluginShell] readCurrentBrowserUrl: 当前窗口非受支持浏览器 (app=${windowInfo.app})`
      )
      throw new Error('当前活动窗口非可识别浏览器')
    }

    if (windowInfo.hwnd == null) {
      console.error('[PluginShell] readCurrentBrowserUrl: 浏览器窗口缺少 hwnd')
      throw new Error('未读取到 URL')
    }

    const tryReadUrl = async (): Promise<string | null> => {
      const result = await WindowManager.readBrowserWindowUrl(browserName, windowInfo.hwnd!)
      return typeof result === 'string' && result.trim() !== '' ? result.trim() : null
    }

    let url = await tryReadUrl()
    if (!url && browserName === 'chrome') {
      console.log('[PluginShell] readCurrentBrowserUrl: Chrome 首次读取失败，50ms 后重试')
      await new Promise((resolve) => setTimeout(resolve, 50))
      url = await tryReadUrl()
    }

    if (!url) {
      console.error(
        `[PluginShell] readCurrentBrowserUrl: 原生读取失败 (browser=${browserName}, hwnd=${windowInfo.hwnd})`
      )
      throw new Error('未读取到 URL')
    }

    console.log(
      `[PluginShell] readCurrentBrowserUrl: Windows 浏览器 URL 读取成功 (browser=${browserName}, hwnd=${windowInfo.hwnd})`
    )
    return url
  }

  /**
   * 执行 AppleScript 命令并返回标准输出
   * 使用 execFile 而非 exec，避免 shell 解释，防止潜在的命令注入风险
   * @param script - AppleScript 脚本内容
   * @returns 命令输出字符串
   */
  private execAppleScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', script], (error, stdout) => {
        if (error) {
          reject(error)
        } else {
          resolve(stdout)
        }
      })
    })
  }
}

export default new PluginShellAPI()
