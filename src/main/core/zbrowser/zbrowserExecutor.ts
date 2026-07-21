/**
 * zbrowser 主进程执行器
 *
 * 核心类 ZBrowserExecutor：管理 BrowserWindow 生命周期，
 * 接收 runner 子进程的方法调用请求并在 BrowserWindow 上执行。
 *
 * 架构：
 *   runner.js（子进程）→ process.send({ method, args }) →
 *   ZBrowserExecutor（主进程）→ webContents.executeJavaScript / sendInputEvent / ... →
 *   返回结果 → childProcess.send({ action, payload })
 */

import { BrowserWindow, clipboard, nativeImage, app } from 'electron'
import { fork, type ChildProcess } from 'child_process'
import path from 'path'
import { getAppBundlePath } from '../../utils/appBundlePath'
import fs from 'fs'

import type {
  ZBrowserQueueItem,
  ZBrowserRunOptions,
  ZBrowserRunResult,
  RunnerToMainMessage,
  MainToRunnerMessage
} from './types'
import { ZBROWSER_DEVICES, type DeviceConfig } from './devices'
import zbrowserManager from './zbrowserManager'
import TurndownService from 'turndown'
import devToolsShortcut from '../../utils/devToolsShortcut'

/**
 * Electron 支持的键码映射表
 *
 * 将 DOM 键名映射到 Electron sendInputEvent 的 keyCode。
 * 与 uTools 保持一致。
 */
const KEY_CODE_MAP: Record<string, string> = {
  Backspace: 'Backspace',
  Tab: 'Tab',
  Enter: 'Enter',
  MediaPlayPause: 'MediaPlayPause',
  Escape: 'Escape',
  Space: 'Space',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  End: 'End',
  Home: 'Home',
  ArrowLeft: 'Left',
  ArrowUp: 'Up',
  ArrowRight: 'Right',
  ArrowDown: 'Down',
  PrintScreen: 'PrintScreen',
  Insert: 'Insert',
  Delete: 'Delete',
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  KeyA: 'A',
  KeyB: 'B',
  KeyC: 'C',
  KeyD: 'D',
  KeyE: 'E',
  KeyF: 'F',
  KeyG: 'G',
  KeyH: 'H',
  KeyI: 'I',
  KeyJ: 'J',
  KeyK: 'K',
  KeyL: 'L',
  KeyM: 'M',
  KeyN: 'N',
  KeyO: 'O',
  KeyP: 'P',
  KeyQ: 'Q',
  KeyR: 'R',
  KeyS: 'S',
  KeyT: 'T',
  KeyU: 'U',
  KeyV: 'V',
  KeyW: 'W',
  KeyX: 'X',
  KeyY: 'Y',
  KeyZ: 'Z',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
  Semicolon: ';',
  Equal: '=',
  Comma: ',',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  Backslash: '\\',
  BracketRight: ']',
  Quote: "'"
}

/** 缓存的键码值数组（延迟初始化） */
let keyCodeValues: string[] | null = null

/** 全局执行超时时间（5 分钟） */
const EXECUTION_TIMEOUT = 5 * 60 * 1000

/** 默认 goto 超时时间（60 秒） */
const DEFAULT_GOTO_TIMEOUT = 60_000

/**
 * 允许 runner 子进程调用的方法白名单
 *
 * 防止通过动态分发调用到原型链方法或私有方法。
 */
const ALLOWED_METHODS = new Set([
  'goto',
  'javascript',
  'css',
  'press',
  'paste',
  'input',
  'file',
  'screenshot',
  'capture',
  'pdf',
  'download',
  'device',
  'cookies',
  'setCookies',
  'removeCookies',
  'clearCookies',
  'viewport',
  'useragent',
  'hide',
  'show',
  'devTools',
  'mouseEvent',
  'drop',
  'markdown'
])

/**
 * zbrowser 执行器
 *
 * 每次 run() 调用创建一个实例，管理一个 BrowserWindow 和 runner 子进程。
 */
export class ZBrowserExecutor {
  /** BrowserWindow 实例 */
  private _browserWindow: BrowserWindow | null = null
  /** runner 子进程 */
  private _childProcess: ChildProcess | null = null
  /** 页面是否已经触发 dom-ready */
  private _pageIsDomReadyed = false
  /** 当前是否处于显示模式 */
  private _isShow = false
  /** goto 第一次调用时是否已自动 show */
  private _isFirstGoto = false

  // ─────────────────── 操作方法 ───────────────────

  /**
   * 设置 UserAgent
   */
  async useragent(ua: string): Promise<void> {
    this._browserWindow!.webContents.userAgent = ua
  }

  /**
   * 设置视口大小
   *
   * 使用 setContentSize 而非 setSize，与 uTools 行为一致。
   */
  async viewport(width: number, height: number): Promise<void> {
    this._browserWindow!.setContentSize(width, height)
  }

  /**
   * 页面导航
   *
   * @param args [url, headersOrTimeout?, timeout?]
   *   - url: 目标 URL（必须是 http/https/file 协议）
   *   - 第二个参数可以是 headers 对象或超时毫秒数
   *   - 第三个参数为超时毫秒数（当第二个参数是 headers 时）
   *   - 默认超时：60 秒（与 uTools 一致）
   */
  async goto(...args: unknown[]): Promise<void> {
    const url = args[0] as string
    if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error('url error')
    }

    // 首次 goto 且为显示模式时，自动 show
    if (this._isShow && !this._isFirstGoto) {
      this._isFirstGoto = true
      this._browserWindow!.setTitle(url)
      this._browserWindow!.show()
    }

    let loadOptions: Electron.LoadURLOptions | undefined
    let timeout = DEFAULT_GOTO_TIMEOUT

    if (args[1]) {
      if (typeof args[1] === 'object') {
        // 第二个参数是 headers 对象
        const headers = args[1] as Record<string, string>
        loadOptions = { extraHeaders: '' }
        for (const [key, value] of Object.entries(headers)) {
          const lowerKey = key.toLowerCase()
          if (lowerKey === 'referer') {
            loadOptions.httpReferrer = value
          } else if (lowerKey === 'useragent') {
            loadOptions.userAgent = value
          } else {
            loadOptions.extraHeaders += `${key}: ${value}\n`
          }
        }
      } else if (typeof args[1] === 'number' && args[1] > 0) {
        timeout = args[1]
      }
    }
    if (args[2] && typeof args[2] === 'number' && args[2] > 0) {
      timeout = args[2]
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('page load timeout'))
      }, timeout)

      this._browserWindow!.webContents.once('dom-ready', () => {
        clearTimeout(timer)
        this._pageIsDomReadyed = true
        resolve()
      })

      this._browserWindow!.loadURL(url, loadOptions).catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  /** 隐藏窗口 */
  async hide(): Promise<void> {
    this._isShow = false
    this._browserWindow!.hide()
  }

  /** 显示窗口 */
  async show(): Promise<void> {
    this._isShow = true
    this._browserWindow!.show()
  }

  /**
   * 打开开发者工具
   *
   * @param mode 打开模式，默认 detach
   */
  async devTools(mode: string = 'detach'): Promise<void> {
    if (!this._isShow) {
      throw new Error('ubrowser is hided')
    }
    this._browserWindow!.webContents.openDevTools({
      mode: mode as 'detach' | 'right' | 'bottom' | 'undocked',
      activate: false
    })
  }

  /**
   * 执行 JavaScript 代码
   *
   * runner 会将 evaluate 回调序列化为 IIFE 字符串，
   * 返回 { data, error, message } 格式。
   */
  async javascript(code: string): Promise<unknown> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }
    const result = await this._browserWindow!.webContents.executeJavaScript(code, true)
    if (result.error) {
      throw new Error(result.message)
    }
    return result.data
  }

  /**
   * 注入 CSS 样式
   */
  async css(code: string): Promise<void> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }
    await this._browserWindow!.webContents.insertCSS(code)
  }

  /**
   * 模拟键盘按键
   *
   * @param key 键名（DOM 键名或 Electron 键名）
   * @param modifiers 修饰键列表（shift / ctrl / alt / meta）
   */
  async press(key: string, ...modifiers: string[]): Promise<void> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }

    // 延迟初始化键码值列表
    if (!keyCodeValues) {
      keyCodeValues = Object.values(KEY_CODE_MAP)
    }

    const keyStr = String(key).toLowerCase()
    let keyCode = keyCodeValues.find((k) => k.toLowerCase() === keyStr)
    if (!keyCode) {
      throw new Error('keyCode error')
    }

    // Enter → 回车字符，Space → 空格字符
    if (keyCode === 'Enter') {
      keyCode = String.fromCharCode(13)
    } else if (keyCode === 'Space') {
      keyCode = String.fromCharCode(32)
    }

    // 校验修饰键
    if (modifiers.length > 0) {
      modifiers = Array.from(new Set(modifiers)).map((m) => String(m).toLowerCase())
      const invalid = modifiers.find((m) => !['shift', 'ctrl', 'alt', 'meta'].includes(m))
      if (invalid) {
        throw new Error('modifier key error')
      }
    }

    const wc = this._browserWindow!.webContents
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers } as Electron.KeyboardInputEvent)
    wc.sendInputEvent({
      type: 'char',
      keyCode: /^[A-Z]$/.test(keyCode) ? key : keyCode,
      modifiers
    } as Electron.KeyboardInputEvent)
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers } as Electron.KeyboardInputEvent)
  }

  /**
   * 粘贴文本或图片到页面
   *
   * 与 uTools 一致：使用 document.execCommand('paste')，而非模拟 Ctrl+V。
   *
   * @param text 要粘贴的文本（或 base64 data URI 图片）。省略则粘贴当前剪贴板内容。
   */
  async paste(text?: string): Promise<void> {
    if (text) {
      if (/^data:image\/[a-z]+?;base64,/.test(text)) {
        clipboard.writeImage(nativeImage.createFromDataURL(text))
      } else {
        clipboard.writeText(text)
      }
    }
    await this._browserWindow!.webContents.executeJavaScript("document.execCommand('paste')")
  }

  /**
   * 输入文本（模拟输入法输入，不触发键盘按键事件）
   *
   * 使用 webContents.insertText() 模拟 IME 输入行为。
   * 支持两种调用方式：
   * 1. input(text) - 在当前焦点元素中输入文本
   * 2. input(selector, text) - 先聚焦元素，再输入文本（支持 CSS/XPath 选择器和 >> iframe 嵌套）
   *
   * @param selectorOrText 选择器字符串或要输入的文本
   * @param text 要输入的文本（当第一个参数为选择器时）
   */
  async input(selectorOrText: string, text?: string): Promise<void> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }

    let inputText: string

    if (typeof text === 'string') {
      // input(selector, text) - 先聚焦元素再输入
      const selector = selectorOrText
      const jsCode = `(() => {
        const selector = ${JSON.stringify(selector)}
        const el = document.querySelector(selector)
        if (!el) throw new Error('input: unable to find element by selector "' + selector + '"')
        el.focus()
      })()`
      await this._browserWindow!.webContents.executeJavaScript(jsCode)
      inputText = text
    } else {
      // input(text) - 直接在当前焦点元素输入
      inputText = selectorOrText
    }

    // 使用 insertText 模拟输入法输入（不触发键盘事件）
    await this._browserWindow!.webContents.insertText(inputText)
  }

  /**
   * 物理鼠标事件（通过 sendInputEvent 实现）
   *
   * 支持两种定位方式：
   * 1. 坐标模式: mouseEvent(eventType, x, y, button?)
   * 2. 选择器模式: mouseEvent(eventType, selector, button?) - 先查询元素中心坐标
   *
   * @param eventType 事件类型（click / dblclick / mousedown / mouseup / mouseMove）
   * @param args 坐标或选择器参数
   */
  async mouseEvent(eventType: string, ...args: unknown[]): Promise<void> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }

    let x: number
    let y: number
    let button: 'left' | 'right' | 'middle' = 'left'

    if (typeof args[0] === 'number' && typeof args[1] === 'number') {
      // 坐标模式: mouseEvent(eventType, x, y, button?)
      x = args[0]
      y = args[1]
      if (typeof args[2] === 'string') button = args[2] as 'left' | 'right' | 'middle'
    } else if (typeof args[0] === 'string') {
      // 选择器模式: mouseEvent(eventType, selector, button?)
      const selector = args[0]
      const jsCode = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      })()`
      const pos = await this._browserWindow!.webContents.executeJavaScript(jsCode)
      if (!pos) {
        throw new Error(`mouseEvent: unable to find element by selector "${selector}"`)
      }
      x = pos.x
      y = pos.y
      if (typeof args[1] === 'string') button = args[1] as 'left' | 'right' | 'middle'
    } else {
      throw new Error('mouseEvent: parameter error')
    }

    const wc = this._browserWindow!.webContents

    switch (eventType) {
      case 'click':
        wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 })
        break
      case 'dblclick':
        wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 2 })
        wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 2 })
        break
      case 'mousedown':
        wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 })
        break
      case 'mouseup':
        wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 })
        break
      case 'mouseMove':
        wc.sendInputEvent({ type: 'mouseMove', x, y })
        break
      default:
        throw new Error(`mouseEvent: unsupported event type "${eventType}"`)
    }
  }

  /**
   * 拖放文件到页面中的指定位置
   *
   * 使用 CDP Input.dispatchDragEvent 模拟文件拖放。
   * 支持两种定位方式：
   * 1. drop(selector, files) - 拖放到元素中心
   * 2. drop(x, y, files) - 拖放到坐标位置
   *
   * @param selectorOrX CSS 选择器或 X 坐标
   * @param filesOrY 文件路径数组或 Y 坐标
   * @param files 文件路径数组（坐标模式时）
   */
  async drop(
    selectorOrX: string | number,
    filesOrY: string[] | number,
    files?: string[]
  ): Promise<void> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }

    let x: number
    let y: number
    let filePaths: string[]

    if (typeof selectorOrX === 'number' && typeof filesOrY === 'number') {
      // drop(x, y, files) - 坐标模式
      x = selectorOrX
      y = filesOrY
      filePaths = files as string[]
    } else if (typeof selectorOrX === 'string') {
      // drop(selector, files) - 选择器模式
      const jsCode = `(() => {
        const el = document.querySelector(${JSON.stringify(selectorOrX)})
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      })()`
      const pos = await this._browserWindow!.webContents.executeJavaScript(jsCode)
      if (!pos) {
        throw new Error(`drop: unable to find element by selector "${selectorOrX}"`)
      }
      x = pos.x
      y = pos.y
      filePaths = filesOrY as string[]
    } else {
      throw new Error('drop: parameter error')
    }

    // 校验文件是否存在
    for (const f of filePaths) {
      if (!fs.existsSync(f)) {
        throw new Error(`drop: file "${f}" does not exist`)
      }
    }

    // 使用 CDP Input.dispatchDragEvent 模拟拖放
    const debugger_ = this._browserWindow!.webContents.debugger
    debugger_.attach('1.1')
    try {
      const dragData = {
        items: filePaths.map(() => ({
          mimeType: 'application/octet-stream',
          data: ''
        })),
        files: filePaths,
        dragOperationsMask: 1 // Copy
      }

      await debugger_.sendCommand('Input.dispatchDragEvent', {
        type: 'dragEnter',
        x,
        y,
        data: dragData
      })
      await debugger_.sendCommand('Input.dispatchDragEvent', {
        type: 'dragOver',
        x,
        y,
        data: dragData
      })
      await debugger_.sendCommand('Input.dispatchDragEvent', {
        type: 'drop',
        x,
        y,
        data: dragData
      })
    } finally {
      debugger_.detach()
    }
  }

  /**
   * 将网页内容转换为 Markdown
   *
   * 使用 turndown 库将 HTML 转换为 Markdown。
   * 先在页面上下文中获取 HTML 内容，再在 Node.js 端用 turndown 转换。
   *
   * @param selector 要转换的元素选择器（可选，不传则转换整个页面 body）
   * @returns Markdown 文本
   */
  async markdown(selector?: string): Promise<string> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }

    // 从页面获取 HTML 内容
    const jsCode = selector
      ? `(() => {
          const el = document.querySelector(${JSON.stringify(selector)})
          return el ? el.innerHTML : null
        })()`
      : `document.body.innerHTML`

    const html = await this._browserWindow!.webContents.executeJavaScript(jsCode)
    if (html === null) {
      throw new Error(`markdown: unable to find element by selector "${selector}"`)
    }

    // 使用 turndown 转换 HTML → Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    })
    return turndownService.turndown(html)
  }

  /**
   * 设置文件输入框的文件列表
   *
   * 使用 Chrome DevTools Protocol（CDP）的 DOM.setFileInputFiles 命令。
   *
   * @param selector CSS 选择器
   * @param files 文件路径数组
   */
  async file(selector: string, files: string[]): Promise<void> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }
    // 安全校验：仅允许临时目录下的文件（由 client.js _resolveFilePayload 生成）
    const allowedDir = path.join(app.getPath('temp'), 'ztools-zbrowser')
    for (const filePath of files) {
      const resolved = path.resolve(filePath)
      if (!resolved.startsWith(allowedDir + path.sep) && !resolved.startsWith(allowedDir)) {
        throw new Error(`file: access restricted to temp directory`)
      }
    }
    const debugger_ = this._browserWindow!.webContents.debugger
    debugger_.attach('1.1')
    try {
      const doc = await debugger_.sendCommand('DOM.getDocument')
      const result = await debugger_.sendCommand('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector
      })
      await debugger_.sendCommand('DOM.setFileInputFiles', {
        nodeId: result.nodeId,
        files
      })
    } finally {
      debugger_.detach()
    }
  }

  /**
   * 截取窗口或元素的截图
   *
   * @param rect 截图区域（Electron.Rectangle）或 null（整个窗口）
   * @param savePath 保存路径（目录或完整文件路径）
   * @returns 保存的文件路径
   */
  async capture(rect: Electron.Rectangle | null, savePath?: string): Promise<string> {
    let dir: string
    let fileName: string | undefined

    if (savePath) {
      const resolvedPath = path.resolve(savePath)
      const tempBase = app.getPath('temp')
      const downloadBase = app.getPath('downloads')
      if (!resolvedPath.startsWith(tempBase) && !resolvedPath.startsWith(downloadBase)) {
        throw new Error('save path must be within temp or downloads directory')
      }
      if (/\.png$/i.test(savePath)) {
        dir = path.dirname(resolvedPath)
        fileName = path.basename(resolvedPath)
      } else {
        dir = resolvedPath
      }
      if (!fs.existsSync(dir)) {
        throw new Error('save directory not exist')
      }
    } else {
      dir = path.join(app.getPath('temp'), 'ztools-zbrowser')
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }

    const image = await this._browserWindow!.webContents.capturePage(rect ?? undefined)

    if (image.isEmpty()) {
      throw new Error('capture image destroyed')
    }

    const filePath = path.join(dir, fileName || `${Date.now()}.png`)
    fs.writeFileSync(filePath, image.toPNG())
    return filePath
  }

  /**
   * 按选择器或区域截图
   *
   * 选择器模式：先滚动到元素、再获取坐标（Math.round 取整）、再截图。
   * 与 uTools 行为一致。
   *
   * @param selectorOrRect CSS 选择器字符串、Rectangle 对象、或 undefined（整个窗口）
   * @param savePath 保存路径
   * @returns 文件路径
   */
  async screenshot(
    selectorOrRect?: string | Electron.Rectangle,
    savePath?: string
  ): Promise<string> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }

    if (typeof selectorOrRect === 'string') {
      // 选择器模式：scrollTo + getBoundingClientRect + Math.round
      const jsCode = `(()=>{
        const selector = ${JSON.stringify(selectorOrRect)}
        const element = document.querySelector(selector)
        if (!element) return
        let rect = element.getBoundingClientRect()
        window.scrollTo(rect.left, rect.top)
        rect = element.getBoundingClientRect()
        return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      })()`
      const rect = await this._browserWindow!.webContents.executeJavaScript(jsCode)
      if (rect) {
        return await this.capture(rect, savePath)
      }
      throw new Error(`unable to find element by selector "${selectorOrRect}"`)
    } else if (typeof selectorOrRect === 'object') {
      return await this.capture(selectorOrRect, savePath)
    } else if (selectorOrRect === undefined) {
      return await this.capture(null, savePath)
    }
    throw new Error('parameter error')
  }

  /**
   * 将页面导出为 PDF
   *
   * @param args [options?, savePath?]
   * @returns PDF 文件路径
   */
  async pdf(...args: unknown[]): Promise<string> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }

    let pdfOptions: Electron.PrintToPDFOptions = {}
    let savePath: string | null = null

    if (args.length === 1) {
      if (typeof args[0] === 'object') {
        pdfOptions = (args[0] as Electron.PrintToPDFOptions) || {}
      } else if (typeof args[0] === 'string') {
        savePath = args[0]
      }
    } else if (args.length > 1) {
      if (typeof args[0] === 'object') {
        pdfOptions = (args[0] as Electron.PrintToPDFOptions) || {}
      }
      if (typeof args[1] === 'string') {
        savePath = args[1]
      }
    }

    let dir: string
    let fileName: string | undefined

    if (savePath) {
      const resolvedPath = path.resolve(savePath)
      const tempBase = app.getPath('temp')
      const downloadBase = app.getPath('downloads')
      if (!resolvedPath.startsWith(tempBase) && !resolvedPath.startsWith(downloadBase)) {
        throw new Error('save path must be within temp or downloads directory')
      }
      if (/\.pdf$/i.test(savePath)) {
        dir = path.dirname(resolvedPath)
        fileName = path.basename(resolvedPath)
      } else {
        dir = resolvedPath
      }
      if (!fs.existsSync(dir)) {
        throw new Error('save directory not exist')
      }
    } else {
      dir = path.join(app.getPath('temp'), 'ztools-zbrowser')
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }

    const data = await this._browserWindow!.webContents.printToPDF(pdfOptions)
    const filePath = path.join(dir, fileName || `${Date.now()}.pdf`)
    fs.writeFileSync(filePath, data)
    return filePath
  }

  /**
   * 下载文件
   *
   * 支持两种调用方式：
   * 1. download(url, savePath?) - 直接下载 URL
   * 2. download(jsCode, savePath, true) - 先在页面中执行代码获取 URL，再下载
   *
   * @param urlOrCode 下载地址或序列化的 JS 代码
   * @param savePath 保存路径（可选）
   * @param isFunc 是否为函数模式（第三个参数为 true 时）
   * @returns 下载后的文件路径
   */
  async download(urlOrCode: string, savePath?: string, isFunc?: boolean): Promise<string> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }

    let url: string

    if (isFunc) {
      // 函数模式：先在页面中执行代码获取下载 URL
      const result = await this._browserWindow!.webContents.executeJavaScript(urlOrCode, true)
      if (result.error) {
        throw new Error(result.message)
      }
      url = result.data
      if (!url || typeof url !== 'string') {
        throw new Error('download: function did not return a valid URL')
      }
    } else {
      url = urlOrCode
    }

    // 安全校验：仅允许 http/https 协议，防止 file:// 读取本地文件
    if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error('download: url must be http or https')
    }

    return await new Promise<string>((resolve, reject) => {
      const sess = this._browserWindow!.webContents.session
      sess.once('will-download', (_event, item) => {
        let finalPath = savePath

        if (finalPath) {
          try {
            if (fs.existsSync(finalPath)) {
              if (!fs.lstatSync(finalPath).isDirectory()) {
                throw new Error(`"${finalPath}" existed`)
              }
              finalPath = path.join(finalPath, path.basename(item.getFilename()))
              if (fs.existsSync(finalPath)) {
                throw new Error(`"${finalPath}" existed`)
              }
            } else {
              const dir = path.dirname(finalPath)
              if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) {
                throw new Error(`save directory "${dir}" no exist`)
              }
              if (!path.extname(finalPath)) {
                finalPath += path.extname(item.getFilename())
              }
            }
          } catch (err) {
            _event.preventDefault()
            reject(err)
            return
          }
        } else {
          const tempDir = path.join(
            app.getPath('temp'),
            'ztools-zbrowser',
            `download_${Date.now()}`
          )
          try {
            fs.mkdirSync(tempDir, { recursive: true })
          } catch (err) {
            _event.preventDefault()
            reject(err)
            return
          }
          finalPath = path.join(tempDir, path.basename(item.getFilename()))
        }

        item.setSavePath(finalPath)
        item.once('done', (_e, state) => {
          if (state === 'completed') {
            resolve(finalPath!)
          } else {
            reject(new Error('download failed'))
          }
        })
      })

      this._browserWindow!.webContents.downloadURL(url)
    })
  }

  /**
   * 设备模拟
   *
   * @param typeOrConfig 设备名称（字符串）或自定义配置对象
   */
  async device(typeOrConfig: string | DeviceConfig): Promise<void> {
    let config: DeviceConfig

    if (typeof typeOrConfig === 'string') {
      if (!(typeOrConfig in ZBROWSER_DEVICES)) {
        throw new Error('type not found')
      }
      config = ZBROWSER_DEVICES[typeOrConfig]
    } else if (typeof typeOrConfig === 'object') {
      if (
        typeof typeOrConfig.size !== 'object' ||
        typeof typeOrConfig.size.width !== 'number' ||
        typeof typeOrConfig.size.height !== 'number'
      ) {
        throw new Error('property "size" wrong')
      }
      if (typeof typeOrConfig.useragent !== 'string') {
        throw new Error('property "useragent" wrong')
      }
      config = typeOrConfig
    } else {
      throw new Error('parameter error')
    }

    const win = this._browserWindow!
    win.setContentSize(config.size.width, config.size.height)
    win.resizable = false
    win.maximizable = false
    win.fullScreenable = false
    win.webContents.userAgent = config.useragent

    // 注册 dom-ready 回调以启用设备模拟（使用自定义标志避免重复注册）
    const wc = win.webContents as Electron.WebContents & {
      _zbrowserDeviceEmulationEnabled?: boolean
    }
    if (!wc._zbrowserDeviceEmulationEnabled) {
      wc._zbrowserDeviceEmulationEnabled = true
      wc.on('dom-ready', () => {
        const contentSize = win.getContentSize()
        win.webContents.enableDeviceEmulation({
          screenPosition: 'mobile',
          screenSize: { width: contentSize[0], height: contentSize[1] },
          viewPosition: { x: 0, y: 0 },
          viewSize: { width: contentSize[0], height: contentSize[1] },
          deviceScaleFactor: 0,
          scale: 1
        })
      })
    }
  }

  // ─────────────────── Cookie 操作 ───────────────────

  /**
   * 获取 Cookie
   *
   * 与 uTools 签名一致：cookies(name?) → 不传参返回全部，传 name 返回单个。
   */
  async cookies(name?: string): Promise<Electron.Cookie | Electron.Cookie[] | null> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }
    const filter: Electron.CookiesGetFilter = {
      url: this._browserWindow!.webContents.getURL()
    }
    if (typeof name === 'string' && name) {
      filter.name = name
    }
    const cookies = await this._browserWindow!.webContents.session.cookies.get(filter)
    if (typeof name === 'string' && name) {
      return cookies.length > 0 ? cookies[0] : null
    }
    return cookies
  }

  /**
   * 设置 Cookie
   *
   * 支持两种签名：setCookies(name, value) 或 setCookies([{name, value, ...}])
   */
  async setCookies(...args: [string, string] | [Array<Electron.CookiesSetDetails>]): Promise<void> {
    const sess = this._browserWindow!.webContents.session
    const currentUrl = this._pageIsDomReadyed
      ? this._browserWindow!.webContents.getURL()
      : undefined

    if (args.length === 2 && typeof args[0] === 'string') {
      // setCookies(name, value)
      const details: Electron.CookiesSetDetails = {
        url: currentUrl || 'http://localhost',
        name: args[0],
        value: args[1] as string
      }
      await sess.cookies.set(details)
    } else if (Array.isArray(args[0])) {
      // setCookies([{name, value, ...}])
      for (const cookie of args[0]) {
        await sess.cookies.set({ ...cookie, url: cookie.url || currentUrl || 'http://localhost' })
      }
    }
  }

  /**
   * 删除指定名称的 Cookie
   *
   * 使用当前页面 URL。
   */
  async removeCookies(name: string): Promise<void> {
    if (!this._pageIsDomReadyed) {
      throw new Error('"goto" method did not executed')
    }
    const url = this._browserWindow!.webContents.getURL()
    await this._browserWindow!.webContents.session.cookies.remove(url, name)
  }

  /**
   * 清除 Cookie
   *
   * 页面已加载时使用当前 URL（忽略参数），否则 url 参数必传。
   */
  async clearCookies(url?: string): Promise<void> {
    const sess = this._browserWindow!.webContents.session
    const targetUrl = this._pageIsDomReadyed ? this._browserWindow!.webContents.getURL() : url

    if (!targetUrl) {
      throw new Error('url is required when page is not loaded')
    }

    const cookies = await sess.cookies.get({ url: targetUrl })
    for (const cookie of cookies) {
      await sess.cookies.remove(targetUrl, cookie.name)
    }
  }

  // ─────────────────── 运行入口 ───────────────────

  /**
   * 执行 zbrowser 操作队列
   *
   * @param params.pluginName  插件名称（用于 Session 隔离和窗口池）
   * @param params.pluginLogo  插件图标路径（窗口图标）
   * @param params.ubrowserId  复用的窗口 ID（可选）
   * @param params.options     窗口配置对象
   * @param params.queue       操作队列
   * @param params.idleWindowIds 当前插件的空闲窗口 ID 列表
   * @returns 运行结果
   */
  async run(params: {
    pluginName: string
    runtimeNamespace: string
    pluginLogo: string
    ubrowserId?: number
    options: ZBrowserRunOptions
    queue: ZBrowserQueueItem[]
    idleWindowIds: number[]
  }): Promise<ZBrowserRunResult> {
    const { pluginName, runtimeNamespace, pluginLogo, ubrowserId, options, queue, idleWindowIds } =
      params

    console.log(
      `[zbrowser] 开始执行: pluginName="${pluginName}", runtimeNamespace="${runtimeNamespace}", ` +
        `队列长度=${queue.length}, ` +
        `模式=${ubrowserId ? '复用窗口#' + ubrowserId : '新建窗口'}`
    )

    try {
      // 获取或创建窗口
      if (ubrowserId !== undefined) {
        // 窗口复用模式：通过 windowId 查找空闲窗口
        if (!idleWindowIds.includes(ubrowserId)) {
          throw new Error('no ubrowser with id')
        }
        const win = BrowserWindow.fromId(ubrowserId)
        if (!win || win.isDestroyed()) {
          throw new Error('no ubrowser with id')
        }
        this._browserWindow = win
        // 从空闲池移除（正在使用中）
        zbrowserManager.removeIdleWindow(runtimeNamespace, ubrowserId)
        console.log(`[zbrowser] 复用空闲窗口: windowId=${ubrowserId}`)
      } else {
        // 新建窗口模式
        this._browserWindow = this.createBrowserWindow(
          runtimeNamespace,
          pluginName,
          pluginLogo,
          options
        )
        console.log(`[zbrowser] 新建窗口: windowId=${this._browserWindow.id}`)
      }

      // 如果配置了 show，记录显示状态
      if (options.show !== false) {
        this._isShow = true
      }

      // fork runner 子进程并执行队列
      const result = await this.forkAndExecute(queue)

      // 运行结束后处理窗口
      this.handleWindowAfterRun(runtimeNamespace)

      // 可见窗口加入空闲池后，返回窗口信息供后续复用
      if (this._browserWindow && !this._browserWindow.isDestroyed()) {
        const win = this._browserWindow
        const bounds = win.getBounds()
        result.windowId = win.id
        result.windowInfo = {
          id: win.id,
          url: win.webContents.getURL(),
          title: win.getTitle(),
          width: bounds.width,
          height: bounds.height,
          x: bounds.x,
          y: bounds.y
        }
      }

      return result
    } catch (error) {
      // 异常时清理窗口
      this.destroyWindow()
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[zbrowser] 执行失败: ${message}`)
      return { data: [], error: true, message }
    }
  }

  // ─────────────────── 私有方法 ───────────────────

  /**
   * 创建 BrowserWindow
   *
   * 使用插件专属 zbrowser Session，严格过滤允许的窗口选项。
   */
  private createBrowserWindow(
    runtimeNamespace: string,
    pluginName: string,
    pluginLogo: string,
    options: ZBrowserRunOptions
  ): BrowserWindow {
    const sess = zbrowserManager.getOrCreateSession(runtimeNamespace, pluginName)

    // 窗口选项白名单过滤
    const winOptions: Electron.BrowserWindowConstructorOptions = {
      show: false, // 首次 goto 时再自动 show
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        session: sess
      }
    }

    // 安全的窗口选项白名单
    const allowedKeys: (keyof ZBrowserRunOptions)[] = [
      'width',
      'height',
      'x',
      'y',
      'center',
      'minWidth',
      'minHeight',
      'maxWidth',
      'maxHeight',
      'resizable',
      'movable',
      'minimizable',
      'maximizable',
      'alwaysOnTop',
      'fullscreen',
      'fullscreenable',
      'enableLargerThanScreen',
      'opacity',
      'frame',
      'closable',
      'focusable',
      'skipTaskbar',
      'backgroundColor',
      'hasShadow',
      'transparent',
      'titleBarStyle',
      'thickFrame'
    ]

    for (const key of allowedKeys) {
      if (options[key] !== undefined) {
        ;(winOptions as Record<string, unknown>)[key] = options[key]
      }
    }

    // 设置窗口图标
    if (pluginLogo && fs.existsSync(pluginLogo)) {
      winOptions.icon = pluginLogo
    }

    const win = new BrowserWindow(winOptions)

    // 添加右键菜单支持（TODO: 可在后续阶段完善）

    // 注册开发者工具快捷键
    win.webContents.on('focus', () => {
      if (win && !win.webContents.isDestroyed()) {
        devToolsShortcut.register(win.webContents)
      }
    })

    win.webContents.on('blur', () => {
      devToolsShortcut.unregister()
    })

    return win
  }

  /**
   * fork runner 子进程并执行操作队列
   *
   * runner 子进程通过 IPC 消息与主进程通信：
   * - runner → main: { method, methodEndKey, args } 请求执行操作
   * - main → runner: { action, payload } 返回执行结果
   * - runner → main: { method: 'runEnd', args: [result] } 队列执行完毕
   */
  private forkAndExecute(queue: ZBrowserQueueItem[]): Promise<ZBrowserRunResult> {
    return new Promise((resolve, reject) => {
      // 使用 app.isPackaged 选择 runner 路径（避免 asar 内 fork 失败）
      const actualRunnerPath = app.isPackaged
        ? path.join(process.resourcesPath, 'zbrowser', 'runner.js')
        : getAppBundlePath('resources', 'zbrowser', 'runner.js')

      this._childProcess = fork(actualRunnerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      })

      // 防止 resolve/reject 被多次调用（exit 事件可能在 runEnd 之后触发）
      let settled = false

      // 全局执行超时保护（防止 runner 挂起导致资源泄漏）
      const globalTimer = setTimeout(() => {
        if (settled) return
        settled = true
        console.error(`[zbrowser] 执行超时（${EXECUTION_TIMEOUT}ms），强制终止`)
        this.killChildProcess()
        reject(new Error('zbrowser execution timeout'))
      }, EXECUTION_TIMEOUT)

      // 监听 runner 的 stdout/stderr（调试用）
      this._childProcess.stdout?.on('data', (data: Buffer) => {
        console.log(`[zbrowser:runner:stdout] ${data.toString().trim()}`)
      })
      this._childProcess.stderr?.on('data', (data: Buffer) => {
        console.error(`[zbrowser:runner:stderr] ${data.toString().trim()}`)
      })

      // 监听 runner 发来的消息
      this._childProcess.on('message', async (msg: RunnerToMainMessage) => {
        const { method, methodEndKey, args } = msg

        if (method === 'runEnd') {
          // 队列执行完毕
          if (settled) return
          settled = true
          clearTimeout(globalTimer)
          const result = (args[0] as ZBrowserRunResult) || { data: [] }
          this.killChildProcess()
          resolve(result)
          return
        }

        // 方法白名单校验（防止原型链攻击和私有方法调用）
        if (!ALLOWED_METHODS.has(method)) {
          console.error(`[zbrowser] 拒绝执行不允许的方法: "${method}"`)
          this.sendToRunner(methodEndKey, { error: true, message: `unknown method: ${method}` })
          return
        }

        // 在 BrowserWindow 上执行对应操作
        try {
          const handler = this[method as keyof ZBrowserExecutor] as (
            ...handlerArgs: unknown[]
          ) => Promise<unknown>
          const data = await handler.apply(this, args)
          this.sendToRunner(methodEndKey, { data })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[zbrowser] 方法 "${method}" 执行失败: ${message}`)
          this.sendToRunner(methodEndKey, { error: true, message })
        }
      })

      // 子进程退出时的异常处理
      this._childProcess.on('exit', (code) => {
        if (settled) return
        settled = true
        clearTimeout(globalTimer)
        if (code !== 0 && code !== null) {
          console.error(`[zbrowser] runner 子进程异常退出, code=${code}`)
          reject(new Error(`runner process exited with code ${code}`))
        } else {
          console.error(`[zbrowser] runner 子进程退出但未返回结果`)
          reject(new Error('runner process exited without sending results'))
        }
      })

      this._childProcess.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(globalTimer)
        console.error(`[zbrowser] runner 子进程错误:`, err.message)
        reject(err)
      })

      // 发送操作队列给 runner 开始执行
      const startMsg: MainToRunnerMessage = {
        action: 'run',
        payload: queue
      }
      this._childProcess.send(startMsg)
    })
  }

  /**
   * 发送响应消息给 runner 子进程
   */
  private sendToRunner(
    methodEndKey: string,
    payload: { data?: unknown; error?: boolean; message?: string }
  ): void {
    if (this._childProcess && this._childProcess.connected) {
      const msg: MainToRunnerMessage = {
        action: methodEndKey,
        payload
      }
      this._childProcess.send(msg)
    }
  }

  /**
   * 运行结束后处理窗口：可见窗口加入空闲池，不可见窗口销毁
   */
  private handleWindowAfterRun(runtimeNamespace: string): void {
    if (!this._browserWindow || this._browserWindow.isDestroyed()) return

    if (this._browserWindow.isVisible()) {
      // 可见窗口 → 加入空闲池
      zbrowserManager.addIdleWindow(runtimeNamespace, this._browserWindow.id)
      console.log(`[zbrowser] 窗口保留为空闲: windowId=${this._browserWindow.id}`)

      // 监听窗口关闭事件，自动从空闲池移除
      const windowId = this._browserWindow.id
      this._browserWindow.once('closed', () => {
        zbrowserManager.removeIdleWindow(runtimeNamespace, windowId)
        devToolsShortcut.unregister()
      })
    } else {
      // 不可见窗口 → 销毁
      this.destroyWindow()
      console.log(`[zbrowser] 不可见窗口已销毁`)
    }
  }

  /** 销毁 BrowserWindow */
  private destroyWindow(): void {
    if (this._browserWindow && !this._browserWindow.isDestroyed()) {
      this._browserWindow.destroy()
    }
    this._browserWindow = null
  }

  /** 终止 runner 子进程 */
  private killChildProcess(): void {
    if (this._childProcess) {
      this._childProcess.removeAllListeners()
      if (this._childProcess.connected) {
        this._childProcess.disconnect()
      }
      this._childProcess.kill('SIGTERM')
      this._childProcess = null
    }
  }
}
