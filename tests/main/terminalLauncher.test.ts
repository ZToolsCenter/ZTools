import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockDbGet, mockSpawn, mockExecFile } = vi.hoisted(() => ({
  mockDbGet: vi.fn(),
  mockSpawn: vi.fn(),
  mockExecFile: vi.fn((...args: unknown[]) => {
    const cb = args[args.length - 1]
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' })
  })
}))

vi.mock('child_process', () => ({ spawn: mockSpawn, execFile: mockExecFile }))
vi.mock('../../src/main/api/shared/database', () => ({
  default: { dbGet: mockDbGet, dbPut: vi.fn() }
}))

import {
  getPresetOptions,
  resolvePreset,
  applyPathToArgs,
  parseCustomCommand,
  openInTerminal,
  escapePowerShellPath,
  escapeCmdPath,
  escapeAppleScriptString
} from '../../src/main/utils/terminalLauncher'

// ========== getPresetOptions ==========

describe('getPresetOptions', () => {
  it('macOS 含 系统默认/Ghostty/iTerm2/自定义', () => {
    const opts = getPresetOptions('darwin')
    expect(opts.map((o) => o.value)).toEqual(['default', 'ghostty', 'iterm2', 'custom'])
  })

  it('Linux 含 系统默认/gnome-terminal/konsole/xterm/自定义', () => {
    const opts = getPresetOptions('linux')
    expect(opts.map((o) => o.value)).toEqual([
      'default',
      'gnome-terminal',
      'konsole',
      'xterm',
      'custom'
    ])
  })

  it('Windows 含 系统默认/wt/powershell/cmd/自定义', () => {
    const opts = getPresetOptions('win32')
    expect(opts.map((o) => o.value)).toEqual(['default', 'wt', 'powershell', 'cmd', 'custom'])
  })

  it('未知平台返回空数组', () => {
    expect(getPresetOptions('freebsd')).toEqual([])
  })
})

// ========== resolvePreset ==========

describe('resolvePreset', () => {
  it('空值返回默认预设', () => {
    expect(resolvePreset(undefined, 'darwin')?.id).toBe('default')
  })

  it('custom 返回 null', () => {
    expect(resolvePreset('custom', 'darwin')).toBeNull()
  })

  it('有效 id 返回对应预设', () => {
    expect(resolvePreset('ghostty', 'darwin')?.id).toBe('ghostty')
  })

  it('无效 id 回退默认', () => {
    expect(resolvePreset('nonexistent', 'darwin')?.id).toBe('default')
  })

  it('id 在当前平台不存在时回退默认', () => {
    expect(resolvePreset('ghostty', 'win32')?.id).toBe('default')
  })

  it('未知平台返回 null', () => {
    expect(resolvePreset(undefined, 'freebsd')).toBeNull()
  })
})

// ========== applyPathToArgs ==========

describe('applyPathToArgs', () => {
  it('替换 {path} 占位符', () => {
    expect(applyPathToArgs(['--working-directory={path}'], '/Users/x')).toEqual([
      '--working-directory=/Users/x'
    ])
  })

  it('多个占位符都替换', () => {
    expect(applyPathToArgs(['{path}', 'cd {path}'], '/p')).toEqual(['/p', 'cd /p'])
  })

  it('无占位符保持不变', () => {
    expect(applyPathToArgs(['-la'], '/p')).toEqual(['-la'])
  })
})

// ========== parseCustomCommand ==========

describe('parseCustomCommand', () => {
  it('解析命令与参数', () => {
    expect(parseCustomCommand('alacritty --working-directory={path}')).toEqual({
      command: 'alacritty',
      args: ['--working-directory={path}']
    })
  })

  it('处理引号包裹的参数（去除引号）', () => {
    expect(parseCustomCommand('open -na "Ghostty.app"')).toEqual({
      command: 'open',
      args: ['-na', 'Ghostty.app']
    })
  })

  it('空字符串/纯空白返回 null', () => {
    expect(parseCustomCommand('')).toBeNull()
    expect(parseCustomCommand('   ')).toBeNull()
  })
})

// ========== 路径转义（安全关键）==========

describe('escapePowerShellPath', () => {
  it('单引号包裹并将内部单引号翻倍', () => {
    expect(escapePowerShellPath("a'b")).toBe("'a''b'")
  })
  it('无单引号仅包裹', () => {
    expect(escapePowerShellPath('/Users/x')).toBe("'/Users/x'")
  })
})

describe('escapeCmdPath', () => {
  it('双引号包裹并转义内部双引号', () => {
    expect(escapeCmdPath('a"b')).toBe('"a^"b"')
  })
  it('无双引号仅包裹', () => {
    expect(escapeCmdPath('/Users/x')).toBe('"/Users/x"')
  })
})

describe('escapeAppleScriptString', () => {
  it('转义反斜杠和双引号', () => {
    expect(escapeAppleScriptString('a"b\\c')).toBe('a\\"b\\\\c')
  })
  it('无特殊字符保持不变', () => {
    expect(escapeAppleScriptString('/Users/x')).toBe('/Users/x')
  })
})

// ========== openInTerminal 编排分发 ==========

describe('openInTerminal 编排分发', () => {
  let originalPlatform: string
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawn.mockImplementation(() => ({ pid: 12345, unref: vi.fn(), on: vi.fn() }))
    // stub 为 darwin：使默认预设确定性走 AppleScript 路径（不 spawn），与宿主 OS 无关
    originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('预设 ghostty → spawn open 并替换 {path}', async () => {
    mockDbGet.mockReturnValue({ terminal: 'ghostty' })
    const ok = await openInTerminal('/Users/test/proj')
    expect(ok).toBe(true)
    expect(mockSpawn).toHaveBeenCalledWith(
      'open',
      ['-na', 'Ghostty.app', '--args', '--working-directory=/Users/test/proj'],
      expect.objectContaining({ detached: true })
    )
  })

  it('自定义命令 → 解析并替换 {path}', async () => {
    mockDbGet.mockReturnValue({
      terminal: 'custom',
      terminalCustomCommand: 'alacritty --working-directory={path}'
    })
    const ok = await openInTerminal('/my/dir')
    expect(ok).toBe(true)
    expect(mockSpawn).toHaveBeenCalledWith(
      'alacritty',
      ['--working-directory=/my/dir'],
      expect.objectContaining({ detached: true })
    )
  })

  it('自定义命令为空 → 回退默认（mac 走 applescript，不 spawn）', async () => {
    mockDbGet.mockReturnValue({ terminal: 'custom', terminalCustomCommand: '' })
    const ok = await openInTerminal('/x')
    expect(ok).toBe(true)
    expect(mockSpawn).not.toHaveBeenCalled()
    expect(mockExecFile).toHaveBeenCalled()
    // execFileAsync('osascript', ['-e', script]) → execFile(cmd, args, callback)
    expect(mockExecFile).toHaveBeenCalledWith(
      'osascript',
      expect.arrayContaining([expect.stringContaining('/x')]),
      expect.anything()
    )
  })
})
