import { app } from 'electron'
import { getZToolsRoot } from './appDataPaths'

const LEGACY_USER_DATA_ENV = 'ZTOOLS_LEGACY_USER_DATA_PATH'

export function configureAppDataRoot(): void {
  if (!process.env[LEGACY_USER_DATA_ENV]) {
    process.env[LEGACY_USER_DATA_ENV] = app.getPath('userData')
  }
  const root = getZToolsRoot()
  if (app.getPath('userData') !== root) {
    app.setPath('userData', root)
  }
}

configureAppDataRoot()
