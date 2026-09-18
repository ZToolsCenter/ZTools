import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// uiohook-napi 是原生模块，测试环境不可加载：mock 成最小 EventEmitter 形态 + 必要的 keycode 常量
// （vi.hoisted 在顶层 import 初始化前运行，因此这里手写 on/off/emit 而不依赖 'events'）
const { mockUIOhook, UiohookKey } = vi.hoisted(() => {
  type Listener = (event: { keycode: number }) => void
  const handlers = new Map<string, Listener[]>()
  const mockUIOhook = {
    start: vi.fn(),
    stop: vi.fn(),
    on(event: string, listener: Listener) {
      const list = handlers.get(event) ?? []
      list.push(listener)
      handlers.set(event, list)
      return this
    },
    off(event: string, listener: Listener) {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((l) => l !== listener)
      )
      return this
    },
    emit(event: string, payload: { keycode: number }) {
      for (const listener of [...(handlers.get(event) ?? [])]) listener(payload)
    },
    removeAllListeners() {
      handlers.clear()
    }
  }
  return {
    mockUIOhook,
    UiohookKey: {
      Meta: 3675,
      MetaRight: 3676,
      Ctrl: 29,
      CtrlRight: 3613,
      Alt: 56,
      AltRight: 3640,
      Shift: 42,
      ShiftRight: 54,
      C: 46
    }
  }
})

vi.mock('uiohook-napi', () => ({ uIOhook: mockUIOhook, UiohookKey }))

const CTRL = UiohookKey.Ctrl
const CTRL_RIGHT = UiohookKey.CtrlRight
const KEY_C = UiohookKey.C

// 人手双击的物理特征：按住 >=10ms，两次间隔 >=50ms 且 <400ms
const HUMAN_HOLD = 40
const HUMAN_GAP = 120

describe('doubleTapManager 双击修饰键检测', () => {
  let doubleTapManager: typeof import('../../src/main/core/doubleTapManager').default
  let callback: ReturnType<typeof vi.fn>

  const keydown = (keycode: number): void => {
    mockUIOhook.emit('keydown', { keycode })
  }
  const keyup = (keycode: number): void => {
    mockUIOhook.emit('keyup', { keycode })
  }
  // 完整按击：按下 → 按住 holdMs → 抬起
  const tap = (keycode: number, holdMs = HUMAN_HOLD): void => {
    keydown(keycode)
    vi.advanceTimersByTime(holdMs)
    keyup(keycode)
  }
  // fireHandlers 用 setTimeout(0) 派发回调，需推进定时器才能观察到
  const flushCallbacks = (): void => {
    vi.advanceTimersByTime(1)
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    mockUIOhook.removeAllListeners()
    // globalInputManager 现在惰性 require 原生模块（加载失败不应让主进程崩溃），
    // 因此 vi.mock 拦不到它，改为在 import 之后显式注入替身。
    const globalInputManager = await import('../../src/main/core/globalInputManager')
    globalInputManager.setUiohookModuleForTesting({
      uIOhook: mockUIOhook,
      UiohookKey
    } as never)
    doubleTapManager = (await import('../../src/main/core/doubleTapManager')).default
    callback = vi.fn()
    doubleTapManager.register('Ctrl', callback)
  })

  afterEach(() => {
    doubleTapManager.unregisterAll()
    vi.useRealTimers()
  })

  it('正常节奏双击同一修饰键会触发回调', () => {
    tap(CTRL)
    vi.advanceTimersByTime(HUMAN_GAP)
    tap(CTRL)
    flushCallbacks()

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('两个孤立 keyup（RDP 注入的修饰键同步事件）不触发回调', () => {
    keyup(CTRL)
    vi.advanceTimersByTime(HUMAN_GAP)
    keyup(CTRL)
    flushCallbacks()

    expect(callback).not.toHaveBeenCalled()
  })

  it('0ms 的 down+up 对（注入的完整按击）不触发回调', () => {
    tap(CTRL, 0)
    vi.advanceTimersByTime(HUMAN_GAP)
    tap(CTRL, 0)
    flushCallbacks()

    expect(callback).not.toHaveBeenCalled()
  })

  it('左右 Ctrl 各按击一次不触发回调（不同物理键）', () => {
    tap(CTRL)
    vi.advanceTimersByTime(HUMAN_GAP)
    tap(CTRL_RIGHT)
    flushCallbacks()

    expect(callback).not.toHaveBeenCalled()
  })

  it('Ctrl+C 后快速单击 Ctrl 不触发回调', () => {
    // 组合键的常见释放顺序：先松 C，再松 Ctrl
    keydown(CTRL)
    vi.advanceTimersByTime(20)
    keydown(KEY_C)
    vi.advanceTimersByTime(20)
    keyup(KEY_C)
    vi.advanceTimersByTime(20)
    keyup(CTRL)

    vi.advanceTimersByTime(HUMAN_GAP)
    tap(CTRL)
    flushCallbacks()

    expect(callback).not.toHaveBeenCalled()
  })

  it('两次按击周期过短（keyup 间隔 <50ms）不触发回调', () => {
    // 间隔从上一次 keyup 量到本次 keyup：15ms 按住 + 10ms 抬起间隙 = 25ms
    tap(CTRL, 15)
    vi.advanceTimersByTime(10)
    tap(CTRL, 15)
    flushCallbacks()

    expect(callback).not.toHaveBeenCalled()
  })

  it('长按超过 300ms 不算 tap', () => {
    tap(CTRL, 400)
    vi.advanceTimersByTime(HUMAN_GAP)
    tap(CTRL)
    flushCallbacks()

    expect(callback).not.toHaveBeenCalled()
  })

  it('组合键后间隔足够的两次正常按击仍能触发', () => {
    keydown(CTRL)
    vi.advanceTimersByTime(20)
    keydown(KEY_C)
    vi.advanceTimersByTime(20)
    keyup(KEY_C)
    vi.advanceTimersByTime(20)
    keyup(CTRL)

    vi.advanceTimersByTime(HUMAN_GAP)
    tap(CTRL)
    vi.advanceTimersByTime(HUMAN_GAP)
    tap(CTRL)
    flushCallbacks()

    expect(callback).toHaveBeenCalledTimes(1)
  })
})
