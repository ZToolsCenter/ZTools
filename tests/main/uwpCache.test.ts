import { describe, expect, it, vi } from 'vitest'
import {
  decodeZToolsIconPath,
  hasStaleUwpIconCache,
  hasUwpPackageSnapshotChanged
} from '../../src/main/core/commandScanner/uwpCache'

describe('UWP 应用缓存校验', () => {
  it('解码 ztools-icon 协议中的 Windows 绝对路径', () => {
    const iconPath =
      'C:\\Program Files\\WindowsApps\\HillsLite_2.0.0.0_x64__publisher\\Assets\\Logo.png'

    expect(decodeZToolsIconPath(`ztools-icon://${encodeURIComponent(iconPath)}`)).toBe(iconPath)
  })

  it('缓存图标仍存在时保持缓存有效', () => {
    const fileExists = vi.fn(() => true)
    const iconPath = 'C:\\Program Files\\WindowsApps\\HillsLite_2.0.0.0\\Logo.png'

    expect(
      hasStaleUwpIconCache(
        [
          {
            path: 'uwp:HillsLite_publisher!App',
            icon: `ztools-icon://${encodeURIComponent(iconPath)}`
          }
        ],
        fileExists
      )
    ).toBe(false)
    expect(fileExists).toHaveBeenCalledWith(iconPath)
  })

  it('商店更新删除旧版本目录后判定缓存失效', () => {
    const fileExists = vi.fn(() => false)
    const oldIconPath =
      'C:\\Program Files\\WindowsApps\\HillsLite_1.0.0.0_x64__publisher\\Assets\\Logo.png'

    expect(
      hasStaleUwpIconCache(
        [
          {
            path: 'uwp:HillsLite_publisher!App',
            icon: `ztools-icon://${encodeURIComponent(oldIconPath)}`
          }
        ],
        fileExists
      )
    ).toBe(true)
  })

  it('普通快捷方式图标缺失不由 UWP 校验处理', () => {
    expect(
      hasStaleUwpIconCache(
        [{ path: 'C:\\Start Menu\\App.lnk', icon: 'ztools-icon://missing' }],
        () => false
      )
    ).toBe(false)
  })

  it('包快照忽略枚举顺序差异', () => {
    expect(
      hasUwpPackageSnapshotChanged(
        ['Package.B_1.0.0.0_x64__publisher', 'Package.A_1.0.0.0_x64__publisher'],
        ['Package.A_1.0.0.0_x64__publisher', 'Package.B_1.0.0.0_x64__publisher']
      )
    ).toBe(false)
  })

  it('离线安装、更新或卸载导致包快照变化', () => {
    expect(
      hasUwpPackageSnapshotChanged(
        ['HillsLite_1.0.0.0_x64__publisher'],
        ['HillsLite_2.0.0.0_x64__publisher']
      )
    ).toBe(true)
    expect(hasUwpPackageSnapshotChanged([], ['NewPackage_1.0.0.0_x64__publisher'])).toBe(true)
    expect(hasUwpPackageSnapshotChanged(['RemovedPackage_1.0.0.0_x64__publisher'], [])).toBe(true)
  })

  it('旧版本没有包快照时触发一次修复性扫描', () => {
    expect(hasUwpPackageSnapshotChanged(undefined, [])).toBe(true)
  })
})
