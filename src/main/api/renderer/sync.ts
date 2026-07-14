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
import { coordinateTokenRefresh } from '../../core/sync/tokenRefreshCoordinator'
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

  public init(mainWindow?: BrowserWindow, pluginManager?: PluginManager): void {
    void mainWindow
    this.pluginManager = pluginManager || null
    this.recreateSyncClient()
    this.setupIPC()
    this.registerStorageSwitchListener()
    this.registerLocalChangeListener()

    // 自动启动同步
    this.autoStart().catch((error) => {
      console.error('[Sync API] 自动启动失败:', error)
    })
  }

  private async autoStart(): Promise<void> {
    const config = await this.loadConfig()
    this.switchAccountForConfig(config)
    if (config?.enabled) {
      this.syncClient!.start(config)
    }
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

  private switchAccountForConfig(config?: Pick<SyncConfig, 'username'> | null): void {
    const nextUid = config?.username?.trim() || null
    if (nextUid === storageManager.getCurrentAccountUid()) return
    storageManager.switchAccount(nextUid)
    this.recreateSyncClient()
  }

  private registerStorageSwitchListener(): void {
    storageManager.on('account-switched', () => {
      this.sendToSettingPlugin('sync:account-storage-changed', {
        username: storageManager.getCurrentAccountUid()
      })
      this.scheduleStatusChanged()
    })
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
      const doc = await lmdbInstance.promises.get('SYNC/config')
      if (!doc?.data) return null

      return doc.data as SyncConfig
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
    const existingDoc = await lmdbInstance.promises.get('SYNC/config')
    if (!existingDoc?.data) return
    await lmdbInstance.promises.put({
      _id: 'SYNC/config',
      _rev: existingDoc._rev,
      data: {
        ...existingDoc.data,
        lastSyncTime: time
      }
    })
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

  private async getUnsyncedCount(): Promise<number> {
    let count = 0
    for (const prefix of SYNC_PREFIXES) {
      const docs = await lmdbInstance.promises.allDocs(prefix)
      for (const doc of docs) {
        const meta = await lmdbInstance.promises.getSyncMeta(doc._id)
        if (!meta || meta._cloudSynced !== true) {
          count++
        }
      }
    }
    return count
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
    const config = await this.loadConfig()
    const unsyncedCount = await this.getUnsyncedCount()
    const conflictCount = await this.getConflictCount()
    return {
      config,
      state: this.syncClient?.getState() || 'disconnected',
      loggedIn: Boolean(config?.token),
      username: config?.username || '',
      lastSyncTime: config?.lastSyncTime || 0,
      unsyncedCount,
      conflictCount,
      retryStatus: this.syncClient?.getRetryStatus() || null
    }
  }

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
          // 从 ws:// 转换为 http:// 用于 REST API
          const httpUrl = this.syncServerUrlToHttp(params.serverUrl)

          const response = await fetch(`${httpUrl}/api/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uid: params.username,
              password: params.password,
              captchaVerifyParam: params.captchaVerifyParam
            })
          })

          const data = await response.json()
          if (!response.ok) {
            return { success: false, error: data.error || '认证失败' }
          }

          return {
            success: true,
            token: data.token,
            refreshToken: data.refreshToken,
            isNew: data.isNew
          }
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )

    // 保存同步配置
    ipcMain.handle('sync:save-config', async (_event, config: SyncConfig) => {
      try {
        if (!config.deviceId) {
          config.deviceId = pluginDeviceAPI.getDeviceIdPublic()
        }

        const existingDoc = await lmdbInstance.promises.get('SYNC/config')
        const existingConfig = existingDoc?.data || {}
        const nextConfig = {
          ...existingConfig,
          ...config,
          lastSyncTime: config.lastSyncTime || existingConfig.lastSyncTime || 0
        }
        await lmdbInstance.promises.put({
          _id: 'SYNC/config',
          _rev: existingDoc?._rev,
          data: nextConfig
        })

        // 重新启动/停止同步
        this.syncClient?.stop()
        this.switchAccountForConfig(nextConfig)
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
        const config = await this.loadConfig()
        return { success: true, config }
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
        const result = defaultAccountImportService.importToCurrentAccount(config?.username)
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
        const config = await this.loadConfig()
        defaultAccountImportService.skip(config?.username)
        this.scheduleStatusChanged()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:get-account-stats', async () => {
      try {
        let config = await this.loadConfig()
        if (!config?.serverUrl || !config.token) {
          return { success: false, error: '未登录' }
        }
        let response = await fetch(
          `${this.syncServerUrlToHttp(config.serverUrl)}/api/console/client/stats`,
          {
            headers: { Authorization: `Bearer ${config.token}` }
          }
        )
        if (response.status === 401 && config.refreshToken) {
          const refreshed = await this.refreshToken(config)
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
        let config = await this.loadConfig()
        if (!config?.serverUrl || !config.token) {
          return { success: false, error: '未登录' }
        }
        let response = await fetch(
          `${this.syncServerUrlToHttp(config.serverUrl)}/api/account/profile`,
          {
            headers: { Authorization: `Bearer ${config.token}` }
          }
        )
        if (response.status === 401 && config.refreshToken) {
          const refreshed = await this.refreshToken(config)
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
        return { success: true, profile: data }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync:upload-account-avatar', async (_event, avatarPath: string) => {
      try {
        let config = await this.loadConfig()
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
          const refreshed = await this.refreshToken(config)
          if (refreshed) {
            config = refreshed
            response = await send(config)
          }
        }
        const data = await response.json()
        if (!response.ok) {
          return { success: false, error: data.error || '头像上传失败' }
        }
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

    // 将本地同步状态重置为未同步：不删除文档，只清同步进度和本地云端标记
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
        params: { serverUrl: string; token: string; nickname: string }
      ): Promise<{ success: boolean; error?: string; profile?: any }> => {
        try {
          const response = await fetch(
            `${this.syncServerUrlToHttp(params.serverUrl)}/api/account/nickname`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${params.token}`
              },
              body: JSON.stringify({ nickname: params.nickname })
            }
          )
          const data = await response.json()
          if (!response.ok) {
            return { success: false, error: data.error || '更新昵称失败' }
          }
          return { success: true, profile: data }
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    )
  }

  private syncServerUrlToHttp(serverUrl: string): string {
    return serverUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')
  }

  private async refreshToken(config: SyncConfig): Promise<SyncConfig | null> {
    if (!config.refreshToken) return null
    const tokens = await coordinateTokenRefresh(config.refreshToken, async () => {
      const response = await fetch(
        `${this.syncServerUrlToHttp(config.serverUrl)}/api/auth/refresh`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: config.refreshToken })
        }
      )
      const data = await response.json()
      if (!response.ok || !data?.token || !data?.refreshToken) return null
      return { token: data.token, refreshToken: data.refreshToken }
    })
    if (!tokens) return null
    const nextConfig = { ...config, token: tokens.token, refreshToken: tokens.refreshToken }
    const existingDoc = await lmdbInstance.promises.get('SYNC/config')
    await lmdbInstance.promises.put({
      _id: 'SYNC/config',
      _rev: existingDoc?._rev,
      data: nextConfig
    })
    return nextConfig
  }
}

export default new SyncAPI()
