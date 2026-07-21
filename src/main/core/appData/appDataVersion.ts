import fs from 'fs'
import path from 'path'
import { getZToolsRoot, type AppDataPathOptions } from './appDataPaths'

export const ZTOOLS_DATA_VERSION = '3.0.0'

export interface ZToolsDataVersion {
  version: string
  initializedAt: string
  importedFromLegacy: boolean
}

export function getVersionFilePath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'version.json')
}

export function readDataVersion(options: AppDataPathOptions = {}): ZToolsDataVersion | null {
  try {
    const filePath = getVersionFilePath(options)
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ZToolsDataVersion
  } catch {
    return null
  }
}

export function writeDataVersion(
  input: Partial<ZToolsDataVersion> = {},
  options: AppDataPathOptions = {}
): ZToolsDataVersion {
  const version: ZToolsDataVersion = {
    version: input.version || ZTOOLS_DATA_VERSION,
    initializedAt: input.initializedAt || new Date().toISOString(),
    importedFromLegacy: Boolean(input.importedFromLegacy)
  }
  const filePath = getVersionFilePath(options)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(version, null, 2))
  return version
}
