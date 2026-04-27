/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// 类型定义文件：定义 ZTools 设置插件可用的 API

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
}

declare global {
  interface Window {
    services: Services
    ztools: {
      // 获取拖放文件的路径（Electron webUtils）
      getPathForFile: (file: File) => string

      internal: {
        // 数据库操作（主程序专用，直接操作 ZTOOLS 命名空间）
        dbPut: (key: string, data: any) => Promise<any>
        dbGet: (key: string) => Promise<any>

        // 插件管理
        getPlugins: () => Promise<
          Array<{
            name: string
            path: string
            version: string
            description?: string
            logo?: string
            features?: any[]
            isDevelopment?: boolean
          }>
        >
        getDisabledPlugins: () => Promise<string[]>
        setPluginDisabled: (
          pluginPath: string,
          disabled: boolean
        ) => Promise<{ success: boolean; error?: string }>
        getAllPlugins: () => Promise<
          Array<{
            name: string
            path: string
            version: string
            description?: string
            logo?: string
            features?: any[]
            isDevelopment?: boolean
          }>
        >
        getRunningPlugins: () => Promise<string[]>
        selectPluginFile: () => Promise<{ success: boolean; filePath?: string; error?: string }>
        importPlugin: () => Promise<{ success: boolean; error?: string }>
        readPluginInfoFromZpx: (zpxPath: string) => Promise<{
          success: boolean
          pluginInfo?: {
            name: string
            title: string
            version: string
            description: string
            author: string
            logo: string
            features: Array<{ code: string; explain?: string }>
            isInstalled: boolean
          }
          error?: string
        }>
        installPluginFromPath: (zpxPath: string) => Promise<{
          success: boolean
          error?: string
          plugin?: any
        }>
        // 获取当前记录的开发项目集合
        getDevProjects: () => Promise<any[]>
        // 导入开发中的插件工程，可选直接传入 plugin.json 路径
        importDevPlugin: (pluginJsonPath?: string) => Promise<{
          success: boolean
          error?: string
          pluginName?: string
          pluginPath?: string
        }>
        // 从开发项目列表中移除指定项目，但保留磁盘目录
        removeDevProject: (pluginName: string) => Promise<{ success: boolean; error?: string }>
        // 将开发项目安装为开发模式插件
        installDevPlugin: (pluginName: string) => Promise<{ success: boolean; error?: string }>
        // 将开发项目从开发模式卸载
        uninstallDevPlugin: (pluginName: string) => Promise<{ success: boolean; error?: string }>
        // 校验当前设备绑定的开发项目配置
        validateDevProject: (pluginName: string) => Promise<{ success: boolean; error?: string }>
        // 为当前设备重新选择开发项目配置文件
        selectDevProjectConfig: (
          pluginName: string
        ) => Promise<{ success: boolean; error?: string }>
        // 打包指定开发项目
        packageDevProject: (pluginName: string) => Promise<{ success: boolean; error?: string }>
        deletePlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
        killPlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
        revealInFinder: (filePath: string) => Promise<void>
        launch: (options: {
          path: string
          type?: 'direct' | 'plugin' | 'builtin'
          featureCode?: string
          param?: any
          name?: string
        }) => Promise<{ success: boolean; error?: string }>
        quitApp: () => Promise<{ success: boolean }>
        openApp: (appPath: string) => Promise<void>

        // 插件市场
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

        // 插件数据管理
        getPluginReadme: (pluginPath: string) => Promise<{
          success: boolean
          content?: string
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
        getPluginDataStats: () => Promise<{
          success: boolean
          data?: Array<{
            pluginName: string
            pluginTitle: string | null
            isDevelopment: boolean
            docCount: number
            attachmentCount: number
            logo: string | null
          }>
          error?: string
        }>
        clearPluginData: (pluginName: string) => Promise<{
          success: boolean
          deletedCount?: number
          error?: string
        }>
        exportAllPlugins: () => Promise<{
          success: boolean
          exportPath?: string
          count?: number
          error?: string
        }>
        getPluginMemoryInfo: (pluginPath: string) => Promise<{
          success: boolean
          data?: {
            private: number
            shared: number
            total: number
          } | null
          error?: string
        }>

        // 快捷键相关
        startHotkeyRecording: () => Promise<{ success: boolean; error?: string }>
        updateShortcut: (shortcut: string) => Promise<{ success: boolean; error?: string }>
        getCurrentShortcut: () => Promise<string>
        registerGlobalShortcut: (
          shortcut: string,
          target: string
        ) => Promise<{ success: boolean; error?: string }>
        unregisterGlobalShortcut: (shortcut: string) => Promise<{
          success: boolean
          error?: string
        }>
        registerAppShortcut: (
          shortcut: string,
          target: string
        ) => Promise<{ success: boolean; error?: string }>
        unregisterAppShortcut: (shortcut: string) => Promise<{
          success: boolean
          error?: string
        }>
        onHotkeyRecorded: (callback: (shortcut: string) => void) => void

        // 窗口和设置
        setWindowOpacity: (opacity: number) => Promise<void>
        setWindowDefaultHeight: (height: number) => Promise<void>
        setWindowMaterial: (material: 'mica' | 'acrylic' | 'none') => Promise<{ success: boolean }>
        getWindowMaterial: () => Promise<'mica' | 'acrylic' | 'none'>
        onUpdateWindowMaterial: (callback: (material: 'mica' | 'acrylic' | 'none') => void) => void
        updateAcrylicOpacity: (lightOpacity: number, darkOpacity: number) => Promise<void>
        updatePlaceholder: (placeholder: string) => Promise<void>
        selectAvatar: () => Promise<{ success: boolean; path?: string; error?: string }>
        updateAvatar: (avatar: string) => Promise<void>
        updateAutoPaste: (autoPaste: string) => Promise<void>
        updateAutoClear: (autoClear: string) => Promise<void>
        updateAutoBackToSearch: (autoBackToSearch: string) => Promise<void>
        updateShowRecentInSearch: (showRecentInSearch: boolean) => Promise<void>
        updateMatchRecommendation: (showMatchRecommendation: boolean) => Promise<void>
        updateLocalAppSearch: (enabled: boolean) => Promise<void>
        updateRecentRows: (rows: number) => Promise<void>
        updatePinnedRows: (rows: number) => Promise<void>
        updateClipboardConfig: (config: { retentionDays: number }) => Promise<void>
        updateSearchMode: (searchMode: 'aggregate' | 'list') => Promise<void>
        updateTabKeyFunction: (mode: 'navigate' | 'target-command') => Promise<void>
        updateTabTarget: (target: string) => Promise<void>
        updateSpaceOpenCommand: (enabled: boolean) => Promise<void>
        updateFloatingBallDoubleClickCommand: (command: string) => Promise<void>
        setTheme: (theme: string) => Promise<void>
        updatePrimaryColor: (primaryColor: string, customColor?: string) => Promise<void>
        setTrayIconVisible: (visible: boolean) => Promise<void>
        setFloatingBallEnabled: (enabled: boolean) => Promise<{ success: boolean }>
        setFloatingBallLetter: (letter: string) => Promise<{ success: boolean }>
        getFloatingBallLetter: () => Promise<string>
        setLaunchAtLogin: (enable: boolean) => Promise<void>
        getLaunchAtLogin: () => Promise<boolean>
        setProxyConfig: (config: { enabled: boolean; url: string }) => Promise<{
          success: boolean
          error?: string
        }>

        // 系统信息
        getAppVersion: () => Promise<string>
        getAppName: () => Promise<string>
        getSystemVersions: () => Promise<NodeJS.ProcessVersions>
        getPlatform: () => NodeJS.Platform
        isWindows11: () => Promise<boolean>

        // 软件更新
        updaterCheckUpdate: () => Promise<{
          hasUpdate: boolean
          latestVersion?: string
          updateInfo?: any
          error?: string
        }>
        updaterStartUpdate: (updateInfo: any) => Promise<{
          success: boolean
          error?: string
        }>
        updaterSetAutoCheck: (enabled: boolean) => Promise<{
          success: boolean
          error?: string
        }>

        // 指令管理
        // 返回设置页使用的原始指令快照，用于构建 alias 目标列表（commands 文本指令 + regexCommands 中可直接触发的 window 指令）
        getCommands: () => Promise<{
          commands: any[]
          regexCommands: any[]
          plugins: any[]
        }>
        // 保存 alias 映射。主进程会负责归一化、持久化，并触发主窗口的指令缓存刷新。
        updateCommandAliases: (
          aliases: Record<string, Array<{ alias: string; icon?: string }>>
        ) => Promise<{ success: boolean }>

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
          addByPath: (filePath: string) => Promise<{ success: boolean; error?: string }>
          delete: (id: string) => Promise<{ success: boolean; error?: string }>
          open: (path: string) => Promise<{ success: boolean; error?: string }>
          updateAlias: (id: string, alias: string) => Promise<{ success: boolean; error?: string }>
        }

        // 图片分析
        analyzeImage: (imagePath: string) => Promise<{
          isSimpleIcon: boolean
          mainColor: string | null
          isDark: boolean
          needsAdaptation: boolean
        }>

        // WebDAV 同步
        syncGetConfig: () => Promise<{
          success: boolean
          config?: {
            enabled: boolean
            serverUrl: string
            username: string
            password: string
            syncInterval: number
            lastSyncTime: number
            syncPlugins?: boolean
          }
          error?: string
        }>
        syncGetUnsyncedCount: () => Promise<{
          success: boolean
          count?: number
          error?: string
        }>
        syncStopAutoSync: () => Promise<{
          success: boolean
          error?: string
        }>
        syncTestConnection: (config: {
          serverUrl: string
          username: string
          password: string
        }) => Promise<{
          success: boolean
          error?: string
        }>
        syncSaveConfig: (config: {
          enabled: boolean
          serverUrl: string
          username: string
          password: string
          syncInterval: number
          syncPlugins?: boolean
        }) => Promise<{
          success: boolean
          error?: string
        }>
        syncPerformSync: () => Promise<{
          success: boolean
          result?: {
            uploaded: number
            downloaded: number
            errors: number
            pluginsUploaded?: number
            pluginsDownloaded?: number
            pluginsDeleted?: number
          }
          error?: string
        }>
        syncForceDownloadFromCloud: () => Promise<{
          success: boolean
          result?: {
            downloaded: number
            errors: number
          }
          error?: string
        }>

        // AI 模型管理
        aiModels: {
          getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
          add: (model: any) => Promise<{ success: boolean; error?: string }>
          update: (model: any) => Promise<{ success: boolean; error?: string }>
          delete: (id: string) => Promise<{ success: boolean; error?: string }>
        }

        // 网页快开
        webSearch: {
          getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
          add: (engine: any) => Promise<{ success: boolean; error?: string }>
          update: (engine: any) => Promise<{ success: boolean; error?: string }>
          delete: (id: string) => Promise<{ success: boolean; error?: string }>
          fetchFavicon: (
            url: string
          ) => Promise<{ success: boolean; data?: string; error?: string }>
        }

        // 超级面板
        updateSuperPanelConfig: (config: {
          enabled: boolean
          mouseButton: string
          longPressMs: number
        }) => Promise<{ success: boolean }>
        updateSuperPanelBlockedApps: (
          blockedApps: Array<{ app: string; bundleId?: string; label?: string }>
        ) => Promise<{ success: boolean }>
        getCurrentWindowInfo: () => Promise<{
          app: string
          bundleId?: string
          pid?: number
          title?: string
          appPath?: string
          className?: string
          hwnd?: number
        } | null>

        // 唤醒黑名单
        updateWakeupBlacklist: (
          blacklist: Array<{ app: string; bundleId?: string; label?: string }>
        ) => Promise<{ success: boolean }>

        // 超级面板翻译
        updateSuperPanelTranslate: (enabled: boolean) => Promise<{ success: boolean }>
        getTranslationStatus: () => Promise<{
          status: 'idle' | 'downloading' | 'initializing' | 'ready' | 'error'
          error?: string
        }>

        pinToSuperPanel: (command: any) => Promise<{ success: boolean; error?: string }>
        unpinSuperPanelCommand: (
          path: string,
          featureCode?: string
        ) => Promise<{ success: boolean; error?: string }>
        getSuperPanelPinned: () => Promise<any[]>

        // 通知主渲染进程禁用指令列表已更改
        notifyDisabledCommandsChanged: () => Promise<{ success: boolean }>

        // 固定/取消固定指令到搜索窗口
        pinApp: (app: any) => Promise<void>
        unpinApp: (appPath: string, featureCode?: string, name?: string) => Promise<void>

        // HTTP 服务
        httpServerGetConfig: () => Promise<{
          success: boolean
          config?: {
            enabled: boolean
            port: number
            apiKey: string
          }
          error?: string
        }>
        httpServerSaveConfig: (config: {
          enabled: boolean
          port: number
          apiKey: string
        }) => Promise<{
          success: boolean
          config?: {
            enabled: boolean
            port: number
            apiKey: string
          }
          error?: string
        }>
        httpServerRegenerateKey: () => Promise<{
          success: boolean
          apiKey?: string
          error?: string
        }>
        httpServerStatus: () => Promise<{
          success: boolean
          running?: boolean
          error?: string
        }>
        // MCP 服务配置与状态管理
        mcpServerGetConfig: () => Promise<{
          success: boolean
          config?: {
            enabled: boolean
            port: number
            apiKey: string
          }
          error?: string
        }>
        mcpServerSaveConfig: (config: {
          enabled: boolean
          port: number
          apiKey: string
        }) => Promise<{
          success: boolean
          config?: {
            enabled: boolean
            port: number
            apiKey: string
          }
          error?: string
        }>
        mcpServerRegenerateKey: () => Promise<{
          success: boolean
          apiKey?: string
          error?: string
        }>
        mcpServerStatus: () => Promise<{
          success: boolean
          running?: boolean
          error?: string
        }>
        // 当前已安装插件中声明的 MCP 工具列表
        mcpServerTools: () => Promise<{
          success: boolean
          data?: Array<{
            pluginName: string
            pluginPath: string
            pluginLogo?: string
            toolName: string
            mcpName: string
            description: string
            inputSchema: Record<string, unknown>
            outputSchema?: Record<string, unknown>
            enabled: boolean
          }>
          error?: string
        }>

        // 调试日志
        logEnable: () => Promise<{ success: boolean }>
        logDisable: () => Promise<{ success: boolean }>
        logGetBuffer: () => Promise<
          Array<{
            id: number
            timestamp: number
            level: string
            source: string
            message: string
          }>
        >
        logIsEnabled: () => Promise<boolean>
        logSubscribe: () => Promise<{ success: boolean }>
        onLogEntries: (
          callback: (
            entries: Array<{
              id: number
              timestamp: number
              level: string
              source: string
              message: string
            }>
          ) => void
        ) => void
        offLogEntries: (callback: (...args: any[]) => void) => void
      }
    }
  }
}

export {}
