import { MainWindowClient, type MainWindowSource } from '../../common/mainWindowClient'
import { BrowserWindow, net, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import { loadOfficialAccountSession } from '../../core/account/officialAccountService'
import { openAfdianCheckout, closeAfdianCheckout } from '../../core/afdianPaymentWindow'
import detachedWindowManager from '../../core/detachedWindowManager'
import { OFFICIAL_SERVER_HTTP_URL } from '../../../shared/syncServerUrl'
import type {
  PluginPaymentInfo,
  PluginPaymentInput,
  PluginPaymentQuery,
  PluginPaymentRecords
} from '../../../shared/pluginPayment'
import pluginUserAPI from './user'
import { registerPluginApiServices } from './pluginApiDispatcher'

interface PaymentContext {
  event: IpcMainInvokeEvent
  sender: WebContents
  username: string
  pluginId: string
  paymentOwner: BrowserWindow | null
}
interface PaymentWatch {
  context: PaymentContext
  orderId: string
  expiresAt: number
  callbacks: Set<string>
  resume?: () => void
}
export class PluginPaymentAPI extends MainWindowClient {
  private manager: PluginManager | null = null
  private watches = new Map<string, PaymentWatch>()
  private creating = new Set<number>()

  /**
   * 注册插件支付与记录 API，身份只能由真实 IPC 来源推导。
   * @param main 主窗口实例或当前宿主提供器。
   * @param manager 插件运行时管理器。
   * @returns 无返回值。
   */
  init(main: MainWindowSource, manager: PluginManager): void {
    this.mainWindow = main
    this.manager = manager
    registerPluginApiServices({
      requestPayment: this.requestPayment.bind(this),
      getPaymentRecords: this.getPaymentRecords.bind(this)
    })
  }

  /**
   * 建立插件与账号快照。
   * @param event 调用方 IPC 事件。
   * @returns 经核验的请求上下文。
   * @throws 未登录或无法确定插件身份时抛错。
   */
  private async context(event: IpcMainInvokeEvent): Promise<PaymentContext> {
    const pluginId = this.manager?.getPluginManifestNameByWebContents(event.sender)
    const account = await loadOfficialAccountSession()
    if (!pluginId || event.sender.isDestroyed()) throw new Error('无法确认当前插件身份')
    if (!account?.token || !account.username) throw new Error('请先登录 ZTools')
    // 支付结束后只恢复真实发起窗口，分离插件不能意外唤起主窗口。
    const paymentOwner =
      detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow
    return { event, sender: event.sender, username: account.username, pluginId, paymentOwner }
  }

  /**
   * 防止请求、轮询或回调期间切换账号、卸载插件后继续使用旧身份。
   * @param context 请求发起时的身份。
   * @returns 身份是否仍然有效。
   */
  private async current(context: PaymentContext): Promise<boolean> {
    const account = await loadOfficialAccountSession()
    return (
      !context.sender.isDestroyed() &&
      !!account?.token &&
      account.username === context.username &&
      this.manager?.getPluginManifestNameByWebContents(context.sender) === context.pluginId
    )
  }

  /**
   * 使用插件短期授权访问固定支付接口，每次网络请求有硬超时。
   * @param context 身份快照。
   * @param suffix 支付接口后缀。
   * @param body 创建订单数据，未传时为查询。
   * @returns 服务端 JSON。
   * @throws 网络失败、身份切换或服务端拒绝时抛错。
   */
  private async request<T>(
    context: PaymentContext,
    suffix: string,
    body?: PluginPaymentInput
  ): Promise<T> {
    if (!(await this.current(context))) throw new Error('账号或插件状态已变化')
    const auth = await pluginUserAPI.handleGetUserTempToken(context.event)
    if (!(await this.current(context))) throw new Error('账号或插件状态已变化')
    const response = await net.fetch(`${OFFICIAL_SERVER_HTTP_URL}/api/plugin/payments${suffix}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
      redirect: 'error'
    })
    const data = await response.json()
    if (!(await this.current(context))) throw new Error('账号或插件状态已变化')
    if (!response.ok) throw new Error(data.error || '支付请求失败')
    return data as T
  }

  /**
   * 创建幂等订单并直接打开收银台；成功状态由主进程查询 Server 后回调。
   * @param event 插件调用事件。
   * @param input 商品、业务订单与回调关联 ID。
   * @returns 创建好的订单，不含内部收银台链接；返回不代表支付成功。
   * @throws 参数无效或请求失败时抛错。
   */
  async requestPayment(
    event: IpcMainInvokeEvent,
    input: PluginPaymentInput & { requestId: string }
  ): Promise<PluginPaymentInfo> {
    if (
      !input ||
      typeof input.requestId !== 'string' ||
      !/^[\w-]{1,80}$/.test(input.requestId) ||
      typeof input.productId !== 'string' ||
      typeof input.orderNo !== 'string'
    )
      throw new Error('支付参数不正确')
    if (this.creating.has(event.sender.id)) throw new Error('正在打开支付，请勿重复操作')
    this.creating.add(event.sender.id)
    try {
      const context = await this.context(event)
      const { requestId, ...body } = input
      const response = await this.request<PluginPaymentInfo & { paymentUrl?: string }>(
        context,
        '',
        body
      )
      const { paymentUrl, ...order } = response
      if (order.status === 'paid') {
        context.sender.send('plugin-payment-result', { requestId, status: 'paid', order })
        return order
      }
      if (order.status !== 'pending' || !paymentUrl)
        throw new Error('订单已超时或异常，请查询支付记录后使用新订单号')
      const existing = this.watches.get(order.orderId)
      if (
        existing &&
        (existing.context.sender.id !== context.sender.id ||
          existing.context.username !== context.username)
      )
        throw new Error('该订单已在另一个插件窗口处理中')
      if (!(await this.current(context))) throw new Error('账号或插件状态已变化')
      openAfdianCheckout(
        order.orderId,
        paymentUrl,
        `插件赞赏 · ${order.productName}`,
        context.paymentOwner
      )
      if (existing) {
        existing.callbacks.add(requestId)
      } else {
        const watch: PaymentWatch = {
          context,
          orderId: order.orderId,
          expiresAt: Date.now() + 30 * 60_000,
          callbacks: new Set([requestId])
        }
        this.watches.set(order.orderId, watch)
        // 插件退出时关闭其支付窗口，服务端订单仍可通过记录接口恢复。
        const destroyed = (): void => this.stop(watch)
        context.sender.once('destroyed', destroyed)
        void this.poll(watch).finally(() => context.sender.removeListener('destroyed', destroyed))
      }
      return order
    } finally {
      this.creating.delete(event.sender.id)
    }
  }

  /**
   * 查询当前用户在当前插件的付款记录，不允许传入其他账号或插件 ID。
   * @param event 插件调用事件。
   * @param query 商品、订单号、状态与游标。
   * @returns 支付记录分页。
   * @throws 查询失败时抛错。
   */
  async getPaymentRecords(
    event: IpcMainInvokeEvent,
    query: PluginPaymentQuery = {}
  ): Promise<PluginPaymentRecords> {
    const context = await this.context(event)
    const params = new URLSearchParams()
    for (const key of ['productId', 'orderNo', 'status', 'cursor', 'limit'] as const) {
      if (query?.[key] !== undefined) params.set(key, String(query[key]))
    }
    return this.request(context, `?${params}`)
  }

  /**
   * 有界轮询本地订单状态，只有服务端已入账才发送成功事件。
   * @param watch 订单订阅及身份快照。
   * @returns 订阅结束后的 Promise。
   */
  private async poll(watch: PaymentWatch): Promise<void> {
    while (this.watches.get(watch.orderId) === watch) {
      if (Date.now() >= watch.expiresAt || !(await this.current(watch.context))) {
        this.stop(watch)
        return
      }
      try {
        const order = await this.request<PluginPaymentInfo>(
          watch.context,
          `/${encodeURIComponent(watch.orderId)}`
        )
        if (this.watches.get(watch.orderId) !== watch) return
        if (order.status === 'paid') {
          for (const requestId of watch.callbacks)
            watch.context.sender.send('plugin-payment-result', { requestId, status: 'paid', order })
          this.stop(watch)
          return
        }
        if (order.status === 'expired' || order.status === 'abnormal') {
          this.stop(watch)
          return
        }
      } catch {
        // 短暂网络失败不判定未付款，后续轮询或插件记录查询可恢复。
      }
      if (this.watches.get(watch.orderId) !== watch) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          watch.resume = undefined
          resolve()
        }, 3000)
        // 取消订阅时同时结束等待，避免悬挂 Promise 或残留定时器。
        watch.resume = () => {
          clearTimeout(timer)
          watch.resume = undefined
          resolve()
        }
      })
    }
  }

  /**
   * 结束本地订阅并清理窗口；不会取消渠道订单或清理登录缓存。
   * @param watch 要清理的订阅。
   * @returns 无返回值。
   */
  private stop(watch: PaymentWatch): void {
    if (this.watches.get(watch.orderId) !== watch) return
    this.watches.delete(watch.orderId)
    watch.resume?.()
    if (!watch.context.sender.isDestroyed()) {
      for (const requestId of watch.callbacks)
        watch.context.sender.send('plugin-payment-result', { requestId, status: 'stopped' })
    }
    closeAfdianCheckout(watch.orderId, watch.context.paymentOwner)
  }
}
export default new PluginPaymentAPI()
