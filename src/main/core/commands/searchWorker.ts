import { parentPort } from 'node:worker_threads'
import { buildCommandCatalog } from './catalog'
import { CommandSearchEngine } from './engine'

let engine: CommandSearchEngine | undefined
// 隔离第三方正则；主线程超时时可以真正终止本线程。
parentPort!.on('message', (message) => {
  try {
    let value: unknown
    if (message.type === 'catalog') {
      engine = new CommandSearchEngine(buildCommandCatalog(message.input))
      value = engine.catalog
    } else {
      if (!engine) throw new Error('搜索目录尚未初始化')
      value =
        message.type === 'validate'
          ? engine.validateCommand(message.ruleId, message.context)
          : engine.query(message.request, message.state)
    }
    parentPort!.postMessage({ id: message.id, value })
  } catch (error) {
    parentPort!.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})
