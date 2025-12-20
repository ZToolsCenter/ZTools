const electron = require('electron')

// 为已弃用的 ipcRenderer.sendTo 添加 polyfill
// 通过主进程转发消息到目标 webContents
if (!electron.ipcRenderer.sendTo) {
  electron.ipcRenderer.sendTo = function (webContentsId, channel, ...args) {
    electron.ipcRenderer.send('ipc-send-to', webContentsId, channel, ...args)
  }
}

const enterCallbacks = []
const clipboardChangeCallbacks = []
const subInputChangeCallbacks = []
const pluginOutCallbacks = []
const mainPushCallbacks = []
const hotkeyRecordedCallbacks = []

// 获取操作系统类型
const osType = electron.ipcRenderer.sendSync('get-os-type')

window.ztools = {
  getAppName: () => 'ZTools',
  // 平台检测
  isMacOs: () => osType === 'Darwin',
  isMacOS: () => osType === 'Darwin',
  isWindows: () => osType === 'Windows_NT',
  isLinux: () => osType === 'Linux',
  // 获取设备唯一标识符（32位字符串）
  getNativeId: () => electron.ipcRenderer.sendSync('get-native-id'),
  // 获取应用版本号
  getAppVersion: () => electron.ipcRenderer.sendSync('get-app-version'),
  // 是否深色主题
  isDarkColors: () => electron.ipcRenderer.sendSync('is-dark-colors'),
  sendInputEvent: async (event) => await electron.ipcRenderer.invoke('send-input-event', event),
  // 模拟键盘按键
  simulateKeyboardTap: (key, ...modifiers) => {
    console.log('插件请求模拟键盘按键:', { key, modifiers })
    return electron.ipcRenderer.sendSync('simulate-keyboard-tap', key, modifiers)
  },
  onPluginEnter: async (callback) => {
    console.log('插件请求onPluginEnter')
    enterCallbacks.push(callback)
  },
  // 插件退出事件
  onPluginOut: async (callback) => {
    console.log('插件请求onPluginOut')
    if (callback && typeof callback === 'function') {
      pluginOutCallbacks.push(callback)
    }
  },
  // 监听主进程推送消息
  // TODO: 临时的，需要完善
  onMainPush: async (callback) => {
    console.log('插件请求onMainPush')
    if (callback && typeof callback === 'function') {
      mainPushCallbacks.push(callback)
    }
  },
  // 兼容旧api
  onPluginReady: async (callback) => {
    console.log('插件请求onPluginReady')
    enterCallbacks.push(callback)
  },
  // 显示系统通知
  showNotification: async (body) => {
    return await electron.ipcRenderer.invoke('show-notification', body)
  },
  // 设置插件高度
  setExpendHeight: async (height) => {
    return await electron.ipcRenderer.invoke('set-expend-height', height)
  },
  // 设置子输入框 (插件模式下的搜索框)
  setSubInput: async (onChange, placeholder, isFocus = true) => {
    console.log('插件设置子输入框:', { placeholder, isFocus })
    // 保存回调
    if (onChange && typeof onChange === 'function') {
      subInputChangeCallbacks.push(onChange)
    }
    // 通知主进程更新 placeholder，并传递 isFocus 参数
    return await electron.ipcRenderer.invoke('set-sub-input', placeholder, isFocus)
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
    write: async (id) => await electron.ipcRenderer.invoke('clipboard:write', id),
    // 写入内容到剪贴板 ({ type: 'text'|'image', content: string })
    writeContent: async (data) =>
      await electron.ipcRenderer.invoke('clipboard:write-content', data),
    updateConfig: async (config) =>
      await electron.ipcRenderer.invoke('clipboard:update-config', config),
    // 监听剪贴板变化事件
    onChange: async (callback) => {
      clipboardChangeCallbacks.push(callback)
    }
  },
  // 复制文本到剪贴板
  copyText: (text) => electron.ipcRenderer.sendSync('copy-text', text),
  // 复制图片到剪贴板
  copyImage: (image) => electron.ipcRenderer.sendSync('copy-image', image),
  // 复制文件到剪贴板
  copyFile: (filePath) => electron.ipcRenderer.sendSync('copy-file', filePath),
  // 获取系统路径
  getPath: (name) => electron.ipcRenderer.sendSync('get-path', name),
  // 显示文件保存对话框
  // 显示文件保存对话框
  showSaveDialog: (options) => electron.ipcRenderer.sendSync('show-save-dialog', options),
  // 显示文件打开对话框
  showOpenDialog: (options) => electron.ipcRenderer.sendSync('show-open-dialog', options),
  // 屏幕截图
  screenCapture: async (callback) => {
    const image = await electron.ipcRenderer.invoke('screen-capture')
    if (callback && typeof callback === 'function') {
      callback(image)
    }
  },
  // 隐藏主窗口
  hideMainWindow: async (isRestorePreWindow = true) => {
    return await electron.ipcRenderer.invoke('hide-main-window', isRestorePreWindow)
  },
  // 创建独立窗口
  createBrowserWindow: (url, options, callback) => {
    const callbackId = Math.random().toString(36).substr(2, 9)

    // 监听加载完成事件
    if (callback && typeof callback === 'function') {
      electron.ipcRenderer.once(`browser-window-loaded-${callbackId}`, () => {
        callback()
      })
    }

    // 同步调用创建窗口，获取 windowId
    const windowId = electron.ipcRenderer.sendSync(
      'create-browser-window',
      url,
      options,
      callbackId
    )

    if (!windowId) return null

    // 创建 Proxy 对象模拟 BrowserWindow
    const createProxy = (path = []) => {
      return new Proxy(() => {}, {
        get: (target, prop) => {
          if (typeof prop !== 'string') return undefined

          // 特殊处理 then，防止 Promise 链式调用错误
          if (prop === 'then') {
            if (path.length === 0) return undefined
            // 如果用户强行 await 一个属性，我们返回该属性的值
            return (resolve) =>
              resolve(
                electron.ipcRenderer.sendSync('browser-window-get-prop-sync', windowId, path).value
              )
          }

          const newPath = [...path, prop]

          // 同步获取属性信息
          const info = electron.ipcRenderer.sendSync(
            'browser-window-get-prop-sync',
            windowId,
            newPath
          )

          console.log('获取属性信息:', info)

          if (info.type === 'value') {
            return info.value
          } else {
            // 如果是对象，继续 Proxy
            return createProxy(newPath)
          }
        },
        apply: (target, thisArg, args) => {
          // 同步尝试调用方法
          const result = electron.ipcRenderer.sendSync(
            'browser-window-call-sync',
            windowId,
            path,
            args
          )

          if (result.type === 'value') {
            // 同步方法，直接返回结果
            return result.data
          } else if (result.type === 'promise') {
            // 异步方法，返回 Promise 等待结果
            return electron.ipcRenderer.invoke('browser-window-wait-task', result.taskId)
          }

          return null
        }
      })
    }

    return createProxy()
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
  // 插件跳转
  redirect: (label, payload) =>
    electron.ipcRenderer.sendSync('ztools-redirect', { label, payload }),
  // HTTP 请求头设置
  http: {
    // 设置请求头
    setHeaders: (headers) => electron.ipcRenderer.sendSync('http-set-headers', headers),
    // 获取当前请求头配置
    getHeaders: () => electron.ipcRenderer.sendSync('http-get-headers'),
    // 清除请求头配置
    clearHeaders: () => electron.ipcRenderer.sendSync('http-clear-headers')
  },

  // 内置插件专用 API（仅限内置插件调用）
  internal: {
    // ==================== 数据库 API (ZTOOLS/ 命名空间) ====================
    dbPut: async (key, value) => await electron.ipcRenderer.invoke('internal:db-put', key, value),
    dbGet: async (key) => await electron.ipcRenderer.invoke('internal:db-get', key),

    // ==================== 应用启动 API ====================
    launch: async (params) => await electron.ipcRenderer.invoke('internal:launch', params),

    // ==================== 指令管理 API ====================
    getCommands: async () => await electron.ipcRenderer.invoke('internal:get-commands'),

    // ==================== 插件管理 API ====================
    getPlugins: async () => await electron.ipcRenderer.invoke('internal:get-plugins'),
    importPlugin: async () => await electron.ipcRenderer.invoke('internal:import-plugin'),
    importDevPlugin: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:import-dev-plugin', pluginPath),
    deletePlugin: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:delete-plugin', pluginPath),
    reloadPlugin: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:reload-plugin', pluginPath),
    getRunningPlugins: async () =>
      await electron.ipcRenderer.invoke('internal:get-running-plugins'),
    killPlugin: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:kill-plugin', pluginPath),
    fetchPluginMarket: async () =>
      await electron.ipcRenderer.invoke('internal:fetch-plugin-market'),
    installPluginFromMarket: async (plugin) =>
      await electron.ipcRenderer.invoke('internal:install-plugin-from-market', plugin),
    getPluginReadme: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:get-plugin-readme', pluginPath),
    getPluginDocKeys: async (pluginPath) =>
      await electron.ipcRenderer.invoke('internal:get-plugin-doc-keys', pluginPath),
    getPluginDoc: async (pluginPath, docKey) =>
      await electron.ipcRenderer.invoke('internal:get-plugin-doc', pluginPath, docKey),
    getPluginDataStats: async () =>
      await electron.ipcRenderer.invoke('internal:get-plugin-data-stats'),
    clearPluginData: async (pluginName) =>
      await electron.ipcRenderer.invoke('internal:clear-plugin-data', pluginName),

    // ==================== 全局快捷键 API ====================
    registerGlobalShortcut: async (shortcut, target) =>
      await electron.ipcRenderer.invoke('internal:register-global-shortcut', shortcut, target),
    unregisterGlobalShortcut: async (shortcut) =>
      await electron.ipcRenderer.invoke('internal:unregister-global-shortcut', shortcut),
    startHotkeyRecording: async () =>
      await electron.ipcRenderer.invoke('internal:start-hotkey-recording'),
    updateShortcut: async (shortcut) =>
      await electron.ipcRenderer.invoke('internal:update-shortcut', shortcut),
    getCurrentShortcut: async () => await electron.ipcRenderer.invoke('get-current-shortcut'),
    onHotkeyRecorded: (callback) => {
      if (callback && typeof callback === 'function') {
        hotkeyRecordedCallbacks.push(callback)
      }
    },

    // ==================== 系统设置 API ====================
    setWindowOpacity: async (opacity) =>
      await electron.ipcRenderer.invoke('internal:set-window-opacity', opacity),
    selectAvatar: async () => await electron.ipcRenderer.invoke('internal:select-avatar'),
    setTheme: async (theme) => await electron.ipcRenderer.invoke('internal:set-theme', theme),
    setTrayIconVisible: async (visible) =>
      await electron.ipcRenderer.invoke('internal:set-tray-icon-visible', visible),
    setLaunchAtLogin: async (enabled) =>
      await electron.ipcRenderer.invoke('internal:set-launch-at-login', enabled),
    getLaunchAtLogin: async () => await electron.ipcRenderer.invoke('internal:get-launch-at-login'),
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
    // 通知主渲染进程更新主题色
    updatePrimaryColor: async (primaryColor, customColor) =>
      await electron.ipcRenderer.invoke('internal:update-primary-color', primaryColor, customColor),

    // ==================== 应用更新 API ====================
    updaterCheckUpdate: async () =>
      await electron.ipcRenderer.invoke('internal:updater-check-update'),
    updaterStartUpdate: async (updateInfo) =>
      await electron.ipcRenderer.invoke('internal:updater-start-update', updateInfo),

    // ==================== 其他 API ====================
    revealInFinder: async (path) =>
      await electron.ipcRenderer.invoke('internal:reveal-in-finder', path)
  }
}

electron.ipcRenderer.on('on-plugin-enter', (event, launchParam) => {
  console.log('插件进入参数:', launchParam)
  enterCallbacks.forEach((cb) => cb(launchParam))
})

// 监听插件退出事件
electron.ipcRenderer.on('plugin-out', (event, isKill) => {
  console.log('插件退出事件:', isKill)
  pluginOutCallbacks.forEach((cb) => cb(isKill))
})

electron.ipcRenderer.on('clipboard-change', (event, item) => {
  console.log('剪贴板变化:', item)
  clipboardChangeCallbacks.forEach((cb) => cb(item))
})

// 监听子输入框变化事件
electron.ipcRenderer.on('sub-input-change', (event, details) => {
  console.log('子输入框变化:', details)
  subInputChangeCallbacks.forEach((cb) => cb(details))
})

// 监听主进程推送消息
electron.ipcRenderer.on('main-push', (event, data) => {
  console.log('收到主进程推送:', data)
  mainPushCallbacks.forEach((cb) => cb(data))
})

// 监听快捷键录制事件
electron.ipcRenderer.on('hotkey-recorded', (event, shortcut) => {
  console.log('收到快捷键录制事件:', shortcut)
  hotkeyRecordedCallbacks.forEach((cb) => cb(shortcut))
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
