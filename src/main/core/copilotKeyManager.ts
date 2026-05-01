/**
 * Windows Copilot 键管理器
 *
 * Windows Copilot 键在系统层面被映射为 Win+Shift+F23 组合键。
 * 本管理器使用原生 C++ addon (copilot_hook.node) 注册 WH_KEYBOARD_LL
 * 低级键盘钩子来拦截该组合键，使其触发 ZTools 而非 Windows 默认的
 * Copilot 侧边栏/搜索窗口。
 *
 * 技术说明：
 * - Copilot 键是 2024 年起新款键盘（如 Surface Pro 10 等）上的专用按键
 * - Windows 系统将其映射为 Shift + Win + F23
 * - 系统对该组合键的响应优先级很高，会强制启动 ShellExperienceHost.exe
 * - 通过 WH_KEYBOARD_LL 级别钩子在 C++ 层同步拦截并返回 1 截断按键消息
 * - C++ 层同步返回 1 不经过 JS 引擎，不会触发 Windows 的低级钩子超时限制
 * - 截断后系统不再处理该按键，从而阻止 Copilot 侧边栏/搜索窗口弹出
 * - 仅在 Windows 平台上启用
 *
 * 额外保险措施：
 * - C++ 层在检测到 Copilot 键时，会注入一个无效按键 (keybd_event VK_NONAME)
 *   破坏系统对 Win+... 组合键的识别序列
 * - 即使 return 1 被系统忽略，这也能阻止搜索窗口弹出
 *
 * 注意：在某些 Windows 版本中，系统可能仍然会先于应用处理该组合键。
 * 如果拦截不生效，可能需要以管理员权限运行应用。
 */

// 使用 Vite ?asset 静态导入获取 .node 文件路径（构建期转换为实际路径字符串）
import copilotHookAssetPath from '../../../resources/lib/win/copilot_hook.node?asset'

// 加载原生 addon
let copilotHook: { startHook: (cb: () => void) => boolean; stopHook: () => boolean } | null =
  null

if (process.platform === 'win32') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    copilotHook = require(copilotHookAssetPath)
    console.log('[CopilotKeyManager] 原生 addon 加载成功')
  } catch (error) {
    console.warn('[CopilotKeyManager] 原生 addon 加载失败:', error)
  }
}

interface CopilotKeyHandler {
  callback: () => void
}

class CopilotKeyManager {
  private handler: CopilotKeyHandler | null = null
  private hookInstalled = false

  /**
   * 注册 Copilot 键回调
   * @param callback 按下 Copilot 键时触发的回调
   */
  register(callback: () => void): void {
    // 仅在 Windows 平台启用
    if (process.platform !== 'win32') {
      console.log('[CopilotKeyManager] 非 Windows 平台，跳过 Copilot 键注册')
      return
    }

    if (!copilotHook) {
      console.warn('[CopilotKeyManager] 原生 addon 不可用，无法拦截 Copilot 键')
      return
    }

    this.handler = { callback }

    if (!this.hookInstalled) {
      this.installHook()
    }

    console.log('[CopilotKeyManager] Copilot 键监听已注册 (Win+Shift+F23)')
  }

  /**
   * 注销 Copilot 键回调
   */
  unregister(): void {
    this.handler = null

    if (this.hookInstalled) {
      this.removeHook()
    }

    console.log('[CopilotKeyManager] Copilot 键监听已注销')
  }

  /**
   * 检查是否已注册
   */
  isRegistered(): boolean {
    return this.handler !== null
  }

  /**
   * 安装 WH_KEYBOARD_LL 钩子
   */
  private installHook(): void {
    if (!copilotHook) return

    try {
      const success = copilotHook.startHook(() => {
        console.log('[CopilotKeyManager] 检测到 Copilot 键 (Win+Shift+F23)，已拦截')
        if (this.handler) {
          try {
            this.handler.callback()
          } catch (error) {
            console.error('[CopilotKeyManager] 回调执行失败:', error)
          }
        }
      })

      if (success) {
        this.hookInstalled = true
        console.log('[CopilotKeyManager] WH_KEYBOARD_LL 钩子安装成功')
      } else {
        console.error('[CopilotKeyManager] 钩子安装失败')
      }
    } catch (error) {
      console.error('[CopilotKeyManager] 安装键盘钩子失败:', error)
    }
  }

  /**
   * 移除 WH_KEYBOARD_LL 钩子
   */
  private removeHook(): void {
    if (!copilotHook || !this.hookInstalled) return

    try {
      copilotHook.stopHook()
      this.hookInstalled = false
      console.log('[CopilotKeyManager] 键盘钩子已移除')
    } catch (error) {
      console.error('[CopilotKeyManager] 移除键盘钩子失败:', error)
    }
  }
}

export default new CopilotKeyManager()
