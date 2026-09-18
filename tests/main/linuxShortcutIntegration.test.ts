import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { app } from 'electron'

// 该模块只用到 app.isPackaged / app.getAppPath，测试里不需要真实 Electron。
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/opt/ztools' }
}))

// 拦截 gsettings：记录调用参数，并让 get 返回可控的现有条目列表。
const mocks = vi.hoisted(() => ({
  calls: [] as string[][],
  getResult: "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']"
}))

vi.mock('child_process', () => ({
  execFileSync: (_cmd: string, args: string[]) => {
    mocks.calls.push(args)
    return args[0] === 'get' ? mocks.getResult : ''
  }
}))

const { toGnomeAccelerator, getToggleCommand, installGnomeShortcut } =
  await import('../../src/main/core/linuxShortcutIntegration')

describe('toGnomeAccelerator', () => {
  it('把 macOS 风格的 Option 映射为 <Alt>', () => {
    expect(toGnomeAccelerator('Option+Z')).toBe('<Alt>z')
  })

  it('把 Alt 映射为 <Alt> 并把主键小写', () => {
    expect(toGnomeAccelerator('Alt+Space')).toBe('<Alt>space')
  })

  it('把 Ctrl 映射为 <Primary>（跨桌面环境更通用）', () => {
    expect(toGnomeAccelerator('Ctrl+Space')).toBe('<Primary>space')
  })

  it('支持多个修饰键并保持顺序', () => {
    expect(toGnomeAccelerator('Ctrl+Shift+Z')).toBe('<Primary><Shift>z')
  })

  it('把 Command/Super 映射为 <Super>', () => {
    expect(toGnomeAccelerator('Command+Z')).toBe('<Super>z')
  })

  it('组合键顺序变化不影响结果', () => {
    expect(toGnomeAccelerator('Shift+Ctrl+Z')).toBe('<Shift><Primary>z')
  })

  it('双击修饰键（无主键）无法映射，返回 null', () => {
    expect(toGnomeAccelerator('Command+Command')).toBeNull()
    expect(toGnomeAccelerator('Ctrl+Ctrl')).toBeNull()
  })

  it('空字符串返回 null', () => {
    expect(toGnomeAccelerator('')).toBeNull()
  })
})

describe('getToggleCommand', () => {
  afterEach(() => {
    delete process.env.APPIMAGE
    app.isPackaged = false
  })

  it('开发模式下同时带上 electron 可执行文件与项目路径', () => {
    const command = getToggleCommand()
    expect(command).toContain('--toggle')
    expect(command).toContain('/opt/ztools')
    // 路径含空格时必须加引号，否则 GNOME 按空格切分参数
    expect(command.startsWith('"')).toBe(true)
  })

  it('打包后只用可执行文件本身', () => {
    app.isPackaged = true
    const command = getToggleCommand()
    expect(command).toContain('--toggle')
    expect(command).not.toContain('/opt/ztools')
  })

  it('AppImage 下改用 APPIMAGE 的持久路径而非临时挂载点', () => {
    app.isPackaged = true
    process.env.APPIMAGE = '/home/u/Apps/ZTools.AppImage'

    const command = getToggleCommand()

    // execPath 在 AppImage 里是 /tmp/.mount_xxx，退出即失效，必须优先用 APPIMAGE
    expect(command).toBe('"/home/u/Apps/ZTools.AppImage" --toggle')
    expect(command).not.toContain('/tmp/.mount_')
  })
})

describe('installGnomeShortcut 写入 gsettings 的转义', () => {
  beforeEach(() => {
    mocks.calls.length = 0
    mocks.getResult =
      "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']"
    // isGnomeDesktop 依赖该环境变量，显式固定以免受运行环境影响
    process.env.XDG_CURRENT_DESKTOP = 'ubuntu:GNOME'
  })

  it('command 值被包成 GVariant 字符串字面量', () => {
    installGnomeShortcut('Option+Z')

    const commandCall = mocks.calls.find((args) => args[2] === 'command')
    expect(commandCall).toBeDefined()
    const value = commandCall![3]

    // gsettings 把值当 GVariant 解析：命令里的路径引号会让它报
    // `expected end of input`，因此整体必须再包一层单引号。
    expect(value.startsWith("'")).toBe(true)
    expect(value.endsWith("'")).toBe(true)
    expect(value).toContain('--toggle')
    expect(value).toMatch(/^'"/)
  })

  it('把新条目追加到已有列表，且使用未被占用的槽位', () => {
    installGnomeShortcut('Option+Z')

    // 注意排除读取现有列表的那次 get 调用（args[2] 同样是 custom-keybindings）
    const listCall = mocks.calls.find(
      (args) => args[0] === 'set' && args[2] === 'custom-keybindings'
    )
    expect(listCall).toBeDefined()
    // custom0 已存在，新条目应是 custom1，且 custom0 必须保留
    expect(listCall![3]).toContain('custom0')
    expect(listCall![3]).toContain('custom1')
  })

  it('双击修饰键无法映射为系统快捷键时给出可读原因且不写入设置', () => {
    const result = installGnomeShortcut('Command+Command')

    expect(result.success).toBe(false)
    expect(result.message).toContain('双击修饰键')
    expect(mocks.calls).toHaveLength(0)
  })

  it('非 GNOME 桌面直接返回可手动执行的命令', () => {
    process.env.XDG_CURRENT_DESKTOP = 'KDE'

    const result = installGnomeShortcut('Option+Z')

    expect(result.success).toBe(false)
    expect(result.message).toContain('--toggle')
    expect(mocks.calls).toHaveLength(0)
  })
})
