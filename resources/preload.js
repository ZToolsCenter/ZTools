const electron = require('electron')

// ── plugin.api 统一 IPC 公共方法（与 utools 写法一致）──

/**
 * 同步 IPC 调用 - 通过 plugin.api 通道发送同步消息
 * 如果主进程返回 Error 实例，自动抛出异常
 */
const ipcSendSync = (apiName, args) => {
  const result = electron.ipcRenderer.sendSync('plugin.api', apiName, args)
  if (result instanceof Error) throw result
  return result
}

/**
 * 异步 IPC 调用 - 通过 plugin.api 通道发送异步消息
 * 主进程 throw 的错误会被 Electron 包裹，这里去除前缀后重新抛出
 */
const ipcInvoke = async (apiName, args) => {
  try {
    return await electron.ipcRenderer.invoke('plugin.api', apiName, args)
  } catch (e) {
    throw new Error(e.message.replace(/^.*?Error:/, '').trim())
  }
}

/**
 * 单向 IPC 发送 - 通过 plugin.api 通道发送消息，不等待返回值
 */
const ipcSend = (apiName, args) => {
  electron.ipcRenderer.send('plugin.api', apiName, args)
}

// 为已弃用的 ipcRenderer.sendTo 添加 polyfill
// 通过主进程转发消息到目标 webContents
if (!electron.ipcRenderer.sendTo) {
  electron.ipcRenderer.sendTo = function (webContentsId, channel, ...args) {
    electron.ipcRenderer.send('ipc-send-to', webContentsId, channel, ...args)
  }
}

// senderId 兼容层：接收主进程中继消息并分发到原始通道
electron.ipcRenderer.on('__ipc_sendto_relay__', (_event, payload) => {
  // 仅处理约定结构，避免异常 payload 影响插件运行
  if (!payload || typeof payload !== 'object') return
  const { senderId, channel, args } = payload
  if (typeof senderId !== 'number') return
  if (typeof channel !== 'string' || !channel) return
  if (channel === '__ipc_sendto_relay__') return // 防止内部通道递归分发
  if (!Array.isArray(args)) return

  // 兼容边界：只补 senderId，不模拟完整 IpcRendererEvent
  electron.ipcRenderer.emit(channel, { senderId }, ...args)
})

// 事件监听采用单回调模式：重复注册会替换之前的回调，避免插件热重载时累积多个监听器
let enterCallback = null
// 进入事件粘性缓存：解决 onPluginEnter 晚绑定导致的事件丢失
let pendingEnterPayload = null
let pendingEnterMeta = null
let clipboardChangeCallback = null
let subInputChangeCallback = null
let pluginOutCallback = null
let pluginDetachCallback = null
let mainPushCallback = null // { callback, selectCallback }
let hotkeyRecordedCallback = null
let windowMaterialChangeCallback = null
let themeChangeCallback = null
let logEntriesCallback = null
let foundInPageCallback = null
// 插件侧注册的 MCP 工具处理器，实际执行时由主进程回调到这里。
const registeredTools = new Map()
// 插件侧注册的 provider 处理器，按 type 存放，由主进程聚合后调用。
const registeredProviders = new Map()

/**
 * 创建懒注册的 IPC 事件监听器。
 * 仅在首次设置回调时注册 ipcRenderer.on，回调置空后可通过 detach 移除监听。
 * @param {string} channel  IPC 通道名
 * @param {function} handler 接收 (event, ...args) 的处理函数
 * @returns {{ attach: function, detach: function }}
 */
function lazyListen(channel, handler) {
  let listening = false
  return {
    attach() {
      if (!listening) {
        electron.ipcRenderer.on(channel, handler)
        listening = true
      }
    },
    detach() {
      if (listening) {
        electron.ipcRenderer.removeListener(channel, handler)
        listening = false
      }
    }
  }
}

// ── 懒注册 IPC 事件实例 ──
// 以下事件仅在插件调用对应 onXxx 注册回调后才开始监听，避免未订阅时产生无效 IPC 通信

// 剪贴板变化事件（由 clipboard.onChange 触发注册）
const lazyClipboardChange = lazyListen('clipboard-change', (_e, item) => {
  if (clipboardChangeCallback) clipboardChangeCallback(item)
})

// 插件退出事件（由 onPluginOut 触发注册）
const lazyPluginOut = lazyListen('plugin-out', (_e, isKill) => {
  if (pluginOutCallback) pluginOutCallback(isKill)
})

// 插件分离事件（由 onPluginDetach 触发注册）
const lazyPluginDetach = lazyListen('plugin-detach', () => {
  if (pluginDetachCallback) pluginDetachCallback()
})

// mainPush 查询请求（由 onMainPush 触发注册，搜索时主进程转发）
const lazyMainPushQuery = lazyListen('main-push-query', async (event, { queryData, callId }) => {
  try {
    let allResults = []
    if (mainPushCallback) {
      try {
        let results = await mainPushCallback.callback(queryData)
        // MainPush结果可能是一个对象，需要提取 data 字段
        if (results && results.type === 'list' && Array.isArray(results.data)) {
          results = results.data
        }
        if (Array.isArray(results) && results.length > 0) {
          allResults = allResults.concat(results)
        }
      } catch (e) {
        console.error('mainPush callback error:', e)
      }
    }
    electron.ipcRenderer.send(`main-push-result-${callId}`, {
      success: true,
      results: allResults
    })
  } catch (error) {
    electron.ipcRenderer.send(`main-push-result-${callId}`, {
      success: false,
      error: error.message
    })
  }
})

// mainPush 选择事件（由 onMainPush 触发注册，用户选择搜索结果时触发）
const lazyMainPushSelect = lazyListen('main-push-select', (event, { selectData, callId }) => {
  try {
    let shouldEnterPlugin = false
    if (
      mainPushCallback &&
      mainPushCallback.selectCallback &&
      typeof mainPushCallback.selectCallback === 'function'
    ) {
      try {
        const result = mainPushCallback.selectCallback(selectData)
        if (result === true) {
          shouldEnterPlugin = true
        }
      } catch (e) {
        console.error('mainPush selectCallback error:', e)
      }
    }
    electron.ipcRenderer.send(`main-push-select-result-${callId}`, {
      success: true,
      shouldEnterPlugin
    })
  } catch (error) {
    electron.ipcRenderer.send(`main-push-select-result-${callId}`, {
      success: false,
      error: error.message
    })
  }
})

// 快捷键录制事件（由 internal.onHotkeyRecorded 触发注册）
const lazyHotkeyRecorded = lazyListen('hotkey-recorded', (_e, shortcut) => {
  console.log('收到快捷键录制事件:', shortcut)
  if (hotkeyRecordedCallback) hotkeyRecordedCallback(shortcut)
})

// 窗口材质更新事件（由 internal.onUpdateWindowMaterial 触发注册）
const lazyWindowMaterial = lazyListen('update-window-material', (_e, material) => {
  if (windowMaterialChangeCallback) windowMaterialChangeCallback(material)
})

// 主题信息更新事件（由 onThemeChange 触发注册）
const lazyThemeChange = lazyListen('update-theme-info', (_e, themeInfo) => {
  if (themeChangeCallback) themeChangeCallback(themeInfo)
})

// 调试日志推送事件（由 internal.onLogEntries 触发注册）
const lazyLogEntries = lazyListen('log-entries', (_e, entries) => {
  if (logEntriesCallback) logEntriesCallback(entries)
})

// 页面内查找结果事件（由 onFindInPageResult 触发注册）
const lazyFoundInPage = lazyListen('found-in-page-result', (_e, result) => {
  if (foundInPageCallback) foundInPageCallback(result)
})

/**
 * 统一派发插件进入事件（已注册回调时调用）
 */
function dispatchPluginEnter(launchParam) {
  if (!enterCallback) return
  console.log('[PluginRuntime][Enter] dispatch-now', {
    assemblyId: launchParam?.__assemblyId,
    ts: launchParam?.__ts
  })
  enterCallback(launchParam)
}

/**
 * 回放缓存的进入事件（仅保留最新一条）
 */
function replayPendingPluginEnterIfNeeded() {
  if (!enterCallback || !pendingEnterPayload) return
  const replayPayload = pendingEnterPayload
  const replayMeta = pendingEnterMeta
  // 清空后再异步回放，避免重复触发
  pendingEnterPayload = null
  pendingEnterMeta = null
  console.log('[PluginRuntime][Enter] replay-pending', replayMeta || {})
  queueMicrotask(() => {
    dispatchPluginEnter(replayPayload)
  })
}

// 获取操作系统类型
const osType = electron.ipcRenderer.sendSync('get-os-type')

// ── zbrowser 客户端工厂（每次调用 getter 返回新实例）──

/**
 * 创建 zbrowser 客户端实例
 *
 * 加载 client.js 并注入 run() 方法（client.js 本身不包含 run）。
 * run() 将操作队列通过 ipcInvoke 发送到主进程的 ZBrowserExecutor。
 *
 * @returns {object} ZBrowserClient 实例（带 run 方法）
 */
function createZBrowserClient() {
  const { ZBrowserClient } = require('./zbrowser/client')
  const client = new ZBrowserClient()
  client.run = async function (ubrowserIdOrOptions, options) {
    if (this._queue.length === 0) throw new Error('no actions run')
    // 复制队列并清空（允许客户端实例复用）
    const queue = [...this._queue]
    this._queue = []

    // 解析参数：run() / run(options) / run(ubrowserId) / run(ubrowserId, options)
    let ubrowserId
    let runOptions = {}
    if (typeof ubrowserIdOrOptions === 'number') {
      ubrowserId = ubrowserIdOrOptions
      if (typeof options === 'object' && options !== null) runOptions = options
    } else if (typeof ubrowserIdOrOptions === 'object' && ubrowserIdOrOptions !== null) {
      runOptions = ubrowserIdOrOptions
    }
    // 如果未指定 ubrowserId 但实例上有保留的 _windowId，自动复用
    if (ubrowserId === undefined && this._windowId) {
      ubrowserId = this._windowId
    }

    const result = await ipcInvoke('runZBrowser', { ubrowserId, options: runOptions, queue })
    if (result.error) {
      const err = new Error(result.message)
      err.data = result.data
      throw err
    }
    // 如果窗口保留（可见窗口加入空闲池），记录 windowId 以便后续 run() 复用
    if (result.windowId) {
      this._windowId = result.windowId
    }
    // uTools 兼容：返回数组，最后一个元素是窗口信息对象
    const data = result.data || []
    if (result.windowInfo) {
      data.push(result.windowInfo)
    }
    return data
  }
  return client
}

window.ztools = {
  getAppName: () => 'ZTools',
  // 获取拖放文件的路径（Electron webUtils）
  getPathForFile: (file) => electron.webUtils.getPathForFile(file),
  // 平台检测
  isMacOs: () => osType === 'Darwin',
  isMacOS: () => osType === 'Darwin',
  isWindows: () => osType === 'Windows_NT',
  isLinux: () => osType === 'Linux',
  // 获取设备唯一标识符（32位字符串）
  getNativeId: () => electron.ipcRenderer.sendSync('get-native-id'),
  // 获取应用版本号
  getAppVersion: () => electron.ipcRenderer.sendSync('get-app-version'),
  // 获取窗口类型
  getWindowType: () => electron.ipcRenderer.sendSync('get-window-type'),
  // 是否深色主题
  isDarkColors: () => electron.ipcRenderer.sendSync('is-dark-colors'),
  // 获取当前主题信息（isDark, primaryColor, customColor, windowMaterial）
  getThemeInfo: () => ipcSendSync('getThemeInfo'),
  // 监听主题变更
  onThemeChange: (callback) => {
    if (typeof callback === 'function') {
      themeChangeCallback = callback
      lazyThemeChange.attach()
    }
  },
  sendInputEvent: async (event) => await electron.ipcRenderer.invoke('send-input-event', event),
  // 在当前页面中查找文本
  findInPage: (text, options) => electron.ipcRenderer.invoke('find-in-page', text, options),
  // 停止查找
  stopFindInPage: (action = 'clearSelection') =>
    electron.ipcRenderer.invoke('stop-find-in-page', action),
  // 监听页面查找结果
  onFindInPageResult: (callback) => {
    if (callback && typeof callback === 'function') {
      foundInPageCallback = callback
      lazyFoundInPage.attach()
    }
  },
  // 取消监听页面查找结果
  offFindInPageResult: (callback) => {
    if (foundInPageCallback === callback) {
      foundInPageCallback = null
      lazyFoundInPage.detach()
    }
  },
  // 模拟键盘按键
  simulateKeyboardTap: (key, ...modifiers) => {
    console.log('插件请求模拟键盘按键:', { key, modifiers })
    return electron.ipcRenderer.sendSync('simulate-keyboard-tap', key, modifiers)
  },
  // 模拟鼠标移动
  simulateMouseMove: (x, y) => {
    console.log('插件请求 simulateMouseMove', { x, y })
    return electron.ipcRenderer.sendSync('simulate-mouse-move', x, y)
  },
  // 模拟鼠标左键单击
  simulateMouseClick: (x, y) => {
    console.log('插件请求 simulateMouseClick', { x, y })
    return electron.ipcRenderer.sendSync('simulate-mouse-click', x, y)
  },
  // 模拟鼠标左键双击
  simulateMouseDoubleClick: (x, y) => {
    console.log('插件请求 simulateMouseDoubleClick', { x, y })
    return electron.ipcRenderer.sendSync('simulate-mouse-double-click', x, y)
  },
  // 模拟鼠标右键单击
  simulateMouseRightClick: (x, y) => {
    console.log('插件请求 simulateMouseRightClick', { x, y })
    return electron.ipcRenderer.sendSync('simulate-mouse-right-click', x, y)
  },
  onPluginEnter: async (callback) => {
    console.log('插件请求onPluginEnter')
    enterCallback = callback
    console.log('[PluginRuntime][Enter] enter-handler-registered')
    replayPendingPluginEnterIfNeeded()
  },
  // 插件退出事件
  onPluginOut: async (callback) => {
    console.log('插件请求onPluginOut')
    if (callback && typeof callback === 'function') {
      pluginOutCallback = callback
      lazyPluginOut.attach()
    }
  },
  // 插件分离事件
  onPluginDetach: async (callback) => {
    console.log('插件请求onPluginDetach')
    if (callback && typeof callback === 'function') {
      pluginDetachCallback = callback
      lazyPluginDetach.attach()
    }
  },
  // 监听主搜索推送（mainPush 功能）
  onMainPush: (callback, selectCallback) => {
    console.log('插件注册 onMainPush')
    if (callback && typeof callback === 'function') {
      mainPushCallback = { callback, selectCallback }
      lazyMainPushQuery.attach()
      lazyMainPushSelect.attach()
    }
  },
  // 兼容旧api
  onPluginReady: async (callback) => {
    console.log('插件请求onPluginReady')
    enterCallback = callback
    console.log('[PluginRuntime][Enter] enter-handler-registered(by-ready)')
    replayPendingPluginEnterIfNeeded()
  },
  // 显示系统通知
  showNotification: async (body) => {
    return await electron.ipcRenderer.invoke('show-notification', body)
  },
  // 显示 toast 提示
  showToast: async (message, options = {}) => {
    const toastOptions = {
      message,
      ...options
    }
    return await electron.ipcRenderer.invoke('plugin:show-toast', toastOptions)
  },
  // 设置插件高度
  setExpendHeight: async (height) => {
    return await electron.ipcRenderer.invoke('set-expend-height', height)
  },
  // 设置子输入框 (插件模式下的搜索框)
  setSubInput: async (onChange, placeholder, isFocus = true) => {
    console.log('插件设置子输入框:', { placeholder, isFocus })
    // 保存回调（替换之前的）
    if (onChange && typeof onChange === 'function') {
      subInputChangeCallback = onChange
    }
    // 通知主进程更新 placeholder，并传递 isFocus 参数
    return await electron.ipcRenderer.invoke('set-sub-input', placeholder, isFocus)
  },
  // 移除子输入框（隐藏）
  removeSubInput: async () => {
    console.log('插件移除子输入框')
    subInputChangeCallback = null
    return await electron.ipcRenderer.invoke('remove-sub-input')
  },
  // 设置子输入框的值
  setSubInputValue: async (text) => {
    console.log('插件设置子输入框值:', text)
    return await electron.ipcRenderer.invoke('set-sub-input-value', text)
  },
  // 聚焦子输入框
  subInputFocus: () => {
    console.log('插件请求聚焦子输入框')
    return electron.ipcRenderer.sendSync('sub-input-focus')
  },
  // 子输入框失去焦点，插件应用获得焦点
  subInputBlur: () => {
    console.log('插件请求子输入框失去焦点')
    return electron.ipcRenderer.sendSync('sub-input-blur')
  },
  // 子输入框获得焦点并选中内容
  subInputSelect: () => {
    console.log('插件请求选中子输入框内容')
    return electron.ipcRenderer.sendSync('sub-input-select')
  },
  // 标准数据库 API - 完全兼容 UTools
  // 同步版本（供插件使用）
  db: {
    put: (doc) => electron.ipcRenderer.sendSync('db:put', doc),
    get: (id) => electron.ipcRenderer.sendSync('db:get', id),
    remove: (docOrId) => electron.ipcRenderer.sendSync('db:remove', docOrId),
    bulkDocs: (docs) => electron.ipcRenderer.sendSync('db:bulk-docs', docs),
    allDocs: (key) => electron.ipcRenderer.sendSync('db:all-docs', key),
    postAttachment: (id, attachment, type) =>
      electron.ipcRenderer.sendSync('db:post-attachment', id, attachment, type),
    getAttachment: (id) => electron.ipcRenderer.sendSync('db:get-attachment', id),
    getAttachmentType: (id) => electron.ipcRenderer.sendSync('db:get-attachment-type', id),

    // Promise API（供渲染进程使用）
    promises: {
      put: async (doc) => await electron.ipcRenderer.invoke('db:put', doc),
      get: async (id) => await electron.ipcRenderer.invoke('db:get', id),
      remove: async (docOrId) => await electron.ipcRenderer.invoke('db:remove', docOrId),
      bulkDocs: async (docs) => await electron.ipcRenderer.invoke('db:bulk-docs', docs),
      allDocs: async (key) => await electron.ipcRenderer.invoke('db:all-docs', key),
      postAttachment: async (id, attachment, type) =>
        await electron.ipcRenderer.invoke('db:post-attachment', id, attachment, type),
      getAttachment: async (id) => await electron.ipcRenderer.invoke('db:get-attachment', id),
      getAttachmentType: async (id) =>
        await electron.ipcRenderer.invoke('db:get-attachment-type', id)
    }
  },

  // dbStorage API - 类似 localStorage 的简化接口
  dbStorage: {
    setItem: (key, value) => electron.ipcRenderer.sendSync('db-storage:set-item', key, value),
    getItem: (key) => electron.ipcRenderer.sendSync('db-storage:get-item', key),
    removeItem: (key) => electron.ipcRenderer.sendSync('db-storage:remove-item', key)
  },

  // 动态 Feature API
  // 获取动态添加的 features（可选参数：指定要获取的 feature codes）
  getFeatures: (codes) => electron.ipcRenderer.sendSync('get-features', codes),
  // 设置动态 feature（如果已存在则更新）
  setFeature: (feature) => electron.ipcRenderer.sendSync('set-feature', feature),
  // 删除指定的动态 feature
  removeFeature: (code) => electron.ipcRenderer.sendSync('remove-feature', code),

  // 剪贴板相关API
  clipboard: {
    getHistory: async (page, pageSize, filter) =>
      await electron.ipcRenderer.invoke('clipboard:get-history', page, pageSize, filter),
    search: async (keyword) => await electron.ipcRenderer.invoke('clipboard:search', keyword),
    delete: async (id) => await electron.ipcRenderer.invoke('clipboard:delete', id),
    clear: async (type) => await electron.ipcRenderer.invoke('clipboard:clear', type),
    getStatus: async () => await electron.ipcRenderer.invoke('clipboard:get-status'),
    write: async (id, shouldPaste = true) =>
      await electron.ipcRenderer.invoke('clipboard:write', id, shouldPaste),
    // 写入内容到剪贴板 ({ type: 'text'|'image', content: string }, shouldPaste = true)
    writeContent: async (data, shouldPaste = true) =>
      await electron.ipcRenderer.invoke('clipboard:write-content', data, shouldPaste),
    updateConfig: async (config) =>
      await electron.ipcRenderer.invoke('clipboard:update-config', config),
    // 监听剪贴板变化事件
    onChange: async (callback) => {
      clipboardChangeCallback = callback
      if (callback) {
        lazyClipboardChange.attach()
      }
    }
  },
  // 复制文本到剪贴板
  copyText: (text) => electron.ipcRenderer.sendSync('copy-text', text),
  // 复制图片到剪贴板
  copyImage: (image) => electron.ipcRenderer.sendSync('copy-image', image),
  // 复制文件到剪贴板
  copyFile: (filePath) => electron.ipcRenderer.sendSync('copy-file', filePath),
  // 获取剪贴板中复制的文件列表
  getCopyedFiles: () => electron.ipcRenderer.sendSync('get-copyed-files'),
  // 获取系统路径
  getPath: (name) => electron.ipcRenderer.sendSync('get-path', name),
  // 显示文件保存对话框
  // 显示文件保存对话框
  showSaveDialog: (options) => electron.ipcRenderer.sendSync('show-save-dialog', options),
  // 显示文件打开对话框
  showOpenDialog: (options) => {
    const data = electron.ipcRenderer.sendSync('show-open-dialog', options)
    return data
  },
  // 屏幕截图
  screenCapture: async (callback) => {
    const { image, bounds } = await electron.ipcRenderer.invoke('screen-capture')
    if (callback && typeof callback === 'function') {
      callback(image, bounds)
    }
  },
  // 屏幕取色
  screenColorPick: async (callback) => {
    const result = await electron.ipcRenderer.invoke('screen-color-pick')
    if (result.success && callback && typeof callback === 'function') {
      callback({ hex: result.hex, rgb: result.rgb })
    }
  },
  // 显示主窗口
  showMainWindow: async () => {
    return await electron.ipcRenderer.invoke('show-main-window')
  },
  // 隐藏主窗口
  hideMainWindow: async (isRestorePreWindow = true) => {
    return await electron.ipcRenderer.invoke('hide-main-window', isRestorePreWindow)
  },
  // 隐藏窗口并粘贴文本到外部应用
  hideMainWindowPasteText: (text) => {
    return electron.ipcRenderer.sendSync('hide-main-window-paste-text', text)
  },
  // 隐藏窗口并粘贴图片到外部应用
  hideMainWindowPasteImage: (image) => {
    return electron.ipcRenderer.sendSync('hide-main-window-paste-image', image)
  },
  // 隐藏窗口并粘贴文件到外部应用
  hideMainWindowPasteFile: (filePath) => {
    return electron.ipcRenderer.sendSync('hide-main-window-paste-file', filePath)
  },
  // 隐藏窗口并模拟键入字符串到外部应用
  hideMainWindowTypeString: (text) => {
    return electron.ipcRenderer.sendSync('hide-main-window-type-string', text)
  },
  // 创建独立窗口（白名单动态挂载模式，与 utools 一致）
  createBrowserWindow: (url, options, callback) => {
    // 注册 callback（子窗口 dom-ready 时由主进程在父窗口触发）
    if (typeof callback === 'function') {
      window.ztools.__event__ = window.ztools.__event__ || {}
      window.ztools.__event__.createBrowserWindowCallback = callback
    }

    // 同步创建窗口，返回 { id, methods[], invokes[], webContents: { id, methods[], invokes[] } }
    const result = ipcSendSync('createBrowserWindow', { url, options })

    const winId = result.id

    // ── 挂载 BrowserWindow 同步方法 ──
    result.methods.forEach((method) => {
      result[method] = (...args) =>
        ipcSendSync('pluginBrowserWindowMethod', { id: winId, method, args })
    })
    delete result.methods

    // ── 挂载 BrowserWindow 异步方法 ──
    result.invokes.forEach((method) => {
      result[method] = (...args) =>
        ipcInvoke('pluginBrowserWindowInvoke', { id: winId, method, args })
    })
    delete result.invokes

    // ── 挂载 WebContents 同步方法 ──
    result.webContents.methods.forEach((method) => {
      result.webContents[method] = (...args) =>
        ipcSendSync('pluginBrowserWindowMethod', {
          id: winId,
          target: 'webContents',
          method,
          args
        })
    })
    delete result.webContents.methods

    // ── 挂载 WebContents 异步方法 ──
    result.webContents.invokes.forEach((method) => {
      result.webContents[method] = (...args) =>
        ipcInvoke('pluginBrowserWindowInvoke', {
          id: winId,
          target: 'webContents',
          method,
          args
        })
    })
    delete result.webContents.invokes

    return result
  },
  // 退出插件
  outPlugin: async (isKill = false) => {
    return await electron.ipcRenderer.invoke('out-plugin', isKill)
  },
  // 发送消息到父窗口
  sendToParent: (channel, ...args) => {
    electron.ipcRenderer.send('send-to-parent', channel, ...args)
  },
  // 获取主显示器信息
  getPrimaryDisplay: () => electron.ipcRenderer.sendSync('get-primary-display'),
  // 获取所有显示器
  getAllDisplays: () => electron.ipcRenderer.sendSync('get-all-displays'),
  // 获取鼠标光标的屏幕坐标
  getCursorScreenPoint: () => electron.ipcRenderer.sendSync('get-cursor-screen-point'),
  // 获取最接近指定点的显示器
  getDisplayNearestPoint: (point) =>
    electron.ipcRenderer.sendSync('get-display-nearest-point', point),
  // 获取桌面捕获源
  desktopCaptureSources: async (options) =>
    await electron.ipcRenderer.invoke('desktop-capture-sources', options),
  // DIP 坐标转屏幕物理坐标
  dipToScreenPoint: (point) => electron.ipcRenderer.sendSync('dip-to-screen-point', point),
  // 屏幕物理坐标转 DIP 坐标
  screenToDipPoint: (point) => electron.ipcRenderer.sendSync('screen-to-dip-point', point),
  // DIP 区域转屏幕物理区域
  dipToScreenRect: (rect) => electron.ipcRenderer.sendSync('dip-to-screen-rect', rect),
  // 检查当前插件是否处于开发模式
  isDev: () => electron.ipcRenderer.sendSync('is-dev'),
  // 获取当前 WebContents ID
  getWebContentsId: () => electron.ipcRenderer.sendSync('get-web-contents-id'),
  // 使用系统默认程序打开 URL
  shellOpenExternal: (url) => electron.ipcRenderer.sendSync('shell-open-external', url),
  // 使用系统默认方式打开文件或文件夹
  shellOpenPath: (fullPath) => electron.ipcRenderer.sendSync('shell-open-path', fullPath),
  // 在文件管理器中显示文件
  shellShowItemInFolder: (fullPath) =>
    electron.ipcRenderer.sendSync('shell-show-item-in-folder', fullPath),
  // 播放系统提示音
  shellBeep: () => electron.ipcRenderer.sendSync('shell-beep'),
  // 将文件移动到回收站
  shellTrashItem: (fullPath) => electron.ipcRenderer.invoke('shell-trash-item', fullPath),
  // 读取当前文件管理器窗口的文件夹路径（macOS: Finder / Windows: Explorer）
  readCurrentFolderPath: () => electron.ipcRenderer.invoke('plugin:read-current-folder-path'),
  // 读取当前浏览器窗口 URL（前提当前活动系统窗口是受支持浏览器）
  readCurrentBrowserUrl: () => electron.ipcRenderer.invoke('plugin:read-current-browser-url'),
  // 获取文件系统图标（返回 base64 Data URL，同步）
  getFileIcon: (filePath) => electron.ipcRenderer.sendSync('get-file-icon', filePath),
  // 插件跳转
  redirect: (label, payload) =>
    electron.ipcRenderer.sendSync('ztools-redirect', { label, payload }),
  // 跳转到快捷键设置
  redirectHotKeySetting: (cmdLabel) =>
    electron.ipcRenderer.sendSync('ztools-redirect-hotkey-setting', cmdLabel),
  // 跳转到 AI 模型设置
  redirectAiModelsSetting: () => electron.ipcRenderer.sendSync('ztools-redirect-ai-models-setting'),
  // HTTP 请求头设置
  http: {
    // 设置请求头
    setHeaders: (headers) => electron.ipcRenderer.sendSync('http-set-headers', headers),
    // 获取当前请求头配置
    getHeaders: () => electron.ipcRenderer.sendSync('http-get-headers'),
    // 清除请求头配置
    clearHeaders: () => electron.ipcRenderer.sendSync('http-clear-headers')
  },

  // 注册插件工具处理器（用于 MCP 工具暴露）。
  registerTool: (name, handler) => {
    const toolName = typeof name === 'string' ? name.trim() : ''
    if (!toolName) {
      throw new Error('工具名称不能为空')
    }
    if (typeof handler !== 'function') {
      throw new Error(`工具 "${toolName}" 的处理器必须是函数`)
    }

    registeredTools.set(toolName, handler)
    const result = electron.ipcRenderer.sendSync('plugin:tool-register', toolName)
    if (!result?.success) {
      registeredTools.delete(toolName)
      throw new Error(result?.error || `工具 "${toolName}" 注册失败`)
    }
  },

  // 由主进程回调执行已注册的工具处理器，不对插件开发者直接暴露。
  __invokeRegisteredTool: async (name, input) => {
    const toolName = typeof name === 'string' ? name.trim() : ''
    const handler = registeredTools.get(toolName)
    if (!handler) {
      throw new Error(`工具 "${toolName}" 未注册`)
    }
    return await handler(input ?? {})
  },

  // 注册 provider（翻译、OCR 等）处理器。
  // 首参 key 需与 plugin.json 的 providers 字段 key 一致；type 由声明决定。
  // 一个插件可对同一 type 声明多条（如 baidu / google 都为 translation），只要 key 不同。
  registerProvider: (key, handler) => {
    const providerKey = typeof key === 'string' ? key.trim() : ''
    if (!providerKey) {
      throw new Error('provider key 不能为空')
    }
    if (typeof handler !== 'function') {
      throw new Error(`provider "${providerKey}" 的处理器必须是函数`)
    }

    registeredProviders.set(providerKey, handler)
    const result = electron.ipcRenderer.sendSync('plugin:provider-register', providerKey)
    if (!result?.success) {
      registeredProviders.delete(providerKey)
      throw new Error(result?.error || `provider "${providerKey}" 注册失败`)
    }
  },

  // 由主进程回调执行已注册的 provider 处理器，不对插件开发者直接暴露。
  __invokeRegisteredProvider: async (key, input) => {
    const providerKey = typeof key === 'string' ? key.trim() : ''
    const handler = registeredProviders.get(providerKey)
    if (!handler) {
      throw new Error(`provider "${providerKey}" 未注册`)
    }
    return await handler(input ?? {})
  },

  // ==================== 作为消费方调用其它 provider 的能力 ====================
  // 查询/调用入口统一经 plugin.api 分发器走主进程 providerManager，不在 preload 侧持有状态。
  providers: {
    // 查询某 type 下全部渠道，每个渠道带 isDefault 标记。type 缺省时返回所有 type 的渠道。
    getProviders: async (type) => {
      return await ipcInvoke('providersGetProviders', { type })
    },
    // 单独查询某 type 的默认渠道（无可用时返回 null）。
    getDefaultProvider: async (type) => {
      return await ipcInvoke('providersGetDefault', { type })
    },
    // 统一调用入口：providerId 可选，缺省走该 type 的默认渠道。
    invokeProvider: async (type, input, providerId) => {
      return await ipcInvoke('providersInvoke', { type, input, providerId })
    }
  },

  // 翻译便捷封装：ztools.translate(text, { from?, to?, providerId? }) → { text, detectedFrom? }
  translate: async (text, options = {}) => {
    const { from, to, providerId } = options || {}
    return await ipcInvoke('providersInvoke', {
      type: 'translation',
      input: { text, from, to },
      providerId
    })
  },

  // OCR 便捷封装：ztools.ocr(image, { lang?, providerId? }) → { text, blocks?, confidence? }
  ocr: async (image, options = {}) => {
    const { lang, providerId } = options || {}
    return await ipcInvoke('providersInvoke', {
      type: 'ocr',
      input: { image, lang },
      providerId
    })
  },

  // AI 调用 API
  ai: (option, streamCallback) => {
    const requestId = Math.random().toString(36).substr(2, 9)

    // 创建 PromiseLike 对象
    const promiseLike = {
      abort: () => {
        electron.ipcRenderer.invoke('plugin:ai-abort', requestId)
      }
    }

    if (streamCallback && typeof streamCallback === 'function') {
      // 流式调用
      const streamListener = (event, chunk) => {
        streamCallback(chunk)
      }

      // 监听流式数据
      electron.ipcRenderer.on(`plugin:ai-stream-${requestId}`, streamListener)

      // 创建 Promise
      const promise = electron.ipcRenderer
        .invoke('plugin:ai-call-stream', requestId, option)
        .then((result) => {
          // 移除监听器
          electron.ipcRenderer.removeListener(`plugin:ai-stream-${requestId}`, streamListener)
          if (!result.success) {
            throw new Error(result.error || 'AI 调用失败')
          }
        })
        .catch((error) => {
          // 移除监听器
          electron.ipcRenderer.removeListener(`plugin:ai-stream-${requestId}`, streamListener)
          throw error
        })

      // 合并 Promise 和 abort 方法
      Object.setPrototypeOf(promiseLike, promise)
      promiseLike.then = promise.then.bind(promise)
      promiseLike.catch = promise.catch.bind(promise)
      promiseLike.finally = promise.finally.bind(promise)

      return promiseLike
    } else {
      // 非流式调用
      const promise = electron.ipcRenderer
        .invoke('plugin:ai-call', requestId, option)
        .then((result) => {
          if (!result.success) {
            throw new Error(result.error || 'AI 调用失败')
          }
          return result.data
        })

      // 合并 Promise 和 abort 方法
      Object.setPrototypeOf(promiseLike, promise)
      promiseLike.then = promise.then.bind(promise)
      promiseLike.catch = promise.catch.bind(promise)
      promiseLike.finally = promise.finally.bind(promise)

      return promiseLike
    }
  },

  // 获取所有可用 AI 模型
  allAiModels: async () => {
    const result = await electron.ipcRenderer.invoke('plugin:ai-all-models')
    if (!result.success) {
      throw new Error(result.error || '获取 AI 模型列表失败')
    }
    return result.data || []
  },

  // 内置插件专用 API（仅限内置插件调用）
  internal: {
    // ==================== 数据库 API (ZTOOLS/ 命名空间) ====================
    dbPut: async (key, value) => await electron.ipcRenderer.invoke('internal:db-put', key, value),
    dbGet: async (key) => await electron.ipcRenderer.invoke('internal:db-get', key),

    // ==================== 应用启动 API ====================
    launch: async (params) => await electron.ipcRenderer.invoke('internal:launch', params),
    quitApp: async () => await electron.ipcRenderer.invoke('internal:quit-app'),

    // ==================== 指令管理 API ====================
    // 返回设置插件使用的原始指令快照，用于构建 alias 可选目标列表。
    // 这里返回的是主进程整理后的 canonical commands，不包含主窗口搜索阶段注入的 alias 搜索字段。
    getCommands: async () => await electron.ipcRenderer.invoke('internal:get-commands'),
    // 保存完整 alias store。主进程会负责归一化、持久化，并触发 commands cache 失效与主窗口刷新。
    updateCommandAliases: async (aliases) =>
      await electron.ipcRenderer.invoke('internal:update-command-aliases', aliases),

    // ==================== 本地启动管理 API ====================
    localShortcuts: {
      getAll: async () => await electron.ipcRenderer.invoke('local-shortcuts:get-all'),
      add: async (type) => await electron.ipcRenderer.invoke('local-shortcuts:add', type),
      addByPath: async (filePath) =>
        await electron.ipcRenderer.invoke('local-shortcuts:add-by-path', filePath),
      delete: async (id) => await electron.ipcRenderer.invoke('local-shortcuts:delete', id),
      deleteWhenNotExist: async () =>
        await electron.ipcRenderer.invoke('local-shortcuts:delete-when-not-exist'),
      open: async (path) => await electron.ipcRenderer.invoke('local-shortcuts:open', path),
      updateAlias: async (id, alias) =>
        await electron.ipcRenderer.invoke('local-shortcuts:update-alias', id, alias)
    },

    // ==================== 插件管理 API ====================
    getPlugins: async () => await electron.ipcRenderer.invoke('internal:get-plugins'),
    getDisabledPlugins: async () =>
      await electron.ipcRenderer.invoke('internal:get-disabled-plugins'),
    setPluginDisabled: async (pluginPath, disabled) =>
      await electron.ipcRenderer.invoke('internal:set-plugin-disabled', pluginPath, disabled),
    getAllPlugins: async () => await electron.ipcRenderer.invoke('internal:get-all-plugins'),
    setPluginMainPushEnabled: async (pluginName, enabled) =>
      await electron.ipcRenderer.invoke(
        'internal:set-plugin-main-push-enabled',
        pluginName,
        enabled
      ),
    selectPluginFile: async () => await electron.ipcRenderer.invoke('internal:select-plugin-file'),
    importPlugin: async () => await electron.ipcRenderer.invoke('internal:import-plugin'),
    getDevProjects: async () => await electron.ipcRenderer.invoke('internal:get-dev-projects'),
    updateDevProjectsOrder: async (pluginNames) =>
      await electron.ipcRenderer.invoke('internal:update-dev-projects-order', pluginNames),
    readPluginInfoFromZpx: async (zpxPath) =>
      await electron.ipcRenderer.invoke('internal:read-plugin-info-from-zpx', zpxPath),
    installPluginFromPath: async (zpxPath) =>
      await electron.ipcRenderer.invoke('internal:install-plugin-from-path', zpxPath),
    importDevPlugin: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:import-dev-plugin', pluginPath),
    scaffoldDevProject: async (params) =>
      await electron.ipcRenderer.invoke('internal:scaffold-dev-project', params),
    updateDevProjectMeta: async (projectName, meta) =>
      await electron.ipcRenderer.invoke('internal:update-dev-project-meta', projectName, meta),
    upsertDevProjectByConfigPath: async (pluginJsonPath) =>
      await electron.ipcRenderer.invoke(
        'internal:upsert-dev-project-by-config-path',
        pluginJsonPath
      ),
    removeDevProject: async (pluginName) =>
      await electron.ipcRenderer.invoke('internal:remove-dev-project', pluginName),
    installDevPlugin: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:install-dev-plugin', pluginPath),
    uninstallDevPlugin: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:uninstall-dev-plugin', pluginPath),
    validateDevProject: async (pluginName) =>
      await electron.ipcRenderer.invoke('internal:validate-dev-project', pluginName),
    selectDevProjectConfig: async (pluginName, configPath) =>
      await electron.ipcRenderer.invoke(
        'internal:select-dev-project-config',
        pluginName,
        configPath
      ),
    packageDevProject: async (pluginName, packagePath, version) =>
      await electron.ipcRenderer.invoke(
        'internal:package-dev-project',
        pluginName,
        packagePath,
        version
      ),
    deletePlugin: async (pluginPath, options) =>
      await electron.ipcRenderer.invoke('internal:delete-plugin', pluginPath, options),
    getRunningPlugins: async () =>
      await electron.ipcRenderer.invoke('internal:get-running-plugins'),
    killPlugin: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:kill-plugin', pluginPath),
    fetchPluginMarket: async () =>
      await electron.ipcRenderer.invoke('internal:fetch-plugin-market'),
    fetchPluginMarketRecommendations: async (limit) =>
      await electron.ipcRenderer.invoke('internal:fetch-plugin-market-recommendations', limit),
    fetchPluginMarketComments: async (pluginName, page, pageSize) =>
      await electron.ipcRenderer.invoke(
        'internal:fetch-plugin-market-comments',
        pluginName,
        page,
        pageSize
      ),
    createPluginMarketComment: async (input) =>
      await electron.ipcRenderer.invoke('internal:create-plugin-market-comment', input),
    togglePluginMarketCommentLike: async (commentId) =>
      await electron.ipcRenderer.invoke('internal:toggle-plugin-market-comment-like', commentId),
    deletePluginMarketComment: async (commentId) =>
      await electron.ipcRenderer.invoke('internal:delete-plugin-market-comment', commentId),
    installPluginFromMarket: async (plugin) =>
      await electron.ipcRenderer.invoke('internal:install-plugin-from-market', plugin),
    cancelPluginMarketDownload: async (pluginNameOrTaskId) =>
      await electron.ipcRenderer.invoke(
        'internal:cancel-plugin-market-download',
        pluginNameOrTaskId
      ),
    onPluginMarketDownloadProgress: (callback) => {
      const handler = (_event, payload) => callback(payload)
      electron.ipcRenderer.on('plugin-market-download-progress', handler)
      return () => {
        electron.ipcRenderer.removeListener('plugin-market-download-progress', handler)
      }
    },
    installPluginFromNpm: async (options) =>
      await electron.ipcRenderer.invoke('internal:install-plugin-from-npm', options),
    getPluginReadme: async (pluginPathOrName, pluginName) =>
      await electron.ipcRenderer.invoke('internal:get-plugin-readme', pluginPathOrName, pluginName),
    getPluginDocKeys: async (pluginRef) =>
      await electron.ipcRenderer.invoke('internal:get-plugin-doc-keys', pluginRef),
    getPluginDoc: async (pluginRef, docKey) =>
      await electron.ipcRenderer.invoke('internal:get-plugin-doc', pluginRef, docKey),
    deletePluginDoc: async (pluginRef, docKey) =>
      await electron.ipcRenderer.invoke('internal:delete-plugin-doc', pluginRef, docKey),
    exportPluginDoc: async (pluginRef, docKey) =>
      await electron.ipcRenderer.invoke('internal:export-plugin-doc', pluginRef, docKey),
    getPluginDataStats: async () =>
      await electron.ipcRenderer.invoke('internal:get-plugin-data-stats'),
    clearPluginData: async (pluginRef) =>
      await electron.ipcRenderer.invoke('internal:clear-plugin-data', pluginRef),
    exportAllPlugins: async () => await electron.ipcRenderer.invoke('internal:export-all-plugins'),
    getPluginMemoryInfo: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:get-plugin-memory-info', pluginPath),

    // ==================== 全局快捷键 API ====================
    registerGlobalShortcut: async (shortcut, target, autoCopy, preScreenshotOptimization) =>
      await electron.ipcRenderer.invoke(
        'internal:register-global-shortcut',
        shortcut,
        target,
        autoCopy,
        preScreenshotOptimization
      ),
    unregisterGlobalShortcut: async (shortcut) =>
      await electron.ipcRenderer.invoke('internal:unregister-global-shortcut', shortcut),
    updateGlobalShortcutConfig: async (shortcut, config) =>
      await electron.ipcRenderer.invoke('internal:update-global-shortcut-config', shortcut, config),
    startHotkeyRecording: async () =>
      await electron.ipcRenderer.invoke('internal:start-hotkey-recording'),
    updateShortcut: async (shortcut) =>
      await electron.ipcRenderer.invoke('internal:update-shortcut', shortcut),
    getCurrentShortcut: async () =>
      await electron.ipcRenderer.invoke('internal:get-current-shortcut'),
    onHotkeyRecorded: (callback) => {
      if (callback && typeof callback === 'function') {
        hotkeyRecordedCallback = callback
        lazyHotkeyRecorded.attach()
      }
    },

    // ==================== 应用快捷键 API ====================
    registerAppShortcut: async (shortcut, target) =>
      await electron.ipcRenderer.invoke('internal:register-app-shortcut', shortcut, target),
    unregisterAppShortcut: async (shortcut) =>
      await electron.ipcRenderer.invoke('internal:unregister-app-shortcut', shortcut),

    // ==================== 系统设置 API ====================
    setWindowOpacity: async (opacity) =>
      await electron.ipcRenderer.invoke('internal:set-window-opacity', opacity),
    setWindowDefaultHeight: async (height) =>
      await electron.ipcRenderer.invoke('internal:set-window-default-height', height),
    setWindowMaterial: async (material) =>
      await electron.ipcRenderer.invoke('internal:set-window-material', material),
    getWindowMaterial: async () =>
      await electron.ipcRenderer.invoke('internal:get-window-material'),
    selectAvatar: async () => await electron.ipcRenderer.invoke('internal:select-avatar'),
    setTheme: async (theme) => await electron.ipcRenderer.invoke('internal:set-theme', theme),
    setTrayIconVisible: async (visible) =>
      await electron.ipcRenderer.invoke('internal:set-tray-icon-visible', visible),
    setLaunchAtLogin: async (enabled) =>
      await electron.ipcRenderer.invoke('internal:set-launch-at-login', enabled),
    getLaunchAtLogin: async () => await electron.ipcRenderer.invoke('internal:get-launch-at-login'),
    selectImageFile: async () => await electron.ipcRenderer.invoke('internal:select-image-file'),
    setProxyConfig: async (config) =>
      await electron.ipcRenderer.invoke('internal:set-proxy-config', config),
    getAppVersion: async () => await electron.ipcRenderer.invoke('get-app-version'),
    getSystemVersions: async () => await electron.ipcRenderer.invoke('get-system-versions'),
    getPlatform: () => electron.ipcRenderer.sendSync('internal:get-platform'),

    // 通知主渲染进程更新搜索框提示文字
    updatePlaceholder: async (placeholder) =>
      await electron.ipcRenderer.invoke('internal:update-placeholder', placeholder),
    // 通知主渲染进程更新头像
    updateAvatar: async (avatar) =>
      await electron.ipcRenderer.invoke('internal:update-avatar', avatar),
    // 通知主渲染进程更新自动粘贴配置
    updateAutoPaste: async (autoPaste) =>
      await electron.ipcRenderer.invoke('internal:update-auto-paste', autoPaste),
    // 通知主渲染进程更新自动清空配置
    updateAutoClear: async (autoClear) =>
      await electron.ipcRenderer.invoke('internal:update-auto-clear', autoClear),
    // 通知主渲染进程更新自动返回搜索配置
    updateAutoBackToSearch: async (autoBackToSearch) =>
      await electron.ipcRenderer.invoke('internal:update-auto-back-to-search', autoBackToSearch),
    updateWindowPositionStrategy: async (strategy) =>
      await electron.ipcRenderer.invoke('internal:update-window-position-strategy', strategy),
    // 通知主渲染进程更新显示最近使用配置
    updateShowRecentInSearch: async (showRecentInSearch) =>
      await electron.ipcRenderer.invoke(
        'internal:update-show-recent-in-search',
        showRecentInSearch
      ),
    // 通知主渲染进程更新匹配推荐配置
    updateMatchRecommendation: async (showMatchRecommendation) =>
      await electron.ipcRenderer.invoke(
        'internal:update-match-recommendation',
        showMatchRecommendation
      ),
    // 通知主渲染进程更新最近使用行数
    updateRecentRows: async (rows) =>
      await electron.ipcRenderer.invoke('internal:update-recent-rows', rows),
    // 通知主渲染进程更新固定栏行数
    updatePinnedRows: async (rows) =>
      await electron.ipcRenderer.invoke('internal:update-pinned-rows', rows),
    // 通知主渲染进程更新搜索框模式
    updateSearchMode: async (mode) =>
      await electron.ipcRenderer.invoke('internal:update-search-mode', mode),
    // 通知主渲染进程更新 Tab 键功能配置
    updateTabKeyFunction: async (mode) =>
      await electron.ipcRenderer.invoke('internal:update-tab-key-function', mode),
    // 通知主渲染进程更新 Tab 键目标指令
    updateTabTarget: async (target) =>
      await electron.ipcRenderer.invoke('internal:update-tab-target', target),
    // 通知主渲染进程更新空格打开指令配置
    updateSpaceOpenCommand: async (enabled) =>
      await electron.ipcRenderer.invoke('internal:update-space-open-command', enabled),
    // 通知主渲染进程更新悬浮球双击目标指令
    updateFloatingBallDoubleClickCommand: async (command) =>
      await electron.ipcRenderer.invoke(
        'internal:update-floating-ball-double-click-command',
        command
      ),
    // 通知主渲染进程更新本地应用搜索配置
    updateLocalAppSearch: async (enabled) =>
      await electron.ipcRenderer.invoke('internal:update-local-app-search', enabled),
    // 通知主渲染进程更新主题色
    updatePrimaryColor: async (primaryColor, customColor) =>
      await electron.ipcRenderer.invoke('internal:update-primary-color', primaryColor, customColor),
    // 通知主渲染进程更新亚克力透明度
    updateAcrylicOpacity: async (lightOpacity, darkOpacity) =>
      await electron.ipcRenderer.invoke(
        'internal:update-acrylic-opacity',
        lightOpacity,
        darkOpacity
      ),

    // 监听窗口材质更新
    onUpdateWindowMaterial: (callback) => {
      windowMaterialChangeCallback = callback
      if (callback) {
        lazyWindowMaterial.attach()
      }
    },

    // ==================== 应用更新 API ====================
    updaterCheckUpdate: async () =>
      await electron.ipcRenderer.invoke('internal:updater-check-update'),
    updaterStartUpdate: async () =>
      await electron.ipcRenderer.invoke('internal:updater-start-update'),
    updaterSetAutoCheck: async (enabled) =>
      await electron.ipcRenderer.invoke('internal:updater-set-auto-check', enabled),

    // ==================== 数据同步 API ====================
    syncTestConnection: async (config) =>
      await electron.ipcRenderer.invoke('sync:test-connection', config),
    syncGetCaptchaConfig: async (params) =>
      await electron.ipcRenderer.invoke('sync:get-captcha-config', params),
    syncLogin: async (params) => await electron.ipcRenderer.invoke('sync:login', params),
    syncSaveConfig: async (config) => await electron.ipcRenderer.invoke('sync:save-config', config),
    syncGetConfig: async () => await electron.ipcRenderer.invoke('sync:get-config'),
    syncGetState: async () => await electron.ipcRenderer.invoke('sync:get-state'),
    syncGetStatus: async () => await electron.ipcRenderer.invoke('sync:get-status'),
    syncGetDefaultImportStatus: async () =>
      await electron.ipcRenderer.invoke('sync:get-default-import-status'),
    syncImportDefaultData: async () =>
      await electron.ipcRenderer.invoke('sync:import-default-data'),
    syncSkipDefaultImport: async () =>
      await electron.ipcRenderer.invoke('sync:skip-default-import'),
    syncGetRetryStatus: async () => await electron.ipcRenderer.invoke('sync:get-retry-status'),
    syncGetAccountStats: async () => await electron.ipcRenderer.invoke('sync:get-account-stats'),
    syncGetAccountProfile: async () =>
      await electron.ipcRenderer.invoke('sync:get-account-profile'),
    syncUploadAccountAvatar: async (avatarPath) =>
      await electron.ipcRenderer.invoke('sync:upload-account-avatar', avatarPath),
    syncRetryNow: async () => await electron.ipcRenderer.invoke('sync:retry-now'),
    syncPerformSync: async () => await electron.ipcRenderer.invoke('sync:perform-sync'),
    syncStopAutoSync: async () => await electron.ipcRenderer.invoke('sync:stop-auto-sync'),
    syncGetUnsyncedCount: async () => await electron.ipcRenderer.invoke('sync:get-unsynced-count'),
    syncGetConflictCount: async () => await electron.ipcRenderer.invoke('sync:get-conflict-count'),
    syncListConflicts: async () => await electron.ipcRenderer.invoke('sync:list-conflicts'),
    syncGetConflictDetail: async (docId) =>
      await electron.ipcRenderer.invoke('sync:get-conflict-detail', docId),
    syncResolveConflict: async (docId, sourceRev) =>
      await electron.ipcRenderer.invoke('sync:resolve-conflict', { docId, sourceRev }),
    storageGetInitState: async () => await electron.ipcRenderer.invoke('storage:get-init-state'),
    storageStartFresh: async () => await electron.ipcRenderer.invoke('storage:start-fresh'),
    storageImportLegacy: async (options) =>
      await electron.ipcRenderer.invoke('storage:import-legacy', options),
    syncResetLocalSyncState: async () =>
      await electron.ipcRenderer.invoke('sync:reset-local-sync-state'),
    syncForcePushAll: async () => await electron.ipcRenderer.invoke('sync:force-push-all'),
    // GitHub OAuth 登录（轮询方式）
    syncGithubInitSession: async (params) =>
      await electron.ipcRenderer.invoke('sync:github-init-session', params),
    syncGithubOpenBrowser: async (params) =>
      await electron.ipcRenderer.invoke('sync:github-open-browser', params),
    syncGithubPollStatus: async (params) =>
      await electron.ipcRenderer.invoke('sync:github-poll-status', params),
    // 更新用户昵称
    syncUpdateNickname: async (params) =>
      await electron.ipcRenderer.invoke('sync:update-nickname', params),
    onSyncStatusChanged: (callback) => {
      const handler = (_event, payload) => {
        if (typeof callback === 'function') callback(payload || {})
      }
      electron.ipcRenderer.on('sync:status-changed', handler)
      return () => electron.ipcRenderer.removeListener('sync:status-changed', handler)
    },
    onSyncAccountStorageChanged: (callback) => {
      const handler = (_event, payload) => {
        if (typeof callback === 'function') callback(payload)
      }
      electron.ipcRenderer.on('sync:account-storage-changed', handler)
      return () => electron.ipcRenderer.removeListener('sync:account-storage-changed', handler)
    },

    // ==================== 其他 API ====================
    revealInFinder: async (path) =>
      await electron.ipcRenderer.invoke('internal:reveal-in-finder', path),

    // 通知主渲染进程禁用指令列表已更改
    notifyDisabledCommandsChanged: async () =>
      await electron.ipcRenderer.invoke('internal:notify-disabled-commands-changed'),

    // 固定/取消固定指令到搜索窗口
    pinApp: async (app) => await electron.ipcRenderer.invoke('internal:pin-app', app),
    unpinApp: async (appPath, featureCode, name) =>
      await electron.ipcRenderer.invoke('internal:unpin-app', appPath, featureCode, name),

    // ==================== 图片分析 API ====================
    analyzeImage: async (imagePath) =>
      await electron.ipcRenderer.invoke('internal:analyze-image', imagePath),

    // ==================== 超级面板 API ====================
    updateSuperPanelConfig: async (config) =>
      await electron.ipcRenderer.invoke('internal:update-super-panel-config', config),
    updateSuperPanelBlockedApps: async (blockedApps) =>
      await electron.ipcRenderer.invoke('internal:update-super-panel-blocked-apps', blockedApps),
    getCurrentWindowInfo: async () =>
      await electron.ipcRenderer.invoke('internal:get-current-window-info'),

    // ==================== 唤醒黑名单 API ====================
    updateWakeupBlacklist: async (blacklist) =>
      await electron.ipcRenderer.invoke('internal:update-wakeup-blacklist', blacklist),

    // 超级面板翻译
    updateSuperPanelTranslate: async (enabled) =>
      await electron.ipcRenderer.invoke('internal:update-super-panel-translate', enabled),
    getTranslationStatus: async () =>
      await electron.ipcRenderer.invoke('internal:get-translation-status'),

    pinToSuperPanel: async (command) =>
      await electron.ipcRenderer.invoke('super-panel:pin-command', command),
    unpinSuperPanelCommand: async (path, featureCode) =>
      await electron.ipcRenderer.invoke('super-panel:unpin-command', path, featureCode),
    getSuperPanelPinned: async () => await electron.ipcRenderer.invoke('super-panel:get-pinned'),

    // ==================== AI 模型管理 API ====================
    aiModels: {
      getAll: async () => await electron.ipcRenderer.invoke('internal:ai-models-get-all'),
      add: async (model) => await electron.ipcRenderer.invoke('internal:ai-models-add', model),
      update: async (model) =>
        await electron.ipcRenderer.invoke('internal:ai-models-update', model),
      delete: async (modelId) =>
        await electron.ipcRenderer.invoke('internal:ai-models-delete', modelId)
    },

    // ==================== Provider（翻译 / OCR 等）管理 API ====================
    providers: {
      getAll: async (type) => await electron.ipcRenderer.invoke('internal:providers-get-all', type),
      getSettings: async () => await electron.ipcRenderer.invoke('internal:providers-get-settings'),
      setEnabled: async (providerId, enabled) =>
        await electron.ipcRenderer.invoke('internal:providers-set-enabled', providerId, enabled),
      setDefault: async (type, providerId) =>
        await electron.ipcRenderer.invoke('internal:providers-set-default', type, providerId),
      getParams: async (providerId) =>
        await electron.ipcRenderer.invoke('internal:providers-get-params', providerId),
      setParams: async (providerId, params) =>
        await electron.ipcRenderer.invoke('internal:providers-set-params', providerId, params),
      // 翻译引擎（内置 Bergamot）状态与总开关
      getTranslationStatus: async () =>
        await electron.ipcRenderer.invoke('internal:providers-translation-status'),
      setTranslationEnabled: async (enabled) =>
        await electron.ipcRenderer.invoke('internal:providers-translation-set-enabled', enabled)
    },

    // ==================== 网页快开 API ====================
    webSearch: {
      getAll: async () => await electron.ipcRenderer.invoke('internal:web-search-get-all'),
      add: async (engine) => await electron.ipcRenderer.invoke('internal:web-search-add', engine),
      update: async (engine) =>
        await electron.ipcRenderer.invoke('internal:web-search-update', engine),
      delete: async (engineId) =>
        await electron.ipcRenderer.invoke('internal:web-search-delete', engineId),
      fetchFavicon: async (url) =>
        await electron.ipcRenderer.invoke('internal:web-search-fetch-favicon', url)
    },

    // ==================== 悬浮球 API ====================
    setFloatingBallEnabled: async (enabled) =>
      await electron.ipcRenderer.invoke('floating-ball:set-enabled', enabled),
    getFloatingBallEnabled: async () =>
      await electron.ipcRenderer.invoke('floating-ball:get-enabled'),
    setFloatingBallLetter: async (letter) =>
      await electron.ipcRenderer.invoke('floating-ball:set-letter', letter),
    getFloatingBallLetter: async () =>
      await electron.ipcRenderer.invoke('floating-ball:get-letter'),

    // ==================== HTTP 服务 API ====================
    httpServerGetConfig: async () =>
      await electron.ipcRenderer.invoke('internal:http-server-get-config'),
    httpServerSaveConfig: async (config) =>
      await electron.ipcRenderer.invoke('internal:http-server-save-config', config),
    httpServerRegenerateKey: async () =>
      await electron.ipcRenderer.invoke('internal:http-server-regenerate-key'),
    httpServerStatus: async () => await electron.ipcRenderer.invoke('internal:http-server-status'),

    // ==================== MCP 服务 API ====================
    // 获取 MCP 服务配置（端口、密钥、启用状态）
    mcpServerGetConfig: async () =>
      await electron.ipcRenderer.invoke('internal:mcp-server-get-config'),
    // 保存 MCP 服务配置，保存后会自动启停服务
    mcpServerSaveConfig: async (config) =>
      await electron.ipcRenderer.invoke('internal:mcp-server-save-config', config),
    // 重新生成 MCP 访问密钥
    mcpServerRegenerateKey: async () =>
      await electron.ipcRenderer.invoke('internal:mcp-server-regenerate-key'),
    // 查询 MCP 服务运行状态
    mcpServerStatus: async () => await electron.ipcRenderer.invoke('internal:mcp-server-status'),
    // 获取所有已安装插件中声明的 MCP 工具列表
    mcpServerTools: async () => await electron.ipcRenderer.invoke('internal:mcp-server-tools'),

    // ==================== 调试日志 API ====================
    logEnable: async () => await electron.ipcRenderer.invoke('internal:log-enable'),
    logDisable: async () => await electron.ipcRenderer.invoke('internal:log-disable'),
    logGetBuffer: async () => await electron.ipcRenderer.invoke('internal:log-get-buffer'),
    logIsEnabled: async () => await electron.ipcRenderer.invoke('internal:log-is-enabled'),
    logSubscribe: async () => await electron.ipcRenderer.invoke('internal:log-subscribe'),
    onLogEntries: (callback) => {
      if (callback && typeof callback === 'function') {
        logEntriesCallback = callback
        lazyLogEntries.attach()
      }
    },
    offLogEntries: (callback) => {
      if (logEntriesCallback === callback) {
        logEntriesCallback = null
        lazyLogEntries.detach()
      }
    }
  },

  // ── zbrowser / ubrowser 浏览器自动化 API ──

  /** zbrowser 客户端（核心实现），每次访问返回新的 Builder 实例 */
  get zbrowser() {
    return createZBrowserClient()
  },
  /** ubrowser 兼容入口（转发到 zbrowser），与 uTools API 一致 */
  get ubrowser() {
    return createZBrowserClient()
  },
  /** 获取当前插件的空闲 zbrowser 窗口列表（同步 API） */
  getIdleUBrowsers: () => ipcSendSync('getIdleZBrowsers'),
  /**
   * 设置 zbrowser Session 代理
   * ⚠️ 破坏性变更：uTools 为同步 API，ZTools 改为异步（返回 Promise<boolean>）
   */
  setUBrowserProxy: (config) => ipcInvoke('setZBrowserProxy', config),
  /**
   * 清除 zbrowser Session 缓存
   * ⚠️ 破坏性变更：uTools 为同步 API，ZTools 改为异步（返回 Promise<boolean>）
   */
  clearUBrowserCache: () => ipcInvoke('clearZBrowserCache'),
  /** ubrowserLogin 兼容桩（ZTools 暂不支持，返回 null） */
  ubrowserLogin: () => ipcInvoke('ubrowserLogin'),
  // ── FFmpeg API ──
  // 注意：runFFmpeg 在 preload 端直接 spawn 子进程，而非走 IPC 转发到主进程。
  // 原因：onProgress 回调需要实时推送 stderr 数据，走 IPC 会引入延迟且无法直接传递回调函数。

  /**
   * 执行 FFmpeg 命令（在插件进程中直接 spawn）
   * @param {string[]} args - FFmpeg 命令行参数
   * @param {Function|Object} [options] - 回调函数（兼容旧版）或选项对象 { onProgress, onLog }
   * @returns {Promise<void> & {kill: Function, quit: Function}} 可终止的 Promise
   */
  runFFmpeg: (args, options) => {
    if (!Array.isArray(args)) throw new Error('参数错误')

    let onProgress, onLog

    // 兼容旧版：第二参数为函数时视为 onProgress
    if (typeof options === 'function') {
      onProgress = options
    } else if (options) {
      if (typeof options !== 'object') throw new Error('参数错误')
      if (typeof options.onLog === 'function') onLog = options.onLog
      if (typeof options.onProgress === 'function') onProgress = options.onProgress
    }

    let proc = null
    let killed = false

    const promise = new Promise((resolve, reject) => {
      ipcInvoke('getFFmpegPath')
        .then((ffmpegPath) => {
          try {
            proc = require('child_process').spawn(ffmpegPath, args, {
              stdio: ['pipe', 'ignore', 'pipe']
            })
          } catch (e) {
            return reject(e)
          }

          // 保留最近几行 stderr 输出，用于错误退出时提取错误信息
          const MAX_ERROR_LINES = 5
          const lines = []
          let answeredYN = false
          let totalDuration = null

          proc.stderr.on('data', (data) => {
            const text = data.toString()
            const trimmed = text.trim()

            if (onLog) onLog(trimmed)

            // ffmpeg 覆盖已存在文件时会询问 [y/N]，自动回答 N 拒绝覆盖
            if (
              trimmed.endsWith(']') &&
              ((lines.length > 0 ? lines[lines.length - 1] : '') + trimmed).endsWith('[y/N]')
            ) {
              answeredYN = true
              try {
                proc.stdin.write('N\n')
              } catch {}
              return
            }

            // 从 stderr 头部解析输入文件总时长，用于计算进度百分比
            if (onProgress && totalDuration === null) {
              const m = trimmed.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
              if (m)
                totalDuration =
                  3600 * parseInt(m[1], 10) + 60 * parseInt(m[2], 10) + parseFloat(m[3])
            }

            // 解析 ffmpeg 进度行（格式: "frame=... fps=... time=00:01:23 ..."）
            if (/time=\d+:\d{2}:\d{2}/.test(trimmed)) {
              if (onProgress) {
                const info = {}
                // 按非值内空格分割 key=value 对（跳过 "=" 或值内的空格）
                trimmed.split(/(?<!(?:=|\s))\s/).forEach((pair) => {
                  const kv = pair.split('=')
                  if (kv.length === 2) {
                    const v = kv[1].trim()
                    info[kv[0].trim()] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
                  }
                })
                if (info.time && totalDuration) {
                  const tp = info.time.split(':')
                  const cur =
                    3600 * parseInt(tp[0], 10) + 60 * parseInt(tp[1], 10) + parseFloat(tp[2])
                  info.percent = (cur / totalDuration) * 100
                }
                if (info.time) onProgress(info)
              }
            } else {
              lines.push(text)
              if (lines.length > MAX_ERROR_LINES) lines.shift()
            }
          })

          proc.on('close', (code) => {
            if (killed) return reject(new Error('已被主动终止'))
            if (code !== 0 || answeredYN) {
              if (lines.length === 0)
                return reject(new Error(`ffmpeg process exited with code ${code}`))
              let msg
              if (lines.length > 1) lines.shift()
              if (answeredYN) {
                // 自动拒绝覆盖后，提取最后一行的错误描述（去掉 ffmpeg 模块前缀）
                msg = lines[lines.length - 1].replace(/^\[[^\]]+ @ [^\]]+\]\s*/gm, '')
              } else {
                const combined = lines.join('').trim()
                const errs = combined
                  .split('\n')
                  .filter((l) => /error|invalid|failed|no such file|unable/i.test(l))
                  .map((l) => l.replace(/^\[[^\]]+ @ [^\]]+\]\s*/, '').trim())
                msg = errs.length === 0 ? combined : errs.join('\n')
              }
              reject(new Error(msg))
            } else {
              resolve()
            }
          })

          proc.on('error', reject)
        })
        .catch(reject)
    })

    /** 强制终止 ffmpeg 进程（SIGTERM） */
    promise.kill = () => {
      if (!proc) throw new Error('未运行')
      if (proc.exitCode !== null) throw new Error('已结束运行')
      killed = true
      proc.kill()
    }

    /** 向 ffmpeg stdin 发送 'q' 优雅退出 */
    promise.quit = () => {
      if (!proc) throw new Error('未运行')
      if (proc.exitCode !== null) throw new Error('已结束运行')
      try {
        proc.stdin.write('q\n')
        proc.stdin.end()
      } catch {}
    }

    return promise
  }
}

electron.ipcRenderer.on('on-plugin-enter', (event, launchParam) => {
  console.log('插件进入参数:', launchParam)
  if (enterCallback) {
    dispatchPluginEnter(launchParam)
    return
  }

  // 晚绑定场景：先缓存最近一次 enter，待 onPluginEnter 注册后回放
  pendingEnterPayload = launchParam
  pendingEnterMeta = {
    assemblyId: launchParam?.__assemblyId,
    ts: launchParam?.__ts
  }
  console.log('[PluginRuntime][Enter] enter-received-buffered', pendingEnterMeta)
})

// 监听子输入框变化事件
electron.ipcRenderer.on('sub-input-change', (event, details) => {
  console.log('子输入框变化:', details)
  if (subInputChangeCallback) subInputChangeCallback(details)
})

// 监听主进程的插件方法调用请求（用于无界面插件）
electron.ipcRenderer.on('call-plugin-method', async (event, { featureCode, action, callId }) => {
  try {
    // 检查 window.exports 是否存在
    if (!window.exports) {
      electron.ipcRenderer.send(`plugin-method-result-${callId}`, {
        success: false,
        error: 'window.exports is not defined'
      })
      return
    }

    // 获取对应的 feature
    const feature = window.exports[featureCode]
    if (!feature) {
      electron.ipcRenderer.send(`plugin-method-result-${callId}`, {
        success: false,
        error: `Feature "${featureCode}" not found`
      })
      return
    }

    // 检查 mode
    if (feature.mode !== 'none') {
      electron.ipcRenderer.send(`plugin-method-result-${callId}`, {
        success: false,
        error: `Mode "${feature.mode}" is not supported`
      })
      return
    }

    // 检查 enter 方法
    if (!feature.args || typeof feature.args.enter !== 'function') {
      electron.ipcRenderer.send(`plugin-method-result-${callId}`, {
        success: false,
        error: 'Feature does not have a valid enter function'
      })
      return
    }

    // 调用方法
    const result = await feature.args.enter(action)

    // 返回成功结果
    electron.ipcRenderer.send(`plugin-method-result-${callId}`, {
      success: true,
      result
    })
  } catch (error) {
    // 返回错误
    electron.ipcRenderer.send(`plugin-method-result-${callId}`, {
      success: false,
      error: error.message || String(error)
    })
    throw error
  }
})

// 监听 ESC 键，支持插件内部阻止返回
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') {
      electron.ipcRenderer.send('plugin-esc-pressed')
    }
  },
  false
)

// 监听主进程获取插件模式的请求
electron.ipcRenderer.on('get-plugin-mode', (event, { featureCode, callId }) => {
  // console.log('收到获取插件模式请求:', featureCode)
  const mode =
    window.exports && window.exports[featureCode] ? window.exports[featureCode].mode : undefined
  electron.ipcRenderer.send(`plugin-mode-result-${callId}`, mode)
})

// ==================== 列表模式 (mode: 'list') ====================
;(function () {
  var listState = {
    active: false,
    items: [],
    selectedIndex: 0,
    container: null,
    keyHandler: null,
    ignoreMouseHover: false
  }

  var LIST_CSS = [
    '* { margin:0; padding:0; box-sizing:border-box; }',
    'body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; overflow:hidden;}',
    '.ztools-list { max-height:100vh; overflow-y:auto; overflow-x:hidden; padding:0 0 2px 0; }',
    '.ztools-li { display:flex; align-items:center; gap:12px; padding:8px 12px; border-radius:6px; cursor:pointer; transition:background-color .15s; user-select:none; }',
    '.ztools-li:hover { background:rgba(0,0,0,.05); }',
    '.ztools-li.selected { background:rgba(0,0,0,.05); }',
    '.ztools-list.ignore-mouse-hover .ztools-li:hover { background:transparent; }',
    '.ztools-li-icon { flex-shrink:0; width:32px; height:32px; display:flex; align-items:center; justify-content:center; }',
    '.ztools-li-icon img { width:100%; height:100%; object-fit:contain; }',
    '.ztools-li-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }',
    '.ztools-li-title { font-size:14px; font-weight:500; color:#1a1a1a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.ztools-li-desc { font-size:12px; color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '@media(prefers-color-scheme:dark){',
    '  .ztools-li:hover { background:rgba(255,255,255,.08); }',
    '  .ztools-li.selected { background:rgba(255,255,255,.08); }',
    '  .ztools-list.ignore-mouse-hover .ztools-li:hover { background:transparent; }',
    '  .ztools-li-title { color:#e5e5e5; }',
    '  .ztools-li-desc { color:#999; }',
    '}'
  ].join('\n')

  function injectListUI() {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;'
    var style = document.createElement('style')
    style.textContent = LIST_CSS
    document.head.appendChild(style)
    var container = document.createElement('div')
    container.className = 'ztools-list'
    document.body.appendChild(container)
    listState.container = container
  }

  function syncMouseHoverState() {
    if (!listState.container) return
    listState.container.classList.toggle('ignore-mouse-hover', !!listState.ignoreMouseHover)
  }

  function renderItems(items, pluginPath) {
    listState.items = items || []
    listState.selectedIndex = 0
    var container = listState.container
    if (!container) return
    syncMouseHoverState()
    container.innerHTML = ''
    for (var i = 0; i < listState.items.length; i++) {
      var item = listState.items[i]
      var div = document.createElement('div')
      div.className = 'ztools-li' + (i === 0 ? ' selected' : '')
      div.dataset.index = i

      var iconDiv = document.createElement('div')
      iconDiv.className = 'ztools-li-icon'
      if (item.icon) {
        var img = document.createElement('img')
        // 解析图标路径
        var iconSrc = item.icon
        if (
          iconSrc &&
          !iconSrc.startsWith('http') &&
          !iconSrc.startsWith('file:') &&
          !iconSrc.startsWith('data:') &&
          pluginPath
        ) {
          iconSrc = 'file://' + pluginPath.replace(/\\/g, '/') + '/' + iconSrc
        }
        img.src = iconSrc
        img.draggable = false
        img.onerror = function () {
          this.style.display = 'none'
        }
        iconDiv.appendChild(img)
      }
      div.appendChild(iconDiv)

      var bodyDiv = document.createElement('div')
      bodyDiv.className = 'ztools-li-body'
      var titleDiv = document.createElement('div')
      titleDiv.className = 'ztools-li-title'
      titleDiv.textContent = item.title || ''
      bodyDiv.appendChild(titleDiv)
      if (item.description) {
        var descDiv = document.createElement('div')
        descDiv.className = 'ztools-li-desc'
        descDiv.textContent = item.description
        bodyDiv.appendChild(descDiv)
      }
      div.appendChild(bodyDiv)
      ;(function (idx) {
        div.addEventListener('mousemove', function () {
          if (listState.ignoreMouseHover) {
            listState.ignoreMouseHover = false
            syncMouseHoverState()
          }
          if (listState.selectedIndex === idx) return
          listState.selectedIndex = idx
          updateSelection()
        })

        div.addEventListener('mouseenter', function () {
          if (listState.ignoreMouseHover) return
          if (listState.selectedIndex === idx) return
          listState.selectedIndex = idx
          updateSelection()
        })
      })(i)
      ;(function (idx) {
        div.addEventListener('click', function () {
          listState.selectedIndex = idx
          updateSelection()
          doSelect()
        })
      })(i)

      container.appendChild(div)
    }
    updateHeight()
  }

  function updateSelection() {
    var nodes = listState.container ? listState.container.querySelectorAll('.ztools-li') : []
    for (var i = 0; i < nodes.length; i++) {
      if (i === listState.selectedIndex) {
        nodes[i].classList.add('selected')
      } else {
        nodes[i].classList.remove('selected')
      }
    }
    var sel = listState.container && listState.container.querySelector('.ztools-li.selected')
    if (sel) sel.scrollIntoView({ block: 'nearest' })
  }

  function updateHeight() {
    var container = listState.container
    if (!container || container.children.length === 0) {
      window.ztools.setExpendHeight(0)
      return
    }
    var height = Math.min(container.scrollHeight, 541)
    window.ztools.setExpendHeight(height)
  }

  function doSelect() {
    var item = listState.items[listState.selectedIndex]
    if (!item || !listState._selectFn) return
    listState._selectFn(listState._action, item, function (items) {
      renderItems(items, listState._pluginPath)
    })
  }

  function handleListKeydown(e) {
    if (!listState.active) return
    var maxIdx = listState.items.length - 1
    if (maxIdx < 0) return
    if (e.key === 'ArrowUp' || e.key === 'Up') {
      e.preventDefault()
      listState.ignoreMouseHover = true
      syncMouseHoverState()
      if (listState.selectedIndex > 0) {
        listState.selectedIndex--
      } else {
        listState.selectedIndex = maxIdx
      }
      updateSelection()
    } else if (e.key === 'ArrowDown' || e.key === 'Down') {
      e.preventDefault()
      listState.ignoreMouseHover = true
      syncMouseHoverState()
      if (listState.selectedIndex < maxIdx) {
        listState.selectedIndex++
      } else {
        listState.selectedIndex = 0
      }
      updateSelection()
    } else if (e.key === 'Enter' || e.key === 'Return') {
      e.preventDefault()
      doSelect()
    }
  }

  electron.ipcRenderer.on('activate-list-mode', function (event, data) {
    var featureCode = data.featureCode
    var action = data.action
    var pluginPath = data.pluginPath
    var feature = window.exports && window.exports[featureCode]
    if (!feature || feature.mode !== 'list') return

    // 注入或重置 UI
    if (!listState.active) {
      injectListUI()
      listState.keyHandler = handleListKeydown
      document.addEventListener('keydown', listState.keyHandler)
      listState.active = true
    } else {
      // 重入：清空列表
      if (listState.container) listState.container.innerHTML = ''
    }

    listState.ignoreMouseHover = false
    syncMouseHoverState()
    listState._action = action
    listState._pluginPath = pluginPath
    listState._selectFn =
      feature.args && typeof feature.args.select === 'function' ? feature.args.select : null

    var callbackSetList = function (items) {
      renderItems(items, pluginPath)
    }

    // 设置子输入框（搜索）
    if (feature.args && typeof feature.args.search === 'function') {
      var searchFn = feature.args.search
      window.ztools.setSubInput(
        function (details) {
          searchFn(action, details.text, callbackSetList)
        },
        feature.args.placeholder || '搜索',
        true
      )
    }

    // 调用 enter
    if (feature.args && typeof feature.args.enter === 'function') {
      feature.args.enter(action, callbackSetList)
    }
  })
})()
