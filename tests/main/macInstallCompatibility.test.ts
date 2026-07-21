import { describe, expect, it } from 'vitest'
import {
  MAC_APP_ID,
  MAC_ELECTRON_VERSION,
  MAC_UPDATER_TYPE,
  validateMacInstall,
  type MacInstallInfo
} from '../../src/main/api/macInstallCompatibility'

const validInstallInfo: MacInstallInfo = {
  schemaVersion: 1,
  appId: MAC_APP_ID,
  electronVersion: MAC_ELECTRON_VERSION,
  updater: MAC_UPDATER_TYPE
}

describe('validateMacInstall', () => {
  it('accepts a complete signed installation with update configuration', () => {
    expect(validateMacInstall(MAC_ELECTRON_VERSION, validInstallInfo, true)).toMatchObject({
      compatible: true,
      migrationRequired: false,
      reasons: []
    })
  })

  it('requires migration for a legacy ASAR installation without marker', () => {
    const result = validateMacInstall(MAC_ELECTRON_VERSION, null, true)

    expect(result.migrationRequired).toBe(true)
    expect(result.reasons).toContain('缺少 macOS 完整安装标记')
  })

  it('requires migration when runtime and complete package versions differ', () => {
    const result = validateMacInstall('40.0.0', validInstallInfo, true)

    expect(result.migrationRequired).toBe(true)
    expect(result.reasons[0]).toContain('Electron 版本不匹配')
  })

  it('requires migration for incompatible identity or updater configuration', () => {
    const result = validateMacInstall(
      MAC_ELECTRON_VERSION,
      { ...validInstallInfo, appId: 'legacy.ztools', updater: 'legacy-asar' },
      false
    )

    expect(result.reasons).toContain('应用标识不匹配')
    expect(result.reasons).toContain('更新方式不兼容')
    expect(result.reasons).toContain('缺少 electron-updater 配置')
  })

  it('requires migration while running directly from a disk image', () => {
    const result = validateMacInstall(MAC_ELECTRON_VERSION, validInstallInfo, true, true)

    expect(result.migrationRequired).toBe(true)
    expect(result.reasons).toContain('应用正在 macOS 磁盘映像中运行')
  })
})
