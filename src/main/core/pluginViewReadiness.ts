import type { Event, WebContents, WebContentsDidStartNavigationEventParams } from 'electron'

export interface PluginViewReadiness {
  /** 当前主框架文档是否已就绪，可直接复用而无需加载占位。 */
  readonly isReady: boolean
  /** 当前主框架页面的 DOM 就绪结果；导航或重载后读取会得到新的 Promise。 */
  readonly ready: Promise<boolean>
  /** 重载当前页面，并在导航事件到达前就让 ready 指向新文档的等待。 */
  reload(): void
}

/**
 * 在首次加载前绑定视图就绪等待，并随主框架导航更新等待结果。
 * 等待本身不设时限，慢页面在任意时刻就绪都能被后续调用复用；时限由调用方各自决定。
 * @param contents 插件视图的 WebContents
 * @returns 随页面更新的就绪记录；失败或销毁时本次等待返回 false
 */
export function createPluginViewReadiness(contents: WebContents): PluginViewReadiness {
  // 已销毁的视图不能再注册监听，也不能产生永远无法完成的等待。
  if (contents.isDestroyed()) {
    return { isReady: false, ready: Promise.resolve(false), reload: () => undefined }
  }

  let ready: Promise<boolean>
  let resolveReady: (value: boolean) => void
  let settled = true
  // 下一次主框架导航是否沿用已建立的等待：首次 loadURL 及主动重载在导航事件到达前已取得等待。
  let adoptNextNavigation = true
  let loadFailed = false
  let domReady = false
  // 已开始但尚未提交的主框架导航；被拦截、204 或转为下载时不会提交，原文档继续使用。
  let pendingNavigation = false
  let previousReady = false
  let previousFailed = false

  /**
   * 完成本次页面等待，继续观察迟到的页面就绪事件。
   * @param value 当前页面是否已经 DOM 就绪
   * @returns 无返回值
   */
  function finish(value: boolean): void {
    if (settled) return
    settled = true
    resolveReady(value)
  }

  /**
   * 接受当前主框架页面的 DOM 就绪通知。
   * @returns 无返回值
   */
  function onReady(): void {
    // 调用方等待超时后，慢页面随后就绪时，后续调用仍应可以使用该视图。
    if (loadFailed) return
    pendingNavigation = false
    domReady = true
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
    pendingNavigation = false
    // 加载失败后的错误页也可能发出 DOM 就绪，不能将其当成可用插件页面。
    loadFailed = true
    domReady = false
    finish(false)
    ready = Promise.resolve(false)
  }

  /**
   * 为新的主框架页面建立等待。
   * @returns 无返回值
   */
  function begin(): void {
    settled = false
    loadFailed = false
    domReady = false
    ready = new Promise<boolean>((resolve) => {
      resolveReady = resolve
    })
  }

  /**
   * 页面导航时更新就绪记录，保留首次 loadURL 之前已取得的等待。
   * @param details 导航目标及主框架、同文档标记
   * @returns 无返回值
   */
  function onNavigation(details: Event<WebContentsDidStartNavigationEventParams>): void {
    if (!details.isMainFrame || details.isSameDocument) return
    // 连续导航只记录最初文档的状态，未提交时恢复的是仍在显示的那份文档。
    if (!pendingNavigation) {
      previousReady = domReady
      previousFailed = loadFailed
    }
    pendingNavigation = true
    // 首次导航及主动重载沿用已建立的等待；之后导航使旧文档的未完成等待失效。
    if (!adoptNextNavigation || settled) {
      finish(false)
      begin()
    }
    adoptNextNavigation = false
  }

  /**
   * 重载当前页面；导航开始事件可能异步到达，先建立新等待避免调用方读到旧文档结果。
   * @returns 无返回值
   */
  function reload(): void {
    if (contents.isDestroyed()) return
    if (!pendingNavigation) {
      previousReady = domReady
      previousFailed = loadFailed
    }
    pendingNavigation = true
    finish(false)
    begin()
    adoptNextNavigation = true
    contents.reload()
  }

  /**
   * 主框架提交新文档后，等待只属于新文档，停止加载时不再恢复旧文档状态。
   * @returns 无返回值
   */
  function onCommit(): void {
    pendingNavigation = false
  }

  /**
   * 导航未提交即停止加载时恢复原文档状态，否则就绪状态会永久停在等待或失败。
   * @returns 无返回值
   */
  function onStopLoading(): void {
    if (!pendingNavigation) return
    pendingNavigation = false
    if (previousReady) {
      domReady = true
      if (settled) ready = Promise.resolve(true)
      finish(true)
      return
    }
    // 原文档本就不可用；保留失败标记，避免其错误页被当成插件页面。
    loadFailed = previousFailed
    finish(false)
    ready = Promise.resolve(false)
  }

  /**
   * 视图销毁时结束等待并释放跨导航保留的监听。
   * @returns 无返回值
   */
  function onDestroyed(): void {
    finish(false)
    domReady = false
    pendingNavigation = false
    // 销毁后的读取必须返回失败，不能保留已就绪页面的成功结果。
    ready = Promise.resolve(false)
    contents.removeListener('dom-ready', onReady)
    contents.removeListener('did-fail-load', onFailed)
    contents.removeListener('did-start-navigation', onNavigation)
    contents.removeListener('did-navigate', onCommit)
    contents.removeListener('did-stop-loading', onStopLoading)
    contents.removeListener('destroyed', onDestroyed)
  }

  // 每类事件只监听一次，跨导航继续观察页面，直到视图销毁统一释放。
  contents.on('dom-ready', onReady)
  contents.on('did-fail-load', onFailed)
  contents.on('did-start-navigation', onNavigation)
  contents.on('did-navigate', onCommit)
  contents.on('did-stop-loading', onStopLoading)
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
     * 获取当前页面对应的等待，避免重载后使用旧文档的就绪结果。
     * @returns 当前主框架页面的 DOM 就绪 Promise
     */
    get ready(): Promise<boolean> {
      return ready
    },
    reload
  }
}

/**
 * 为单次调用限定等待时长，超时只影响本次调用，不改变页面的就绪记录。
 * @param ready 调用开始时读取的页面就绪等待
 * @param timeoutMs 本次调用允许等待的毫秒数
 * @returns 页面在时限内就绪时为 true，失败、销毁或超时为 false
 */
export function waitForPluginViewReady(
  ready: Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  return Promise.race([ready, timeout]).finally(() => clearTimeout(timer))
}
