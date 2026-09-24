import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'

interface ToastOptions {
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
  duration?: number // 显示时长(毫秒),默认 3000
  position?: 'top' | 'bottom' // 显示位置,默认 top
}

interface ToastItem {
  id: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  position: 'top' | 'bottom'
}

/**
 * Toast 容器窗口管理器
 */
class ToastManager {
  private containerWindow: BrowserWindow | null = null
  private toasts: ToastItem[] = []
  private toastIdCounter = 0
  private readonly DEFAULT_DURATION = 3000
  private destroyTimer: NodeJS.Timeout | null = null
  private readonly DESTROY_DELAY = 1000 // 延迟销毁时间(毫秒)

  /**
   * 创建或获取容器窗口
   */
  private getContainerWindow(): BrowserWindow {
    if (this.containerWindow && !this.containerWindow.isDestroyed()) {
      return this.containerWindow
    }

    // 获取主屏幕尺寸
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds
    // 创建透明全屏容器窗口
    this.containerWindow = new BrowserWindow({
      width: screenWidth,
      height: screenHeight,
      x: 0,
      y: 0,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    // 设置窗口忽略鼠标事件
    this.containerWindow.setIgnoreMouseEvents(true)

    // 设置窗口级别(macOS)
    if (process.platform === 'darwin') {
      // 跳过进程类型变换，避免每条 toast 创建容器窗口时触发异步变换影响主窗口
      this.containerWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
      this.containerWindow.setAlwaysOnTop(true, 'screen-saver')
      this.containerWindow.setHasShadow(false)
    }

    // 加载容器 HTML
    const html = this.generateContainerHTML()
    this.containerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    // 窗口加载完成后立即显示（但内容为空）
    this.containerWindow.once('ready-to-show', () => {
      if (this.containerWindow && !this.containerWindow.isDestroyed()) {
        this.containerWindow.showInactive() // 显示但不获取焦点
      }
    })

    return this.containerWindow
  }

  /**
   * 更新容器窗口中的 toast 列表
   */
  private updateToasts(): void {
    const window = this.getContainerWindow()
    if (window.isDestroyed()) return

    // 发送更新消息的函数
    const sendUpdate = (): void => {
      if (!window.isDestroyed()) {
        window.webContents.send('update-toasts', this.toasts)
      }
    }

    // 等待 webContents 准备好后再发送消息
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => {
        sendUpdate()
      })
    } else {
      sendUpdate()
    }
  }

  /**
   * 显示 toast
   */
  public showToast(options: ToastOptions): void {
    const { message, type = 'info', duration = this.DEFAULT_DURATION, position = 'top' } = options

    // 取消待销毁的定时器
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer)
      this.destroyTimer = null
    }

    // 创建 toast item
    const toastId = `toast-${++this.toastIdCounter}-${Date.now()}`
    const toastItem: ToastItem = {
      id: toastId,
      message,
      type,
      position
    }

    // 添加到列表
    this.toasts.push(toastItem)

    // 更新容器窗口
    this.updateToasts()

    // 自动关闭
    setTimeout(() => {
      this.removeToast(toastId)
    }, duration)
  }

  /**
   * 移除指定的 toast
   */
  private removeToast(toastId: string): void {
    const index = this.toasts.findIndex((t) => t.id === toastId)
    if (index > -1) {
      this.toasts.splice(index, 1)
      this.updateToasts()

      // 如果是最后一个 toast，延迟销毁窗口
      if (this.toasts.length === 0) {
        this.destroyTimer = setTimeout(() => {
          if (this.containerWindow && !this.containerWindow.isDestroyed()) {
            this.containerWindow.hide()
            this.containerWindow.destroy()
            this.containerWindow = null
          }
          this.destroyTimer = null
        }, this.DESTROY_DELAY)
      }
    }
  }

  /**
   * 生成容器窗口 HTML
   */
  private generateContainerHTML(): string {
    // 检测是否为深色模式
    const isDark = nativeTheme.shouldUseDarkColors

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            -webkit-app-region: no-drag;
            overflow: hidden;
            width: 100vw;
            height: 100vh;
          }
          .toast-container {
            position: fixed;
            left: 50%;
            transform: translateX(-50%);
            width: 360px;
            display: flex;
            flex-direction: column;
            pointer-events: none;
          }
          .toast-container.top {
            top: 60px;
          }
          .toast-container.bottom {
            bottom: 20px;
          }
          .toast-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 16px 20px;
            margin-bottom: 10px;
            background: ${isDark ? '#2d2d2d' : '#ffffff'};
            border-radius: 12px;
            color: ${isDark ? '#ffffff' : '#1f1f1f'};
            font-size: 14px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, ${isDark ? '0.7' : '0.12'}),
                        0 1px 6px rgba(0, 0, 0, ${isDark ? '0.5' : '0.08'}),
                        ${isDark ? 'inset 0 1px 0 rgba(255, 255, 255, 0.1)' : 'inset 0 1px 0 rgba(255, 255, 255, 0.8)'};
            backdrop-filter: blur(10px);
            border: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.05)'};
            animation: toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            will-change: transform, opacity, margin-bottom;
          }
          .toast-item:last-child {
            margin-bottom: 0;
          }
          @keyframes toast-in {
            from {
              opacity: 0;
              transform: translateY(-20px) scale(0.95);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @keyframes toast-out {
            0% {
              opacity: 1;
              transform: scale(1);
              max-height: 300px;
            }
            40% {
              opacity: 0;
              transform: scale(0.9);
              max-height: 300px;
            }
            100% {
              opacity: 0;
              transform: scale(0.9);
              max-height: 0;
              margin-bottom: 0;
              padding-top: 0;
              padding-bottom: 0;
            }
          }
          .toast-item.removing {
            animation: toast-out 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
            overflow: hidden;
          }
          .toast-item.info {
            gap: 0;
          }
          .toast-icon {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .toast-message {
            flex: 1;
            word-break: break-word;
            line-height: 1.5;
            max-height: 268px;
            overflow-y: auto;
          }
          .toast-message::-webkit-scrollbar {
            width: 6px;
          }
          .toast-message::-webkit-scrollbar-track {
            background: transparent;
          }
          .toast-message::-webkit-scrollbar-thumb {
            background: ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'};
            border-radius: 3px;
            transition: background 0.2s ease;
          }
          .toast-message::-webkit-scrollbar-thumb:hover {
            background: ${isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)'};
          }
        </style>
      </head>
      <body>
        <div id="top-container" class="toast-container top"></div>
        <div id="bottom-container" class="toast-container bottom"></div>
        
        <script>
          const { ipcRenderer } = require('electron');
          
          // 生成图标 HTML
          function getIconHTML(type) {
            if (type === 'success') {
              return \`
                <div class="toast-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="10" fill="#10b981"/>
                    <path d="M6 10L9 13L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              \`;
            } else if (type === 'warning') {
              return \`
                <div class="toast-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="10" fill="#f59e0b"/>
                    <path d="M10 6V11" stroke="white" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="10" cy="14" r="1" fill="white"/>
                  </svg>
                </div>
              \`;
            } else if (type === 'error') {
              return \`
                <div class="toast-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="10" fill="#ef4444"/>
                    <path d="M7 7L13 13M13 7L7 13" stroke="white" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </div>
              \`;
            }
            return '';
          }
          
          // 转义 HTML
          function escapeHTML(text) {
            return text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
          }
          
          // 更新 toast 列表（增量更新）
          ipcRenderer.on('update-toasts', (event, toasts) => {
            const topContainer = document.getElementById('top-container');
            const bottomContainer = document.getElementById('bottom-container');
            
            // 获取当前所有 toast ID
            const currentIds = new Set(
              Array.from(document.querySelectorAll('.toast-item')).map(el => el.id)
            );
            const newIds = new Set(toasts.map(t => t.id));
            
            // 1. 移除不存在的 toast（添加移除动画）
            currentIds.forEach(id => {
              if (!newIds.has(id)) {
                const el = document.getElementById(id);
                if (el) {
                  el.classList.add('removing');
                  setTimeout(() => el.remove(), 400); // 等待动画完成
                }
              }
            });
            
            // 2. 添加新的 toast
            toasts.forEach(toast => {
              if (!currentIds.has(toast.id)) {
                const toastEl = document.createElement('div');
                toastEl.className = \`toast-item \${toast.type}\`;
                toastEl.id = toast.id;
                
                const iconHTML = toast.type !== 'info' ? getIconHTML(toast.type) : '';
                toastEl.innerHTML = \`
                  \${iconHTML}
                  <div class="toast-message">\${escapeHTML(toast.message)}</div>
                \`;
                
                if (toast.position === 'top') {
                  topContainer.appendChild(toastEl);
                } else {
                  bottomContainer.appendChild(toastEl);
                }
              }
            });
            
            // 3. 确保顺序正确（不改变已存在的元素）
            const topToasts = toasts.filter(t => t.position === 'top');
            const bottomToasts = toasts.filter(t => t.position === 'bottom');
            
            topToasts.forEach((toast, index) => {
              const el = document.getElementById(toast.id);
              if (el && el.parentElement === topContainer) {
                const currentIndex = Array.from(topContainer.children).indexOf(el);
                if (currentIndex !== index) {
                  topContainer.insertBefore(el, topContainer.children[index] || null);
                }
              }
            });
            
            bottomToasts.forEach((toast, index) => {
              const el = document.getElementById(toast.id);
              if (el && el.parentElement === bottomContainer) {
                const currentIndex = Array.from(bottomContainer.children).indexOf(el);
                if (currentIndex !== index) {
                  bottomContainer.insertBefore(el, bottomContainer.children[index] || null);
                }
              }
            });
          });
        </script>
      </body>
      </html>
    `
  }

  /**
   * 关闭所有 toast
   */
  public closeAll(): void {
    this.toasts = []

    // 取消待销毁的定时器
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer)
      this.destroyTimer = null
    }

    if (this.containerWindow && !this.containerWindow.isDestroyed()) {
      this.containerWindow.hide()
      this.containerWindow.destroy()
      this.containerWindow = null
    }
  }
}

// 单例
const toastManager = new ToastManager()

/**
 * Toast API 模块
 */
class PluginToastAPI {
  private pluginManager: PluginManager | null = null

  public init(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  private setupIPC(): void {
    // 显示 toast
    ipcMain.handle('plugin:show-toast', async (event, options: ToastOptions) => {
      try {
        // 验证调用来源
        if (!this.pluginManager) {
          throw new Error('PluginManager not initialized')
        }

        // 可选:获取插件信息用于日志
        const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
        if (pluginInfo) {
          console.log(`[Toast] 插件 ${pluginInfo.name} 显示 toast:`, options.message)
        }

        // 显示 toast
        toastManager.showToast(options)

        return { success: true }
      } catch (error) {
        console.error('[Toast] 显示 toast 失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })
  }

  /**
   * 关闭所有 toast(供主进程使用)
   */
  public closeAll(): void {
    toastManager.closeAll()
  }
}

export default new PluginToastAPI()
