import { app } from 'electron'
import path from 'path'
import LocalDb from './index'

// 创建共享的数据库实例
const dbInstance = new LocalDb(path.join(app.getPath('userData'), 'db'))
dbInstance.init()

export default dbInstance
