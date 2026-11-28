import { describe, expect, it } from 'vitest'
import { formatShortcutForDisplay, toElectronAccelerator } from '../../src/shared/shortcut'

describe('shortcut platform conversion', () => {
  it('将 Windows 键转换为 Electron 的 Super 修饰键', () => {
    expect(toElectronAccelerator('Command+V', 'win32')).toBe('Super+V')
    expect(toElectronAccelerator('Ctrl+Command+Shift+V', 'win32')).toBe('Ctrl+Super+Shift+V')
  })

  it('保留 macOS 和 Linux 的快捷键表示', () => {
    expect(toElectronAccelerator('Command+V', 'darwin')).toBe('Command+V')
    expect(toElectronAccelerator('Meta+V', 'linux')).toBe('Meta+V')
  })

  it('将 Windows 快捷键显示为 Win', () => {
    expect(formatShortcutForDisplay('Command+V', 'win32')).toBe('Win+V')
    expect(formatShortcutForDisplay('Super+Shift+V', 'win32')).toBe('Win+Shift+V')
  })
})
