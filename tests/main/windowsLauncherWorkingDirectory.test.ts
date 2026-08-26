import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 回归测试：ZToolsCenter/ZTools#603
// 通过 ZTools 本地启动的程序应以其所在目录作为工作目录（对齐资源管理器双击行为），
// 否则子进程会继承 ZTools 主进程的 CWD（开机自启/提权时通常为 system32），
// 导致程序把相对路径解析到 C:\WINDOWS\system32 下而报权限错误。

const { mockLaunch, mockUwpLaunch, mockOpenPath, mockOpenExternal } = vi.hoisted(() => ({
  mockLaunch: vi.fn(async () => ({ success: true, hresult: 0, stage: 'launched' })),
  mockUwpLaunch: vi.fn(() => ({
    success: true,
    hresult: 0,
    foregroundHresult: 0,
    foregroundPermissionGranted: true,
    processId: 1234,
    stage: 'completed'
  })),
  mockOpenPath: vi.fn(async () => ''),
  mockOpenExternal: vi.fn(async () => undefined)
}))

vi.mock('child_process', () => ({ spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })) }))
vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn() },
  shell: { openPath: mockOpenPath, openExternal: mockOpenExternal }
}))
vi.mock('../../src/main/core/native', () => ({
  UwpManager: { launchUwpApp: mockUwpLaunch },
  WindowsShellLauncher: { launch: mockLaunch }
}))

import {
  launchApp,
  resolveLaunchWorkingDirectory
} from '../../src/main/core/commandLauncher/windowsLauncher'

describe('resolveLaunchWorkingDirectory', () => {
  it('返回带路径 .exe 的所在目录（Windows 语义）', () => {
    expect(resolveLaunchWorkingDirectory('C:\\Program Files\\MyApp\\app.exe')).toBe(
      'C:\\Program Files\\MyApp'
    )
  })

  it('保留含空格/中文的目录', () => {
    expect(resolveLaunchWorkingDirectory('D:\\软件 目录\\子目录\\tool.exe')).toBe(
      'D:\\软件 目录\\子目录'
    )
  })

  it('对 PATH 中的裸 exe（无分隔符）返回 undefined', () => {
    expect(resolveLaunchWorkingDirectory('notepad.exe')).toBeUndefined()
  })

  it('对 .lnk 返回 undefined（由快捷方式自身的起始目录决定）', () => {
    expect(resolveLaunchWorkingDirectory('C:\\Users\\Me\\Desktop\\App.lnk')).toBeUndefined()
  })

  it('对非 exe 目标返回 undefined', () => {
    expect(resolveLaunchWorkingDirectory('C:\\docs\\readme.txt')).toBeUndefined()
  })
})

describe('launchApp 传递工作目录 (#603)', () => {
  beforeEach(() => {
    mockLaunch.mockClear()
    mockUwpLaunch.mockClear()
    mockUwpLaunch.mockReturnValue({
      success: true,
      hresult: 0,
      foregroundHresult: 0,
      foregroundPermissionGranted: true,
      processId: 1234,
      stage: 'completed'
    })
    mockOpenPath.mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('启动带完整路径的 exe 时，向原生启动器传入 exe 所在目录作为 workingDirectory', async () => {
    await launchApp('C:\\Program Files\\MyApp\\app.exe')

    expect(mockLaunch).toHaveBeenCalledTimes(1)
    const opts = mockLaunch.mock.calls[0][0]
    expect(opts.target).toBe('C:\\Program Files\\MyApp\\app.exe')
    expect(opts.workingDirectory).toBe('C:\\Program Files\\MyApp')
  })

  it('启动使用正斜杠的完整路径 exe 时，向原生启动器传入 exe 所在目录作为 workingDirectory', async () => {
    await launchApp('C:/Program Files/MyApp/app.exe')

    expect(mockLaunch).toHaveBeenCalledTimes(1)
    const opts = mockLaunch.mock.calls[0][0]
    expect(opts.target).toBe('C:/Program Files/MyApp/app.exe')
    expect(opts.workingDirectory).toBe('C:/Program Files/MyApp')
  })

  it('启动 .lnk 时不覆盖 workingDirectory（保持 undefined）', async () => {
    await launchApp('C:\\Users\\Me\\Desktop\\App.lnk')

    expect(mockLaunch).toHaveBeenCalledTimes(1)
    const opts = mockLaunch.mock.calls[0][0]
    expect(opts.workingDirectory).toBeUndefined()
  })

  it.runIf(process.platform === 'win32')(
    'PATH 中的裸 exe 走 shell.openPath，不进入原生启动器',
    async () => {
      await launchApp('calc.exe')

      expect(mockLaunch).not.toHaveBeenCalled()
      expect(mockOpenPath).toHaveBeenCalledWith('calc.exe')
    }
  )
})

describe('launchApp 启动 UWP 应用', () => {
  beforeEach(() => {
    mockUwpLaunch.mockClear()
    mockUwpLaunch.mockReturnValue({
      success: true,
      hresult: 0,
      foregroundHresult: 0,
      foregroundPermissionGranted: true,
      processId: 1234,
      stage: 'completed'
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('原生激活成功时完成启动', async () => {
    await expect(
      launchApp('uwp:Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
    ).resolves.toBeUndefined()

    expect(mockUwpLaunch).toHaveBeenCalledWith('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
  })

  it('原生激活失败时抛出包含阶段和 HRESULT 的错误', async () => {
    mockUwpLaunch.mockReturnValue({
      success: false,
      hresult: 0x80070002,
      foregroundHresult: 0,
      foregroundPermissionGranted: true,
      processId: 0,
      stage: 'activate-application'
    })

    await expect(launchApp('uwp:missing!App')).rejects.toThrow(
      'UWP 激活失败: stage=activate-application, hresult=0x80070002'
    )
  })

  it('前台权限转交失败时仍保留成功启动结果', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockUwpLaunch.mockReturnValue({
      success: true,
      hresult: 0,
      foregroundHresult: 0x80070005,
      foregroundPermissionGranted: false,
      processId: 1234,
      stage: 'completed'
    })

    await expect(
      launchApp('uwp:Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(
      '[Launcher] UWP 已启动，但前台权限转交失败:',
      expect.objectContaining({
        foregroundHresultHex: '0x80070005',
        processId: 1234
      })
    )
  })
})
