import { app, ipcMain, type WebContents } from 'electron'
import createSearchWorker from './searchWorker?nodeWorker'
import { SearchWorkerClient } from './workerClient'
import { CommandService, type CommandServiceDependencies } from './service'
import lmdbInstance, { storageManager } from '../lmdb/lmdbInstance'

let service: CommandService | undefined
const hosts = new Map<number, WebContents>()

/**
 * 获取已初始化的主进程指令服务。
 * @returns 共享服务
 * @throws 初始化前访问时抛错
 */
export function getCommandService(): CommandService {
  if (!service) throw new Error('指令服务尚未初始化')
  return service
}

/**
 * 注册宿主窗口并在页面重载或销毁时清理会话。
 * @param contents 宿主 WebContents
 * @returns 无返回值
 */
export function registerCommandHost(contents: WebContents): void {
  hosts.set(contents.id, contents)
  const release = (): void => {
    service?.release(String(contents.id))
  }
  contents.on('did-start-loading', release)
  contents.once('destroyed', () => {
    release()
    hosts.delete(contents.id)
  })
}

/**
 * 校验仅由注册宿主访问指令业务 IPC。
 * @param contents IPC 来源
 * @returns 可信调用方身份
 * @throws 来源未授权时抛错
 */
function owner(contents: WebContents): string {
  if (!hosts.has(contents.id)) throw new Error('仅宿主窗口可调用指令服务')
  return String(contents.id)
}

/**
 * 连接搜索线程、存储变更和宿主 IPC。
 * @param dependencies 平台来源和运行时适配器
 * @param mainContents 主搜索窗口
 * @returns 已初始化服务
 */
export function initializeCommandService(
  dependencies: Omit<CommandServiceDependencies, 'worker' | 'stateChanged'>,
  mainContents: WebContents
): CommandService {
  const worker = new SearchWorkerClient(() => createSearchWorker({}))
  service = new CommandService({
    ...dependencies,
    worker,
    stateChanged: () => {
      for (const contents of hosts.values())
        if (!contents.isDestroyed()) contents.send('commands:state-changed')
    }
  })
  registerCommandHost(mainContents)
  ipcMain.handle('commands:query', (event, request) => {
    const identity = owner(event.sender)
    return service!.query(identity, request, (result) => {
      if (!event.sender.isDestroyed()) event.sender.send('commands:search-update', result)
    })
  })
  ipcMain.on('commands:cancel', (event, sessionId, requestId) =>
    service!.cancel(owner(event.sender), sessionId, requestId)
  )
  ipcMain.on('commands:release-search', (event, sessionId, requestId) =>
    service!.releaseSearch(owner(event.sender), sessionId, requestId)
  )
  ipcMain.handle('commands:execute', (event, request) =>
    service!.execute(owner(event.sender), request)
  )
  ipcMain.handle('commands:home', (event) => {
    owner(event.sender)
    return service!.getHome()
  })
  ipcMain.handle('commands:catalog', async (event) => {
    owner(event.sender)
    return (await service!.getCatalog()).canonical
  })
  ipcMain.handle('commands:recommendation', (event, operation) => {
    owner(event.sender)
    return service!.recommendation(operation)
  })
  const catalogKeys = new Set([
    'plugins',
    'dev-plugin-registry',
    'disabled-plugins',
    'disable-commands',
    'command-aliases',
    'local-shortcuts',
    'cached-commands',
    'enabled-main-push-plugin'
  ])
  const stateKeys = new Set([
    'command-history',
    'pinned-commands',
    'super-panel-pinned',
    'recommendation-pinned',
    'command-usage-stats',
    'search-preference',
    'last-match-state'
  ])
  // 目录只依赖本地应用开关；主题、窗口和其它常规设置不影响搜索索引。
  let localAppSearchEnabled = dependencies.read('settings-general')?.localAppSearch !== false
  /**
   * 按实际目录依赖或用户状态变化刷新搜索，忽略无关配置写入。
   * @param change 已提交的存储文档变更
   * @returns 无返回值
   */
  const changed = (change: { docId?: string }): void => {
    const id = change.docId || ''
    const key = id.replace(/^ZTOOLS\//, '')
    if (key === 'settings-general') {
      const enabled = dependencies.read(key)?.localAppSearch !== false
      if (enabled !== localAppSearchEnabled) {
        localAppSearchEnabled = enabled
        service!.invalidate()
      }
      return
    }
    if (catalogKeys.has(key) || (id.startsWith('PLUGIN/') && id.endsWith('/dynamic-features')))
      service!.invalidate()
    else if (stateKeys.has(key)) service!.invalidate(false)
  }
  // Router 仅转发 account 变化；设备文档不进入同步日志，单独订阅本机通知。
  storageManager.getDeviceDb().on('local-change', changed)
  lmdbInstance.on('change', changed)
  storageManager.on('account-switched', () => {
    // 账号切换重建来源，同时以新账号的有效配置作为后续变更比较基线。
    localAppSearchEnabled = dependencies.read('settings-general')?.localAppSearch !== false
    service!.invalidate()
  })
  app.once('before-quit', () => worker.dispose())
  return service
}
