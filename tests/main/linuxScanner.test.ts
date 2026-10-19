import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// linuxScanner → ../../utils/common → core/native/index → *.node?asset，
// vitest 无法解析原生模块，因此 mock 掉 common 中仅用的 extractAcronym。
vi.mock('../../src/main/utils/common', () => ({
  extractAcronym: (name: string) =>
    name
      .split(/[\s-]+/)
      .map((w) => w[0])
      .join('')
      .toLowerCase()
}))

// linuxScanner.scanApplications 依赖真实文件系统：
// - getLinuxDesktopPaths() 使用 os.homedir() + XDG_DATA_DIRS
// - Flatpak 目录会额外扫描硬编码的 /var/lib/flatpak/...（若存在）
// 因此本测试把 homedir 指到临时目录，并只断言「我们的 .desktop 被收集」，
// 不受测试机是否装有真实 Flatpak 应用影响。

let tempBase: string
let originalXdgDataDirs: string | undefined

beforeEach(() => {
  tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-linux-scan-'))
  originalXdgDataDirs = process.env.XDG_DATA_DIRS
  // 将 XDG_DATA_DIRS 指向临时目录，避免扫描真实 /usr/share
  process.env.XDG_DATA_DIRS = path.join(tempBase, 'share')
  // 将 homedir 重定向，使用户级/Flatpak 用户级目录落在临时目录内
  vi.spyOn(os, 'homedir').mockReturnValue(tempBase)
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalXdgDataDirs === undefined) {
    delete process.env.XDG_DATA_DIRS
  } else {
    process.env.XDG_DATA_DIRS = originalXdgDataDirs
  }
  fs.rmSync(tempBase, { recursive: true, force: true })
})

describe('linuxScanner 收集 Flatpak 符号链接 .desktop', () => {
  it('普通 .desktop 与符号链接 .desktop 都会被扫描到', async () => {
    // 用户级应用目录
    const userApps = path.join(tempBase, '.local', 'share', 'applications')
    fs.mkdirSync(userApps, { recursive: true })

    // 1) 普通 .desktop 文件
    fs.writeFileSync(
      path.join(userApps, 'normal.desktop'),
      `[Desktop Entry]
Type=Application
Name=Normal App
Exec=/usr/bin/normal
`
    )

    // 2) 模拟 Flatpak 导出：.desktop 是指向目录外真实文件的符号链接
    const targetsDir = path.join(tempBase, 'targets')
    fs.mkdirSync(targetsDir, { recursive: true })
    const targetFile = path.join(targetsDir, 'flatpak-app')
    fs.writeFileSync(
      targetFile,
      `[Desktop Entry]
Type=Application
Name=Flatpak App
Exec=flatpak run org.example.App
`
    )
    fs.symlinkSync(targetFile, path.join(userApps, 'org.example.App.desktop'))

    const { scanApplications } = await import('../../src/main/core/commandScanner/linuxScanner')
    const apps = await scanApplications()
    const names = apps.map((a) => a.name)

    expect(names).toContain('Normal App')
    expect(names).toContain('Flatpak App')
  })
})
