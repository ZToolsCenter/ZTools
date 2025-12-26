// Ambient type declarations for renderer, so TS knows window.ztools

/**
 * 上次匹配状态接口
 */
interface LastMatchState {
  searchQuery: string
  pastedImage: string | null
  pastedFiles: any[] | null
  pastedText: string | null
  timestamp: number
}

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        send: (channel: string, ...args: any[]) => void
        on: (channel: string, callback: (...args: any[]) => void) => () => void
      }
    }
    ztools: {
      getApps: () => Promise<Array<{ name: string; path: string; icon?: string }>>
      getSystemSettings: () => Promise<any[]>
      isWindows: () => Promise<boolean>
      launch: (options: {
        path: string
        type?: 'direct' | 'plugin'
        featureCode?: string
        param?: any
        name?: string
        cmdType?: string // cmd 类型（用于判断是否添加历史记录）
        confirmDialog?: any // 确认对话框配置
      }) => Promise<any>
      hideWindow: () => void
      resizeWindow: (height: number) => void
      getWindowPosition: () => Promise<{ x: number; y: number }>
      setWindowPosition: (x: number, y: number) => void
      setWindowSizeLock: (lock: boolean) => void
      setWindowOpacity: (opacity: number) => void
      setTrayIconVisible: (visible: boolean) => Promise<void>
      setLaunchAtLogin: (enable: boolean) => Promise<void>
      getLaunchAtLogin: () => Promise<boolean>
      setTheme: (theme: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      copyToClipboard: (text: string) => Promise<void>
      openTerminal: (path: string) => Promise<void>
      getFinderPath: () => Promise<string | null>
      analyzeImage: (imagePath: string) => Promise<{
        isSimpleIcon: boolean
        mainColor: string | null
        isDark: boolean
        needsAdaptation: boolean
      }>
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
      getPluginReadme: (pluginPath: string) => Promise<{
        success: boolean
        content?: string
        error?: string
      }>
      getPluginDbData: (pluginName: string) => Promise<{
        success: boolean
        data?: Array<{ id: string; data: any; rev?: string; updatedAt?: string }>
        error?: string
      }>
      deletePlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      reloadPlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      getRunningPlugins: () => Promise<string[]>
      killPlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      killPluginAndReturn: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
      detachPlugin: () => Promise<{ success: boolean; error?: string }>
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
      onRedirectSearch: (callback: (data: { cmdName: string; payload?: any }) => void) => void
      onPluginOpened: (
        callback: (plugin: { name: string; logo: string; path: string }) => void
      ) => void
      onPluginLoaded: (callback: (plugin: { name: string; path: string }) => void) => void
      onPluginClosed: (callback: () => void) => void
      onPluginsChanged: (callback: () => void) => void
      onAppsChanged: (callback: () => void) => void
      onHistoryChanged: (callback: () => void) => void
      onPinnedChanged: (callback: () => void) => void
      onShowPluginPlaceholder: (callback: () => void) => void
      onShowSettings: (callback: () => void) => void
      onAppLaunched: (callback: () => void) => void
      onIpcLaunch: (
        callback: (options: {
          path: string
          type?: 'app' | 'plugin'
          featureCode?: string
          param?: any
          name?: string
          cmdType?: string // cmd 类型（用于判断是否添加历史记录）
        }) => void
      ) => void
      openPluginDevTools: () => Promise<{ success: boolean; error?: string }>
      // 快捷键相关
      updateShortcut: (shortcut: string) => Promise<{ success: boolean; error?: string }>
      getCurrentShortcut: () => Promise<string>
      registerGlobalShortcut: (
        shortcut: string,
        target: string
      ) => Promise<{ success: boolean; error?: string }>
      unregisterGlobalShortcut: (shortcut: string) => Promise<{ success: boolean; error?: string }>
      // 快捷键录制（临时注册，触发后自动注销）
      startHotkeyRecording: () => Promise<{ success: boolean; error?: string }>
      onHotkeyRecorded: (callback: (shortcut: string) => void) => void
      // 数据库相关
      dbPut: (key: string, data: any) => Promise<any>
      dbGet: (key: string) => Promise<any>
      dbRemove: (bucket: string, doc: any) => Promise<any>
      dbBulkDocs: (bucket: string, docs: any[]) => Promise<any>
      dbAllDocs: (bucket: string, key: string | string[]) => Promise<any>
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
      // 窗口相关
      windowPaste: () => Promise<{ success: boolean; error?: string }>
      onWindowInfoChanged: (
        callback: (windowInfo: { appName: string; bundleId: string; timestamp: number }) => void
      ) => void
      getLastCopiedContent: (timeLimit?: number) => Promise<{
        type: 'text' | 'image' | 'file'
        data: string | Array<{ isFile: boolean; isDirectory: boolean; name: string; path: string }>
        timestamp: number
      } | null>
      // 子输入框相关
      notifySubInputChange: (text: string) => void
      setSubInputValue: (text: string) => Promise<boolean>
      onSetSubInputValue: (callback: (text: string) => void) => void
      onFocusSubInput: (callback: () => void) => void
      onUpdateSubInputPlaceholder?: (
        callback: (data: { pluginPath: string; placeholder: string }) => void
      ) => void
      // 设置插件通知主渲染进程的事件
      openSettings: () => void
      onUpdatePlaceholder: (callback: (placeholder: string) => void) => void
      onUpdateAvatar: (callback: (avatar: string) => void) => void
      onUpdateAutoPaste: (callback: (autoPaste: string) => void) => void
      onUpdateAutoClear: (callback: (autoClear: string) => void) => void
      onUpdatePrimaryColor: (
        callback: (data: { primaryColor: string; customColor?: string }) => void
      ) => void
      // 软件更新
      updater: {
        checkUpdate: () => Promise<{
          hasUpdate: boolean
          currentVersion?: string
          latestVersion?: string
          updateInfo?: any
          error?: string
        }>
        startUpdate: (updateInfo: any) => Promise<{ success: boolean; error?: string }>
        installDownloadedUpdate: () => Promise<{ success: boolean; error?: string }>
        getDownloadStatus: () => Promise<{
          hasDownloaded: boolean
          version?: string
          changelog?: string[]
        }>
      }
      onUpdateDownloaded: (
        callback: (data: { version: string; changelog: string[] }) => void
      ) => void
      onUpdateDownloadStart: (callback: (data: { version: string }) => void) => void
      onUpdateDownloadFailed: (callback: (data: { error: string }) => void) => void
      getAppVersion: () => Promise<string>
      getSystemVersions: () => Promise<NodeJS.ProcessVersions>
      getPlatform: () => string
      // 上次匹配状态管理
      getLastMatchState: () => Promise<LastMatchState | null>
      restoreLastMatch: () => Promise<LastMatchState | null>
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
      // 文件系统检查（异步，通过主进程）
      checkFilePaths: (
        paths: string[]
      ) => Promise<Array<{ path: string; isDirectory: boolean; exists: boolean }>>
      // 获取拖放文件的路径（Electron webUtils）
      getPathForFile: (file: File) => string
    }
  }
}

export {}
