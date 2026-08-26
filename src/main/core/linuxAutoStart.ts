import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/** XDG autostart 目录相对家目录的路径 */
const AUTOSTART_DIR_RELATIVE_PATH = path.join('.config', 'autostart')

/** ZTools 管理的自启桌面条目文件名 */
const AUTOSTART_FILE_NAME = 'ztools.desktop'

/** GNOME 启动应用程序面板会把关闭态写成 X-GNOME-Autostart-enabled=false */
const GNOME_DISABLED_MARKER = 'X-GNOME-Autostart-enabled=false'

/** 桌面环境通用的禁用标记 */
const HIDDEN_MARKER = 'Hidden=true'

/**
 * 计算自启桌面条目完整路径。
 * @returns XDG autostart 目录下的 ztools.desktop 绝对路径
 */
function getAutostartDesktopFile(): string {
  return path.join(app.getPath('home'), AUTOSTART_DIR_RELATIVE_PATH, AUTOSTART_FILE_NAME)
}

/**
 * 计算自启桌面条目的 Exec 目标。
 * AppImage 运行时使用 APPIMAGE 环境变量指向的实际镜像；其它打包形式使用可执行文件路径。
 * @returns 加引号后的可执行文件绝对路径
 */
function getAutostartExecTarget(): string {
  const target = process.env.APPIMAGE || app.getPath('exe')
  return `"${target}"`
}

/**
 * 生成本次应写入的自启桌面条目内容。
 * @returns UTF-8 桌面条目文本，使用 \n 行尾
 */
function buildDesktopEntryContent(): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=ZTools',
    `Exec=${getAutostartExecTarget()}`,
    'Terminal=false',
    'StartupNotify=false',
    'X-GNOME-Autostart-enabled=true'
  ].join('\n')
}

/**
 * 设置 Linux 开机自启（XDG autostart）。
 * 启用时递归创建 ~/.config/autostart 并写入 ztools.desktop，关闭时删除该文件。
 * @param enable 是否启用开机自启
 * @returns 无返回值
 * @throws 写入或删除自启文件失败时抛出错误，由调用方决定是否回滚开关状态
 */
export function setLinuxLaunchAtLogin(enable: boolean): void {
  const desktopFile = getAutostartDesktopFile()
  if (!enable) {
    // 关闭时仅删除自启条目，force 使文件不存在时成为无操作。
    fs.rmSync(desktopFile, { force: true })
    return
  }

  // 确保 autostart 目录存在，桌面环境只读取该目录下的一级 .desktop 文件。
  fs.mkdirSync(path.dirname(desktopFile), { recursive: true })
  fs.writeFileSync(desktopFile, buildDesktopEntryContent(), { encoding: 'utf8' })
}

/**
 * 读取 Linux 开机自启状态。
 * 文件缺失视为关闭；存在时被 GNOME 面板关闭或带 Hidden 标记也视为关闭。
 * @returns 自启条目存在且未被禁用时返回 true
 * @throws 自启文件存在但读取失败（非 ENOENT）时抛出错误
 */
export function getLinuxLaunchAtLogin(): boolean {
  const desktopFile = getAutostartDesktopFile()
  let content: string
  try {
    content = fs.readFileSync(desktopFile, 'utf8')
  } catch (error) {
    // 文件未创建过按关闭态处理，其它错误如实上抛以便排查。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }

  return !content.includes(GNOME_DISABLED_MARKER) && !content.includes(HIDDEN_MARKER)
}
