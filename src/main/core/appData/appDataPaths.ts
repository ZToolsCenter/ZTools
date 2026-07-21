import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'

export interface AppDataPathOptions {
  homeDir?: string
  legacyUserDataPath?: string
}

export interface ZToolsDataLayout {
  root: string
  lmdbRoot: string
  deviceLmdbPath: string
  accountsRoot: string
  defaultAccountLmdbPath: string
  pluginsPath: string
  avatarPath: string
  clipboardPath: string
  extendsPath: string
  tempPath: string
  logsPath: string
  legacyLmdbPath: string
  legacyUserDataPath: string
}

export function getZToolsRoot(options: AppDataPathOptions = {}): string {
  return path.join(options.homeDir || os.homedir(), '.ztools')
}

export function getLmdbRoot(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'lmdb')
}

export function getDeviceLmdbPath(options: AppDataPathOptions = {}): string {
  return path.join(getLmdbRoot(options), 'device')
}

export function getAccountsRoot(options: AppDataPathOptions = {}): string {
  return path.join(getLmdbRoot(options), 'accounts')
}

export function getDefaultAccountLmdbPath(options: AppDataPathOptions = {}): string {
  return path.join(getAccountsRoot(options), 'default')
}

export function getPluginsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'plugins')
}

export function getAvatarPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'avatar')
}

export function getClipboardPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'clipboard')
}

export function getExtendsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'extends')
}

export function getTempPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'temp')
}

export function getLogsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'logs')
}

export function getLegacyUserDataPath(options: AppDataPathOptions = {}): string {
  return options.legacyUserDataPath || getDefaultLegacyUserDataPath(options)
}

export function getLegacyLmdbPath(options: AppDataPathOptions = {}): string {
  return path.join(getLegacyUserDataPath(options), 'lmdb')
}

export function getZToolsDataLayout(options: AppDataPathOptions = {}): ZToolsDataLayout {
  return {
    root: getZToolsRoot(options),
    lmdbRoot: getLmdbRoot(options),
    deviceLmdbPath: getDeviceLmdbPath(options),
    accountsRoot: getAccountsRoot(options),
    defaultAccountLmdbPath: getDefaultAccountLmdbPath(options),
    pluginsPath: getPluginsPath(options),
    avatarPath: getAvatarPath(options),
    clipboardPath: getClipboardPath(options),
    extendsPath: getExtendsPath(options),
    tempPath: getTempPath(options),
    logsPath: getLogsPath(options),
    legacyLmdbPath: getLegacyLmdbPath(options),
    legacyUserDataPath: getLegacyUserDataPath(options)
  }
}

export function hasZToolsRoot(options: AppDataPathOptions = {}): boolean {
  return fs.existsSync(getZToolsRoot(options))
}

export function hasLegacyLmdb(options: AppDataPathOptions = {}): boolean {
  return fs.existsSync(getLegacyLmdbPath(options))
}

export function ensure3Layout(options: AppDataPathOptions = {}): ZToolsDataLayout {
  const layout = getZToolsDataLayout(options)
  fs.mkdirSync(layout.deviceLmdbPath, { recursive: true })
  fs.mkdirSync(layout.defaultAccountLmdbPath, { recursive: true })
  fs.mkdirSync(layout.pluginsPath, { recursive: true })
  fs.mkdirSync(layout.avatarPath, { recursive: true })
  fs.mkdirSync(layout.clipboardPath, { recursive: true })
  fs.mkdirSync(layout.extendsPath, { recursive: true })
  fs.mkdirSync(layout.tempPath, { recursive: true })
  fs.mkdirSync(layout.logsPath, { recursive: true })
  return layout
}

function getDefaultLegacyUserDataPath(options: AppDataPathOptions): string {
  if (process.env.ZTOOLS_LEGACY_USER_DATA_PATH) {
    return process.env.ZTOOLS_LEGACY_USER_DATA_PATH
  }
  try {
    const userData = app?.getPath?.('userData')
    if (userData) return userData
  } catch {
    // fall back to the production macOS path below
  }

  if (process.platform === 'darwin') {
    return path.join(options.homeDir || os.homedir(), 'Library', 'Application Support', 'ZTools')
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(options.homeDir || os.homedir(), 'AppData', 'Roaming'),
      'ZTools'
    )
  }
  return path.join(options.homeDir || os.homedir(), '.config', 'ZTools')
}
