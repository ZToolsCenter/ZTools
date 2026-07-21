import { UiohookKey } from 'uiohook-napi'
import globalInputManager from './globalInputManager.js'

interface DoubleTapHandler {
  modifier: string
  callback: () => void
}

const INPUT_CONSUMER = 'double-tap'

// uiohook keycode → 修饰键名称映射
const MODIFIER_KEYCODES: Record<number, string> = {
  [UiohookKey.Meta]: 'Command',
  [UiohookKey.MetaRight]: 'Command',
  [UiohookKey.Ctrl]: 'Ctrl',
  [UiohookKey.CtrlRight]: 'Ctrl',
  [UiohookKey.Alt]: 'Alt',
  [UiohookKey.AltRight]: 'Alt',
  [UiohookKey.Shift]: 'Shift',
  [UiohookKey.ShiftRight]: 'Shift'
}

// macOS 下 Option 与 Alt 是同一物理键，统一规范化为 'Alt'
function normalizeModifier(modifier: string): string {
  return modifier === 'Option' ? 'Alt' : modifier
}

/**
 * 双击修饰键检测管理器
 * 使用 uiohook-napi 全局监听键盘事件，检测修饰键的双击模式
 */
class DoubleTapManager {
  private handlers: DoubleTapHandler[] = []
  private lastModifierUp: { modifier: string; time: number } | null = null
  private nonModifierPressed = false
  private started = false
  private listenersRegistered = false
  private pressedKeycodes = new Set<number>()
  private allKeysReleasedWaiters = new Set<() => void>()
  private modifierKeysReleasedWaiters = new Set<(released: boolean) => void>()
  private keepAliveCount = 0

  // 双击最大间隔（毫秒）
  private readonly DOUBLE_TAP_INTERVAL = 400
  // 单次按键最大持续时间（超过则视为长按，非 tap）
  private readonly MAX_TAP_DURATION = 300
  private modifierDownTime = 0

  /**
   * 注册双击修饰键回调
   * @param modifier 修饰键名称（如 "Command"、"Ctrl"）
   * @param callback 双击时触发的回调
   */
  register(modifier: string, callback: () => void): void {
    this.handlers.push({ modifier: normalizeModifier(modifier), callback })
    this.ensureStarted()
  }

  /**
   * 注销指定修饰键的所有回调
   */
  unregister(modifier: string): void {
    const normalized = normalizeModifier(modifier)
    this.handlers = this.handlers.filter((h) => h.modifier !== normalized)
    this.maybeStop()
  }

  /**
   * 注销所有回调并停止监听
   */
  unregisterAll(): void {
    this.handlers = []
    this.maybeStop()
  }

  /**
   * 临时保持全局键盘监听开启。
   * 用于需要感知按键释放时机但并未注册双击回调的场景。
   */
  acquireKeyboardState(): () => void {
    this.keepAliveCount += 1
    this.ensureStarted()

    return () => {
      this.keepAliveCount = Math.max(0, this.keepAliveCount - 1)
      this.maybeStop()
    }
  }

  /**
   * 等待当前所有按下的按键全部释放。
   * 若系统丢失了 keyup 事件，会在超时后继续，避免调用方永久挂起。
   */
  waitForAllKeysReleased(timeoutMs: number = 1000): Promise<void> {
    if (this.pressedKeycodes.size === 0) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        this.allKeysReleasedWaiters.delete(wrappedResolve)
        resolve()
      }, timeoutMs)

      const wrappedResolve = (): void => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        resolve()
      }

      this.allKeysReleasedWaiters.add(wrappedResolve)
    })
  }

  /**
   * 等待当前所有修饰键释放。
   * 全局快捷键触发后先等修饰键抬起，再模拟复制，避免修饰键影响 getSelectedContent。
   */
  waitForModifierKeysReleased(timeoutMs: number = 1000): Promise<boolean> {
    if (!this.hasPressedModifierKey()) {
      return Promise.resolve(true)
    }

    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        this.modifierKeysReleasedWaiters.delete(wrappedResolve)
        resolve(false)
      }, timeoutMs)

      const wrappedResolve = (released: boolean): void => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        resolve(released)
      }

      this.modifierKeysReleasedWaiters.add(wrappedResolve)
    })
  }

  private ensureStarted(): void {
    if (this.started) return
    this.started = true

    // 只注册一次事件监听器，避免重复注册导致事件多次触发
    if (!this.listenersRegistered) {
      this.listenersRegistered = true
      globalInputManager.on(INPUT_CONSUMER, 'keydown', (e) => this.handleKeyDown(e))
      globalInputManager.on(INPUT_CONSUMER, 'keyup', (e) => this.handleKeyUp(e))
    }

    if (globalInputManager.acquire(INPUT_CONSUMER)) {
      console.log('[DoubleTapManager] 全局键盘监听已启动')
    } else {
      this.started = false
    }
  }

  /**
   * 停止双击检测监听并释放所有等待按键抬起的调用方。
   */
  private stop(): void {
    if (!this.started) return
    globalInputManager.release(INPUT_CONSUMER)
    console.log('[DoubleTapManager] 全局键盘监听已停止')
    this.started = false
    this.listenersRegistered = false
    this.lastModifierUp = null
    this.nonModifierPressed = false
    this.modifierDownTime = 0
    this.pressedKeycodes.clear()
    this.resolveAllKeysReleasedWaiters()
    this.resolveModifierKeysReleasedWaiters(false)
  }

  private maybeStop(): void {
    if (this.handlers.length === 0 && this.keepAliveCount === 0) {
      this.stop()
    }
  }

  private handleKeyDown(e: { keycode: number }): void {
    if (!this.started) return

    this.pressedKeycodes.add(e.keycode)

    const modifier = MODIFIER_KEYCODES[e.keycode]
    if (modifier) {
      if (this.modifierDownTime === 0) {
        this.modifierDownTime = Date.now()
      }
    } else {
      // 非修饰键被按下，重置双击检测状态
      this.nonModifierPressed = true
      this.lastModifierUp = null
    }
  }

  /**
   * 处理全局 keyup 事件，维护按键状态并触发双击修饰键回调。
   */
  private handleKeyUp(e: { keycode: number }): void {
    if (!this.started) return

    this.pressedKeycodes.delete(e.keycode)
    if (this.pressedKeycodes.size === 0) {
      this.resolveAllKeysReleasedWaiters()
    }
    if (!this.hasPressedModifierKey()) {
      this.resolveModifierKeysReleasedWaiters()
    }

    const modifier = MODIFIER_KEYCODES[e.keycode]
    if (!modifier) {
      this.nonModifierPressed = false
      this.modifierDownTime = 0
      return
    }

    const now = Date.now()

    // 如果按键时间过长（长按），不算作 tap
    if (this.modifierDownTime > 0 && now - this.modifierDownTime > this.MAX_TAP_DURATION) {
      this.modifierDownTime = 0
      this.lastModifierUp = null
      return
    }
    this.modifierDownTime = 0

    // 如果期间有非修饰键按下，不算 tap
    if (this.nonModifierPressed) {
      this.nonModifierPressed = false
      this.lastModifierUp = null
      return
    }

    // 检查是否为双击
    if (
      this.lastModifierUp &&
      this.lastModifierUp.modifier === modifier &&
      now - this.lastModifierUp.time < this.DOUBLE_TAP_INTERVAL
    ) {
      this.lastModifierUp = null
      this.fireHandlers(modifier)
      return
    }

    // 记录为第一次 tap
    this.lastModifierUp = { modifier, time: now }
  }

  /**
   * 判断当前是否仍有修饰键处于按下状态。
   */
  private hasPressedModifierKey(): boolean {
    for (const keycode of this.pressedKeycodes) {
      if (MODIFIER_KEYCODES[keycode]) {
        return true
      }
    }
    return false
  }

  /**
   * 释放等待全部按键抬起的调用方。
   */
  private resolveAllKeysReleasedWaiters(): void {
    if (this.allKeysReleasedWaiters.size === 0) {
      return
    }

    for (const resolve of this.allKeysReleasedWaiters) {
      resolve()
    }
    this.allKeysReleasedWaiters.clear()
  }

  /**
   * 释放等待修饰键抬起的调用方。
   */
  private resolveModifierKeysReleasedWaiters(released: boolean = true): void {
    if (this.modifierKeysReleasedWaiters.size === 0) {
      return
    }

    for (const resolve of this.modifierKeysReleasedWaiters) {
      resolve(released)
    }
    this.modifierKeysReleasedWaiters.clear()
  }

  private fireHandlers(modifier: string): void {
    for (const handler of this.handlers) {
      if (handler.modifier === modifier) {
        // 避免在 uiohook 的 keyup 调用栈里直接 show/focus 窗口，降低 Windows 焦点竞争概率。
        setTimeout(() => {
          if (!this.started) return

          try {
            handler.callback()
          } catch (error) {
            console.error(`[DoubleTapManager] 回调执行失败 (${modifier}):`, error)
          }
        }, 0)
      }
    }
  }
}

export default new DoubleTapManager()
