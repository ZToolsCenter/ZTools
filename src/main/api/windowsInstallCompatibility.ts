import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import yaml from 'yaml'
import { EXPECTED_ELECTRON_VERSION } from '../runtimeCompatibility'

export const WINDOWS_APP_ID = 'top.z-tools'
export const WINDOWS_ELECTRON_VERSION = EXPECTED_ELECTRON_VERSION
export const WINDOWS_UPDATER_TYPE = 'electron-updater-nsis'
export const WINDOWS_INSTALL_INFO_FILE = 'ztools-install-info.json'
export const WINDOWS_NSIS_INSTALL_MARKER_FILE = '.ztools-nsis-installed'
export const WINDOWS_RELEASE_URL = 'https://github.com/ZToolsCenter/ZTools/releases/latest'

export interface WindowsInstallInfo {
  schemaVersion: number
  appId: string
  electronVersion: string
  updater: string
}

export interface WindowsInstallCompatibility {
  compatible: boolean
  migrationRequired: boolean
  reasons: string[]
  installInfo?: WindowsInstallInfo
}

export function validateWindowsInstall(
  runtimeElectronVersion: string,
  installInfo: WindowsInstallInfo | null,
  hasUpdateConfig: boolean,
  hasNsisInstallMarker = true
): WindowsInstallCompatibility {
  const reasons: string[] = []

  if (runtimeElectronVersion !== WINDOWS_ELECTRON_VERSION) {
    reasons.push(
      `Electron 版本不匹配（当前 ${runtimeElectronVersion}，需要 ${WINDOWS_ELECTRON_VERSION}）`
    )
  }

  if (!installInfo) {
    reasons.push('缺少完整安装标记')
  } else {
    if (installInfo.schemaVersion !== 1) reasons.push('安装标记版本不受支持')
    if (installInfo.appId !== WINDOWS_APP_ID) reasons.push('应用标识不匹配')
    if (installInfo.electronVersion !== WINDOWS_ELECTRON_VERSION) {
      reasons.push('安装包 Electron 版本不匹配')
    }
    if (installInfo.updater !== WINDOWS_UPDATER_TYPE) reasons.push('更新方式不兼容')
  }

  if (!hasUpdateConfig) reasons.push('缺少 electron-updater 配置')
  if (!hasNsisInstallMarker) reasons.push('当前不是 NSIS 完整安装版')

  return {
    compatible: reasons.length === 0,
    migrationRequired: reasons.length > 0,
    reasons,
    installInfo: installInfo ?? undefined
  }
}

export async function getWindowsInstallCompatibility(): Promise<WindowsInstallCompatibility> {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return { compatible: false, migrationRequired: false, reasons: ['当前不是 Windows 安装版'] }
  }

  const installInfoPath = path.join(process.resourcesPath, WINDOWS_INSTALL_INFO_FILE)
  const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml')
  const nsisInstallMarkerPath = path.join(process.resourcesPath, WINDOWS_NSIS_INSTALL_MARKER_FILE)
  let installInfo: WindowsInstallInfo | null = null
  let hasUpdateConfig = false
  let hasNsisInstallMarker = false

  try {
    installInfo = JSON.parse(await fs.readFile(installInfoPath, 'utf8')) as WindowsInstallInfo
  } catch {
    installInfo = null
  }

  try {
    const updateConfig = yaml.parse(await fs.readFile(updateConfigPath, 'utf8'))
    hasUpdateConfig =
      updateConfig?.provider === 'github' &&
      updateConfig?.owner === 'ZToolsCenter' &&
      updateConfig?.repo === 'ZTools'
  } catch {
    hasUpdateConfig = false
  }

  try {
    await fs.access(nsisInstallMarkerPath)
    hasNsisInstallMarker = true
  } catch {
    hasNsisInstallMarker = false
  }

  return validateWindowsInstall(
    process.versions.electron,
    installInfo,
    hasUpdateConfig,
    hasNsisInstallMarker
  )
}
