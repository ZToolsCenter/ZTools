/// <reference path="ubw.d.ts"/>
/// <reference path="electron.d.ts"/>

interface ZToolsAiModel {
  id: string
  label: string
  description: string
  icon: string
  cost: number
}
interface ZToolsAiResult<T> extends Promise<T> {
  abort(): void
}

interface ZToolsAiMessage {
  role: 'system' | 'user' | 'assistant'
  content?: string
  reasoning_content?: string
}

interface ZToolsAiTool {
  type: 'function'
  function?: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
    }
    required?: string[]
  }
}

interface ZToolsAiOption {
  model?: string
  messages: ZToolsAiMessage[]
  tools?: ZToolsAiTool[]
}

interface CookieFilter {
  url?: string
  name?: string
  domain?: string
  path?: string
  secure?: boolean
  session?: boolean
  httpOnly?: boolean
}

interface UBrowser {
  /**
   * 设置 User-Agent
   */
  useragent(userAgent: string): this
  /**
   * 前往
   * @param url 链接地址,支持 http 或 file 协议
   * @param headers 请求头参数
   * @param timeout 加载超时,默认 60000 ms(60秒)
   */
  goto(url: string, headers?: { Referer: string; userAgent: string }, timeout?: number): this
  /**
   * 页面大小
   */
  viewport(width: number, height: number): this
  /**
   * 隐藏 zbrowser 窗口
   */
  hide(): this
  /**
   * 显示 zbrowser 窗口
   */
  show(): this
  /**
   * 注入样式
   */
  css(css: string): this
  /**
   * 键盘按键
   */
  press(key: string, ...modifier: ('ctrl' | 'shift' | 'alt' | 'meta')[]): this
  /**
   * 粘贴
   * @param text 如果是图片的base64编码字符串，粘贴图片，为空只执行粘贴动作
   */
  paste(text?: string): this
  /**
   * 页面截图
   * @param arg 1.字符串 - 要截取的DOM元素， 2.对象 - 截图位置和大小， 3.空 - 为截取整个窗口
   * @param savePath 截图保存路径，可以是文件夹 或 .png文件完全路径, 默认保存临时目录
   */
  screenshot(
    arg: string | { x: number; y: number; width: number; height: number },
    savePath?: string
  ): this
  /**
   * 转为 markdown 文本
   * @param selector css 选择器或者XPATH
   */
  markdown(selector?: string): this
  /**
   * 保存为PDF
   * @param options 选项
   * @param savePath PDF保存路径，可以是文件夹 或 .pdf文件完全路径, 默认保存临时目录
   */
  pdf(
    options?: {
      marginsType: 0 | 1 | 2
      pageSize:
        | ('A3' | 'A4' | 'A5' | 'Legal' | 'Letter' | 'Tabloid')
        | { width: number; height: number }
    },
    savePath?: string
  ): this
  /**
   * 模拟设备
   */
  device(arg: { size: { width: number; height: number }; useragent: string }): this
  /**
   * 在当前 url 根据名称获取 cookie
   * @param name 为空获取当前 url 全部 cookie
   */
  cookies(name?: string): this
  /**
   * 根据条件获取 zbrowser cookies
   * @param filter 条件过滤对象
   */
  cookies(filter: CookieFilter): this
  /**
   * 设置Cookie
   */
  setCookies(name: string, value: string): this
  /**
   * 设置Cookie
   */
  setCookies(cookies: { name: string; value: string }[]): this
  /**
   * 删除 cookie
   */
  removeCookies(name: string): this
  /**
   * 清空cookie
   * @param url 在执行"goto"前执行 url参数必需
   */
  clearCookies(url?: string): this
  /**
   * 打开开发者工具
   */
  devTools(mode?: 'right' | 'bottom' | 'undocked' | 'detach'): this
  /**
   * 执行JS计算 并获得结果
   * @param func 在目标网页中执行
   * @param params 传到 func 中的参数
   */
  evaluate<T extends any[]>(func: (...params: T) => any, ...params: T): this
  /**
   * 等待时间
   * @param ms 毫秒
   */
  wait(ms: number): this
  /**
   * 等待元素出现
   * @param selector DOM元素
   * @param timeout 超时 默认60000 ms(60秒)
   */
  wait(selector: string, timeout?: number): this
  /**
   * 等待 JS函数 执行返回 true
   * @param func 执行的JS函数
   * @param timeout 超时 默认60000 ms(60秒)
   * @param params 传到 func 中的参数
   */
  wait<T extends any[]>(func: (...params: T) => boolean, timeout?: number, ...params: T): this
  /**
   * 当元素存在时执行，直到碰到 end
   * @param selector DOM元素
   */
  when(selector: string): this
  /**
   * 当 JS函数执行返回 true 时执行直到碰到 end
   * @param func 执行的JS函数
   * @param params 传到 func 中的参数
   */
  when<T extends any[]>(func: (...params: T) => boolean, ...params: T): this
  /**
   * 配合 when 使用
   */
  end(): this
  /**
   * 单击元素
   */
  click(selector: string): this
  /**
   * 元素触发按下鼠标左键
   */
  mousedown(selector: string): this
  /**
   * 元素触发释放鼠标左键
   */
  mouseup(selector: string): this
  /**
   * 赋值 file input
   * @param selector <input type='file' /> 元素
   * @param payload 1. string - 文件路径 或 图片的base64编码，2. string[] - 文件路径集合，3. Uint8Array[]
   */
  file(selector: string, payload: string | string[] | Uint8Array): this
  /**
   * input textarea select 等元素赋值并触发 input 或 change事件
   */
  value(selector: string, value: string): this
  /**
   * checkbox radio 元素选中或取消选中
   */
  check(selector: string, checked: boolean): this
  /**
   * 元素获得焦点
   */
  focus(selector: string): this
  /**
   * 滚动到元素位置
   */
  scroll(selector: string): this
  /**
   * Y轴滚动
   */
  scroll(y: number): this
  /**
   * X轴和Y轴滚动
   */
  scroll(x: number, y: number): this
  /**
   * 下载文件
   */
  download(url: string, savePath?: string): this
  /**
   * 下载文件
   */
  download(func: (...params: any[]) => string, savePath: string | null, ...params: any[]): this
  /**
   * 启动一个 zbrowser 运行
   * 当运行结束后，窗口如果为隐藏状态将自动销毁窗口
   * @param options
   */
  run<T extends any = any[]>(options: {
    show?: boolean
    width?: number
    height?: number
    x?: number
    y?: number
    center?: boolean
    minWidth?: number
    minHeight?: number
    maxWidth?: number
    maxHeight?: number
    resizable?: boolean
    movable?: boolean
    minimizable?: boolean
    maximizable?: boolean
    alwaysOnTop?: boolean
    fullscreen?: boolean
    fullscreenable?: boolean
    enableLargerThanScreen?: boolean
    opacity?: number
    frame?: boolean
    closable?: boolean
    focusable?: boolean
    skipTaskbar?: boolean
    backgroundColor?: string
    hasShadow?: boolean
    transparent?: boolean
    titleBarStyle?: string
    thickFrame?: boolean
  }): Promise<T>
  /**
   * 运行在闲置的 zbrowser 上
   * @param zbrowserId 1. run(options) 运行结束后, 当 zbrowser 实例窗口仍然显示时返回 2. ztools.getIdleUBrowsers() 中获得
   */
  run<T extends any = any[]>(zbrowserId: number): Promise<T>
}

interface Display {
  accelerometerSupport: 'available' | 'unavailable' | 'unknown'
  bounds: { x: number; y: number; width: number; height: number }
  colorDepth: number
  colorSpace: string
  depthPerComponent: number
  id: number
  internal: boolean
  monochrome: boolean
  rotation: number
  scaleFactor: number
  size: { width: number; height: number }
  touchSupport: 'available' | 'unavailable' | 'unknown'
  workArea: { x: number; y: number; width: number; height: number }
  workAreaSize: { width: number; height: number }
}

type DbDoc<T extends {} = Record<string, any>> = {
  _id: string
  _rev?: string
} & T

interface DbReturn {
  id: string
  rev?: string
  ok?: boolean
  error?: boolean
  name?: string
  message?: string
}

interface PluginFeature {
  code: string
  explain?: string
  platform?: ('darwin' | 'win32' | 'linux') | Array<'darwin' | 'win32' | 'linux'>
  icon?: string
  cmds: (
    | string
    | {
        type: 'img' | 'files' | 'regex' | 'over' | 'window'
        label: string
      }
  )[]
  mainHide?: boolean
  mainPush?: boolean
}

type PluginEnterFrom = 'main' | 'panel' | 'hotkey' | 'redirect'

interface FfmpegRunProgress {
  bitrate: string
  fps: number
  frame: number
  percent?: number
  q: number | string
  size: string
  speed: string
  time: string
}

interface FfmpegPromise extends Promise<void> {
  kill(): void
  quit(): void
}

interface MainPushResult {
  icon?: string
  text: string
  title?: string
}

type MainPushResultList = MainPushResult[] | Promise<MainPushResult[]>

interface ZToolsApi {
  /**
   * 插件应用进入时触发
   */
  onPluginEnter<T = any, L = any>(
    callback: (action: {
      code: string
      type: string
      payload: T
      option: L
      from?: PluginEnterFrom
    }) => void
  ): void
  /**
   * 向搜索面板推送消息
   */
  onMainPush<T = any>(
    callback: (action: { code: string; type: string; payload: T }) => MainPushResultList,
    selectCallback: (action: {
      code: string
      type: string
      payload: any
      option: MainPushResult
    }) => void
  ): void
  /**
   * 插件应用隐藏后台或完全退出时触发
   */
  onPluginOut(callback: (processExit: boolean) => void): void
  /**
   * 插件应用分离时触发
   */
  onPluginDetach(callback: () => void): void
  /**
   * 插件应用从云端拉取到数据时触发
   */
  onDbPull<T extends {} = Record<string, any>>(callback: (docs: DbDoc<T>[]) => void): void
  /**
   * 隐藏主窗口
   * @param isRestorePreWindow 是否焦点回归到前面的活动窗口，默认 true
   */
  hideMainWindow(isRestorePreWindow?: boolean): boolean
  /**
   * 显示主窗口
   */
  showMainWindow(): boolean
  /**
   * 设置插件应用自身高度
   */
  setExpendHeight(height: number): boolean
  /**
   * 设置子输入框
   * @param onChange 修改时触发
   * @param placeholder 占位符， 默认为空
   * @param isFocus 是否获得焦点，默认为 true
   */
  setSubInput(
    onChange: (input: { text: string }) => void,
    placeholder?: string,
    isFocus?: boolean
  ): boolean
  /**
   * 移除子输入框
   */
  removeSubInput(): boolean
  /**
   * 赋值子输入框
   */
  setSubInputValue(value: string): boolean
  /**
   * 子输入框获得焦点
   */
  subInputFocus(): boolean
  /**
   * 子输入框获得焦点并选中
   */
  subInputSelect(): boolean
  /**
   * 子输入框失去焦点，插件应用获得焦点
   */
  subInputBlur(): boolean
  /**
   * 创建独立窗口
   * @param url 相对路径 html 文件
   * @param options 参考 https://www.electronjs.org/docs/api/browser-window#new-browserwindowoptions
   * @param callback url 加载完成时的回调
   */
  createBrowserWindow(
    url: string,
    options: BrowserWindow.InitOptions,
    callback?: () => void
  ): BrowserWindow.WindowInstance
  /**
   * 发送消息到父窗口
   * **仅在 `createBrowserWindow` 创建的窗口中使用有效**
   * @param channel 通道名
   * @param params 发送的数据
   */
  sendToParent(channel: string, ...params: any[]): void
  /**
   * 隐藏插件应用到后台
   * @param {boolean|undefined} isKill 设置为 `true` 时，会将插件进程杀死
   */
  outPlugin(isKill?: boolean): boolean
  /**
   * 是否深色模式
   */
  isDarkColors(): boolean
  /**
   * 获取用户
   */
  getUser(): { avatar: string; nickname: string; type: string } | null
  /**
   * 获取用户服务端临时令牌
   */
  fetchUserServerTemporaryToken(): Promise<{ token: string; expiredAt: number }>
  /**
   * 是否插件应用的付费用户
   */
  isPurchasedUser(): boolean
  /**
   * 打开付费 (软件付费)
   * @param callback 购买成功触发
   */
  openPurchase(
    options: {
      /**
       * 商品 ID，在「开发者工具」插件应用中创建
       */
      goodsId: string
      /**
       * 第三方服务生成的订单号(可选)
       */
      outOrderId?: string
      /**
       * 第三方服务附加数据，在查询API和支付通知中原样返回，可作为自定义参数使用(可选)
       */
      attach?: string
    },
    callback?: () => void
  ): void
  /**
   * 打开支付 (付费)
   * @param callback 支付成功触发
   */
  openPayment(
    options: {
      /**
       * 商品 ID，在「开发者工具」插件应用中创建
       */
      goodsId: string
      /**
       * 第三方服务生成的订单号(可选)
       */
      outOrderId?: string
      /**
       * 第三方服务附加数据，在查询API和支付通知中原样返回，可作为自定义参数使用(可选)
       */
      attach?: string
    },
    callback?: () => void
  ): void
  /**
   * 获取用户支付记录
   */
  fetchUserPayments(): Promise<
    {
      order_id: string
      total_fee: number
      body: string
      attach: string
      goods_id: string
      out_order_id: string
      paid_at: string
    }[]
  >
  /**
   * 设置插件应用动态功能
   */
  setFeature(feature: PluginFeature): boolean
  /**
   * 移除插件应用动态功能
   */
  removeFeature(code: string): boolean
  /**
   * 获取插件应用动态功能，参数为空获取所有动态功能
   */
  getFeatures(codes?: string[]): PluginFeature[]
  /**
   * 插件应用间跳转
   */
  redirect(
    label: string | string[],
    payload: string | { type: 'text' | 'img' | 'files'; data: any }
  ): boolean
  /**
   * 跳转(前往) ZTools 设置界面，引导用户配置指令全局快捷键
   * @param cmdLabel 指令名称
   * @param autocopy 是否自动复制，默认为 false
   */
  redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): void
  /**
   * 跳转(前往) ZTools 自定义 AI 模型设置界面，引导用户配置自定义 AI 模型
   */
  redirectAiModelsSetting(): void
  /**
   * 获取闲置的 zbrowser
   */
  getIdleUBrowsers(): { id: number; title: string; url: string }[]
  /**
   * 设置 zbrowser 代理 https://www.electronjs.org/docs/api/session#sessetproxyconfig
   */
  setUBrowserProxy(config: {
    pacScript?: string
    proxyRules?: string
    proxyBypassRules?: string
  }): boolean
  /**
   * 清空 zbrowser 缓存
   */
  clearUBrowserCache(): boolean
  /**
   * 显示系统通知
   */
  showNotification(body: string, featureName?: string): void
  /**
   * 弹出文件选择框
   */
  showOpenDialog(options: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: { name: string; extensions: string[] }[]
    properties?: Array<
      | 'openFile'
      | 'openDirectory'
      | 'multiSelections'
      | 'showHiddenFiles'
      | 'createDirectory'
      | 'promptToCreate'
      | 'noResolveAliases'
      | 'treatPackageAsDirectory'
      | 'dontAddToRecent'
    >
    message?: string
    securityScopedBookmarks?: boolean
  }): string[] | undefined
  /**
   * 弹出文件保存框
   */
  showSaveDialog(options: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: { name: string; extensions: string[] }[]
    message?: string
    nameFieldLabel?: string
    showsTagField?: string
    properties?: Array<
      | 'showHiddenFiles'
      | 'createDirectory'
      | 'treatPackageAsDirectory'
      | 'showOverwriteConfirmation'
      | 'dontAddToRecent'
    >
    securityScopedBookmarks?: boolean
  }): string | undefined
  /**
   * 插件应用页面中查找
   */
  findInPage(
    text: string,
    options?: {
      forward?: boolean
      findNext?: boolean
      matchCase?: boolean
      wordStart?: boolean
      medialCapitalAsWordStart?: boolean
    }
  ): void
  /**
   * 停止插件应用页面中查找
   */
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  /**
   * 拖拽文件
   */
  startDrag(file: string | string[]): void
  /**
   * 屏幕取色
   */
  screenColorPick(callback: (color: { hex: string; rgb: string }) => void): void
  /**
   * 屏幕截图
   */
  screenCapture(callback: (imgBase64: string) => void): void
  /**
   * 获取本地 ID
   */
  getNativeId(): string
  /**
   * 获取软件版本
   */
  getAppVersion(): string
  /**
   * 获取软件名称
   */
  getAppName(): string
  /**
   * 获取路径
   */
  getPath(
    name:
      | 'home'
      | 'appData'
      | 'userData'
      | 'cache'
      | 'temp'
      | 'exe'
      | 'module'
      | 'desktop'
      | 'documents'
      | 'downloads'
      | 'music'
      | 'pictures'
      | 'videos'
      | 'logs'
      | 'pepperFlashSystemPlugin'
  ): string
  /**
   * 获取文件图标
   */
  getFileIcon(filePath: string): string
  /**
   * 获取当前窗口类型, 'main' 主窗口 | 'detach' 分离窗口 | 'browser' 由 createBrowserWindow 创建的窗口
   */
  getWindowType(): 'main' | 'detach' | 'browser'
  /**
   * 复制文件到剪贴板
   */
  copyFile(file: string | string[]): boolean
  /**
   * 复制图片到剪贴板
   * @param img base64、buffer、图片路径
   */
  copyImage(img: string | Uint8Array): boolean
  /**
   * 复制文本到剪贴板
   */
  copyText(text: string): boolean
  /**
   * 获取复制的文件或文件夹
   */
  getCopyedFiles(): { isFile: boolean; isDirectory: boolean; name: string; path: string }[]
  /**
   * 读取当前文件管理器路径(linux 不支持)
   */
  readCurrentFolderPath(): Promise<string>
  /**
   * 读取当前浏览器窗口的URL(linux 不支持)
   * MacOs 支持浏览器 Safari、Chrome、Opera、Vivaldi、Brave
   * Windows 支持浏览器 Chrome、Firefox、Edge、IE、Opera、Brave
   * Linux 不支持
   */
  readCurrentBrowserUrl(): Promise<string>
  /**
   * 默认方式打开给定的文件
   */
  shellOpenPath(fullPath: string): void
  /**
   * 删除文件到回收站
   */
  shellTrashItem(filename: string): Promise<void>
  /**
   * 在文件管理器中显示给定的文件
   */
  shellShowItemInFolder(fullPath: string): void
  /**
   * 系统默认的协议打开URL
   */
  shellOpenExternal(url: string): void
  /**
   * 播放哔哔声
   */
  shellBeep(): void
  /*
   * 键入字符串
   */
  hideMainWindowTypeString(str: string): void
  /*
   * 粘贴文件
   */
  hideMainWindowPasteFile(file: string | string[]): void
  /*
   * 粘贴图像
   */
  hideMainWindowPasteImage(img: string | Uint8Array): void
  /*
   * 粘贴文本
   */
  hideMainWindowPasteText(text: string): void
  /**
   * 模拟键盘按键
   */
  simulateKeyboardTap(
    key: string,
    ...modifier: ('control' | 'ctrl' | 'shift' | 'option' | 'alt' | 'command' | 'super')[]
  ): void
  /**
   * 模拟鼠标单击
   */
  simulateMouseClick(x?: number, y?: number): void
  /**
   * 模拟鼠标右击
   */
  simulateMouseRightClick(x?: number, y?: number): void
  /**
   * 模拟鼠标双击
   */
  simulateMouseDoubleClick(x?: number, y?: number): void
  /**
   * 模拟鼠标移动
   */
  simulateMouseMove(x: number, y: number): void
  /**
   * 获取鼠标绝对位置
   */
  getCursorScreenPoint(): { x: number; y: number }
  /**
   * 获取主显示器
   */
  getPrimaryDisplay(): Display
  /**
   * 获取所有显示器
   */
  getAllDisplays(): Display[]
  /**
   * 获取位置所在的显示器
   */
  getDisplayNearestPoint(point: { x: number; y: number }): Display
  /**
   * 获取矩形所在的显示器
   */
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): Display
  /**
   * 屏幕物理坐标转 DIP 坐标
   */
  screenToDipPoint(point: { x: number; y: number }): { x: number; y: number }
  /**
   * 屏幕 DIP 坐标转物理坐标
   */
  dipToScreenPoint(point: { x: number; y: number }): { x: number; y: number }
  /**
   * 屏幕物理区域转 DIP 区域
   */
  screenToDipRect(rect: { x: number; y: number; width: number; height: number }): {
    x: number
    y: number
    width: number
    height: number
  }
  /**
   * 屏幕 DIP 区域转物理区域
   */
  dipToScreenRect(rect: { x: number; y: number; width: number; height: number }): {
    x: number
    y: number
    width: number
    height: number
  }
  /**
   * 录屏源
   */
  desktopCaptureSources(options: {
    types: string[]
    thumbnailSize?: { width: number; height: number }
    fetchWindowIcons?: boolean
  }): Promise<{ appIcon: {}; display_id: string; id: string; name: string; thumbnail: {} }>
  /**
   * 是否开发中
   */
  isDev(): boolean
  /**
   * 是否 MacOs 操作系统
   */
  isMacOS(): boolean
  /**
   * 是否 Windows 操作系统
   */
  isWindows(): boolean
  /**
   * 是否 Linux 操作系统
   */
  isLinux(): boolean

  db: {
    /**
     * 创建/更新文档
     */
    put(doc: DbDoc): DbReturn
    /**
     * 获取文档
     */
    get<T extends {} = Record<string, any>>(id: string): DbDoc<T> | null
    /**
     * 删除文档
     */
    remove(doc: string | DbDoc): DbReturn
    /**
     * 批量操作文档(新增、修改、删除)
     */
    bulkDocs(docs: DbDoc[]): DbReturn[]
    /**
     * 获取所有文档 可根据文档id前缀查找
     */
    allDocs<T extends {} = Record<string, any>>(key?: string): DbDoc<T>[]
    /**
     * 存储附件到新文档
     * @param docId 文档ID
     * @param attachment 附件 buffer
     * @param type 附件类型，示例：image/png, text/plain
     */
    postAttachment(docId: string, attachment: Uint8Array, type: string): DbReturn
    /**
     * 获取附件
     * @param docId 文档ID
     */
    getAttachment(docId: string): Uint8Array | null
    /**
     * 获取附件类型
     * @param docId 文档ID
     */
    getAttachmentType(docId: string): string | null
    /**
     * 云端复制数据状态 (null: 未开启数据同步、0: 已完成复制、1：复制中)
     */
    replicateStateFromCloud(): null | 0 | 1
    /**
     * 异步
     */
    promises: {
      /**
       * 创建/更新文档
       */
      put(doc: DbDoc): Promise<DbReturn>
      /**
       * 获取文档
       */
      get(id: string): Promise<DbDoc | null>
      /**
       * 删除文档
       */
      remove(doc: string | DbDoc): Promise<DbReturn>
      /**
       * 批量操作文档(新增、修改、删除)
       */
      bulkDocs(docs: DbDoc[]): Promise<DbReturn[]>
      /**
       * 获取所有文档 可根据文档id前缀查找
       */
      allDocs(key?: string): Promise<DbDoc[]>
      /**
       * 存储附件到新文档
       * @param docId 文档ID
       * @param attachment 附件 buffer
       * @param type 附件类型，示例：image/png, text/plain
       */
      postAttachment(docId: string, attachment: Uint8Array, type: string): Promise<DbReturn>
      /**
       * 获取附件
       * @param docId 文档ID
       */
      getAttachment(docId: string): Promise<Uint8Array | null>
      /**
       * 获取附件类型
       * @param docId 文档ID
       */
      getAttachmentType(docId: string): Promise<string | null>
      /**
       * 云端复制数据状态 (null: 未开启数据同步、0: 已完成复制、1：复制中)
       */
      replicateStateFromCloud(): Promise<null | 0 | 1>
    }
  }

  dbStorage: {
    /**
     * 键值对存储，如果键名存在，则更新其对应的值
     * @param key 键名(同时为文档ID)
     * @param value 键值
     */
    setItem(key: string, value: any): void
    /**
     * 获取键名对应的值
     */
    getItem<T = any>(key: string): T
    /**
     * 删除键值对(删除文档)
     */
    removeItem(key: string): void
  }

  dbCryptoStorage: {
    /**
     * 键值对加密存储，如果键名存在，则更新其对应的值
     * @param key 键名(同时为文档ID)
     * @param value 键值
     */
    setItem(key: string, value: any): void
    /**
     * 获取键名对应的值
     */
    getItem<T = any>(key: string): T
    /**
     * 删除键值对(删除文档)
     */
    removeItem(key: string): void
  }

  team: {
    /**
     * 获取团队信息
     */
    info(): {
      teamId: string
      teamName: string
      teamLogo: string
      userId: string
      userName: string
      userAvatar: string
    }
    /**
     * 获取团队版预设键名对应的值
     */
    preset<T = any>(key: string): T
    /**
     * 获取团队版预设的所有数据
     */
    allPresets(): Promise<{ key: string; value: any }[]>
  }

  zbrowser: UBrowser

  /**
   * 运行 ffmpeg
   * @param args ffmpeg 命令行参数
   * @param onProgress 进度回调
   */
  runFFmpeg(args: string[], onProgress?: (progress: FfmpegRunProgress) => void): FfmpegPromise

  /**
   * 获取所有 AI 模型
   */
  allAiModels(): Promise<ZToolsAiModel[]>

  /**
   * 流式调用 AI
   * @param option 选项参数
   * @param option.model 模型
   * @param option.messages 消息
   * @param option.tools 工具集合，使用 function calling 配置
   * @param streamCallback 流式回调
   */
  ai(option: ZToolsAiOption, streamCallback: (chunk: ZToolsAiMessage) => void): ZToolsAiResult<void>
  /**
   * 非流式调用 AI
   * @param option 选项参数
   */
  ai(option: ZToolsAiOption): ZToolsAiResult<ZToolsAiMessage>
}

declare var ztools: ZToolsApi
