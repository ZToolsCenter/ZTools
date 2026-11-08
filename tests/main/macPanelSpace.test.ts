import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isMacOS: true,
  anchors: [] as any[],
  createAnchor: vi.fn(),
  getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: -1728, y: 254 } }))
}))

vi.mock('@electron-toolkit/utils', () => ({ platform: mocks }))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function (options) {
    return mocks.createAnchor(options)
  }),
  screen: { getDisplayNearestPoint: mocks.getDisplayNearestPoint }
}))

import { prepareMacPanelForShow } from '../../src/main/utils/macPanelSpace'

/**
 * 创建可记录迁移操作的原生面板替身，不启动 Electron 或访问用户数据。
 * @returns 包含迁移所需窗口方法的测试面板。
 */
function createPanel(): any {
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    getPosition: vi.fn(() => [-600, 800]),
    getOpacity: vi.fn(() => 0.8),
    getParentWindow: vi.fn(() => null),
    setParentWindow: vi.fn(),
    setOpacity: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn()
  }
}

describe('macOS panel Space migration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isMacOS = true
    mocks.anchors = []
    mocks.createAnchor.mockImplementation((options) => {
      const anchor = {
        options,
        setVisibleOnAllWorkspaces: vi.fn(),
        setAlwaysOnTop: vi.fn(),
        showInactive: vi.fn(),
        isDestroyed: vi.fn(() => false),
        destroy: vi.fn()
      }
      mocks.anchors.push(anchor)
      return anchor
    })
  })

  it('migrates on the target display with a fresh anchor and restores the independent panel', () => {
    const panel = createPanel()
    prepareMacPanelForShow(panel)
    prepareMacPanelForShow(panel)

    expect(mocks.anchors).toHaveLength(2)
    expect(mocks.anchors[0]).not.toBe(mocks.anchors[1])
    for (const anchor of mocks.anchors) {
      expect(anchor.options).toMatchObject({ x: -1728, y: 254, focusable: false, opacity: 0 })
      expect(anchor.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
      expect(anchor.destroy).toHaveBeenCalledTimes(1)
    }
    expect(panel.setOpacity.mock.calls).toEqual([[0], [0.8], [0], [0.8]])
    expect(panel.setParentWindow.mock.calls).toEqual([
      [mocks.anchors[0]],
      [null],
      [mocks.anchors[1]],
      [null]
    ])
    expect(panel.hide).toHaveBeenCalledTimes(2)
  })

  it('restores opacity and releases the anchor when native migration throws', () => {
    const panel = createPanel()
    panel.showInactive.mockImplementationOnce(() => {
      throw new Error('migration failed')
    })

    expect(() => prepareMacPanelForShow(panel)).toThrow('migration failed')
    expect(panel.setParentWindow).toHaveBeenLastCalledWith(null)
    expect(panel.setOpacity).toHaveBeenLastCalledWith(0.8)
    expect(mocks.anchors[0].destroy).toHaveBeenCalledTimes(1)
  })

  it('releases the anchor even if restoring the target window fails', () => {
    const panel = createPanel()
    panel.hide.mockImplementationOnce(() => {
      throw new Error('window closed')
    })

    expect(() => prepareMacPanelForShow(panel)).toThrow('window closed')
    expect(panel.setParentWindow).toHaveBeenLastCalledWith(null)
    expect(panel.setOpacity).toHaveBeenLastCalledWith(0.8)
    expect(mocks.anchors[0].destroy).toHaveBeenCalledTimes(1)
  })

  it('avoids moving an already visible panel or creating anchors on other platforms', () => {
    const panel = createPanel()
    panel.isVisible.mockReturnValue(true)
    prepareMacPanelForShow(panel)
    panel.isVisible.mockReturnValue(false)
    mocks.isMacOS = false
    prepareMacPanelForShow(panel)

    expect(mocks.createAnchor).not.toHaveBeenCalled()
    expect(panel.setOpacity).not.toHaveBeenCalled()
  })
})
