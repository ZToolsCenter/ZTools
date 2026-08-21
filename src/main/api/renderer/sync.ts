import { BrowserWindow, ipcMain, shell } from 'electron'
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import WebSocket from 'ws'
import { SyncClient, SYNC_PREFIXES } from '../../core/sync/syncClient'
import { SyncConfig } from '../../core/sync/types'
import lmdbInstance, { storageManager } from '../../core/lmdb/lmdbInstance'
import pluginDeviceAPI from '../plugin/device'
import { defaultAccountImportService } from '../../core/storage/defaultAccountImportService'
import activityHeartbeatService from '../../core/activity/heartbeatService'
import { cacheUserProfile } from '../../core/account/userProfileStore'
import {
  clearOfficialAccountSession,
  loadOfficialAccountSession,
  onOfficialAccountInvalidated,
  refreshOfficialAccountTokens,
  saveOfficialAccountSession
} from '../../core/account/officialAccountService'
import { onSyncCredentialsInvalidated } from '../../core/sync/syncAuthTokenService'
import {
  clearPrivateSyncSession,
  loadPrivateSyncSession,
  loadSyncProfile,
  migrateLegacySyncConfig,
  resolveSyncRuntimeConfig,
  savePrivateSyncSession,
  saveSyncProfile,
  type SyncProfile
} from '../../core/sync/syncProfileService'
import { OFFICIAL_SYNC_SERVER_URL } from '../../../shared/syncServerUrl'
import type { PluginManager } from '../../managers/pluginManager'

/**
 * 同步 API（WebSocket 版）
 */
export class SyncAPI {
  private syncClient: SyncClient | null = null
  private pluginManager: PluginManager | null = null
  private lastSyncTimeSave: Promise<void> = Promise.resolve()
  private lastPersistedSyncTime = 0
  private statusNotifyTimer: ReturnType<typeof setTimeout> | null = null
  private stopCredentialsInvalidatedListener: (() => void) | null = null
  private stopOfficialAccountInvalidatedListener: (() => void) | null = null
  private storageReload: Promise<void> = Promise.resolve()

  /**
   * 初始化同步客户端、IPC 和账号凭据状态监听。
   * @param mainWindow 主窗口实例；当前同步通知直接发送到设置插件。
   * @param pluginManager 插件管理器，用于向设置插件发送状态更新。
   * @returns 无返回值。
   */
  public init(mainWindow?: BrowserWindow, pluginManager?: PluginManager): void {
    void mainWindow
    this.pluginManager = pluginManager || null
    this.recreateSyncClient()
    this.setupIPC()
    this.registerStorageSwitchListener()
    this.registerLocalChangeListener()
    this.registerCredentialsInvalidatedListener()

    // 自动启动同步
    this.autoStart().catch((error) => {
      console.error('[Sync API] 自动启动失败:', error)
    })
  }

  /**
   * 监听统一刷新服务确认的登录失效，并停止同步及通知设置界面清理旧登录态。
   * @returns 无返回值。
   */
  private registerCredentialsInvalidatedListener(): void {
    this.stopCredentialsInvalidatedListener?.()
    this.stopCredentialsInvalidatedListener = onSyncCredentialsInvalidated(() => {
      this.syncClient?.stop()
      this.sendToSettingPlugin('sync:status-changed', {
        state: 'error',
        lastError: '登录状态已失效，请重新登录',
        credentialsInvalidated: true,
        refresh: true
      })
    })
    this.stopOfficialAccountInvalidatedListener?.()
    this.stopOfficialAccountInvalidatedListener = onOfficialAccountInvalidated(() => {
      this.sendToSettingPlugin('sync:status-changed', {
        accountCredentialsInvalidated: true,
        refresh: true
      })
    })
  }

  private async autoStart(): Promise<void> {
    // 先完成旧混合配置拆分，再解析当前数据空间的同步运行配置。
    await migrateLegacySyncConfig()
    await this.restartForCurrentDataSpace()
  }

  private recreateSyncClient(): void {
    this.syncClient?.stop()
    this.syncClient = new SyncClient(storageManager.getAccountDb())
    this.bindSyncClientEvents(this.syncClient)
  }

  private bindSyncClientEvents(client: SyncClient): void {
    client.on('state', (state: string) => {
      this.sendStatusPatch({ state })
      if (state === 'live') {
        this.markSyncCompleted()
      }
      this.scheduleStatusChanged()
    })
    client.on('pull', (docs: any[]) => {
      void docs
      this.scheduleStatusChanged()
    })
    client.on('sync-error', (msg: string) => {
      this.sendStatusPatch({ lastError: msg })
      this.scheduleStatusChanged()
    })
    client.on('retry-status', (status: any) => {
      this.sendStatusPatch({ retryStatus: status })
      this.scheduleStatusChanged()
    })
  }

  /**
   * 监听官方账号导致的数据空间切换，并为新数据空间重建同步客户端。
   * @returns 无返回值。
   */
  private registerStorageSwitchListener(): void {
    storageManager.on('account-switched', () => {
      this.sendToSettingPlugin('sync:account-storage-changed', {
        username: storageManager.getCurrentAccountUid()
      })
      this.storageReload = this.storageReload
        .then(() => this.restartForCurrentDataSpace())
        .catch((error) => {
          console.error('[Sync API] 数据空间切换后重启同步失败:', error)
        })
    })
  }

  /**
   * 停止旧数据空间同步，并使用当前数据空间配置重新创建客户端。
   * @returns 同步客户端重建和可选启动完成后的 Promise。
   */
  private async restartForCurrentDataSpace(): Promise<void> {
    this.recreateSyncClient()
    const config = await this.loadConfig()
    if (config?.enabled) this.syncClient!.start(config)
    this.scheduleStatusChanged()
  }

  private registerLocalChangeListener(): void {
    lmdbInstance.on('change', () => {
      this.scheduleStatusChanged()
    })
    lmdbInstance.on('attachment-added', () => {
      this.scheduleStatusChanged()
    })
  }

  private async loadConfig(): Promise<SyncConfig | null> {
    try {
      return await resolveSyncRuntimeConfig()
    } catch {
      return null
    }
  }

  private markSyncCompleted(): void {
    const time = Date.now()
    if (time - this.lastPersistedSyncTime < 1000) return
    this.lastPersistedSyncTime = time
    this.lastSyncTimeSave = this.lastSyncTimeSave
      .then(() => this.persistLastSyncTime(time))
      .catch((error) => {
        console.error('[Sync API] 保存最后同步时间失败:', error)
      })
  }

  private async persistLastSyncTime(time: number): Promise<void> {
    await saveSyncProfile({ lastSyncTime: time })
    this.sendStatusPatch({ lastSyncTime: time })
    this.scheduleStatusChanged()
  }

  private sendStatusPatch(payload: Record<string, unknown>): void {
    this.sendToSettingPlugin('sync:status-changed', {
      ...payload,
      refresh: false
    })
  }

  private sendToSettingPlugin(channel: string, ...args: unknown[]): void {
    const contents = this.pluginManager?.getPluginWebContentsByName('setting')
    if (contents && !contents.isDestroyed()) {
      contents.send(channel, ...args)
    }
  }

  private scheduleStatusChanged(): void {
    if (this.statusNotifyTimer) {
      clearTimeout(this.statusNotifyTimer)
    }
    this.statusNotifyTimer = setTimeout(() => {
      this.statusNotifyTimer = null
      this.sendToSettingPlugin('sync:status-changed', { refresh: true })
    }, 250)
  }

  /**
   * 按当前同步目标的 checkpoint 统计待确认文档数量。
   * @returns 待同步唯一文档数量。
   */
  private async getUnsyncedCount(): Promise<number> {
    const config = await this.loadConfig()
    return this.syncClient?.getPendingDocumentCount(config) || 0
  }

  private async getConflictCount(): Promise<number> {
    let count = 0
    for (const prefix of SYNC_PREFIXES) {
      const docs = await lmdbInstance.promises.allDocs(prefix)
      for (const doc of docs) {
        const meta = await lmdbInstance.promises.getSyncMeta(doc._id)
        if (meta?._hasConflicts) {
          count++
        }
      }
    }
    return count
  }

  private async getSyncStatus(): Promise<Record<string, unknown>> {
    const profile = await loadSyncProfile()
    const config = await resolveSyncRuntimeConfig(profile)
    const officialAccount = await loadOfficialAccountSession()
    const privateSession = await loadPrivateSyncSession()
    const unsyncedCount = this.syncClient?.getPendingDocumentCount(config) || 0
    const conflictCount = await this.getConflictCount()
    return {
      config,
      profile,
      state: this.syncClient?.getState() || 'disconnected',
      loggedIn: Boolean(config?.token),
      username: config?.username || '',
      lastSyncTime: config?.lastSyncTime || 0,
      unsyncedCount,
      conflictCount,
      retryStatus: this.syncClient?.getRetryStatus() || null,
      officialAccount: {
        loggedIn: Boolean(officialAccount?.token),
        username: officialAccount?.username || ''
      },
      privateSession: {
        loggedIn: Boolean(privateSession?.token),
        serverUrl: privateSession?.serverUrl || '',
        username: privateSession?.username || ''
      }
    }
  }

  /**
   * 注销私服会话，并在私服是当前目标时先关闭同步配置和客户端。
   * @returns 注销操作结果；失败时包含可展示的错误信息。
   */
  private async logoutPrivateSession(): Promise<{ success: boolean; error?: string }> {
    try {
      const profile = await loadSyncProfile()

      // 注销活动私服前先持久化关闭状态，避免应用重启后尝试使用已清理的凭据。
      if (profile.provider === 'private') {
        await saveSyncProfile({
          provider: 'private',
          enabled: false,
          serverUrl: profile.serverUrl,
          syncInterval: profile.syncInterval
        })
        this.syncClient?.stop()
      }

      // 只清除令牌，保留服务器地址和用户名供下次登录预填。
      await clearPrivateSyncSession()
      this.scheduleStatusChanged()
      activityHeartbeatService.runNow()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * 注册同步、认证和官方账号管理使用的主进程 IPC 处理器。
   * @returns 无返回值。
   */
  private setupIPC(): void {
    // 测试 WebSocket 连接
    ipcMain.handle('sync:test-connection', async (_event, config: SyncConfig) => {
      try {
        return new Promise((resolve) => {
          const ws = new WebSocket(config.serverUrl)
          const timer = setTimeout(() => {
            ws.close()
            resolve({ success: false, error: '连接超时' })
          }, 5000)

          ws.on('open', () => {
            clearTimeout(timer)
            ws.close()
            resolve({ success: true })
          })
          ws.on('error', (err: any) => {
            clearTimeout(timer)
            resolve({ success: false, error: err.message })
          })
        })
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:get-captcha-config', async (_event, params: { serverUrl: string }) => {
      try {
        const response = await fetch(
          `${this.syncServerUrlToHttp(params.serverUrl)}/api/auth/captcha-config`
        )
        const data = await response.json()
        if (!response.ok) {
          return { success: false, error: data.error || '验证码配置加载失败' }
        }
        return { success: true, config: data }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('account:get-session', async () => {
      try {
        const session = await loadOfficialAccountSession()
        return { success: true, session }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle(
      'account:login',
      async (
        _event,
        params: { username: string; password: string; captchaVerifyParam?: string }
      ) => {
        try {
          const login = await this.authenticate({
            serverUrl: OFFICIAL_SYNC_SERVER_URL,
            ...params
          })
          if (!login.success || !login.token) return login

          // 官方账号是本地数据空间唯一身份来源，登录后切换到对应账号数据库。
          await saveOfficialAccountSession({
            username: params.username,
            token: login.token,
            refreshToken: login.refreshToken
          })
          storageManager.switchAccount(params.username)
          activityHeartbeatService.runNow()
          return login
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )

    ipcMain.handle(
      'account:save-session',
      async (_event, params: { username: string; token: string; refreshToken?: string }) => {
        try {
          await saveOfficialAccountSession(params)
          storageManager.switchAccount(params.username)
          activityHeartbeatService.runNow()
          return { success: true }
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )

    ipcMain.handle('account:logout', async () => {
      try {
        await clearOfficialAccountSession()
        storageManager.switchAccount(null)
        activityHeartbeatService.runNow()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle(
      'account:change-password',
      async (
        _event,
        params: { currentPassword: string; newPassword: string }
      ): Promise<{ success: boolean; error?: string }> => {
        try {
          let config = await this.loadOfficialConfig()
          if (!config?.serverUrl || !config.token) return { success: false, error: '未登录' }
          if (!params.currentPassword || !params.newPassword) {
            return { success: false, error: '请输入当前密码和新密码' }
          }

          if (process.env.ZTOOLS_E2E !== '1') {
            // 先提交密码修改请求，服务端会在事务中校验旧密码并撤销全部会话。
            const send = (activeConfig: SyncConfig): Promise<Response> =>
              fetch(`${this.syncServerUrlToHttp(activeConfig.serverUrl)}/api/account/password`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${activeConfig.token}`
                },
                body: JSON.stringify(params)
              })
            let response = await send(config)
            if (response.status === 401 && config.refreshToken) {
              // 仅在刷新结果仍属于原账号时重试，避免账号切换期间误操作。
              const refreshed = await this.refreshOfficialToken(config)
              if (refreshed) {
                config = refreshed
                response = await send(config)
              }
            }
            const data = await response.json()
            if (!response.ok) return { success: false, error: data.error || '修改密码失败' }
          }

          // 密码变更会使当前 token 失效，退出同步但保留本地账户 LMDB 数据。
          this.syncClient?.stop()
          await clearOfficialAccountSession()
          storageManager.switchAccount(null)
          activityHeartbeatService.runNow()
          return { success: true }
        } catch (error: any) {
          return { success: false, error: error.message || '修改密码失败' }
        }
      }
    )

    ipcMain.handle('account:delete', async () => {
      try {
        let config = await this.loadOfficialConfig()
        if (!config?.serverUrl || !config.token) {
          return { success: false, error: '未登录' }
        }
        const accountUid = config.username?.trim()
        if (!accountUid || storageManager.getCurrentAccountUid() !== accountUid) {
          return { success: false, error: '当前账号与本地数据空间不一致' }
        }

        // E2E 只验证隔离实例中的界面与本地退出流程，不访问真实官方账号。
        if (process.env.ZTOOLS_E2E !== '1') {
          /**
           * 使用当前官方账号凭据请求删除服务端账号。
           * @param activeConfig 本次请求使用的官方账号配置。
           * @returns 服务端删除账号响应。
           */
          const send = (activeConfig: SyncConfig): Promise<Response> =>
            fetch(`${this.syncServerUrlToHttp(activeConfig.serverUrl)}/api/account`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${activeConfig.token}` }
            })

          let response = await send(config)
          if (response.status === 401 && config.refreshToken) {
            const refreshed = await this.refreshOfficialToken(config)
            if (refreshed) {
              config = refreshed
              response = await send(config)
            }
          }
          const data = await response.json()
          if (!response.ok) {
            return { success: false, error: data.error || '删除账号失败' }
          }
        }

        // 服务端删除成功后停止当前同步，再清理登录态和该账号的本地数据空间。
        this.syncClient?.stop()
        await clearOfficialAccountSession()
        storageManager.deleteCurrentAccount(accountUid)
        activityHeartbeatService.runNow()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 登录/注册（自动：不存在则创建，存在则验证密码）
    ipcMain.handle(
      'sync:login',
      async (
        _event,
        params: {
          serverUrl: string
          username: string
          password: string
          captchaVerifyParam?: string
        }
      ) => {
        try {
          return await this.authenticate(params)
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )

    ipcMain.handle(
      'sync:login-private',
      async (_event, params: { serverUrl: string; username: string; password: string }) => {
        try {
          const login = await this.authenticate(params)
          if (!login.success || !login.token) return login
          // 私服用户名只用于远端认证，绝不调用 storageManager.switchAccount。
          await savePrivateSyncSession({
            serverUrl: params.serverUrl,
            username: params.username,
            token: login.token,
            refreshToken: login.refreshToken || ''
          })
          return login
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )

    ipcMain.handle('sync:logout-private', () => this.logoutPrivateSession())

    // 保存同步配置
    ipcMain.handle('sync:save-config', async (_event, config: Partial<SyncProfile>) => {
      try {
        const profile = await saveSyncProfile({
          ...config,
          deviceId: config.deviceId || pluginDeviceAPI.getDeviceIdPublic()
        })
        const nextConfig = await resolveSyncRuntimeConfig(profile)

        // 同步配置只重启当前数据空间客户端，不再根据远端用户名切换本地数据库。
        this.syncClient?.stop()
        if (nextConfig.enabled) {
          this.syncClient!.start(nextConfig)
        }

        this.scheduleStatusChanged()
        activityHeartbeatService.runNow()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 获取同步配置
    ipcMain.handle('sync:get-config', async () => {
      try {
        const profile = await loadSyncProfile()
        return { success: true, config: profile }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 获取同步状态
    ipcMain.handle('sync:get-state', async () => {
      return { state: this.syncClient?.getState() || 'disconnected' }
    })

    ipcMain.handle('sync:get-status', async () => {
      try {
        return { success: true, status: await this.getSyncStatus() }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:get-default-import-status', async () => {
      try {
        return { success: true, status: defaultAccountImportService.getStatus() }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:import-default-data', async () => {
      try {
        const config = await this.loadConfig()
        this.syncClient?.stop()
        const result = defaultAccountImportService.importToCurrentAccount(
          storageManager.getCurrentAccountUid()
        )
        this.recreateSyncClient()
        if (config?.enabled) {
          this.syncClient!.start(config)
        }
        this.scheduleStatusChanged()
        return { success: true, result }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:skip-default-import', async () => {
      try {
        defaultAccountImportService.skip(storageManager.getCurrentAccountUid())
        this.scheduleStatusChanged()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:get-account-stats', async () => {
      try {
        let config = await this.loadOfficialConfig()
        if (!config?.serverUrl || !config.token) {
          return { success: false, error: '未登录' }
        }
        // E2E 使用隔离凭据，不访问或刷新真实官方账号。
        if (process.env.ZTOOLS_E2E === '1') {
          return {
            success: true,
            stats: {
              documentCount: 0,
              attachmentCount: 0,
              storageBytes: 0,
              monthlyTraffic: 0
            }
          }
        }
        let response = await fetch(
          `${this.syncServerUrlToHttp(config.serverUrl)}/api/console/client/stats`,
          {
            headers: { Authorization: `Bearer ${config.token}` }
          }
        )
        if (response.status === 401 && config.refreshToken) {
          const refreshed = await this.refreshOfficialToken(config)
          if (refreshed) {
            config = refreshed
            response = await fetch(
              `${this.syncServerUrlToHttp(config.serverUrl)}/api/console/client/stats`,
              {
                headers: { Authorization: `Bearer ${config.token}` }
              }
            )
          }
        }
        const data = await response.json()
        if (!response.ok) {
          return { success: false, error: data.error || '获取云空间统计失败' }
        }
        return { success: true, stats: data }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:get-account-profile', async () => {
      try {
        let config = await this.loadOfficialConfig()
        if (!config?.serverUrl || !config.token) {
          return { success: false, error: '未登录' }
        }
        // 隔离 E2E 使用本地模拟资料，禁止读取线上账号。
        if (process.env.ZTOOLS_E2E === '1') {
          return {
            success: true,
            profile: { uid: config.username || '', nickname: '', avatarUrl: '' }
          }
        }
        let response = await fetch(
          `${this.syncServerUrlToHttp(config.serverUrl)}/api/account/profile`,
          {
            headers: { Authorization: `Bearer ${config.token}` }
          }
        )
        if (response.status === 401 && config.refreshToken) {
          const refreshed = await this.refreshOfficialToken(config)
          if (refreshed) {
            config = refreshed
            response = await fetch(
              `${this.syncServerUrlToHttp(config.serverUrl)}/api/account/profile`,
              {
                headers: { Authorization: `Bearer ${config.token}` }
              }
            )
          }
        }
        const data = await response.json()
        if (!response.ok) {
          return { success: false, error: data.error || '获取账号资料失败' }
        }
        // 主进程先更新同步快照，确保插件随后调用 getUser 时可立即读取最新资料。
        cacheUserProfile(data, config.username || '')
        return { success: true, profile: data }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:upload-account-avatar', async (_event, avatarPath: string) => {
      try {
        let config = await this.loadOfficialConfig()
        if (!config?.serverUrl || !config.token) {
          return { success: false, error: '未登录' }
        }
        const send = async (activeConfig: SyncConfig): Promise<Response> => {
          const filePath = avatarPath.startsWith('file://') ? fileURLToPath(avatarPath) : avatarPath
          const data = await readFile(filePath)
          const form = new FormData()
          form.append('file', new Blob([new Uint8Array(data)]), path.basename(filePath))
          return fetch(`${this.syncServerUrlToHttp(activeConfig.serverUrl)}/api/account/avatar`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${activeConfig.token}` },
            body: form
          })
        }
        let response = await send(config)
        if (response.status === 401 && config.refreshToken) {
          const refreshed = await this.refreshOfficialToken(config)
          if (refreshed) {
            config = refreshed
            response = await send(config)
          }
        }
        const data = await response.json()
        if (!response.ok) {
          return { success: false, error: data.error || '头像上传失败' }
        }
        // 上传成功后同步头像快照，避免插件继续读取旧头像。
        cacheUserProfile(data, config.username || '')
        return { success: true, profile: data }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:get-retry-status', async () => {
      return { success: true, status: this.syncClient?.getRetryStatus() || null }
    })

    ipcMain.handle('sync:retry-now', async () => {
      try {
        this.syncClient?.retryNow()
        this.scheduleStatusChanged()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 立即触发同步（强制重连，无冷却期）
    ipcMain.handle('sync:perform-sync', async () => {
      try {
        const config = await this.loadConfig()
        if (!config?.enabled) {
          return { success: false, error: '同步未启用' }
        }
        this.syncClient!.performSync()
        this.scheduleStatusChanged()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 停止同步
    ipcMain.handle('sync:stop-auto-sync', async () => {
      try {
        this.syncClient!.stop()
        this.scheduleStatusChanged()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 获取未同步文档数量
    ipcMain.handle('sync:get-unsynced-count', async () => {
      try {
        return { success: true, count: await this.getUnsyncedCount() }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 重置当前目标的本地同步进度，不删除文档、附件或其他服务器 checkpoint。
    ipcMain.handle('sync:reset-local-sync-state', async () => {
      try {
        const config = await this.loadConfig()
        const result = this.syncClient!.resetLocalSyncState(config)
        this.scheduleStatusChanged()
        return { success: true, ...result }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 获取冲突文档数量
    ipcMain.handle('sync:get-conflict-count', async () => {
      try {
        return { success: true, count: await this.getConflictCount() }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 列出存在冲突的文档
    ipcMain.handle('sync:list-conflicts', async () => {
      try {
        const syncPrefixes = SYNC_PREFIXES
        const items: Array<{
          docId: string
          winningRev?: string
          conflictCount: number
          deleted: boolean
          lastModified?: number
        }> = []

        for (const prefix of syncPrefixes) {
          const docs = await lmdbInstance.promises.allDocs(prefix)
          for (const doc of docs) {
            const meta = await lmdbInstance.promises.getSyncMeta(doc._id)
            if (!meta?._hasConflicts) continue
            items.push({
              docId: doc._id,
              winningRev: meta._winningRev || meta._rev,
              conflictCount: meta._conflictCount || 0,
              deleted: !!meta._deleted,
              lastModified: meta._lastModified
            })
          }
        }

        items.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
        return { success: true, items }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 获取冲突详情（winner + loser leaf）
    ipcMain.handle('sync:get-conflict-detail', async (_event, docId: string) => {
      try {
        const winner = lmdbInstance.get(docId)
        const meta = lmdbInstance.getSyncMeta(docId)
        const conflicts = lmdbInstance.getConflicts(docId)
        return {
          success: true,
          detail: {
            docId,
            winningRev: meta?._winningRev || meta?._rev,
            deleted: !!meta?._deleted,
            winner,
            conflicts
          }
        }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 解决冲突：选择某个 leaf 作为新的当前结果
    ipcMain.handle(
      'sync:resolve-conflict',
      async (_event, params: { docId: string; sourceRev: string }) => {
        try {
          const result = lmdbInstance.resolveConflict(params.docId, params.sourceRev)
          if (!result.ok) {
            return { success: false, error: result.message || '解决冲突失败' }
          }
          this.scheduleStatusChanged()
          return { success: true, rev: result.rev }
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )

    // 强制全量推送本地数据到云端
    ipcMain.handle('sync:force-push-all', async () => {
      try {
        this.syncClient!.forcePushAll()
        this.scheduleStatusChanged()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // ==================== GitHub OAuth 登录（轮询方式）====================

    // GitHub 登录：初始化会话
    ipcMain.handle('sync:github-init-session', async (_event, params: { serverUrl: string }) => {
      try {
        const httpUrl = this.syncServerUrlToHttp(params.serverUrl)
        const response = await fetch(`${httpUrl}/api/auth/github/init-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })

        const data = await response.json()
        if (!response.ok || !data.success) {
          return { success: false, error: data.error || '初始化会话失败' }
        }

        return { success: true, sessionId: data.sessionId, expiresIn: data.expiresIn }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // GitHub 登录：打开浏览器
    ipcMain.handle(
      'sync:github-open-browser',
      async (_event, params: { serverUrl: string; sessionId: string }) => {
        try {
          const httpUrl = this.syncServerUrlToHttp(params.serverUrl)

          await shell.openExternal(`${httpUrl}/api/auth/github/start?session=${params.sessionId}`)

          return { success: true }
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )

    // GitHub 登录：轮询状态
    ipcMain.handle(
      'sync:github-poll-status',
      async (_event, params: { serverUrl: string; sessionId: string }) => {
        try {
          const httpUrl = this.syncServerUrlToHttp(params.serverUrl)
          const response = await fetch(`${httpUrl}/api/auth/session/${params.sessionId}/status`)

          const data = await response.json()
          return data
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )

    // 更新用户昵称
    ipcMain.handle(
      'sync:update-nickname',
      async (
        _event,
        params: { nickname: string }
      ): Promise<{ success: boolean; error?: string; profile?: any }> => {
        try {
          let config = await this.loadOfficialConfig()
          if (!config?.token) return { success: false, error: '未登录' }
          const send = (activeConfig: SyncConfig): Promise<Response> =>
            fetch(`${this.syncServerUrlToHttp(activeConfig.serverUrl)}/api/account/nickname`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${activeConfig.token}`
              },
              body: JSON.stringify({ nickname: params.nickname })
            })
          let response = await send(config)
          if (response.status === 401 && config.refreshToken) {
            const refreshed = await this.refreshOfficialToken(config)
            if (refreshed) {
              config = refreshed
              response = await send(config)
            }
          }
          const data = await response.json()
          if (!response.ok) {
            return { success: false, error: data.error || '更新昵称失败' }
          }
          // 服务端返回最终资料后同步本地快照，避免昵称展示不一致。
          cacheUserProfile(data)
          return { success: true, profile: data }
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )
  }

  /**
   * 调用指定同步服务的账号密码认证接口。
   * @param params 服务地址、用户名、密码和可选验证码参数。
   * @returns 登录 token 或认证错误。
   */
  private async authenticate(params: {
    serverUrl: string
    username: string
    password: string
    captchaVerifyParam?: string
  }): Promise<{
    success: boolean
    token?: string
    refreshToken?: string
    isNew?: boolean
    error?: string
  }> {
    const response = await fetch(`${this.syncServerUrlToHttp(params.serverUrl)}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: params.username,
        password: params.password,
        captchaVerifyParam: params.captchaVerifyParam
      })
    })
    const data = await response.json()
    if (!response.ok) return { success: false, error: data.error || '认证失败' }
    return {
      success: true,
      token: data.token,
      refreshToken: data.refreshToken,
      isNew: data.isNew
    }
  }

  /**
   * 将 WebSocket 服务地址转换为 HTTP API 地址。
   * @param serverUrl WebSocket 服务地址。
   * @returns 对应的 HTTP 或 HTTPS 地址。
   */
  private syncServerUrlToHttp(serverUrl: string): string {
    return serverUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')
  }

  /**
   * 刷新官方账号凭据，并拒绝复用刷新期间切换到的其他账号。
   * @param config 发起请求时使用的官方账号配置。
   * @returns 同一账号的最新完整配置；刷新失败、凭据失效或账号切换时返回 null。
   */
  private async refreshOfficialToken(config: SyncConfig): Promise<SyncConfig | null> {
    if (!config.refreshToken) return null
    const result = await refreshOfficialAccountTokens(config.refreshToken)
    if (result.status !== 'refreshed' && result.status !== 'reused') return null
    if (
      !result.session.token ||
      result.session.serverUrl !== config.serverUrl ||
      result.session.username !== (config.username || '')
    ) {
      return null
    }
    return { ...config, ...result.session }
  }

  /**
   * 将设备级官方账号会话转换为官方接口调用配置。
   * @returns 官方账号配置；未登录时返回 null。
   */
  private async loadOfficialConfig(): Promise<SyncConfig | null> {
    const session = await loadOfficialAccountSession()
    if (!session) return null
    return {
      enabled: false,
      serverUrl: OFFICIAL_SYNC_SERVER_URL,
      token: session.token,
      refreshToken: session.refreshToken,
      syncInterval: 30,
      lastSyncTime: 0,
      deviceId: pluginDeviceAPI.getDeviceIdPublic(),
      username: session.username
    }
  }
}

export default new SyncAPI()
