// Ambient type declarations for renderer, so TS knows window.ztools

declare global {
  interface Window {
    ztools: {
      getApps: () => Promise<Array<{ name: string; path: string; icon?: string }>>
      launch: (options: {
        path: string
        type?: 'app' | 'plugin'
        featureCode?: string
        param?: any
      }) => Promise<void>
      hideWindow: () => void
      resizeWindow: (height: number) => void
      setWindowOpacity: (opacity: number) => void
      setTrayIconVisible: (visible: boolean) => Promise<void>
      setHideOnBlur: (hide: boolean) => Promise<void>
      setLaunchAtLogin: (enable: boolean) => Promise<void>
      getLaunchAtLogin: () => Promise<boolean>
      setTheme: (theme: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      copyToClipboard: (text: string) => Promise<void>
      openTerminal: (path: string) => Promise<void>
      getFinderPath: () => Promise<string | null>
      getFrontmostApp: () => Promise<{
        name: string
        bundleId: string
        path: string
      } | null>
      activateApp: (
        identifier: string,
        type?: 'name' | 'bundleId' | 'path'
      ) => Promise<{ success: boolean; error?: string }>
      showContextMenu: (menuItems: any[]) => Promise<void>
      getPlugins: () => Promise<any[]>
      importPlugin: () => Promise<{ success: boolean; error?: string }>
      importDevPlugin: () => Promise<{ success: boolean; error?: string }>
      fetchPluginMarket: () => Promise<{ success: boolean; data?: any; error?: string }>
      installPluginFromMarket: (plugin: any) => Promise<{ success: boolean; error?: string }>
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
      hidePlugin: () => void
      onContextMenuCommand: (callback: (command: string) => void) => void
      onFocusSearch: (callback: () => void) => void
      onBackToSearch: (callback: () => void) => void
      onPluginOpened: (
        callback: (plugin: { name: string; logo: string; path: string }) => void
      ) => void
      onPluginClosed: (callback: () => void) => void
      onPluginsChanged: (callback: () => void) => void
      onAppsChanged: (callback: (data: { type: 'add' | 'remove'; path: string }) => void) => void
      onShowPluginPlaceholder: (callback: () => void) => void
      onShowSettings: (callback: () => void) => void
      onAppLaunched: (callback: () => void) => void
      onIpcLaunch: (
        callback: (options: {
          path: string
          type?: 'app' | 'plugin'
          featureCode?: string
          param?: any
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
      getLastCopiedText: (timeLimit: number) => Promise<string>
      // 子输入框相关
      notifySubInputChange: (text: string) => void
      onUpdateSubInputPlaceholder?: (
        callback: (data: { pluginPath: string; placeholder: string }) => void
      ) => void
    }
  }
}

export {}
