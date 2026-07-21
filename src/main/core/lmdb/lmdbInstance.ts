import { app } from 'electron'
import { storageManager } from '../storage/storageManager'

/**
 * 3.0 共享数据库入口。
 *
 * 这里导出的是 StorageRouter：调用方继续使用 lmdbInstance，
 * 实际读写会按 key 路由到 device/account LMDB。
 */
const initState = storageManager.init()
const lmdbInstance = storageManager.getRouter()

console.log('[LMDB] ZTools 3.0 storage initialized', {
  firstRun: initState.firstRun,
  legacyLmdbFound: initState.legacyLmdbFound,
  device: initState.layout.deviceLmdbPath,
  defaultAccount: initState.layout.defaultAccountLmdbPath
})

// 导出单例实例
export default lmdbInstance
export { storageManager }

/**
 * 清理函数：应用退出时调用
 */
export function closeLmdb(): void {
  try {
    storageManager.close()
    console.log('[LMDB] ZTools storage closed successfully')
  } catch (e) {
    console.error('[LMDB] Error closing LMDB:', e)
  }
}

// 监听应用退出事件，自动关闭数据库
app.on('will-quit', () => {
  closeLmdb()
})
