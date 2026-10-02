import { describe, expect, it } from 'vitest'
import {
  buildLoginItemSettings,
  buildWindowsDelayedStartupScript,
  buildWindowsStartupApprovedRegArgs,
  buildWindowsStartupScriptPath,
  isLaunchAtLoginActive,
  resolveDisplayedLaunchAtLogin,
  resolveStartupLaunchAtLoginSync
} from '../../src/main/core/launchAtLogin'

const windowsContext = {
  isPackaged: true,
  platform: 'win32' as const,
  execPath: 'C:\\Users\\demo\\AppData\\Local\\Programs\\ZTools\\ZTools.exe',
  appUserModelId: 'top.z-tools'
}

describe('buildLoginItemSettings', () => {
  it('does not write OS login items from an unpackaged process', () => {
    expect(
      buildLoginItemSettings(true, {
        ...windowsContext,
        isPackaged: false
      })
    ).toBeNull()
  })

  it('writes Windows Run and StartupApproved together with an explicit exe path', () => {
    expect(buildLoginItemSettings(true, windowsContext)).toEqual({
      openAtLogin: true,
      enabled: true,
      name: 'top.z-tools',
      path: windowsContext.execPath,
      args: []
    })
  })

  it('clears the Windows login item without leaving a disabled StartupApproved entry', () => {
    expect(buildLoginItemSettings(false, windowsContext)).toEqual({
      openAtLogin: false,
      name: 'top.z-tools',
      path: windowsContext.execPath,
      args: []
    })
  })

  it('registers the macOS main app service without the deprecated hidden flag', () => {
    expect(
      buildLoginItemSettings(true, {
        isPackaged: true,
        platform: 'darwin',
        execPath: '/Applications/ZTools.app/Contents/MacOS/ZTools'
      })
    ).toEqual({
      openAtLogin: true,
      type: 'mainAppService'
    })
  })
})

describe('isLaunchAtLoginActive', () => {
  it('treats a Windows Run key as inactive when StartupApproved has disabled it', () => {
    expect(
      isLaunchAtLoginActive(
        {
          openAtLogin: true,
          executableWillLaunchAtLogin: false,
          launchItems: [{ name: 'top.z-tools', enabled: false }]
        },
        'win32'
      )
    ).toBe(false)
  })

  it('treats Windows login as active only when the executable will actually launch', () => {
    expect(
      isLaunchAtLoginActive(
        {
          openAtLogin: true,
          executableWillLaunchAtLogin: true,
          launchItems: [{ name: 'top.z-tools', enabled: true }]
        },
        'win32'
      )
    ).toBe(true)
  })

  it('does not treat macOS requires-approval as an active login item', () => {
    expect(
      isLaunchAtLoginActive({ openAtLogin: false, status: 'requires-approval' }, 'darwin')
    ).toBe(false)
  })

  it('treats macOS SMAppService enabled as active', () => {
    expect(isLaunchAtLoginActive({ openAtLogin: true, status: 'enabled' }, 'darwin')).toBe(true)
  })
})

describe('resolveDisplayedLaunchAtLogin', () => {
  it('prefers the stored user preference over a stale OS disabled state', () => {
    expect(resolveDisplayedLaunchAtLogin(true, false)).toBe(true)
    expect(resolveDisplayedLaunchAtLogin(false, true)).toBe(false)
  })

  it('falls back to the OS active state when no preference has been stored', () => {
    expect(resolveDisplayedLaunchAtLogin(undefined, true)).toBe(true)
    expect(resolveDisplayedLaunchAtLogin(undefined, false)).toBe(false)
  })
})

describe('resolveStartupLaunchAtLoginSync', () => {
  it('re-applies a stored enabled preference so Windows can recover a disabled StartupApproved key', () => {
    expect(
      resolveStartupLaunchAtLoginSync(true, {
        openAtLogin: true,
        executableWillLaunchAtLogin: false
      })
    ).toEqual({ apply: true, enable: true })
  })

  it('re-applies a stored disabled preference so leftover OS login items stay off', () => {
    expect(
      resolveStartupLaunchAtLoginSync(false, {
        openAtLogin: true,
        executableWillLaunchAtLogin: true
      })
    ).toEqual({ apply: true, enable: false })
  })

  it('repairs a legacy enabled Run key that Windows has disabled before any preference was stored', () => {
    expect(
      resolveStartupLaunchAtLoginSync(undefined, {
        openAtLogin: true,
        executableWillLaunchAtLogin: false
      })
    ).toEqual({ apply: true, enable: true, persist: true })
  })

  it('migrates a working legacy login item into the stored preference and refreshes the registration', () => {
    expect(
      resolveStartupLaunchAtLoginSync(undefined, {
        openAtLogin: true,
        executableWillLaunchAtLogin: true
      })
    ).toEqual({ apply: true, enable: true, persist: true })
  })

  it('does nothing when the user never enabled login launch', () => {
    expect(
      resolveStartupLaunchAtLoginSync(undefined, {
        openAtLogin: false,
        executableWillLaunchAtLogin: false
      })
    ).toBeNull()
  })
})

describe('buildWindowsStartupApprovedRegArgs', () => {
  it('writes the Windows 11 enable binary after Electron deletes StartupApproved', () => {
    expect(buildWindowsStartupApprovedRegArgs('top.z-tools', true)).toEqual({
      command: 'reg',
      args: [
        'add',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
        '/v',
        'top.z-tools',
        '/t',
        'REG_BINARY',
        '/d',
        '020000000000000000000000',
        '/f'
      ]
    })
  })

  it('deletes the StartupApproved value when login launch is turned off', () => {
    expect(buildWindowsStartupApprovedRegArgs('top.z-tools', false)).toEqual({
      command: 'reg',
      args: [
        'delete',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
        '/v',
        'top.z-tools',
        '/f'
      ]
    })
  })
})

describe('buildWindowsDelayedStartupScript', () => {
  const exePath = 'C:\\Program Files\\ZTools\\ZTools.exe'

  it('writes a hidden delayed launcher that starts the packaged exe from its own directory', () => {
    expect(buildWindowsDelayedStartupScript(exePath, 30000)).toBe(
      [
        'WScript.Sleep 30000',
        'Set sh = CreateObject("WScript.Shell")',
        'sh.CurrentDirectory = "C:\\Program Files\\ZTools"',
        'sh.Run """C:\\Program Files\\ZTools\\ZTools.exe""", 0, False',
        ''
      ].join('\r\n')
    )
  })
})

describe('buildWindowsStartupScriptPath', () => {
  it('places the delayed launcher in the current-user Startup folder', () => {
    expect(
      buildWindowsStartupScriptPath(
        'C:\\Users\\demo\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup'
      )
    ).toBe(
      'C:\\Users\\demo\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\ZTools-startup.vbs'
    )
  })
})
