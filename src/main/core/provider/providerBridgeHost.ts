import type { ProviderType } from '@shared/providerShared'
import { ProviderBridge } from '../native'
import providerManager from './providerManager'

/**
 * Provider 桥接宿主：把原生层发起的 provider 调用透传到 providerManager。
 *
 * 原生业务（如 Windows 截图工具栏「翻译」按钮）在 native 线程上经桥接发起调用，
 * 这里按 type 白名单转发到 providerManager（沿用用户在设置页选择的默认渠道）：
 *   ocr        { image }          => { text, blocks: [{ text, left, top, right, bottom }] }
 *   translation { text }          => { text }
 * 契约细节见 ztools-native-api 仓库 README「截图翻译」。
 *
 * 桥接在主进程生命周期内常驻（原生模块无此能力时记日志跳过，不影响启动）。
 */

/** 允许经桥接调用的 provider 类型（与原生侧约定一致） */
const BRIDGE_PROVIDER_TYPES: ReadonlySet<string> = new Set<ProviderType>(['ocr', 'translation'])

let started = false

/**
 * 启动桥接宿主。重复调用安全；原生模块不支持或已启动时只记录并返回。
 */
export function startProviderBridgeHost(): void {
  if (started) return
  try {
    ProviderBridge.start(async (type, input) => {
      if (!BRIDGE_PROVIDER_TYPES.has(type)) {
        throw new Error(`unknown provider type: ${type}`)
      }
      return await providerManager.invoke(type as ProviderType, input as never)
    })
    started = true
    console.log('[ProviderBridge] 桥接宿主已启动（ocr / translation）')
  } catch (error) {
    // 旧版原生模块（或 Linux）没有桥接导出：截图翻译等功能不可用，但不阻塞启动
    console.warn('[ProviderBridge] 启动失败，原生 provider 调用不可用:', error)
  }
}

/**
 * 停止桥接宿主（等待中的原生调用会立即收到失败）。目前仅测试 / 退出流程使用。
 */
export function stopProviderBridgeHost(): void {
  if (!started) return
  ProviderBridge.stop()
  started = false
}

/** 桥接宿主是否在运行（调试 / 自检用） */
export function isProviderBridgeHostRunning(): boolean {
  return started
}
