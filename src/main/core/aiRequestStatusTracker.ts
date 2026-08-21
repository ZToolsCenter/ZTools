import type { AiRequestStatus } from '../../shared/aiRequestStatus'

type ActiveAiRequestStatus = Exclude<AiRequestStatus, 'idle'>

/**
 * 按插件 WebContents 和请求标识聚合 AI 请求状态。
 */
export class AiRequestStatusTracker {
  private readonly requestsByWebContents = new Map<number, Map<string, ActiveAiRequestStatus>>()

  /**
   * 更新单个请求并返回该插件 WebContents 的聚合状态。
   * @param webContentsId 插件页面 WebContents 标识
   * @param requestId AI 请求标识
   * @param status 当前请求状态
   * @returns 同一插件所有并发请求聚合后的状态
   */
  public update(
    webContentsId: number,
    requestId: string,
    status: AiRequestStatus
  ): AiRequestStatus {
    const requests = this.requestsByWebContents.get(webContentsId) ?? new Map()

    // idle 只结束对应请求，不能覆盖同一插件仍在运行的其他请求。
    if (status === 'idle') {
      requests.delete(requestId)
    } else {
      requests.set(requestId, status)
    }

    // 最后一个请求结束后释放该 WebContents 的状态容器。
    if (requests.size === 0) {
      this.requestsByWebContents.delete(webContentsId)
      return 'idle'
    }
    this.requestsByWebContents.set(webContentsId, requests)
    return this.resolveAggregateStatus(requests)
  }

  /**
   * 读取插件 WebContents 当前的聚合 AI 请求状态。
   * @param webContentsId 插件页面 WebContents 标识
   * @returns 当前聚合状态；没有活动请求时返回 idle
   */
  public get(webContentsId: number): AiRequestStatus {
    const requests = this.requestsByWebContents.get(webContentsId)
    return requests ? this.resolveAggregateStatus(requests) : 'idle'
  }

  /**
   * 将同一插件的活动请求归并为一个可展示状态。
   * @param requests 当前插件的活动请求状态
   * @returns receiving 优先于 sending 的聚合状态
   */
  private resolveAggregateStatus(
    requests: ReadonlyMap<string, ActiveAiRequestStatus>
  ): ActiveAiRequestStatus {
    return Array.from(requests.values()).includes('receiving') ? 'receiving' : 'sending'
  }
}

export default new AiRequestStatusTracker()
