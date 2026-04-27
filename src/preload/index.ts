import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface Command {
  name: string
  path: string
  icon?: string
  type?: string
  subType?: string
  cmdType?: string
  originalName?: string
  persistedName?: string
}

const api = {
  getApps: () => ipcRenderer.invoke('get-apps'),
  getSystemSettings: () => ipcRenderer.invoke('get-system-settings'),
  isWindows: () => ipcRenderer.invoke('is-windows'),
  launch: (options: {
    path: string
    type?: 'direct' | 'plugin' | 'builtin' | 'file'
    featureCode?: string
    param?: any
    name?: string
    cmdType?: string
    confirmDialog?: any
  }) => ipcRenderer.invoke('launch', options),
  launchAsAdmin: (appPath: string, name?: string) =>
    ipcRenderer.invoke('launch-as-admin', appPath, name),
  hideWindow: () => ipcRenderer.send('hide-window'),
  resizeWindow: (height: number) => ipcRenderer.send('resize-window', height),
  updateLaunchContext: (context: {
    searchQuery: string
    pastedImage: string | null
    pastedFiles: Array<{ path: string; name: string; isDirectory: boolean }> | null
    pastedText: string | null
  }) => ipcRenderer.send('update-launch-context', context),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  setWindowPosition: (x: number, y: number) => ipcRenderer.send('set-window-position', x, y),
  setWindowSizeLock: (lock: boolean) => ipcRenderer.send('set-window-size-lock', lock),
  setWindowOpacity: (opacity: number) => ipcRenderer.send('set-window-opacity', opacity),
  getWindowMaterial: () => ipcRenderer.invoke('get-window-material'),
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
  getAllPlugins: () => ipcRenderer.invoke('get-all-plugins'),
  getDisabledPlugins: () => ipcRenderer.invoke('get-disabled-plugins'),
  setPluginDisabled: (pluginPath: string, disabled: boolean) =>
    ipcRenderer.invoke('set-plugin-disabled', pluginPath, disabled),
  importPlugin: () => ipcRenderer.invoke('import-plugin'),
  // 导入开发中的插件工程，可选直接传入 plugin.json 路径
  importDevPlugin: (pluginJsonPath?: string) =>
    ipcRenderer.invoke('import-dev-plugin', pluginJsonPath),
  fetchPluginMarket: () => ipcRenderer.invoke('fetch-plugin-market'),
  installPluginFromMarket: (plugin: any) =>
    ipcRenderer.invoke('install-plugin-from-market', plugin),
  getPluginReadme: (pluginPath: string): Promise<any> =>
    ipcRenderer.invoke('get-plugin-readme', pluginPath),
  getPluginDbData: (pluginName: string): Promise<any> =>
    ipcRenderer.invoke('get-plugin-db-data', pluginName),
  installPluginFromNpm: (options: {
    packageName: string
    useChinaMirror?: boolean
  }): Promise<any> => ipcRenderer.invoke('install-plugin-from-npm', options),
  deletePlugin: (pluginPath: string) => ipcRenderer.invoke('delete-plugin', pluginPath),
  exportAllPlugins: () => ipcRenderer.invoke('export-all-plugins'),
  getRunningPlugins: () => ipcRenderer.invoke('get-running-plugins'),
  killPlugin: (pluginPath: string) => ipcRenderer.invoke('kill-plugin', pluginPath),
  killPluginAndReturn: (pluginPath: string) =>
    ipcRenderer.invoke('kill-plugin-and-return', pluginPath),
  // mainPush 功能
  queryMainPush: (pluginPath: string, featureCode: string, queryData: any) =>
    ipcRenderer.invoke('query-main-push', pluginPath, featureCode, queryData),
  selectMainPush: (pluginPath: string, featureCode: string, selectData: any) =>
    ipcRenderer.invoke('select-main-push', pluginPath, featureCode, selectData),
  sendInputEvent: (event: any) => ipcRenderer.invoke('send-input-event', event),
  selectAvatar: () => ipcRenderer.invoke('select-avatar'),
  openSettings: () => ipcRenderer.send('open-settings'),
  // 历史记录管理
  removeFromHistory: (appPath: string, featureCode?: string, name?: string) =>
    ipcRenderer.invoke('remove-from-history', appPath, featureCode, name),
  // 固定应用管理
  pinApp: (app: any) => ipcRenderer.invoke('pin-app', app),
  unpinApp: (appPath: string, featureCode?: string, name?: string) =>
    ipcRenderer.invoke('unpin-app', appPath, featureCode, name),
  updatePinnedOrder: (newOrder: any[]) => ipcRenderer.invoke('update-pinned-order', newOrder),
  hidePlugin: () => ipcRenderer.send('hide-plugin'),
  setAssemblyTarget: (token: string) => ipcRenderer.invoke('set-assembly-target', token),
  endAssemblyPlugin: () => ipcRenderer.invoke('end-assembly-plugin'),
  onContextMenuCommand: (callback: (command: string) => void) => {
    const handler = (_event: any, command: string): void => callback(command)
    ipcRenderer.on('context-menu-command', handler)
    return (): void => {
      ipcRenderer.removeListener('context-menu-command', handler)
    }
  },
  onFocusSearch: (
    callback: (
      windowInfo?: {
        app: string
        bundleId?: string
        pid?: number
        title?: string
        x?: number
        y?: number
        width?: number
        height?: number
        appPath?: string
        className?: string
        hwnd?: number
      } | null
    ) => void
  ) => {
    ipcRenderer.on('focus-search', (_event, windowInfo) => callback(windowInfo))
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
    callback: (windowInfo: {
      app: string
      bundleId?: string
      pid?: number
      title?: string
      x?: number
      y?: number
      width?: number
      height?: number
      appPath?: string
      timestamp?: number
      className?: string
      hwnd?: number
    }) => void
  ) => {
    ipcRenderer.on('window-info-changed', (_event, windowInfo) => callback(windowInfo))
  },
  onPluginsChanged: (callback: () => void) => {
    ipcRenderer.on('plugins-changed', callback)
  },
  onAppsChanged: (callback: () => void) => {
    ipcRenderer.on('apps-changed', callback)
  },
  onLocalShortcutsChanged: (callback: () => void) => {
    ipcRenderer.on('local-shortcuts-changed', callback)
  },
  onCommandAliasesChanged: (callback: () => void) => {
    ipcRenderer.on('command-aliases-changed', callback)
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
  onSuperPanelPinnedChanged: (callback: () => void) => {
    ipcRenderer.on('super-panel-pinned-changed', callback)
  },
  onDisabledCommandsChanged: (callback: () => void) => {
    ipcRenderer.on('disabled-commands-changed', callback)
  },
  onUpdatePlaceholder: (callback: (placeholder: string) => void) => {
    ipcRenderer.on('update-placeholder', (_event, placeholder) => callback(placeholder))
  },
  onUpdateAvatar: (callback: (avatar: string) => void) => {
    ipcRenderer.on('update-avatar', (_event, avatar) => callback(avatar))
  },
  onAiStatusChanged: (callback: (status: 'idle' | 'sending' | 'receiving') => void) => {
    ipcRenderer.on('ai-status-changed', (_event, status) => callback(status))
  },
  onUpdateAutoPaste: (callback: (autoPaste: string) => void) => {
    ipcRenderer.on('update-auto-paste', (_event, autoPaste) => callback(autoPaste))
  },
  onUpdateAutoClear: (callback: (autoClear: string) => void) => {
    ipcRenderer.on('update-auto-clear', (_event, autoClear) => callback(autoClear))
  },
  onUpdateShowRecentInSearch: (callback: (showRecentInSearch: boolean) => void) => {
    ipcRenderer.on('update-show-recent-in-search', (_event, showRecentInSearch) =>
      callback(showRecentInSearch)
    )
  },
  onUpdateMatchRecommendation: (callback: (showMatchRecommendation: boolean) => void) => {
    ipcRenderer.on('update-match-recommendation', (_event, showMatchRecommendation) =>
      callback(showMatchRecommendation)
    )
  },
  onUpdateRecentRows: (callback: (rows: number) => void) => {
    ipcRenderer.on('update-recent-rows', (_event, rows) => callback(rows))
  },
  onUpdatePinnedRows: (callback: (rows: number) => void) => {
    ipcRenderer.on('update-pinned-rows', (_event, rows) => callback(rows))
  },
  onUpdateTabTarget: (callback: (target: string) => void) => {
    ipcRenderer.on('update-tab-target', (_event, target) => callback(target))
  },
  onUpdateTabKeyFunction: (callback: (mode: 'navigate' | 'target-command') => void) => {
    ipcRenderer.on('update-tab-key-function', (_event, mode) => callback(mode))
  },
  onUpdateSpaceOpenCommand: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on('update-space-open-command', (_event, enabled) => callback(enabled))
  },
  onUpdateFloatingBallDoubleClickCommand: (callback: (command: string) => void) => {
    ipcRenderer.on('update-floating-ball-double-click-command', (_event, command) =>
      callback(command)
    )
  },
  onUpdateSearchMode: (callback: (mode: string) => void) => {
    ipcRenderer.on('update-search-mode', (_event, mode) => callback(mode))
  },
  onUpdatePrimaryColor: (
    callback: (data: { primaryColor: string; customColor?: string }) => void
  ) => {
    ipcRenderer.on('update-primary-color', (_event, data) => callback(data))
  },
  onUpdateWindowMaterial: (callback: (material: 'mica' | 'none') => void) => {
    ipcRenderer.on('update-window-material', (_event, material) => callback(material))
  },
  onUpdateAcrylicOpacity: (
    callback: (data: { lightOpacity: number; darkOpacity: number }) => void
  ) => {
    ipcRenderer.on('update-acrylic-opacity', (_event, data) => callback(data))
  },
  onIpcLaunch: (
    callback: (options: {
      path: string
      type?: 'app' | 'direct' | 'plugin' | 'builtin' | 'file'
      featureCode?: string
      param?: any
      name?: string
      cmdType?: string
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
  onSetSearchText: (callback: (text: string) => void) => {
    ipcRenderer.on('set-search-text', (_event, text) => callback(text))
  },
  onSetSubInputValue: (callback: (text: string) => void) => {
    ipcRenderer.on('set-sub-input-value', (_event, text) => callback(text))
  },
  onFocusSubInput: (callback: () => void) => {
    ipcRenderer.on('focus-sub-input', callback)
  },
  onSelectSubInput: (callback: () => void) => {
    ipcRenderer.on('select-sub-input', callback)
  },
  onUpdateSubInputPlaceholder: (
    callback: (data: { pluginPath: string; placeholder: string }) => void
  ) => {
    ipcRenderer.on('update-sub-input-placeholder', (_event, data) => callback(data))
  },
  onUpdateSubInputVisible: (callback: (visible: boolean) => void) => {
    ipcRenderer.on('update-sub-input-visible', (_event, visible) => callback(visible))
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
  // 检测是否为 Windows 11
  isWindows11: () => ipcRenderer.invoke('is-windows11'),
  // 上次匹配状态管理
  getLastMatchState: () => ipcRenderer.invoke('get-last-match-state'),
  restoreLastMatch: () => ipcRenderer.invoke('restore-last-match'),
  // 使用统计管理
  getUsageStats: () => ipcRenderer.invoke('get-usage-stats'),
  // 本地启动管理
  localShortcuts: {
    getAll: () => ipcRenderer.invoke('local-shortcuts:get-all'),
    add: (type: 'file' | 'folder') => ipcRenderer.invoke('local-shortcuts:add', type),
    delete: (id: string) => ipcRenderer.invoke('local-shortcuts:delete', id),
    open: (path: string) => ipcRenderer.invoke('local-shortcuts:open', path),
    updateAlias: (id: string, alias: string) =>
      ipcRenderer.invoke('local-shortcuts:update-alias', id, alias)
  },
  // 文件系统检查（异步，通过主进程）
  checkFilePaths: (paths: string[]) => ipcRenderer.invoke('check-file-paths', paths),
  // 获取拖放文件的路径（Electron webUtils）
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // AI 模型管理
  aiModels: {
    getAll: () => ipcRenderer.invoke('ai-models:get-all'),
    add: (model: any) => ipcRenderer.invoke('ai-models:add', model),
    update: (model: any) => ipcRenderer.invoke('ai-models:update', model),
    delete: (modelId: string) => ipcRenderer.invoke('ai-models:delete', modelId)
  },
  // 超级面板相关
  onSuperPanelSearch: (callback: (data: { text: string; clipboardContent?: any }) => void) => {
    ipcRenderer.on('super-panel-search', (_event, data) => callback(data))
  },
  sendSuperPanelSearchResult: (data: { results: any[]; clipboardContent?: any }) => {
    ipcRenderer.send('super-panel-search-result', data)
  },
  onSuperPanelData: (
    callback: (data: {
      type: string
      commands?: any[]
      results?: any[]
      clipboardContent?: any
    }) => void
  ) => {
    ipcRenderer.on('super-panel-data', (_event, data) => callback(data))
  },
  superPanelLaunch: (command: any) => ipcRenderer.invoke('super-panel:launch', command),
  superPanelReady: () => ipcRenderer.send('super-panel:ready'),
  superPanelShowPinned: () => ipcRenderer.send('super-panel:show-pinned'),
  superPanelShowMainWindow: () => ipcRenderer.send('super-panel:show-main-window'),
  // 悬浮球
  floatingBall: {
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('floating-ball:set-enabled', enabled),
    getEnabled: () => ipcRenderer.invoke('floating-ball:get-enabled')
  },
  onFloatingBallFiles: (
    callback: (files: Array<{ path: string; name: string; isDirectory: boolean }>) => void
  ) => {
    ipcRenderer.on('floating-ball-files', (_event, files) => callback(files))
  },
  onFloatingBallDoubleClickCommand: (callback: (command: string) => void) => {
    ipcRenderer.on('floating-ball-double-click-command', (_event, command) => callback(command))
  },
  updateSuperPanelPinnedOrder: (commands: any[]) =>
    ipcRenderer.invoke('super-panel:update-pinned-order', commands),
  unpinSuperPanelCommand: (path: string, featureCode?: string) =>
    ipcRenderer.invoke('super-panel:unpin-command', path, featureCode),
  pinToSuperPanel: (command: any) => ipcRenderer.invoke('super-panel:pin-command', command),
  getSuperPanelPinned: () => ipcRenderer.invoke('super-panel:get-pinned'),
  onSuperPanelLaunch: (
    callback: (data: { command: any; clipboardContent?: any; windowInfo?: any }) => void
  ) => {
    ipcRenderer.on('super-panel-launch', (_event, data) => callback(data))
  },
  superPanelAddBlockedApp: () => ipcRenderer.invoke('super-panel:add-blocked-app'),
  // 超级面板窗口匹配
  superPanelSearchWindowCommands: (windowInfo: { app?: string; title?: string }) =>
    ipcRenderer.invoke('super-panel:search-window-commands', windowInfo),
  onSuperPanelWindowCommandsData: (callback: (data: { results: any[] }) => void) => {
    ipcRenderer.on('super-panel-window-commands-data', (_event, data) => callback(data))
  },
  onSuperPanelTranslation: (callback: (data: { text: string; sourceText?: string }) => void) => {
    ipcRenderer.on('super-panel-translation', (_event, data) => callback(data))
  },
  onSuperPanelSearchWindowCommands: (
    callback: (windowInfo: { app?: string; title?: string }) => void
  ) => {
    ipcRenderer.on('super-panel-search-window-commands', (_event, windowInfo) =>
      callback(windowInfo)
    )
  },
  sendSuperPanelWindowCommandsResult: (data: { results: any[] }) => {
    ipcRenderer.send('super-panel-window-commands-result', data)
  }
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
        type?: 'direct' | 'plugin' | 'builtin' | 'file'
        featureCode?: string
        param?: any
        name?: string
        cmdType?: string
        confirmDialog?: any
      }) => Promise<void>
      hideWindow: () => void
      resizeWindow: (height: number) => void
      updateLaunchContext: (context: {
        searchQuery: string
        pastedImage: string | null
        pastedFiles: Array<{ path: string; name: string; isDirectory: boolean }> | null
        pastedText: string | null
      }) => void
      setWindowOpacity: (opacity: number) => void
      getWindowMaterial: () => Promise<'mica' | 'acrylic' | 'none'>
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
      getAllPlugins: () => Promise<any[]>
      getDisabledPlugins: () => Promise<string[]>
      setPluginDisabled: (
        pluginPath: string,
        disabled: boolean
      ) => Promise<{ success: boolean; error?: string }>
      importPlugin: () => Promise<{ success: boolean; error?: string }>
      // 导入开发中的插件工程，可选直接传入 plugin.json 路径
      importDevPlugin: (pluginJsonPath?: string) => Promise<{ success: boolean; error?: string }>
      fetchPluginMarket: () => Promise<{ success: boolean; data?: any; error?: string }>
      installPluginFromMarket: (plugin: any) => Promise<{
        success: boolean
        error?: string
        plugin?: any
      }>
      deletePlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      exportAllPlugins: () => Promise<{
        success: boolean
        exportPath?: string
        count?: number
        error?: string
      }>
      getRunningPlugins: () => Promise<string[]>
      killPlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      killPluginAndReturn: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      // mainPush 功能
      queryMainPush: (
        pluginPath: string,
        featureCode: string,
        queryData: { code: string; type: string; payload: string }
      ) => Promise<any[]>
      selectMainPush: (
        pluginPath: string,
        featureCode: string,
        selectData: { code: string; type: string; payload: string; option: any }
      ) => Promise<boolean>
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
      removeFromHistory: (appPath: string, featureCode?: string, name?: string) => Promise<void>
      // 固定应用管理
      pinApp: (app: any) => Promise<void>
      unpinApp: (appPath: string, featureCode?: string, name?: string) => Promise<void>
      updatePinnedOrder: (newOrder: any[]) => Promise<void>
      hidePlugin: () => void
      setAssemblyTarget: (token: string) => Promise<boolean>
      endAssemblyPlugin: () => Promise<string | null>
      onContextMenuCommand: (callback: (command: string) => void) => () => void
      onFocusSearch: (
        callback: (
          windowInfo?: {
            app: string
            bundleId?: string
            pid?: number
            title?: string
            x?: number
            y?: number
            width?: number
            height?: number
            appPath?: string
            timestamp?: number
            className?: string
            hwnd?: number
          } | null
        ) => void
      ) => void
      onBackToSearch: (callback: () => void) => void
      onPluginOpened: (
        callback: (plugin: { name: string; logo: string; path: string }) => void
      ) => void
      onPluginClosed: (callback: () => void) => void
      onWindowInfoChanged: (
        callback: (windowInfo: {
          app: string
          bundleId?: string
          pid?: number
          title?: string
          x?: number
          y?: number
          width?: number
          height?: number
          appPath?: string
          timestamp?: number
          className?: string
          hwnd?: number
        }) => void
      ) => void
      onPluginsChanged: (callback: () => void) => void
      onAppsChanged: (callback: () => void) => void
      onLocalShortcutsChanged: (callback: () => void) => void
      onCommandAliasesChanged: (callback: () => void) => void
      onShowPluginPlaceholder: (callback: () => void) => void
      onShowSettings: (callback: () => void) => void
      onAppLaunched: (callback: () => void) => void
      onHistoryChanged: (callback: () => void) => void
      onPinnedChanged: (callback: () => void) => void
      onSuperPanelPinnedChanged: (callback: () => void) => void
      onIpcLaunch: (
        callback: (options: {
          path: string
          type?: 'app' | 'direct' | 'plugin' | 'builtin' | 'file'
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
      onUpdateSubInputVisible: (callback: (visible: boolean) => void) => void
      onUpdateTabTarget: (callback: (target: string) => void) => void
      onUpdateTabKeyFunction: (callback: (mode: 'navigate' | 'target-command') => void) => void
      onUpdateSpaceOpenCommand: (callback: (enabled: boolean) => void) => void
      onUpdateShowRecentInSearch: (callback: (showRecentInSearch: boolean) => void) => void
      onUpdateMatchRecommendation: (callback: (showMatchRecommendation: boolean) => void) => void
      // 数据库相关（主程序专用，直接操作 ZTOOLS 命名空间）
      dbPut: (key: string, data: any) => Promise<any>
      dbGet: (key: string) => Promise<any>
      // 插件数据管理
      getPluginDataStats: () => Promise<{
        success: boolean
        data?: Array<{
          pluginName: string
          pluginTitle?: string | null
          isDevelopment: boolean
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
      isWindows11: () => Promise<boolean>
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
      // 超级面板相关
      updateSuperPanelPinnedOrder: (
        commands: any[]
      ) => Promise<{ success: boolean; error?: string }>
      superPanelShowMainWindow: () => void
      unpinSuperPanelCommand: (
        path: string,
        featureCode?: string
      ) => Promise<{ success: boolean; error?: string }>
      // AI 模型管理
      aiModels: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
        add: (model: any) => Promise<{ success: boolean; error?: string }>
        update: (model: any) => Promise<{ success: boolean; error?: string }>
        delete: (modelId: string) => Promise<{ success: boolean; error?: string }>
      }
      // 悬浮球
      floatingBall: {
        setEnabled: (enabled: boolean) => Promise<{ success: boolean }>
        getEnabled: () => Promise<boolean>
      }
      onFloatingBallFiles: (
        callback: (files: Array<{ path: string; name: string; isDirectory: boolean }>) => void
      ) => void
      onFloatingBallDoubleClickCommand: (callback: (command: string) => void) => void
    }
  }
}
