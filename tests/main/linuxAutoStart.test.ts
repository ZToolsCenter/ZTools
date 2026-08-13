import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => `/mock/${name}`)
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: mocks.getPath
  }
}))

import { getLinuxLaunchAtLogin, setLinuxLaunchAtLogin } from '../../src/main/core/linuxAutoStart'

const tempDirectories: string[] = []

/**
 * 建立临时 home 目录，并让 electron app.getPath 指向它。
 * @returns 临时 home 目录路径
 */
function createFakeHome(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-autostart-'))
  tempDirectories.push(directory)
  mocks.getPath.mockImplementation((name: string) => {
    if (name === 'home') {
      return directory
    }
    if (name === 'exe') {
      return path.join(directory, 'ZTools')
    }
    return path.join(directory, name)
  })
  return directory
}

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.APPIMAGE
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('linuxAutoStart', () => {
  it('启用后递归创建自启目录并写入包含正确 Exec 的桌面条目', () => {
    const home = createFakeHome()

    setLinuxLaunchAtLogin(true)

    const desktopFile = path.join(home, '.config', 'autostart', 'ztools.desktop')
    expect(fs.existsSync(desktopFile)).toBe(true)
    const content = fs.readFileSync(desktopFile, 'utf8')
    expect(content).toContain('[Desktop Entry]')
    expect(content).toContain('Type=Application')
    expect(content).toContain('Name=ZTools')
    expect(content).toContain(`Exec="${path.join(home, 'ZTools')}"`)
    expect(content).toContain('Terminal=false')
    expect(content).toContain('StartupNotify=false')
    expect(content).toContain('X-GNOME-Autostart-enabled=true')
  })

  it('APPIMAGE 环境变量存在时 Exec 使用 AppImage 路径', () => {
    const home = createFakeHome()
    process.env.APPIMAGE = '/tmp/ZTools-3.1.0.AppImage'

    setLinuxLaunchAtLogin(true)

    const content = fs.readFileSync(
      path.join(home, '.config', 'autostart', 'ztools.desktop'),
      'utf8'
    )
    expect(content).toContain('Exec="/tmp/ZTools-3.1.0.AppImage"')
  })

  it('启用可覆盖已存在文件，关闭删除文件且文件缺失时为无操作', () => {
    const home = createFakeHome()
    const desktopFile = path.join(home, '.config', 'autostart', 'ztools.desktop')
    fs.mkdirSync(path.dirname(desktopFile), { recursive: true })
    fs.writeFileSync(desktopFile, 'stale content', 'utf8')

    setLinuxLaunchAtLogin(true)
    expect(fs.readFileSync(desktopFile, 'utf8')).toContain('[Desktop Entry]')

    setLinuxLaunchAtLogin(false)
    expect(fs.existsSync(desktopFile)).toBe(false)

    expect(() => setLinuxLaunchAtLogin(false)).not.toThrow()
  })

  it('读取状态：文件缺失为 false，启用后为 true，含禁用标记为 false', () => {
    const home = createFakeHome()
    const desktopFile = path.join(home, '.config', 'autostart', 'ztools.desktop')

    expect(getLinuxLaunchAtLogin()).toBe(false)

    setLinuxLaunchAtLogin(true)
    expect(getLinuxLaunchAtLogin()).toBe(true)

    fs.writeFileSync(desktopFile, 'X-GNOME-Autostart-enabled=false\n', 'utf8')
    expect(getLinuxLaunchAtLogin()).toBe(false)

    fs.writeFileSync(desktopFile, 'Hidden=true\n', 'utf8')
    expect(getLinuxLaunchAtLogin()).toBe(false)
  })
})
