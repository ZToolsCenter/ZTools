import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface Command {
  name: string
  path: string
  icon?: string
}

const api = {
  getApps: () => ipcRenderer.invoke('get-apps'),
  getSystemSettings: () => ipcRenderer.invoke('get-system-settings'),
  isWindows: () => ipcRenderer.invoke('is-windows'),
  launch: (options: {
    path: string
    type?: 'direct' | 'plugin'
    featureCode?: string
    param?: any
    name?: string
    cmdType?: string
    confirmDialog?: any
  }) => ipcRenderer.invoke('launch', options),
  hideWindow: () => ipcRenderer.send('hide-window'),
  resizeWindow: (height: number) => ipcRenderer.send('resize-window', height),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  setWindowPosition: (x: number, y: number) => ipcRenderer.send('set-window-position', x, y),
  setWindowSizeLock: (lock: boolean) => ipcRenderer.send('set-window-size-lock', lock),
  setWindowOpacity: (opacity: number) => ipcRenderer.send('set-window-opacity', opacity),
  setTrayIconVisible: (visible: boolean) => ipcRenderer.invoke('set-tray-icon-visible', visible),
  setLaunchAtLogin: (enable: boolean) => ipcRenderer.invoke('set-launch-at-login', enable),
  getLaunchAtLogin: () => ipcRenderer.invoke('get-launch-at-login'),
  setTheme: (theme: string) => ipcRenderer.invoke('set-theme', theme),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  copyToClipboard: (text: string) => ipcRenderer.invoke('copy-to-clipboard', text),
  openTerminal: (path: string) => ipcRenderer.invoke('open-terminal', path),
  getFinderPath: () => ipcRenderer.invoke('get-finder-path'),
  analyzeImage: (imagePath: string) => ipcRenderer.invoke('analyze-image', imagePath),
  getLastCopiedContent: (timeLimit?: number) =>
    ipcRenderer.invoke('get-last-copied-content', timeLimit),
  getFrontmostApp: () => ipcRenderer.invoke('get-frontmost-app'),
  activateApp: (identifier: string, type?: 'name' | 'bundleId' | 'path') =>
    ipcRenderer.invoke('activate-app', identifier, type),
  revealInFinder: (filePath: string) => ipcRenderer.invoke('reveal-in-finder', filePath),
  showContextMenu: (menuItems: any[]) => ipcRenderer.invoke('show-context-menu', menuItems),
  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  importPlugin: () => ipcRenderer.invoke('import-plugin'),
  importDevPlugin: () => ipcRenderer.invoke('import-dev-plugin'),
  fetchPluginMarket: () => ipcRenderer.invoke('fetch-plugin-market'),
  installPluginFromMarket: (plugin: any) =>
    ipcRenderer.invoke('install-plugin-from-market', plugin),
  getPluginReadme: (pluginPath: string): Promise<any> =>
    ipcRenderer.invoke('get-plugin-readme', pluginPath),
  getPluginDbData: (pluginName: string): Promise<any> =>
    ipcRenderer.invoke('get-plugin-db-data', pluginName),
  deletePlugin: (pluginPath: string) => ipcRenderer.invoke('delete-plugin', pluginPath),
  reloadPlugin: (pluginPath: string) => ipcRenderer.invoke('reload-plugin', pluginPath),
  getRunningPlugins: () => ipcRenderer.invoke('get-running-plugins'),
  killPlugin: (pluginPath: string) => ipcRenderer.invoke('kill-plugin', pluginPath),
  killPluginAndReturn: (pluginPath: string) =>
    ipcRenderer.invoke('kill-plugin-and-return', pluginPath),
  sendInputEvent: (event: any) => ipcRenderer.invoke('send-input-event', event),
  selectAvatar: () => ipcRenderer.invoke('select-avatar'),
  openSettings: () => ipcRenderer.send('open-settings'),
  // 历史记录管理
  removeFromHistory: (appPath: string, featureCode?: string) =>
    ipcRenderer.invoke('remove-from-history', appPath, featureCode),
  // 固定应用管理
  pinApp: (app: any) => ipcRenderer.invoke('pin-app', app),
  unpinApp: (appPath: string, featureCode?: string) =>
    ipcRenderer.invoke('unpin-app', appPath, featureCode),
  updatePinnedOrder: (newOrder: any[]) => ipcRenderer.invoke('update-pinned-order', newOrder),
  hidePlugin: () => ipcRenderer.send('hide-plugin'),
  onContextMenuCommand: (callback: (command: string) => void) => {
    ipcRenderer.on('context-menu-command', (_event, command) => callback(command))
  },
  onFocusSearch: (callback: () => void) => {
    ipcRenderer.on('focus-search', callback)
  },
  onBackToSearch: (callback: () => void) => {
    ipcRenderer.on('back-to-search', callback)
  },
  onRedirectSearch: (callback: (data: { cmdName: string; payload?: any }) => void) => {
    ipcRenderer.on('redirect-search', (_event, data) => callback(data))
  },
  onPluginOpened: (callback: (plugin: { name: string; logo: string; path: string }) => void) => {
    ipcRenderer.on('plugin-opened', (_event, plugin) => callback(plugin))
  },
  onPluginLoaded: (callback: (plugin: { name: string; path: string }) => void) => {
    ipcRenderer.on('plugin-loaded', (_event, plugin) => callback(plugin))
  },
  onPluginClosed: (callback: () => void) => {
    ipcRenderer.on('plugin-closed', callback)
  },
  onWindowInfoChanged: (
    callback: (windowInfo: { appName: string; bundleId: string; timestamp: number }) => void
  ) => {
    ipcRenderer.on('window-info-changed', (_event, windowInfo) => callback(windowInfo))
  },
  onPluginsChanged: (callback: () => void) => {
    ipcRenderer.on('plugins-changed', callback)
  },
  onAppsChanged: (callback: () => void) => {
    ipcRenderer.on('apps-changed', callback)
  },
  onShowPluginPlaceholder: (callback: () => void) => {
    ipcRenderer.on('show-plugin-placeholder', callback)
  },
  onShowSettings: (callback: () => void) => {
    ipcRenderer.on('show-settings', callback)
  },
  onAppLaunched: (callback: () => void) => {
    ipcRenderer.on('app-launched', callback)
  },
  onHistoryChanged: (callback: () => void) => {
    ipcRenderer.on('history-changed', callback)
  },
  onPinnedChanged: (callback: () => void) => {
    ipcRenderer.on('pinned-changed', callback)
  },
  onUpdatePlaceholder: (callback: (placeholder: string) => void) => {
    ipcRenderer.on('update-placeholder', (_event, placeholder) => callback(placeholder))
  },
  onUpdateAvatar: (callback: (avatar: string) => void) => {
    ipcRenderer.on('update-avatar', (_event, avatar) => callback(avatar))
  },
  onUpdateAutoPaste: (callback: (autoPaste: string) => void) => {
    ipcRenderer.on('update-auto-paste', (_event, autoPaste) => callback(autoPaste))
  },
  onUpdateAutoClear: (callback: (autoClear: string) => void) => {
    ipcRenderer.on('update-auto-clear', (_event, autoClear) => callback(autoClear))
  },
  onUpdatePrimaryColor: (
    callback: (data: { primaryColor: string; customColor?: string }) => void
  ) => {
    ipcRenderer.on('update-primary-color', (_event, data) => callback(data))
  },
  onIpcLaunch: (
    callback: (options: {
      path: string
      type?: 'direct' | 'plugin'
      featureCode?: string
      param?: any
    }) => void
  ) => {
    ipcRenderer.on('ipc-launch', (_event, options) => callback(options))
  },
  openPluginDevTools: () => ipcRenderer.invoke('open-plugin-devtools'),
  detachPlugin: () => ipcRenderer.invoke('detach-plugin'),
  // 快捷键相关
  updateShortcut: (shortcut: string) => ipcRenderer.invoke('update-shortcut', shortcut),
  getCurrentShortcut: () => ipcRenderer.invoke('get-current-shortcut'),
  registerGlobalShortcut: (shortcut: string, target: string) =>
    ipcRenderer.invoke('register-global-shortcut', shortcut, target),
  unregisterGlobalShortcut: (shortcut: string) =>
    ipcRenderer.invoke('unregister-global-shortcut', shortcut),
  // 快捷键录制（临时注册，触发后自动注销）
  startHotkeyRecording: () => ipcRenderer.invoke('start-hotkey-recording'),
  onHotkeyRecorded: (callback: (shortcut: string) => void) => {
    ipcRenderer.on('hotkey-recorded', (_event, shortcut) => callback(shortcut))
  },
  // 子输入框相关
  notifySubInputChange: (text: string) => ipcRenderer.send('notify-sub-input-change', text),
  setSubInputValue: (text: string) => ipcRenderer.invoke('set-sub-input-value', text),
  onSetSubInputValue: (callback: (text: string) => void) => {
    ipcRenderer.on('set-sub-input-value', (_event, text) => callback(text))
  },
  onFocusSubInput: (callback: () => void) => {
    ipcRenderer.on('focus-sub-input', callback)
  },
  onUpdateSubInputPlaceholder: (
    callback: (data: { pluginPath: string; placeholder: string }) => void
  ) => {
    ipcRenderer.on('update-sub-input-placeholder', (_event, data) => callback(data))
  },
  // 数据库相关（主程序专用，直接操作 ZTOOLS 命名空间）
  dbPut: (key: string, data: any) => ipcRenderer.invoke('ztools:db-put', key, data),
  dbGet: (key: string) => ipcRenderer.invoke('ztools:db-get', key),
  // 插件数据管理
  getPluginDataStats: () => ipcRenderer.invoke('get-plugin-data-stats'),
  getPluginDocKeys: (pluginName: string) => ipcRenderer.invoke('get-plugin-doc-keys', pluginName),
  getPluginDoc: (pluginName: string, key: string) =>
    ipcRenderer.invoke('get-plugin-doc', pluginName, key),
  clearPluginData: (pluginName: string) => ipcRenderer.invoke('clear-plugin-data', pluginName),
  // 软件更新
  updater: {
    checkUpdate: () => ipcRenderer.invoke('updater:check-update'),
    startUpdate: (updateInfo: any) => ipcRenderer.invoke('updater:start-update', updateInfo),
    installDownloadedUpdate: () => ipcRenderer.invoke('updater:install-downloaded-update'),
    getDownloadStatus: () => ipcRenderer.invoke('updater:get-download-status')
  },
  onUpdateDownloaded: (callback: (data: { version: string; changelog: string[] }) => void) => {
    ipcRenderer.on('update-downloaded', (_event, data) => callback(data))
  },
  onUpdateDownloadStart: (callback: (data: { version: string }) => void) => {
    ipcRenderer.on('update-download-start', (_event, data) => callback(data))
  },
  onUpdateDownloadFailed: (callback: (data: { error: string }) => void) => {
    ipcRenderer.on('update-download-failed', (_event, data) => callback(data))
  },
  // 获取应用版本
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // 获取应用名称
  getAppName: () => ipcRenderer.invoke('get-app-name'),
  // 获取环境版本信息 (Electron, Node, Chrome等)
  getSystemVersions: () => ipcRenderer.invoke('get-system-versions'),
  // 获取系统平台 (darwin, win32, linux)
  getPlatform: () => ipcRenderer.sendSync('get-platform'),
  // 上次匹配状态管理
  getLastMatchState: () => ipcRenderer.invoke('get-last-match-state'),
  restoreLastMatch: () => ipcRenderer.invoke('restore-last-match'),
  // 使用统计管理
  getUsageStats: () => ipcRenderer.invoke('get-usage-stats'),
  // 文件系统检查（异步，通过主进程）
  checkFilePaths: (paths: string[]) => ipcRenderer.invoke('check-file-paths', paths),
  // 获取拖放文件的路径（Electron webUtils）
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('ztools', api)

// 为标题栏暴露 electron API
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, ...args: any[]): void => ipcRenderer.send(channel, ...args),
    on: (channel: string, callback: (...args: any[]) => void): (() => void) => {
      const subscription = (_event: any, ...args: any[]): void => callback(...args)
      ipcRenderer.on(channel, subscription)
      return (): void => {
        ipcRenderer.removeListener(channel, subscription)
      }
    }
  }
})

// TypeScript 类型定义
declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        send: (channel: string, ...args: any[]) => void
        on: (channel: string, callback: (...args: any[]) => void) => () => void
      }
    }
    ztools: {
      getApps: () => Promise<Command[]>
      getSystemSettings: () => Promise<any[]>
      isWindows: () => Promise<boolean>
      launch: (options: {
        path: string
        type?: 'direct' | 'plugin'
        featureCode?: string
        param?: any
        name?: string
      }) => Promise<void>
      hideWindow: () => void
      resizeWindow: (height: number) => void
      setWindowOpacity: (opacity: number) => void
      setTrayIconVisible: (visible: boolean) => Promise<void>
      setLaunchAtLogin: (enable: boolean) => Promise<void>
      getLaunchAtLogin: () => Promise<boolean>
      setTheme: (theme: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      copyToClipboard: (text: string) => Promise<void>
      openTerminal: (path: string) => Promise<void>
      getFinderPath: () => Promise<string | null>
      getLastCopiedText: (timeLimit: number) => Promise<string | null>
      getFrontmostApp: () => Promise<{
        name: string
        bundleId: string
        path: string
      } | null>
      activateApp: (
        identifier: string,
        type?: 'name' | 'bundleId' | 'path'
      ) => Promise<{ success: boolean; error?: string }>
      revealInFinder: (filePath: string) => Promise<void>
      showContextMenu: (menuItems: any[]) => Promise<void>
      getPlugins: () => Promise<any[]>
      importPlugin: () => Promise<{ success: boolean; error?: string }>
      importDevPlugin: () => Promise<{ success: boolean; error?: string }>
      fetchPluginMarket: () => Promise<{ success: boolean; data?: any; error?: string }>
      installPluginFromMarket: (plugin: any) => Promise<{
        success: boolean
        error?: string
        plugin?: any
      }>
      deletePlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      reloadPlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      getRunningPlugins: () => Promise<string[]>
      killPlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      killPluginAndReturn: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      sendInputEvent: (event: {
        type: 'keyDown' | 'keyUp' | 'char' | 'mouseDown' | 'mouseUp' | 'mouseMove'
        keyCode?: string
        x?: number
        y?: number
        button?: 'left' | 'right' | 'middle'
        clickCount?: number
      }) => Promise<{ success: boolean; error?: string }>
      selectAvatar: () => Promise<{ success: boolean; path?: string; error?: string }>
      // 历史记录管理
      removeFromHistory: (appPath: string, featureCode?: string) => Promise<void>
      // 固定应用管理
      pinApp: (app: any) => Promise<void>
      unpinApp: (appPath: string, featureCode?: string) => Promise<void>
      updatePinnedOrder: (newOrder: any[]) => Promise<void>
      hidePlugin: () => void
      onContextMenuCommand: (callback: (command: string) => void) => void
      onFocusSearch: (callback: () => void) => void
      onBackToSearch: (callback: () => void) => void
      onPluginOpened: (
        callback: (plugin: { name: string; logo: string; path: string }) => void
      ) => void
      onPluginClosed: (callback: () => void) => void
      onWindowInfoChanged: (
        callback: (windowInfo: { appName: string; bundleId: string; timestamp: number }) => void
      ) => void
      onPluginsChanged: (callback: () => void) => void
      onAppsChanged: (callback: () => void) => void
      onShowPluginPlaceholder: (callback: () => void) => void
      onShowSettings: (callback: () => void) => void
      onAppLaunched: (callback: () => void) => void
      onHistoryChanged: (callback: () => void) => void
      onPinnedChanged: (callback: () => void) => void
      onIpcLaunch: (
        callback: (options: {
          path: string
          type?: 'direct' | 'plugin'
          featureCode?: string
          param?: any
          name?: string
          cmdType?: string
        }) => void
      ) => void
      onRedirectSearch: (callback: (data: { cmdName: string; payload?: any }) => void) => void
      onSetSubInputValue: (callback: (text: string) => void) => void
      onFocusSubInput: (callback: () => void) => void
      openPluginDevTools: () => Promise<{ success: boolean; error?: string }>
      detachPlugin: () => Promise<{ success: boolean; error?: string }>
      // 快捷键相关
      updateShortcut: (shortcut: string) => Promise<{ success: boolean; error?: string }>
      getCurrentShortcut: () => Promise<string>
      registerGlobalShortcut: (
        shortcut: string,
        target: string
      ) => Promise<{ success: boolean; error?: string }>
      unregisterGlobalShortcut: (shortcut: string) => Promise<{ success: boolean; error?: string }>
      // 窗口相关
      windowPaste: () => Promise<{ success: boolean; error?: string }>
      // 子输入框相关
      notifySubInputChange: (text: string) => void
      onUpdateSubInputPlaceholder: (
        callback: (data: { pluginPath: string; placeholder: string }) => void
      ) => void
      // 数据库相关（主程序专用，直接操作 ZTOOLS 命名空间）
      dbPut: (key: string, data: any) => Promise<any>
      dbGet: (key: string) => Promise<any>
      // 插件数据管理
      getPluginDataStats: () => Promise<{
        success: boolean
        data?: Array<{
          pluginName: string
          docCount: number
          attachmentCount: number
          logo: string | null
        }>
        error?: string
      }>
      getPluginDocKeys: (pluginName: string) => Promise<{
        success: boolean
        data?: Array<{ key: string; type: 'document' | 'attachment' }>
        error?: string
      }>
      getPluginDoc: (
        pluginName: string,
        key: string
      ) => Promise<{
        success: boolean
        data?: any
        type?: 'document' | 'attachment'
        error?: string
      }>
      clearPluginData: (pluginName: string) => Promise<{
        success: boolean
        deletedCount?: number
        error?: string
      }>
      // 应用信息
      getAppVersion: () => Promise<string>
      getAppName: () => Promise<string>
      getSystemVersions: () => Promise<NodeJS.ProcessVersions>
      getPlatform: () => NodeJS.Platform
      // 上次匹配状态管理
      getLastMatchState: () => Promise<any>
      restoreLastMatch: () => Promise<any>
      // 使用统计管理
      getUsageStats: () => Promise<
        Array<{
          path: string
          type: string
          featureCode?: string | null
          name: string
          lastUsed: number
          useCount: number
        }>
      >
    }
  }
}
