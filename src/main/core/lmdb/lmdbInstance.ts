import { app } from 'electron'
import path from 'path'
import LmdbDatabase from './index'

/**
 * 创建共享的 LMDB 数据库实例
 * 数据库文件存储在 userData/lmdb 目录下
 */
const lmdbInstance = new LmdbDatabase({
  path: path.join(app.getPath('userData'), 'lmdb'),
  mapSize: 2 * 1024 * 1024 * 1024, // 2GB
  maxDbs: 3 // main, meta, attachment
})

console.log('LMDB database created successfully')

// 导出单例实例
export default lmdbInstance

/**
 * 清理函数：应用退出时调用
 */
export function closeLmdb(): void {
  try {
    lmdbInstance.close()
    console.log('LMDB database closed successfully')
  } catch (e) {
    console.error('Error closing LMDB:', e)
  }
}

// 监听应用退出事件，自动关闭数据库
app.on('will-quit', () => {
  closeLmdb()
})
