/**
 * ZTools 插件 API 类型定义
 * 插件开发者可以引用此文件获得完整的类型提示
 */

declare global {
  interface Window {
    ztools: {
      // ===== 平台检测 =====
      isMacOs: () => boolean
      isMacOS: () => boolean
      isWindows: () => boolean
      isLinux: () => boolean
      isDarkColors: () => boolean

      // ===== 插件生命周期 =====
      onPluginEnter: (callback: (launchParam: any) => void) => Promise<void>
      onPluginReady: (callback: (launchParam: any) => void) => Promise<void>

      // ===== UI 相关 =====
      showNotification: (body: string) => Promise<void>
      setExpendHeight: (height: number) => Promise<void>
      setSubInput: (
        onChange?: (details: { text: string }) => void,
        placeholder?: string
      ) => Promise<void>

      // ===== 窗口操作 =====
      hideMainWindow: (isRestorePreWindow?: boolean) => Promise<void>
      outPlugin: (isKill?: boolean) => Promise<void>

      // ===== 浏览器窗口 =====
      createBrowserWindow: (
        url: string,
        options?: any,
        callback?: () => void
      ) => Promise<BrowserWindow | null>

      // ===== 数据库 API (PouchDB 兼容) =====
      db: {
        put: (doc: any) => any
        get: (id: string) => any
        remove: (docOrId: any) => any
        bulkDocs: (docs: any[]) => any[]
        allDocs: (key?: string | string[]) => any[]
        postAttachment: (id: string, attachment: any, type: string) => any
        getAttachment: (id: string) => any
        getAttachmentType: (id: string) => string | null

        promises: {
          put: (doc: any) => Promise<any>
          get: (id: string) => Promise<any>
          remove: (docOrId: any) => Promise<any>
          bulkDocs: (docs: any[]) => Promise<any[]>
          allDocs: (key?: string | string[]) => Promise<any[]>
          postAttachment: (id: string, attachment: any, type: string) => Promise<any>
          getAttachment: (id: string) => Promise<any>
          getAttachmentType: (id: string) => Promise<string | null>
        }
      }

      // ===== dbStorage API (类似 localStorage) =====
      dbStorage: {
        setItem: (key: string, value: any) => void
        getItem: (key: string) => any
        removeItem: (key: string) => void
      }

      // ===== 动态 Feature API =====
      /**
       * 获取动态添加的 features
       * @param codes 可选，指定要获取的 feature codes
       * @returns 动态 feature 列表
       */
      getFeatures: (codes?: string[]) => DynamicFeature[]

      /**
       * 设置动态 feature（如果已存在则更新）
       * @param feature 要添加或更新的 feature
       * @returns 操作结果
       */
      setFeature: (feature: DynamicFeature) => { success: boolean; error?: string }

      /**
       * 删除指定的动态 feature
       * @param code 要删除的 feature code
       * @returns 是否成功删除
       */
      removeFeature: (code: string) => boolean

      // ===== 剪贴板 API =====
      clipboard: {
        getHistory: (page?: number, pageSize?: number, filter?: any) => Promise<any>
        search: (keyword: string) => Promise<any>
        delete: (id: string) => Promise<void>
        clear: (type?: string) => Promise<void>
        getStatus: () => Promise<any>
        write: (id: string) => Promise<void>
        updateConfig: (config: any) => Promise<void>
        onChange: (callback: (item: any) => void) => Promise<void>
      }

      // ===== 剪贴板操作 =====
      copyText: (text: string) => void
      copyImage: (image: any) => void
      copyFile: (filePath: string) => void

      // ===== 系统对话框 =====
      getPath: (name: string) => string
      showSaveDialog: (options: any) => any
      showOpenDialog: (options: any) => any

      // ===== 屏幕截图 =====
      screenCapture: (callback?: (image: any) => void) => Promise<any>

      // ===== 显示器信息 =====
      getPrimaryDisplay: () => Display
      getAllDisplays: () => Display[]
      getCursorScreenPoint: () => { x: number; y: number }
      getDisplayNearestPoint: (point: { x: number; y: number }) => Display
      desktopCaptureSources: (options: any) => Promise<any[]>
      dipToScreenPoint: (point: { x: number; y: number }) => { x: number; y: number }
      screenToDipPoint: (point: { x: number; y: number }) => { x: number; y: number }

      // ===== 其他工具 =====
      sendInputEvent: (event: {
        type: 'keyDown' | 'keyUp' | 'char' | 'mouseDown' | 'mouseUp' | 'mouseMove'
        keyCode?: string
        x?: number
        y?: number
        button?: 'left' | 'right' | 'middle'
        clickCount?: number
      }) => Promise<void>
      sendToParent: (channel: string, ...args: any[]) => void
      isDev: () => boolean
      getWebContentsId: () => number
      shellOpenExternal: (url: string) => void
    }

    /**
     * 插件导出的 features
     * 插件应该定义此对象来暴露功能
     */
    exports?: {
      [featureCode: string]: {
        mode: 'list' | 'doc' | 'img' | 'none'
        args?: {
          enter?: (action: any) => any
          search?: (action: any, searchWord: string, callbackSetList: (list: any[]) => void) => void
          select?: (action: any, itemData: any, callbackSetList: (list: any[]) => void) => void
          placeholder?: string
        }
      }
    }
  }
}

/**
 * 动态 Feature 定义
 */
export interface DynamicFeature {
  /** Feature 唯一标识 */
  code: string
  /** Feature 说明文字（可选） */
  explain?: string
  /** Feature 图标（可选） */
  icon?: string
  /** 支持的平台（可选），例如: 'darwin', ['darwin', 'win32'] */
  platform?: string | string[]
  /** 触发命令列表 */
  cmds: Array<
    | string
    | {
        type: string
        match: string
        label: string
        minLength?: number
      }
  >
}

/**
 * BrowserWindow 代理对象类型
 */
export interface BrowserWindow {
  [key: string]: any
}

/**
 * 显示器信息
 */
export interface Display {
  /** 显示器的唯一标识符 */
  id: number
  /** 显示器的旋转角度，可以是 0, 90, 180, 270 */
  rotation: number
  /** 显示器的缩放因子 */
  scaleFactor: number
  /** 触摸支持，可以是 available, unavailable, unknown */
  touchSupport: 'available' | 'unavailable' | 'unknown'
  /** 是否为单色显示器 */
  monochrome: boolean
  /** 显示器的颜色深度（每个颜色分量的位数） */
  colorDepth: number
  /** 颜色空间 */
  colorSpace: string
  /** 显示器的边界 */
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  /** 显示器的工作区边界（不包括任务栏等） */
  workArea: {
    x: number
    y: number
    width: number
    height: number
  }
  /** 显示器的尺寸 */
  size: {
    width: number
    height: number
  }
  /** 显示器的工作区尺寸 */
  workAreaSize: {
    width: number
    height: number
  }
  /** 是否为内置显示器 */
  internal: boolean
}

export {}
