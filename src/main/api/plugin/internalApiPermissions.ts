import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import databaseAPI from '../shared/database'
import {
  CUSTOM_INTERNAL_API_DISABLED_KEY,
  CUSTOM_INTERNAL_API_PERMISSIONS_KEY,
  CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY,
  INTERNAL_API_PLUGIN_NAMES,
  INTERNAL_API_REQUESTS_KEY,
  getRegisteredInternalApiChannels,
  isTrustedInternalApiPlugin,
  normalizeCustomInternalApiPluginNames,
  normalizeInternalApiChannelList,
  normalizeInternalApiDisabledPluginList,
  normalizeInternalApiPermissionsMap,
  normalizeInternalApiPluginKey,
  normalizeInternalApiRequestsMap,
  registerInternalApiChannel,
  type InternalApiRequestEntry
} from '../../core/internalPlugins'
import { PermissionDeniedError, requireInternalPlugin } from './internal'
import internalApiRequestDialog from './internalApiRequestDialog'

/** 权限数据变化时向主窗口广播的通道名（设置页据此实时刷新） */
const PERMISSIONS_CHANGED_CHANNEL = 'internal-api-permissions-changed'

/**
 * 插件高级 API 权限管理模块。
 * 一侧面向所有插件：提交授权申请、查询自身授权状态；
 * 另一侧面向设置插件：审批申请、维护按通道授权名单。
 * 新申请写入后会立即触发授权弹窗供用户当场处理。
 */
class PluginInternalApiPermissionsAPI {
  private pluginManager: PluginManager | null = null
  private mainWindow: BrowserWindow | null = null

  /**
   * 初始化模块并注册 IPC 通道。
   * @param mainWindow 主窗口实例，用于权限变化时通知界面刷新
   * @param pluginManager 插件管理器实例，用于识别调用插件身份
   * @returns 无返回值
   */
  public init(mainWindow: BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    // 授权弹窗的动作回调复用本模块的审批逻辑，保证弹窗与设置页行为一致。
    internalApiRequestDialog.init({
      isPending: (pluginName) => Boolean(this.readRequests()[pluginName]),
      onApprove: (pluginName, apis) => this.applyApproval(pluginName, apis),
      onReject: (pluginName) => this.applyRejection(pluginName)
    })
    this.setupIPC()
  }

  /**
   * 校验设置页管理通道的调用方身份，未授权时抛出与 internal API 一致的权限错误。
   * @param event IPC 事件对象
   * @param apiName 通道名
   * @returns 无返回值
   * @throws 调用方未获授权时抛出 PermissionDeniedError
   */
  private assertManagementAccess(event: IpcMainInvokeEvent, apiName: string): void {
    if (!requireInternalPlugin(this.pluginManager, event, apiName)) {
      throw new PermissionDeniedError(apiName)
    }
  }

  /**
   * 注册插件侧申请 / 查询通道与设置页管理通道。
   * @returns 无返回值
   */
  private setupIPC(): void {
    // ==================== 插件侧：提交高级 API 授权申请 ====================
    ipcMain.handle(
      'plugin:request-internal-api-permissions',
      async (event, apis: unknown, reason?: unknown) => {
        try {
          // 申请入口面向所有插件开放，但必须是插件运行时调用。
          const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
          if (!pluginInfo) {
            return { success: false, error: '仅插件可提交高级 API 授权申请' }
          }

          // 仅接受主进程真实存在的通道名，过滤非法输入。
          const requestedApis = normalizeInternalApiChannelList(apis)
          if (requestedApis.length === 0) {
            return { success: false, error: '申请的 API 列表为空或均不存在' }
          }
          const reasonText =
            typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : undefined

          // 完全授权插件无需申请；已全部授权的 API 也直接返回 granted。
          // 停用插件的授权被整体挂起，按无授权处理，让其重新走申请流程。
          const isSuspended = this.readDisabledPluginNames().includes(pluginInfo.name)
          const granted = isSuspended ? [] : (this.readPermissions()[pluginInfo.name] ?? [])
          if (pluginInfo.canUseInternalApi) {
            return {
              success: true,
              status: 'granted' as const,
              pluginName: pluginInfo.name,
              grantedApis: requestedApis
            }
          }
          const missingApis = requestedApis.filter((api) => !granted.includes(api))
          if (missingApis.length === 0) {
            return {
              success: true,
              status: 'granted' as const,
              pluginName: pluginInfo.name,
              grantedApis: granted
            }
          }

          // 合并写入待审申请：同插件多次申请取通道并集并刷新时间。
          const requests = this.readRequests()
          const previous = requests[pluginInfo.name]
          requests[pluginInfo.name] = {
            apis: Array.from(new Set([...(previous?.apis ?? []), ...missingApis])).slice(0, 64),
            reason: reasonText ?? previous?.reason,
            requestedAt: Date.now()
          }
          this.writeRequests(requests)

          // 新申请落库后立即弹出授权弹窗，方便用户当场处理。
          internalApiRequestDialog.enqueue(pluginInfo.name, requests[pluginInfo.name])

          console.log('[InternalApiPermissions] 收到插件高级 API 申请:', {
            plugin: pluginInfo.name,
            apis: missingApis
          })
          return {
            success: true,
            status: 'pending' as const,
            pluginName: pluginInfo.name,
            requestedApis: missingApis
          }
        } catch (error: unknown) {
          console.error('[InternalApiPermissions] 处理授权申请失败:', error)
          return { success: false, error: error instanceof Error ? error.message : '未知错误' }
        }
      }
    )

    // ==================== 插件侧：查询自身授权状态 ====================
    ipcMain.handle('plugin:get-internal-api-permissions', async (event) => {
      try {
        // 主渲染进程不是插件，视为完全可信。
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          return { fullAccess: true, granted: [], pending: [] }
        }
        return {
          fullAccess: pluginInfo.canUseInternalApi,
          granted: this.readPermissions()[pluginInfo.name] ?? [],
          pending: this.readRequests()[pluginInfo.name]?.apis ?? []
        }
      } catch (error: unknown) {
        console.error('[InternalApiPermissions] 查询授权状态失败:', error)
        return { fullAccess: false, granted: [], pending: [] }
      }
    })

    // ==================== 设置页：读取申请与授权 ====================
    registerInternalApiChannel('internal:get-internal-api-grants')
    ipcMain.handle('internal:get-internal-api-grants', async (event) => {
      this.assertManagementAccess(event, 'internal:get-internal-api-grants')
      return {
        permissions: this.readPermissions(),
        requests: this.readRequests(),
        channels: getRegisteredInternalApiChannels(),
        // 手动录入的完全授权名单，展示在授权列表中并可逐通道调整。
        fullAccessPluginNames: this.readCustomFullAccessPluginNames(),
        // 硬编码可信插件（内置 + 开发者工具）始终完全授权，界面不展示、不可管理。
        trustedPluginNames: [...INTERNAL_API_PLUGIN_NAMES],
        // 停用名单原始值；可信插件不可停用，由主进程直接拒绝。
        disabledPluginNames: this.readDisabledPluginNames()
      }
    })

    // ==================== 设置页：维护插件完全授权（全部 API）状态 ====================
    registerInternalApiChannel('internal:set-plugin-internal-api-full-access')
    ipcMain.handle(
      'internal:set-plugin-internal-api-full-access',
      async (event, pluginName: unknown, fullAccess: unknown) => {
        try {
          this.assertManagementAccess(event, 'internal:set-plugin-internal-api-full-access')
          const name = normalizeInternalApiPluginKey(pluginName)
          if (!name) {
            return { success: false, error: '无效的插件名称' }
          }

          // 硬编码可信插件的完全授权不可通过本通道调整。
          if (isTrustedInternalApiPlugin(name)) {
            return { success: false, error: '受信插件始终拥有全部高级 API 权限' }
          }

          const names = this.readCustomFullAccessPluginNames()
          const permissions = this.readPermissions()
          if (fullAccess === true) {
            // 升级为完全授权后按通道明细不再参与判定，清掉避免列表展示混乱。
            this.writeCustomFullAccessPluginNames(Array.from(new Set([...names, name])))
            delete permissions[name]
            this.writePermissions(permissions)
          } else if (names.includes(name)) {
            // 降级仅移出完全授权名单；按通道明细由调用方随后写入。
            this.writeCustomFullAccessPluginNames(names.filter((item) => item !== name))
          }
          this.notifyPermissionsChanged()

          console.log('[InternalApiPermissions] 更新插件完全授权状态:', {
            plugin: name,
            fullAccess
          })
          return { success: true, fullAccessPluginNames: this.readCustomFullAccessPluginNames() }
        } catch (error: unknown) {
          console.error('[InternalApiPermissions] 更新完全授权状态失败:', error)
          return { success: false, error: error instanceof Error ? error.message : '未知错误' }
        }
      }
    )

    // ==================== 设置页：整体启停插件高级 API 授权 ====================
    registerInternalApiChannel('internal:set-plugin-internal-api-disabled')
    ipcMain.handle(
      'internal:set-plugin-internal-api-disabled',
      async (event, pluginName: unknown, disabled: unknown) => {
        try {
          this.assertManagementAccess(event, 'internal:set-plugin-internal-api-disabled')
          const name = normalizeInternalApiPluginKey(pluginName)
          if (!name) {
            return { success: false, error: '无效的插件名称' }
          }

          // 硬编码可信插件承载宿主核心功能，不允许停用其高级 API 授权。
          if (isTrustedInternalApiPlugin(name)) {
            return { success: false, error: '受信插件始终拥有高级 API 权限，不可停用' }
          }

          // 读改写停用名单：停用仅挂起授权配置，开启后原授权完整恢复。
          const disabledNames = this.readDisabledPluginNames()
          const nextDisabled =
            disabled === true
              ? Array.from(new Set([...disabledNames, name]))
              : disabledNames.filter((item) => item !== name)
          this.writeDisabledPluginNames(nextDisabled)
          this.notifyPermissionsChanged()

          console.log('[InternalApiPermissions] 更新插件授权启停状态:', { plugin: name, disabled })
          return { success: true, disabledPluginNames: nextDisabled }
        } catch (error: unknown) {
          console.error('[InternalApiPermissions] 更新授权启停状态失败:', error)
          return { success: false, error: error instanceof Error ? error.message : '未知错误' }
        }
      }
    )

    // ==================== 设置页：维护插件按通道授权 ====================
    registerInternalApiChannel('internal:set-plugin-internal-api-grants')
    ipcMain.handle(
      'internal:set-plugin-internal-api-grants',
      async (event, pluginName: unknown, apis: unknown) => {
        try {
          this.assertManagementAccess(event, 'internal:set-plugin-internal-api-grants')
          const name = normalizeInternalApiPluginKey(pluginName)
          if (!name) {
            return { success: false, error: '无效的插件名称' }
          }

          // 授权列表仅接受已注册通道；清空等价于移除该插件的全部授权。
          const nextApis = normalizeInternalApiChannelList(apis)
          const permissions = this.readPermissions()
          if (nextApis.length === 0) delete permissions[name]
          else permissions[name] = nextApis
          this.writePermissions(permissions)
          this.notifyPermissionsChanged()

          console.log('[InternalApiPermissions] 更新插件高级 API 授权:', { plugin: name, nextApis })
          return { success: true, permissions }
        } catch (error: unknown) {
          console.error('[InternalApiPermissions] 更新授权失败:', error)
          return { success: false, error: error instanceof Error ? error.message : '未知错误' }
        }
      }
    )

    // ==================== 设置页：审批 / 驳回申请 ====================
    registerInternalApiChannel('internal:resolve-internal-api-request')
    ipcMain.handle(
      'internal:resolve-internal-api-request',
      async (event, pluginName: unknown, grantedApis: unknown) => {
        try {
          this.assertManagementAccess(event, 'internal:resolve-internal-api-request')
          const name = normalizeInternalApiPluginKey(pluginName)
          if (!name) {
            return { success: false, error: '无效的插件名称' }
          }

          if (!this.readRequests()[name]) {
            return { success: false, error: '未找到该插件的授权申请' }
          }

          // 空列表等价驳回；非空列表按勾选项部分批准。
          const approvedApis = normalizeInternalApiChannelList(grantedApis)
          if (approvedApis.length > 0) {
            this.applyApproval(name, approvedApis)
          } else {
            this.applyRejection(name)
          }

          console.log('[InternalApiPermissions] 处理插件授权申请:', { plugin: name, approvedApis })
          return {
            success: true,
            permissions: this.readPermissions(),
            requests: this.readRequests()
          }
        } catch (error: unknown) {
          console.error('[InternalApiPermissions] 处理申请失败:', error)
          return { success: false, error: error instanceof Error ? error.message : '未知错误' }
        }
      }
    )
  }

  /**
   * 批准插件申请：将指定通道并入授权名单并移除待审条目。
   * 批准视为用户明确的授权意图，同时解除该插件的整体停用，保证「授权后立即生效」。
   * @param pluginName 插件名
   * @param approvedApis 本次批准的通道列表
   * @returns 无返回值
   */
  private applyApproval(pluginName: string, approvedApis: string[]): void {
    // 读改写：保留既有授权并合并本次批准项（列表长度上限由读取侧归一化兜底）。
    const permissions = this.readPermissions()
    permissions[pluginName] = Array.from(
      new Set([...(permissions[pluginName] ?? []), ...approvedApis])
    )

    const requests = this.readRequests()
    delete requests[pluginName]

    // 解除整体停用，避免“已批准但权限仍被挂起”的困惑状态。
    if (this.readDisabledPluginNames().includes(pluginName)) {
      this.writeDisabledPluginNames(
        this.readDisabledPluginNames().filter((item) => item !== pluginName)
      )
    }

    this.writePermissions(permissions)
    this.writeRequests(requests)
    this.notifyPermissionsChanged()
  }

  /**
   * 驳回插件申请：仅移除待审条目，不改动既有授权。
   * @param pluginName 插件名
   * @returns 无返回值
   */
  private applyRejection(pluginName: string): void {
    const requests = this.readRequests()
    delete requests[pluginName]
    this.writeRequests(requests)
    this.notifyPermissionsChanged()
  }

  /**
   * 读取手动录入的完全授权插件名单（不含硬编码可信名单）。
   * @returns 手动完全授权插件名数组
   */
  private readCustomFullAccessPluginNames(): string[] {
    const settings = databaseAPI.dbGet('settings-general') || {}
    return normalizeCustomInternalApiPluginNames(settings[CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY])
  }

  /**
   * 以读改写方式更新 settings-general 中的手动完全授权名单字段。
   * @param names 要写入的完全授权名单
   * @returns 无返回值
   */
  private writeCustomFullAccessPluginNames(names: string[]): void {
    const settings = databaseAPI.dbGet('settings-general') || {}
    settings[CUSTOM_INTERNAL_API_PLUGIN_NAMES_KEY] = names
    databaseAPI.dbPut('settings-general', settings)
  }

  /**
   * 读取被整体停用高级 API 授权的插件名列表。
   * @returns 归一化后的停用名单
   */
  private readDisabledPluginNames(): string[] {
    const settings = databaseAPI.dbGet('settings-general') || {}
    return normalizeInternalApiDisabledPluginList(settings[CUSTOM_INTERNAL_API_DISABLED_KEY])
  }

  /**
   * 以读改写方式更新 settings-general 中的停用名单字段。
   * @param disabledNames 要写入的停用名单
   * @returns 无返回值
   */
  private writeDisabledPluginNames(disabledNames: string[]): void {
    const settings = databaseAPI.dbGet('settings-general') || {}
    settings[CUSTOM_INTERNAL_API_DISABLED_KEY] = disabledNames
    databaseAPI.dbPut('settings-general', settings)
  }

  /**
   * 读取「插件名 -> 已授权通道列表」映射。
   * @returns 归一化后的授权映射
   */
  private readPermissions(): Record<string, string[]> {
    const settings = databaseAPI.dbGet('settings-general') || {}
    return normalizeInternalApiPermissionsMap(settings[CUSTOM_INTERNAL_API_PERMISSIONS_KEY])
  }

  /**
   * 读取「插件名 -> 申请条目」映射。
   * @returns 归一化后的待审申请映射
   */
  private readRequests(): Record<string, InternalApiRequestEntry> {
    const settings = databaseAPI.dbGet('settings-general') || {}
    return normalizeInternalApiRequestsMap(settings[INTERNAL_API_REQUESTS_KEY])
  }

  /**
   * 以读改写方式更新 settings-general 中的授权映射字段。
   * @param permissions 要写入的授权映射
   * @returns 无返回值
   */
  private writePermissions(permissions: Record<string, string[]>): void {
    const settings = databaseAPI.dbGet('settings-general') || {}
    settings[CUSTOM_INTERNAL_API_PERMISSIONS_KEY] = permissions
    databaseAPI.dbPut('settings-general', settings)
  }

  /**
   * 以读改写方式更新 settings-general 中的待审申请字段。
   * @param requests 要写入的申请映射
   * @returns 无返回值
   */
  private writeRequests(requests: Record<string, InternalApiRequestEntry>): void {
    const settings = databaseAPI.dbGet('settings-general') || {}
    settings[INTERNAL_API_REQUESTS_KEY] = requests
    databaseAPI.dbPut('settings-general', settings)
  }

  /**
   * 通知权限数据已变化：设置页监听方位于插件 preload（非宿主主窗口），
   * 需同时广播到主窗口与所有插件 WebContents，
   * 并同步授权弹窗：当前展示的申请若已被处理则关闭并展示下一条。
   * @returns 无返回值
   */
  private notifyPermissionsChanged(): void {
    this.mainWindow?.webContents.send(PERMISSIONS_CHANGED_CHANNEL)
    this.pluginManager?.broadcastToPluginWebContents(PERMISSIONS_CHANGED_CHANNEL)
    internalApiRequestDialog.sync()
  }
}

export default new PluginInternalApiPermissionsAPI()
