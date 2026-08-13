import { UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import globalInputManager from './globalInputManager.js'

const INPUT_CONSUMER = 'shortcut-fallback'

/**
 * Electron accelerator modifier name → uiohook keycode.
 */
const MODIFIER_NAME_TO_KEYCODE: Record<string, number> = {
  Alt: UiohookKey.Alt,
  Option: UiohookKey.Alt, // macOS alias
  Ctrl: UiohookKey.Ctrl,
  Control: UiohookKey.Ctrl, // alias
  Shift: UiohookKey.Shift,
  Super: UiohookKey.Meta,
  Command: UiohookKey.Meta, // alias
  Meta: UiohookKey.Meta // alias
}

/**
 * Right-side modifier keycodes → left-side equivalents.
 * uiohook-napi emits different keycodes for left and right modifier keys.
 * We normalize right-side variants to left-side for matching purposes,
 * matching the behavior of doubleTapManager.ts MODIFIER_KEYCODES.
 */
const RIGHT_TO_LEFT_MODIFIER: Record<number, number> = {
  [UiohookKey.AltRight]: UiohookKey.Alt,
  [UiohookKey.CtrlRight]: UiohookKey.Ctrl,
  [UiohookKey.ShiftRight]: UiohookKey.Shift,
  [UiohookKey.MetaRight]: UiohookKey.Meta
}

/** All modifier keycodes (both left and right) for strict matching check. */
const ALL_MODIFIER_KEYCODES = new Set([
  ...Object.values(MODIFIER_NAME_TO_KEYCODE),
  ...Object.keys(RIGHT_TO_LEFT_MODIFIER).map(Number)
])

/**
 * Electron accelerator main key name → uiohook keycode.
 * Covers letters, digits, function keys, and common special keys.
 */
const KEY_NAME_TO_KEYCODE: Record<string, number> = {
  // Letters
  A: UiohookKey.A,
  B: UiohookKey.B,
  C: UiohookKey.C,
  D: UiohookKey.D,
  E: UiohookKey.E,
  F: UiohookKey.F,
  G: UiohookKey.G,
  H: UiohookKey.H,
  I: UiohookKey.I,
  J: UiohookKey.J,
  K: UiohookKey.K,
  L: UiohookKey.L,
  M: UiohookKey.M,
  N: UiohookKey.N,
  O: UiohookKey.O,
  P: UiohookKey.P,
  Q: UiohookKey.Q,
  R: UiohookKey.R,
  S: UiohookKey.S,
  T: UiohookKey.T,
  U: UiohookKey.U,
  V: UiohookKey.V,
  W: UiohookKey.W,
  X: UiohookKey.X,
  Y: UiohookKey.Y,
  Z: UiohookKey.Z,
  // Digits (top row)
  '0': UiohookKey['0'],
  '1': UiohookKey['1'],
  '2': UiohookKey['2'],
  '3': UiohookKey['3'],
  '4': UiohookKey['4'],
  '5': UiohookKey['5'],
  '6': UiohookKey['6'],
  '7': UiohookKey['7'],
  '8': UiohookKey['8'],
  '9': UiohookKey['9'],
  // Function keys
  F1: UiohookKey.F1,
  F2: UiohookKey.F2,
  F3: UiohookKey.F3,
  F4: UiohookKey.F4,
  F5: UiohookKey.F5,
  F6: UiohookKey.F6,
  F7: UiohookKey.F7,
  F8: UiohookKey.F8,
  F9: UiohookKey.F9,
  F10: UiohookKey.F10,
  F11: UiohookKey.F11,
  F12: UiohookKey.F12,
  // Special keys
  Space: UiohookKey.Space,
  Tab: UiohookKey.Tab,
  Escape: UiohookKey.Escape,
  Esc: UiohookKey.Escape, // alias
  Backspace: UiohookKey.Backspace,
  Enter: UiohookKey.Enter,
  Return: UiohookKey.Enter, // alias
  Delete: UiohookKey.Delete,
  Insert: UiohookKey.Insert,
  Home: UiohookKey.Home,
  End: UiohookKey.End,
  PageUp: UiohookKey.PageUp,
  PageDown: UiohookKey.PageDown,
  // Arrow keys
  Up: UiohookKey.ArrowUp,
  Down: UiohookKey.ArrowDown,
  Left: UiohookKey.ArrowLeft,
  Right: UiohookKey.ArrowRight,
  // Symbols
  Comma: UiohookKey.Comma,
  Period: UiohookKey.Period,
  Slash: UiohookKey.Slash,
  Semicolon: UiohookKey.Semicolon,
  Equal: UiohookKey.Equal,
  Minus: UiohookKey.Minus,
  Backquote: UiohookKey.Backquote,
  BracketLeft: UiohookKey.BracketLeft,
  BracketRight: UiohookKey.BracketRight,
  Backslash: UiohookKey.Backslash,
  Quote: UiohookKey.Quote,
  // Numpad
  num0: UiohookKey.Numpad0,
  num1: UiohookKey.Numpad1,
  num2: UiohookKey.Numpad2,
  num3: UiohookKey.Numpad3,
  num4: UiohookKey.Numpad4,
  num5: UiohookKey.Numpad5,
  num6: UiohookKey.Numpad6,
  num7: UiohookKey.Numpad7,
  num8: UiohookKey.Numpad8,
  num9: UiohookKey.Numpad9,
  numdec: UiohookKey.NumpadDecimal,
  numadd: UiohookKey.NumpadAdd,
  numsub: UiohookKey.NumpadSubtract,
  nummult: UiohookKey.NumpadMultiply,
  numdiv: UiohookKey.NumpadDivide,
  // PrintScreen
  PrintScreen: UiohookKey.PrintScreen
}

interface ParsedShortcut {
  /** Keycodes of required modifiers (must all be pressed) */
  modifierKeycodes: number[]
  /** Keycode of the main (non-modifier) key */
  mainKeycode: number
}

interface ShortcutEntry {
  parsed: ParsedShortcut
  callback: () => void
}

/**
 * Linux uiohook-based fallback for Electron's globalShortcut.
 *
 * When globalShortcut.register() fails on Linux (common on X11 due to
 * uiohook/XRecord conflicts, or on Wayland where globalShortcut is
 * unsupported), this module uses the existing uiohook-napi infrastructure
 * to detect key chords and fire callbacks.
 *
 * Uses the same GlobalInputManager consumer pattern as DoubleTapManager.
 */
class ShortcutFallbackDetector {
  /** Registered fallback shortcuts, keyed by accelerator string. */
  private shortcuts = new Map<string, ShortcutEntry>()

  /** Currently pressed keycodes (tracked across keydown/keyup). */
  private pressedKeys = new Set<number>()

  /** Whether listeners have been registered on globalInputManager. */
  private listenersRegistered = false

  // Bound handlers for stable listener references
  private boundHandleKeyDown = this.handleKeyDown.bind(this)
  private boundHandleKeyUp = this.handleKeyUp.bind(this)

  /**
   * Register a fallback shortcut. Returns true on success.
   * The accelerator string uses Electron format (e.g. "Alt+Space", "Ctrl+Shift+K").
   */
  register(accelerator: string, callback: () => void): boolean {
    const parsed = this.parseAccelerator(accelerator)
    if (!parsed) {
      console.error(`[ShortcutFallback] 无法解析快捷键: ${accelerator}`)
      return false
    }

    this.shortcuts.set(accelerator, { parsed, callback })
    this.ensureStarted()

    console.log(`[ShortcutFallback] 注册快捷键: ${accelerator}`)
    return true
  }

  /**
   * Unregister a fallback shortcut.
   */
  unregister(accelerator: string): void {
    this.shortcuts.delete(accelerator)
    this.maybeStop()
  }

  /**
   * Unregister all fallback shortcuts.
   */
  unregisterAll(): void {
    this.shortcuts.clear()
    this.maybeStop()
  }

  /**
   * Parse an Electron accelerator string into uiohook modifier + main keycodes.
   * Returns null if parsing fails.
   *
   * Examples:
   *   "Alt+Space"    → { modifierKeycodes: [Alt], mainKeycode: Space }
   *   "Ctrl+Shift+K" → { modifierKeycodes: [Ctrl, Shift], mainKeycode: K }
   *   "Super+Escape" → { modifierKeycodes: [Meta], mainKeycode: Escape }
   */
  private parseAccelerator(accelerator: string): ParsedShortcut | null {
    const parts = accelerator.split('+')
    if (parts.length < 2) {
      // Single key shortcuts are not supported as global shortcuts
      return null
    }

    const modifierKeycodes: number[] = []
    let mainKeycode: number | null = null

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1

      if (!isLast) {
        // Treat as modifier
        const modKeycode = MODIFIER_NAME_TO_KEYCODE[part]
        if (modKeycode === undefined) {
          console.error(`[ShortcutFallback] 未知修饰键: ${part} (accelerator: ${accelerator})`)
          return null
        }
        modifierKeycodes.push(modKeycode)
      } else {
        // Last part is the main key
        const keycode = KEY_NAME_TO_KEYCODE[part]
        if (keycode === undefined) {
          console.error(`[ShortcutFallback] 未知按键: ${part} (accelerator: ${accelerator})`)
          return null
        }
        mainKeycode = keycode
      }
    }

    if (mainKeycode === null) {
      return null
    }

    return { modifierKeycodes, mainKeycode }
  }

  /**
   * Check if a parsed shortcut matches the current set of pressed keys.
   * Requires:
   *  - All required modifier keys are pressed
   *  - The main key is pressed
   *  - No extra modifier keys are pressed (strict matching)
   */
  private matchShortcut(parsed: ParsedShortcut, pressed: Set<number>): boolean {
    // Normalize right-side modifier keys to left-side equivalents
    // (e.g., AltRight → Alt, CtrlRight → Ctrl)
    const normalized = new Set<number>()
    for (const kc of pressed) {
      normalized.add(RIGHT_TO_LEFT_MODIFIER[kc] ?? kc)
    }

    // Main key must be pressed
    if (!normalized.has(parsed.mainKeycode)) {
      return false
    }

    // All required modifiers must be pressed
    for (const modKeycode of parsed.modifierKeycodes) {
      if (!normalized.has(modKeycode)) {
        return false
      }
    }

    // No extra modifier keys may be pressed (strict matching)
    for (const pressedKeycode of normalized) {
      if (pressedKeycode === parsed.mainKeycode) continue
      if (parsed.modifierKeycodes.includes(pressedKeycode)) continue
      if (ALL_MODIFIER_KEYCODES.has(pressedKeycode)) {
        // An extra modifier is held — don't match (e.g., Ctrl held during Alt+Space)
        return false
      }
    }

    return true
  }

  private handleKeyDown(e: UiohookKeyboardEvent): void {
    this.pressedKeys.add(e.keycode)

    // Debug: log key events periodically to confirm the listener is working
    if (this.shortcuts.size > 0) {
      const now = Date.now()
      if (!this._lastDebugLogTime || now - this._lastDebugLogTime > 3000) {
        this._lastDebugLogTime = now
        const pressedStr = [...this.pressedKeys].map((k) => `0x${k.toString(16)}`).join(',')
        console.log(
          `[ShortcutFallback] 监听中，已注册 ${this.shortcuts.size} 个快捷键:`,
          [...this.shortcuts.keys()].join(', '),
          `当前按下: [${pressedStr}]`
        )
      }
    }

    // Check all registered shortcuts
    for (const [accelerator, entry] of this.shortcuts) {
      if (this.matchShortcut(entry.parsed, this.pressedKeys)) {
        console.log(`[ShortcutFallback] ✅ 快捷键匹配成功: ${accelerator}`)
        // Defer callback to avoid uiohook event-handler reentrancy
        // (same pattern as doubleTapManager.fireHandlers)
        const cb = entry.callback
        setTimeout(() => {
          try {
            cb()
          } catch (error) {
            console.error(`[ShortcutFallback] 回调执行失败 (${accelerator}):`, error)
          }
        }, 0)
      }
    }
  }

  private _lastDebugLogTime: number | undefined

  private handleKeyUp(e: UiohookKeyboardEvent): void {
    this.pressedKeys.delete(e.keycode)
  }

  private ensureStarted(): void {
    if (this.listenersRegistered) return

    this.listenersRegistered = true
    globalInputManager.on(INPUT_CONSUMER, 'keydown', this.boundHandleKeyDown)
    globalInputManager.on(INPUT_CONSUMER, 'keyup', this.boundHandleKeyUp)

    if (globalInputManager.acquire(INPUT_CONSUMER)) {
      console.log('[ShortcutFallback] 全局键盘监听已启动')
    } else {
      this.listenersRegistered = false
      console.error('[ShortcutFallback] 启动全局键盘监听失败')
    }
  }

  private maybeStop(): void {
    if (this.shortcuts.size > 0) return

    globalInputManager.release(INPUT_CONSUMER)
    this.listenersRegistered = false
    this.pressedKeys.clear()
    console.log('[ShortcutFallback] 全局键盘监听已停止（无快捷键注册）')
  }
}

export default new ShortcutFallbackDetector()
