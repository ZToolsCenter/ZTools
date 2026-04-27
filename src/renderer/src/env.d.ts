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
        type?: 'direct' | 'plugin' | 'builtin' | 'file'
        featureCode?: string
        param?: any
        name?: string
        cmdType?: string // cmd 类型（用于判断是否添加历史记录）
        confirmDialog?: any // 确认对话框配置
      }) => Promise<any>
      launchAsAdmin: (appPath: string, name?: string) => Promise<void>
      hideWindow: () => void
      resizeWindow: (height: number) => void
      updateLaunchContext: (context: {
        searchQuery: string
        pastedImage: string | null
        pastedFiles: Array<{ path: string; name: string; isDirectory: boolean }> | null
        pastedText: string | null
      }) => void
      getWindowPosition: () => Promise<{ x: number; y: number }>
      setWindowPosition: (x: number, y: number) => void
      setWindowSizeLock: (lock: boolean) => void
      setWindowOpacity: (opacity: number) => void
      getWindowMaterial: () => Promise<'mica' | 'acrylic' | 'none'>
      setTrayIconVisible: (visible: boolean) => Promise<void>
      setWindowMaterial: (material: 'mica' | 'acrylic' | 'none') => Promise<{ success: boolean }>
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
      getAllPlugins: () => Promise<any[]>
      getDisabledPlugins: () => Promise<string[]>
      setPluginDisabled: (
        pluginPath: string,
        disabled: boolean
      ) => Promise<{ success: boolean; error?: string }>
      importPlugin: () => Promise<{ success: boolean; error?: string }>
      // 导入开发中的插件工程，可选直接传入 plugin.json 路径
      importDevPlugin: (pluginJsonPath?: string) => Promise<{ success: boolean; error?: string }>
      removeDevProject: (pluginName: string) => Promise<{ success: boolean; error?: string }>
      fetchPluginMarket: () => Promise<{
        success: boolean
        data?: any
        storefront?: any
        error?: string
      }>
      installPluginFromMarket: (plugin: any) => Promise<{
        success: boolean
        error?: string
        plugin?: any
      }>
      installPluginFromNpm: (options: {
        packageName: string
        useChinaMirror?: boolean
      }) => Promise<{
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
      removeFromHistory: (appPath: string, featureCode?: string, name?: string) => Promise<void>
      // 固定应用管理
      pinApp: (app: any) => Promise<void>
      unpinApp: (appPath: string, featureCode?: string, name?: string) => Promise<void>
      updatePinnedOrder: (newOrder: any[]) => Promise<void>
      hidePlugin: () => void
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
            className?: string
            hwnd?: number
          } | null
        ) => void
      ) => void
      onBackToSearch: (callback: () => void) => void
      onRedirectSearch: (callback: (data: { cmdName: string; payload?: any }) => void) => void
      onPluginOpened: (
        callback: (plugin: {
          name: string
          logo: string
          path: string
          subInputPlaceholder?: string
          subInputVisible?: boolean
        }) => void
      ) => void
      onPluginLoaded: (callback: (plugin: { name: string; path: string }) => void) => void
      onPluginClosed: (callback: () => void) => void
      onPluginsChanged: (callback: () => void) => void
      onAppsChanged: (callback: () => void) => void
      onLocalShortcutsChanged: (callback: () => void) => void
      onCommandAliasesChanged: (callback: () => void) => void
      onHistoryChanged: (callback: () => void) => void
      onPinnedChanged: (callback: () => void) => void
      onSuperPanelPinnedChanged: (callback: () => void) => void
      onDisabledCommandsChanged: (callback: () => void) => void
      onShowPluginPlaceholder: (callback: () => void) => void
      onShowSettings: (callback: () => void) => void
      onAppLaunched: (callback: () => void) => void
      onIpcLaunch: (
        callback: (options: {
          path: string
          type?: 'app' | 'direct' | 'plugin' | 'builtin' | 'file'
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
      // 窗口相关
      windowPaste: () => Promise<{ success: boolean; error?: string }>
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
      getLastCopiedContent: (timeLimit?: number) => Promise<{
        type: 'text' | 'image' | 'file'
        data: string | Array<{ isFile: boolean; isDirectory: boolean; name: string; path: string }>
        timestamp: number
      } | null>
      // 子输入框相关
      notifySubInputChange: (text: string) => void
      setSubInputValue: (text: string) => Promise<boolean>
      onSetSearchText: (callback: (text: string) => void) => void
      onSetSubInputValue: (callback: (text: string) => void) => void
      onFocusSubInput: (callback: () => void) => void
      onSelectSubInput: (callback: () => void) => void
      onUpdateSubInputPlaceholder?: (
        callback: (data: { pluginPath: string; placeholder: string }) => void
      ) => void
      onUpdateSubInputVisible?: (callback: (visible: boolean) => void) => void
      // 设置插件通知主渲染进程的事件
      openSettings: () => void
      onUpdatePlaceholder: (callback: (placeholder: string) => void) => void
      onUpdateAvatar: (callback: (avatar: string) => void) => void
      onAiStatusChanged: (callback: (status: 'idle' | 'sending' | 'receiving') => void) => void
      onUpdateAutoPaste: (callback: (autoPaste: string) => void) => void
      onUpdateAutoClear: (callback: (autoClear: string) => void) => void
      onUpdateShowRecentInSearch: (callback: (showRecentInSearch: boolean) => void) => void
      onUpdateMatchRecommendation: (callback: (showMatchRecommendation: boolean) => void) => void
      onUpdateRecentRows: (callback: (rows: number) => void) => void
      onUpdatePinnedRows: (callback: (rows: number) => void) => void
      onUpdateTabTarget: (callback: (target: string) => void) => void
      onUpdateTabKeyFunction: (callback: (mode: 'navigate' | 'target-command') => void) => void
      onUpdateSpaceOpenCommand: (callback: (enabled: boolean) => void) => void
      onUpdateFloatingBallDoubleClickCommand?: (callback: (command: string) => void) => void
      onUpdateSearchMode: (callback: (mode: string) => void) => void
      onUpdatePrimaryColor: (
        callback: (data: { primaryColor: string; customColor?: string }) => void
      ) => void
      onUpdateWindowMaterial?: (callback: (material: 'mica' | 'acrylic' | 'none') => void) => void
      onUpdateAcrylicOpacity?: (
        callback: (data: { lightOpacity: number; darkOpacity: number }) => void
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
      isWindows11: () => Promise<boolean>
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
      // 本地启动管理
      localShortcuts: {
        getAll: () => Promise<
          Array<{
            id: string
            name: string
            alias?: string
            path: string
            type: 'file' | 'folder' | 'app'
            icon?: string
            keywords?: string[]
            pinyin?: string
            pinyinAbbr?: string
            addedAt: number
          }>
        >
        add: (type: 'file' | 'folder') => Promise<{ success: boolean; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        open: (path: string) => Promise<{ success: boolean; error?: string }>
        updateAlias: (id: string, alias: string) => Promise<{ success: boolean; error?: string }>
      }
      // 文件系统检查（异步，通过主进程）
      checkFilePaths: (
        paths: string[]
      ) => Promise<Array<{ path: string; isDirectory: boolean; exists: boolean }>>
      // 获取拖放文件的路径（Electron webUtils）
      getPathForFile: (file: File) => string
      // 超级面板相关
      onSuperPanelSearch: (
        callback: (data: { text: string; clipboardContent?: any }) => void
      ) => void
      sendSuperPanelSearchResult: (data: { results: any[]; clipboardContent?: any }) => void
      onSuperPanelData: (
        callback: (data: {
          type: string
          commands?: any[]
          results?: any[]
          clipboardContent?: any
          windowInfo?: { app?: string; title?: string }
        }) => void
      ) => void
      superPanelLaunch: (command: any) => Promise<{ success: boolean; error?: string }>
      superPanelReady: () => void
      superPanelShowPinned: () => void
      superPanelShowMainWindow: () => void
      updateSuperPanelPinnedOrder: (
        commands: any[]
      ) => Promise<{ success: boolean; error?: string }>
      unpinSuperPanelCommand: (
        path: string,
        featureCode?: string
      ) => Promise<{ success: boolean; error?: string }>
      pinToSuperPanel: (command: any) => Promise<{ success: boolean; error?: string }>
      getSuperPanelPinned: () => Promise<any[]>
      onSuperPanelLaunch: (
        callback: (data: { command: any; clipboardContent?: any; windowInfo?: any }) => void
      ) => void
      superPanelAddBlockedApp: () => Promise<{ success: boolean; app?: string; error?: string }>
      // 超级面板窗口匹配
      superPanelSearchWindowCommands: (windowInfo: {
        app?: string
        title?: string
      }) => Promise<void>
      onSuperPanelWindowCommandsData: (callback: (data: { results: any[] }) => void) => void
      onSuperPanelTranslation: (
        callback: (data: { text: string; sourceText?: string }) => void
      ) => void
      onSuperPanelSearchWindowCommands: (
        callback: (windowInfo: { app?: string; title?: string }) => void
      ) => void
      sendSuperPanelWindowCommandsResult: (data: { results: any[] }) => void
      onFloatingBallFiles: (
        callback: (files: Array<{ path: string; name: string; isDirectory: boolean }>) => void
      ) => void
      onFloatingBallDoubleClickCommand?: (callback: (command: string) => void) => void
    }
  }
}

export {}
