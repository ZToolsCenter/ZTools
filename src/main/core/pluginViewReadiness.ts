import type { Event, WebContents, WebContentsDidStartNavigationEventParams } from 'electron'

const ERR_ABORTED = -3

export interface PluginViewReadiness {
  /** 当前主框架文档是否已就绪，可直接复用而无需加载占位。 */
  readonly isReady: boolean
  /** 当前主框架文档是否处于真实加载失败状态。 */
  readonly isFailed: boolean
  /** 当前主框架页面的 DOM 就绪结果；导航、重载或超时后重新读取会得到新的 Promise。 */
  readonly ready: Promise<boolean>
  /**
   * 标记宿主已取消当前主框架导航。
   * @returns 无返回值
   */
  markNavigationCancelled(): void
}

/**
 * 创建不可用视图的就绪接口。
 * @returns 所有等待立即失败的就绪接口
 */
function createUnavailableReadiness(): PluginViewReadiness {
  return {
    isReady: false,
    isFailed: false,
    ready: Promise.resolve(false),
    /**
     * 忽略已销毁视图的取消通知。
     * @returns 无返回值
     */
    markNavigationCancelled(): void {
      // 已销毁视图没有可恢复文档，无需处理取消通知。
    }
  }
}

/**
 * 在首次加载前绑定视图就绪等待，并随主框架导航更新等待结果。
 * @param contents 插件视图的 WebContents
 * @param timeoutMs 每次页面加载允许等待 DOM 就绪的毫秒数
 * @returns 随页面更新的就绪记录；失败、超时或销毁时本次等待返回 false
 */
export function createPluginViewReadiness(
  contents: WebContents,
  timeoutMs: number = 5000
): PluginViewReadiness {
  // 已销毁的视图不能再注册监听，也不能产生永远无法完成的等待。
  if (contents.isDestroyed()) return createUnavailableReadiness()

  let ready: Promise<boolean>
  let resolveReady: (value: boolean) => void
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = true
  let navigationStarted = false
  let loadFailed = false
  let domReady = false
  let previousDocumentReady = false
  let destroyed = false

  /**
   * 完成本次页面等待并释放计时器，继续观察迟到的页面就绪事件。
   * @param value 当前页面是否已经 DOM 就绪
   * @returns 无返回值
   */
  function finish(value: boolean): void {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolveReady(value)
  }

  /**
   * 恢复被取消导航前的已提交文档状态。
   * @returns 存在可恢复文档时为 true
   */
  function restorePreviousDocument(): boolean {
    if (!previousDocumentReady) return false
    // 清理失败标记，并恢复原文档的可用状态。
    loadFailed = false
    domReady = true
    // 已超时的等待无法再次 resolve，必须发布一个新的成功结果。
    if (settled) ready = Promise.resolve(true)
    else finish(true)
    return true
  }

  /**
   * 接受当前主框架页面的 DOM 就绪通知。
   * @returns 无返回值
   */
  function onReady(): void {
    // 超时只终止本次等待；慢页面随后就绪时，后续调用仍应可以使用该视图。
    if (loadFailed) return
    domReady = true
    previousDocumentReady = true
    if (settled) ready = Promise.resolve(true)
    finish(true)
  }

  /**
   * 主框架加载失败时结束等待，子框架失败不影响插件页面。
   * @param _event Electron 加载失败事件
   * @param _errorCode Chromium 错误码
   * @param _errorDescription Chromium 错误描述
   * @param _validatedURL 加载失败的地址
   * @param isMainFrame 是否为主框架
   * @returns 无返回值
   */
  function onFailed(
    _event: Event,
    _errorCode: number,
    _errorDescription: string,
    _validatedURL: string,
    isMainFrame: boolean
  ): void {
    if (!isMainFrame) return
    // 被拦截或取消的导航不会替换当前文档，恢复上一个可用页面的状态。
    if (_errorCode === ERR_ABORTED && (domReady || restorePreviousDocument())) return
    // 加载失败后的错误页也可能发出 DOM 就绪，不能将其当成可用插件页面。
    loadFailed = true
    domReady = false
    previousDocumentReady = false
    finish(false)
    ready = Promise.resolve(false)
  }

  /**
   * 为新的主框架页面建立有时间上限的等待。
   * @returns 无返回值
   */
  function begin(): void {
    settled = false
    loadFailed = false
    // 连续导航开始事件不能覆盖仍可回退的已提交文档。
    previousDocumentReady = previousDocumentReady || domReady
    domReady = false
    ready = new Promise<boolean>((resolve) => {
      resolveReady = resolve
    })
    timer = setTimeout(() => finish(false), timeoutMs)
  }

  /**
   * 页面导航时更新就绪记录，保留首次 loadURL 之前已取得的等待。
   * @param details 导航目标及主框架、同文档标记
   * @returns 无返回值
   */
  function onNavigation(details: Event<WebContentsDidStartNavigationEventParams>): void {
    if (!details.isMainFrame || details.isSameDocument) return
    // 首次导航沿用创建时的等待；之后导航使旧文档的未完成等待失效。
    if (navigationStarted || settled) {
      finish(false)
      begin()
    }
    navigationStarted = true
  }

  /**
   * 视图销毁时结束等待并释放跨导航保留的监听。
   * @returns 无返回值
   */
  function onDestroyed(): void {
    // 销毁后同时清除当前等待和可回退文档，禁止后续继续复用。
    destroyed = true
    finish(false)
    domReady = false
    previousDocumentReady = false
    // 销毁后的读取必须返回失败，不能保留已就绪页面的成功结果。
    ready = Promise.resolve(false)
    contents.removeListener('dom-ready', onReady)
    contents.removeListener('did-fail-load', onFailed)
    contents.removeListener('did-start-navigation', onNavigation)
    contents.removeListener('destroyed', onDestroyed)
  }

  /**
   * 恢复宿主取消导航前的可用文档。
   * @returns 无返回值
   */
  function markNavigationCancelled(): void {
    if (restorePreviousDocument()) return
    // 没有旧文档可恢复时立即结束等待，避免调用方永久阻塞。
    finish(false)
    ready = Promise.resolve(false)
  }

  // 每类事件只监听一次，跨导航及超时继续观察页面，直到视图销毁统一释放。
  contents.on('dom-ready', onReady)
  contents.on('did-fail-load', onFailed)
  contents.on('did-start-navigation', onNavigation)
  contents.once('destroyed', onDestroyed)
  begin()
  return {
    /**
     * 判断当前文档能否立即复用，导航、失败或销毁后重新等待。
     * @returns 当前主框架文档是否已完成 DOM 初始化
     */
    get isReady(): boolean {
      return domReady
    },
    /**
     * 判断当前页面是否发生真实加载失败。
     * @returns 当前页面加载失败时为 true
     */
    get isFailed(): boolean {
      return loadFailed
    },
    /**
     * 获取当前页面对应的等待，避免重载后使用旧文档的就绪结果。
     * @returns 当前主框架页面的 DOM 就绪 Promise
     */
    get ready(): Promise<boolean> {
      // 超时只结束上一轮调用；再次读取时为仍在加载的页面建立新的有界等待。
      if (settled && !domReady && !loadFailed && !destroyed) begin()
      return ready
    },
    markNavigationCancelled
  }
}
