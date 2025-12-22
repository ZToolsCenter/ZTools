/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

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
        getRunningPlugins: () => Promise<string[]>
        importPlugin: () => Promise<{ success: boolean; error?: string }>
        importDevPlugin: () => Promise<{ success: boolean; error?: string }>
        deletePlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
        killPlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
        reloadPlugin: (pluginPath: string) => Promise<{ success: boolean; error?: string }>
        revealInFinder: (filePath: string) => Promise<void>
        launch: (options: {
          path: string
          type?: 'direct' | 'plugin'
          featureCode?: string
          param?: any
          name?: string
        }) => Promise<{ success: boolean; error?: string }>

        // 插件市场
        fetchPluginMarket: () => Promise<{ success: boolean; data?: any; error?: string }>
        installPluginFromMarket: (plugin: any) => Promise<{
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
        onHotkeyRecorded: (callback: (shortcut: string) => void) => void

        // 窗口和设置
        setWindowOpacity: (opacity: number) => Promise<void>
        updatePlaceholder: (placeholder: string) => Promise<void>
        selectAvatar: () => Promise<{ success: boolean; path?: string; error?: string }>
        updateAvatar: (avatar: string) => Promise<void>
        updateAutoPaste: (autoPaste: string) => Promise<void>
        updateAutoClear: (autoClear: string) => Promise<void>
        setTheme: (theme: string) => Promise<void>
        updatePrimaryColor: (primaryColor: string, customColor?: string) => Promise<void>
        setTrayIconVisible: (visible: boolean) => Promise<void>
        setLaunchAtLogin: (enable: boolean) => Promise<void>
        getLaunchAtLogin: () => Promise<boolean>

        // 系统信息
        getAppVersion: () => Promise<string>
        getAppName: () => Promise<string>
        getSystemVersions: () => Promise<NodeJS.ProcessVersions>
        getPlatform: () => NodeJS.Platform

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

        // 指令管理
        getCommands: () => Promise<{
          commands: any[]
          regexCommands: any[]
        }>

        // 图片分析
        analyzeImage: (imagePath: string) => Promise<{
          isSimpleIcon: boolean
          mainColor: string | null
          isDark: boolean
          needsAdaptation: boolean
        }>
      }
    }
  }
}

export {}
