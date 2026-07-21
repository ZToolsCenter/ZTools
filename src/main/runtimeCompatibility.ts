export const EXPECTED_ELECTRON_VERSION = __ZTOOLS_TARGET_ELECTRON_VERSION__
export const FULL_INSTALL_RELEASE_URL = 'https://github.com/ZToolsCenter/ZTools/releases/latest'

export interface RuntimeCompatibilityInput {
  platform: NodeJS.Platform
  isPackaged: boolean
  runtimeElectronVersion: string
  expectedElectronVersion?: string
}

export interface RuntimeCompatibilityResult {
  compatible: boolean
  blocked: boolean
  reason?: string
}

export function checkRuntimeCompatibility({
  platform,
  isPackaged,
  runtimeElectronVersion,
  expectedElectronVersion = EXPECTED_ELECTRON_VERSION
}: RuntimeCompatibilityInput): RuntimeCompatibilityResult {
  if (!isPackaged || (platform !== 'win32' && platform !== 'darwin')) {
    return { compatible: true, blocked: false }
  }

  if (runtimeElectronVersion === expectedElectronVersion) {
    return { compatible: true, blocked: false }
  }

  return {
    compatible: false,
    blocked: true,
    reason: `Electron 版本不匹配（当前 ${runtimeElectronVersion}，需要 ${expectedElectronVersion}）`
  }
}
