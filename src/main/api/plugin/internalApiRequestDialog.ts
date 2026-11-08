import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import windowManager from '../../managers/windowManager.js'

/** 弹窗动作通道：弹窗页面将用户选择发回主进程（仅接受弹窗自身 webContents 的消息） */
const DIALOG_RESOLVE_CHANNEL = 'internal-api-request-dialog:resolve'

/** 单条待展示的申请内容 */
export interface InternalApiRequestDialogEntry {
  apis: string[]
  reason?: string
}

/** 弹窗用户动作 */
export type InternalApiRequestDialogAction =
  | { action: 'approve'; apis: string[] }
  | { action: 'reject' }
  | { action: 'later' }

/** 弹窗队列条目 */
interface DialogQueueItem {
  pluginName: string
  entry: InternalApiRequestDialogEntry
}

/**
 * 高级 API 授权申请弹窗管理器。
 * 插件提交授权申请时立即弹出独立置顶小窗，供用户当场批准 / 拒绝 / 稍后处理；
 * 同一时刻只展示一条申请，其余排队依次展示。
 */
class InternalApiRequestDialogManager {
  /** 待展示申请队列（当前展示项出队后窗口销毁时推进） */
  private queue: DialogQueueItem[] = []
  /** 当前正在弹窗展示的插件名；null 表示队列为空且无弹窗 */
  private currentPluginName: string | null = null
  /** 当前弹窗实例 */
  private dialogWindow: BrowserWindow | null = null
  /** 由权限管理模块注入的行为回调 */
  private handlers: {
    isPending: (pluginName: string) => boolean
    onApprove: (pluginName: string, apis: string[]) => Promise<void> | void
    onReject: (pluginName: string) => Promise<void> | void
  } | null = null

  /**
   * 初始化弹窗管理器并注册弹窗回传通道。
   * @param handlers 权限模块注入的回调：判断申请是否仍待审、批准与拒绝动作
   * @returns 无返回值
   */
  public init(handlers: {
    isPending: (pluginName: string) => boolean
    onApprove: (pluginName: string, apis: string[]) => Promise<void> | void
    onReject: (pluginName: string) => Promise<void> | void
  }): void {
    this.handlers = handlers

    // 弹窗页面动作回传：严格校验 sender 是当前弹窗，防止其他 webContents 伪造。
    ipcMain.on(DIALOG_RESOLVE_CHANNEL, (event, payload: InternalApiRequestDialogAction) => {
      if (!this.dialogWindow || event.sender.id !== this.dialogWindow.webContents.id) return
      void this.handleDialogAction(payload)
    })
  }

  /**
   * 将一条新申请加入弹窗队列；空闲时立即弹出。
   * @param pluginName 申请插件名
   * @param entry 申请内容（通道列表与说明）
   * @returns 无返回值
   */
  public enqueue(pluginName: string, entry: InternalApiRequestDialogEntry): void {
    // 正在展示同一插件的弹窗时不再重复入队（服务端已合并申请内容）。
    if (this.currentPluginName === pluginName) return
    if (this.queue.some((item) => item.pluginName === pluginName)) return

    this.queue.push({ pluginName, entry })
    // 无弹窗在展示时立即弹出，否则等待当前弹窗处理完毕后依次展示。
    if (!this.dialogWindow) this.showNext()
  }

  /**
   * 权限数据发生变化后同步弹窗状态。
   * 当前展示的申请若已在别处（如设置页）被处理，则关闭弹窗并继续展示下一条。
   * @returns 无返回值
   */
  public sync(): void {
    if (
      this.dialogWindow &&
      this.currentPluginName &&
      !this.isPendingSafe(this.currentPluginName)
    ) {
      this.closeCurrentDialog()
    }
  }

  /**
   * 处理弹窗页面回传的用户动作。
   * @param payload 弹窗动作（批准所选 / 拒绝 / 稍后处理）
   * @returns 处理完成后结束的 Promise
   */
  private async handleDialogAction(payload: InternalApiRequestDialogAction): Promise<void> {
    const pluginName = this.currentPluginName
    if (!pluginName || !this.handlers) return

    if (payload?.action === 'approve') {
      const apis = Array.isArray(payload.apis)
        ? payload.apis.filter((api): api is string => typeof api === 'string')
        : []
      if (apis.length > 0) {
        // 批准动作会触发权限写入并经 sync() 关闭当前弹窗，这里无需自行关闭。
        await this.handlers.onApprove(pluginName, apis)
        // 兜底：若权限写入异常未触发 sync，仍要推进队列。
        this.sync()
        return
      }
      this.closeCurrentDialog()
      return
    }

    if (payload?.action === 'reject') {
      await this.handlers.onReject(pluginName)
      this.sync()
      return
    }

    // 稍后处理：保留待审申请，仅关闭弹窗并继续下一条。
    this.closeCurrentDialog()
  }

  /**
   * 安全调用 isPending 回调，异常时按仍待审处理避免误关弹窗。
   * @param pluginName 插件名
   * @returns 申请是否仍待审
   */
  private isPendingSafe(pluginName: string): boolean {
    try {
      return this.handlers?.isPending(pluginName) ?? false
    } catch {
      return true
    }
  }

  /**
   * 取出队首申请并创建弹窗展示。
   * @returns 无返回值
   */
  private showNext(): void {
    const next = this.queue.shift()
    if (!next) {
      this.currentPluginName = null
      return
    }
    this.currentPluginName = next.pluginName
    this.createDialogWindow(next)
  }

  /**
   * 关闭当前弹窗；窗口销毁事件中再推进下一条，避免重入。
   * @returns 无返回值
   */
  private closeCurrentDialog(): void {
    this.dialogWindow?.close()
  }

  /**
   * 创建授权申请弹窗窗口。
   * @param item 待展示的申请条目
   * @returns 无返回值
   */
  private createDialogWindow(item: DialogQueueItem): void {
    const width = 460
    const height = 420

    // 优先在主窗口可视区域中心弹出，主窗口不可见时退回主屏工作区中心。
    const mainWindow = this.resolveMainWindow()
    const anchorBounds =
      mainWindow && mainWindow.isVisible() && !mainWindow.isDestroyed()
        ? mainWindow.getBounds()
        : screen.getPrimaryDisplay().workArea
    const x = Math.round(anchorBounds.x + (anchorBounds.width - width) / 2)
    const y = Math.round(anchorBounds.y + (anchorBounds.height - height) / 2)

    const isDark = nativeTheme.shouldUseDarkColors
    const window = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: isDark ? '#303133' : '#f4f4f4',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    this.dialogWindow = window

    // 窗口被关闭（动作处理完成 / 稍后处理 / 系统 close）后推进队列展示下一条。
    window.on('closed', () => {
      if (this.dialogWindow === window) this.dialogWindow = null
      this.currentPluginName = null
      // 延迟一帧再弹出下一条，让用户感知到上一条已处理完成。
      setTimeout(() => {
        if (!this.dialogWindow) this.showNext()
      }, 120)
    })

    const html = this.generateDialogHTML(item, isDark)
    window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
  }

  /**
   * 获取当前主窗口实例。
   * @returns 主窗口；不可用时返回 null
   */
  private resolveMainWindow(): BrowserWindow | null {
    try {
      return windowManager.getMainWindow()
    } catch {
      return null
    }
  }

  /**
   * 生成弹窗页面 HTML（含主题适配与用户动作回传脚本）。
   * @param item 待展示的申请条目
   * @param isDark 是否深色主题
   * @returns 完整 HTML 字符串
   */
  private generateDialogHTML(item: DialogQueueItem, isDark: boolean): string {
    const { pluginName, entry } = item
    const safePluginName = this.escapeHTML(pluginName)
    const safeReason = entry.reason ? this.escapeHTML(entry.reason) : ''
    const apiChips = entry.apis
      .map((api) => {
        const safeApi = this.escapeHTML(api)
        return `
          <label class="api-chip" data-testid="popup-api-option">
            <input type="checkbox" value="${safeApi}" checked />
            <span class="api-chip-name">${safeApi}</span>
          </label>`
      })
      .join('')

    const bg = isDark ? '#303133' : '#f4f4f4'
    const cardBg = isDark ? 'rgba(255,255,255,0.05)' : '#ffffff'
    const text = isDark ? '#f3f4f6' : '#333333'
    const textSecondary = isDark ? '#bfc0c3' : '#616161'
    const border = isDark ? '#374151' : '#e5e7eb'
    const primary = isDark ? '#34d399' : '#059669'
    const primaryHover = isDark ? '#10b981' : '#047857'
    const danger = isDark ? '#f87171' : '#ef4444'
    const controlBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="ztools-internal-api-request-dialog" content="1" />
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { width: 100%; height: 100%; overflow: hidden; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
            background: ${bg};
            color: ${text};
            display: flex;
            flex-direction: column;
            border-radius: 12px;
            -webkit-app-region: no-drag;
          }
          .dialog-header {
            padding: 20px 24px 14px;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .shield-badge {
            width: 38px; height: 38px;
            border-radius: 10px;
            background: ${isDark ? 'rgba(248,113,113,0.15)' : '#fee2e2'};
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
          }
          .dialog-titles { flex: 1; min-width: 0; }
          .dialog-title { font-size: 15px; font-weight: 600; }
          .dialog-subtitle { font-size: 12px; color: ${textSecondary}; margin-top: 2px; }
          .plugin-name { font-weight: 600; color: ${text}; }
          .dialog-body { flex: 1; overflow-y: auto; padding: 0 24px; }
          .reason-block {
            background: ${controlBg};
            border-radius: 8px;
            padding: 10px 12px;
            font-size: 12px;
            color: ${textSecondary};
            line-height: 1.6;
            margin-bottom: 12px;
          }
          .section-label { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
          .api-list { display: flex; flex-direction: column; gap: 8px; padding-bottom: 8px; }
          .api-chip {
            display: flex; align-items: center; gap: 9px;
            background: ${cardBg};
            border: 1px solid ${border};
            border-radius: 8px;
            padding: 9px 12px;
            cursor: pointer;
            user-select: none;
            transition: border-color 0.15s;
          }
          .api-chip:hover { border-color: ${primary}; }
          .api-chip input[type='checkbox'] {
            width: 15px; height: 15px;
            accent-color: ${primary};
            cursor: pointer;
            flex-shrink: 0;
          }
          .api-chip-name {
            font-family: 'SF Mono', Menlo, Consolas, monospace;
            font-size: 12px;
            word-break: break-all;
          }
          .risk-note {
            margin-top: 12px;
            font-size: 11px;
            color: ${textSecondary};
            line-height: 1.6;
            padding-bottom: 4px;
          }
          .dialog-footer {
            padding: 14px 24px 18px;
            display: flex;
            align-items: center;
            gap: 10px;
            border-top: 1px solid ${border};
          }
          .btn-later {
            margin-right: auto;
            background: none; border: none;
            color: ${textSecondary};
            font-size: 12px;
            cursor: pointer;
            padding: 6px 8px;
            border-radius: 6px;
          }
          .btn-later:hover { color: ${text}; background: ${controlBg}; }
          .btn {
            border-radius: 8px;
            font-size: 13px;
            padding: 8px 18px;
            cursor: pointer;
            border: 1px solid transparent;
            transition: background 0.15s;
          }
          .btn-reject {
            background: none;
            border-color: ${border};
            color: ${danger};
          }
          .btn-reject:hover { background: ${isDark ? 'rgba(248,113,113,0.12)' : '#fee2e2'}; }
          .btn-approve {
            background: ${primary};
            color: #fff;
            font-weight: 600;
          }
          .btn-approve:hover { background: ${primaryHover}; }
          .btn-approve:disabled { opacity: 0.5; cursor: not-allowed; }
        </style>
      </head>
      <body data-testid="permission-popup">
        <div class="dialog-header">
          <div class="shield-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${danger}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div class="dialog-titles">
            <div class="dialog-title">高级 API 授权申请</div>
            <div class="dialog-subtitle">插件 <span class="plugin-name">${safePluginName}</span> 请求以下权限</div>
          </div>
        </div>
        <div class="dialog-body">
          ${safeReason ? `<div class="reason-block">申请说明：${safeReason}</div>` : ''}
          <div class="section-label">申请的 API（${entry.apis.length} 项）</div>
          <div class="api-list">${apiChips}</div>
          <div class="risk-note">高级 API 可读写 ZTools 设置、管理插件或执行其他高权限操作，请仅授权你信任的插件。授权立即生效，可随时在设置的「高级权限」页移除。</div>
        </div>
        <div class="dialog-footer">
          <button class="btn-later" data-testid="popup-later">稍后处理</button>
          <button class="btn btn-reject" data-testid="popup-reject">拒绝</button>
          <button class="btn btn-approve" data-testid="popup-approve" disabled>批准所选</button>
        </div>
        <script>
          const { ipcRenderer } = require('electron')
          const approveBtn = document.querySelector('[data-testid="popup-approve"]')
          const checkboxes = () => Array.from(document.querySelectorAll('.api-chip input[type="checkbox"]'))

          // 根据勾选状态更新批准按钮文案与可用性
          function refreshApproveState() {
            const checked = checkboxes().filter((box) => box.checked)
            approveBtn.textContent = checked.length > 0 ? '批准所选（' + checked.length + '）' : '批准所选'
            approveBtn.disabled = checked.length === 0
          }
          checkboxes().forEach((box) => box.addEventListener('change', refreshApproveState))
          // 默认已勾选全部申请项，首次显示时也要同步按钮状态。
          refreshApproveState()

          approveBtn.addEventListener('click', () => {
            const apis = checkboxes().filter((box) => box.checked).map((box) => box.value)
            if (apis.length === 0) return
            ipcRenderer.send('${DIALOG_RESOLVE_CHANNEL}', { action: 'approve', apis })
          })
          document.querySelector('[data-testid="popup-reject"]').addEventListener('click', () => {
            ipcRenderer.send('${DIALOG_RESOLVE_CHANNEL}', { action: 'reject' })
          })
          document.querySelector('[data-testid="popup-later"]').addEventListener('click', () => {
            ipcRenderer.send('${DIALOG_RESOLVE_CHANNEL}', { action: 'later' })
          })
        </script>
      </body>
      </html>
    `
  }

  /**
   * 转义 HTML 特殊字符，防止插件名 / 说明注入页面结构。
   * @param text 原始文本
   * @returns 转义后的安全文本
   */
  private escapeHTML(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }
}

export default new InternalApiRequestDialogManager()
