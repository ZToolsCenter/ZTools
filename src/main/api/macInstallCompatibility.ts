import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import yaml from 'yaml'
import { EXPECTED_ELECTRON_VERSION } from '../runtimeCompatibility'

export const MAC_APP_ID = 'top.z-tools'
export const MAC_ELECTRON_VERSION = EXPECTED_ELECTRON_VERSION
export const MAC_UPDATER_TYPE = 'electron-updater-mac'
export const MAC_INSTALL_INFO_FILE = 'ztools-install-info.json'
export const MAC_RELEASE_URL = 'https://github.com/ZToolsCenter/ZTools/releases/latest'

export interface MacInstallInfo {
  schemaVersion: number
  appId: string
  electronVersion: string
  updater: string
}

export interface MacInstallCompatibility {
  compatible: boolean
  migrationRequired: boolean
  reasons: string[]
  installInfo?: MacInstallInfo
}

/**
 * 校验 macOS 安装是否具备标准整包更新条件。
 * @param runtimeElectronVersion 当前运行时 Electron 版本。
 * @param installInfo 完整安装包写入的安装标记。
 * @param hasUpdateConfig 是否存在有效的 electron-updater 配置。
 * @param runningFromDiskImage 是否正在只读磁盘映像中运行。
 * @returns macOS 安装兼容性结果。
 */
export function validateMacInstall(
  runtimeElectronVersion: string,
  installInfo: MacInstallInfo | null,
  hasUpdateConfig: boolean,
  runningFromDiskImage = false
): MacInstallCompatibility {
  const reasons: string[] = []

  // 完整更新要求运行时、应用标识和更新方式都来自同一完整安装包。
  if (runtimeElectronVersion !== MAC_ELECTRON_VERSION) {
    reasons.push(
      `Electron 版本不匹配（当前 ${runtimeElectronVersion}，需要 ${MAC_ELECTRON_VERSION}）`
    )
  }

  if (!installInfo) {
    reasons.push('缺少 macOS 完整安装标记')
  } else {
    if (installInfo.schemaVersion !== 1) reasons.push('安装标记版本不受支持')
    if (installInfo.appId !== MAC_APP_ID) reasons.push('应用标识不匹配')
    if (installInfo.electronVersion !== MAC_ELECTRON_VERSION) {
      reasons.push('安装包 Electron 版本不匹配')
    }
    if (installInfo.updater !== MAC_UPDATER_TYPE) reasons.push('更新方式不兼容')
  }

  if (!hasUpdateConfig) reasons.push('缺少 electron-updater 配置')
  if (runningFromDiskImage) reasons.push('应用正在 macOS 磁盘映像中运行')

  return {
    compatible: reasons.length === 0,
    migrationRequired: reasons.length > 0,
    reasons,
    installInfo: installInfo ?? undefined
  }
}

/**
 * 读取当前 macOS 应用的完整安装标记与更新配置并执行兼容校验。
 * @returns macOS 安装兼容性结果。
 */
export async function getMacInstallCompatibility(): Promise<MacInstallCompatibility> {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return { compatible: false, migrationRequired: false, reasons: ['当前不是 macOS 安装版'] }
  }

  const installInfoPath = path.join(process.resourcesPath, MAC_INSTALL_INFO_FILE)
  const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml')
  let installInfo: MacInstallInfo | null = null
  let hasUpdateConfig = false

  // 缺少安装标记意味着当前应用来自 legacy ASAR 更新或非完整安装。
  try {
    installInfo = JSON.parse(await fs.readFile(installInfoPath, 'utf8')) as MacInstallInfo
  } catch {
    installInfo = null
  }

  // 仅接受当前公开 GitHub Release 更新源，避免错误源触发整包替换。
  try {
    const updateConfig = yaml.parse(await fs.readFile(updateConfigPath, 'utf8'))
    hasUpdateConfig =
      updateConfig?.provider === 'github' &&
      updateConfig?.owner === 'ZToolsCenter' &&
      updateConfig?.repo === 'ZTools'
  } catch {
    hasUpdateConfig = false
  }

  return validateMacInstall(
    process.versions.electron,
    installInfo,
    hasUpdateConfig,
    process.execPath.startsWith('/Volumes/')
  )
}
