import { describe, expect, it } from 'vitest'
import { shouldKeepMainWindowHiddenForLaunch } from '../../src/shared/pluginLaunch'

describe('plugin launch window visibility', () => {
  it('suppresses the main window for mainHide global shortcut launches', () => {
    expect(shouldKeepMainWindowHiddenForLaunch('global-shortcut', true)).toBe(true)
  })

  it('suppresses the main window for mainHide super panel launches', () => {
    expect(shouldKeepMainWindowHiddenForLaunch('super-panel', true)).toBe(true)
  })

  it('keeps ordinary search launches unchanged', () => {
    expect(shouldKeepMainWindowHiddenForLaunch('search', true)).toBe(false)
    expect(shouldKeepMainWindowHiddenForLaunch(undefined, true)).toBe(false)
  })

  it('does not suppress the main window when mainHide is disabled', () => {
    expect(shouldKeepMainWindowHiddenForLaunch('global-shortcut', false)).toBe(false)
    expect(shouldKeepMainWindowHiddenForLaunch('super-panel', false)).toBe(false)
  })
})
