import { app } from 'electron'
import os from 'os'
import path from 'path'

/**
 * 获取 Windows 需要递归扫描的开始菜单根目录。
 *
 * @returns 系统级与用户级开始菜单根目录。
 */
export function getWindowsRecursiveScanPaths(): string[] {
  // 系统级开始菜单
  const programDataStartMenu = path.join('C:', 'ProgramData', 'Microsoft', 'Windows', 'Start Menu')

  // 用户级开始菜单
  const userStartMenu = path.join(
    os.homedir(),
    'AppData',
    'Roaming',
    'Microsoft',
    'Windows',
    'Start Menu'
  )

  return [programDataStartMenu, userStartMenu]
}

/**
 * 获取 Windows 只扫描顶层的桌面路径。
 *
 * @returns 用户桌面和公共桌面路径。
 */
export function getWindowsFlatScanPaths(): string[] {
  // Electron 返回重定向后的真实桌面路径，桌面始终只扫描顶层。
  const userDesktop = app.getPath('desktop')
  const publicDesktop = path.join('C:', 'Users', 'Public', 'Desktop')

  return [...new Set([userDesktop, publicDesktop])]
}

/**
 * 获取 macOS 应用目录路径。
 *
 * @returns macOS 系统级与用户级应用目录。
 */
export function getMacApplicationPaths(): string[] {
  return ['/Applications', '/System/Applications', `${process.env.HOME}/Applications`]
}

/**
 * 获取 Linux XDG 应用目录路径（遵循 XDG Base Directory 规范）。
 *
 * @returns 用户级和系统级 .desktop 文件目录。
 */
export function getLinuxApplicationPaths(): string[] {
  const home = os.homedir()
  const xdgDataDirs = process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share'
  const baseDirs = xdgDataDirs.split(':').filter(Boolean)

  const paths = [
    path.join(home, '.local/share/applications'), // 用户安装的应用
    ...baseDirs.map((dir) => path.join(dir, 'applications')) // 系统安装的应用
  ]

  return [...new Set(paths)] // 去重
}
