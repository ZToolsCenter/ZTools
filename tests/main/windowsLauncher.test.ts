import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockShellLaunch, mockLaunchUwpApp } = vi.hoisted(() => ({
  mockShellLaunch: vi.fn(),
  mockLaunchUwpApp: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))
vi.mock('../../src/main/core/native', () => ({
  UwpManager: { launchUwpApp: mockLaunchUwpApp },
  WindowsShellLauncher: { launch: mockShellLaunch }
}))

import { launchApp } from '../../src/main/core/commandLauncher/windowsLauncher'

describe('Windows UWP 应用启动', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShellLaunch.mockResolvedValue({ success: true, hresult: 0, stage: 'test' })
    mockLaunchUwpApp.mockReturnValue(true)
  })

  it('通过 Explorer Shell 启动以获得正常的前台焦点交接', async () => {
    await launchApp('uwp:Microsoft.WindowsTerminal_8wekyb3d8bbwe!App')

    expect(mockShellLaunch).toHaveBeenCalledWith({
      target: 'shell:AppsFolder\\Microsoft.WindowsTerminal_8wekyb3d8bbwe!App',
      showCommand: 1
    })
    expect(mockLaunchUwpApp).not.toHaveBeenCalled()
  })

  it('Explorer Shell 启动失败时回退原生 UWP API', async () => {
    mockShellLaunch.mockResolvedValue({ success: false, hresult: -1, stage: 'execute' })

    await launchApp('uwp:Contoso.App_123!App')

    expect(mockLaunchUwpApp).toHaveBeenCalledWith('Contoso.App_123!App')
  })
})
