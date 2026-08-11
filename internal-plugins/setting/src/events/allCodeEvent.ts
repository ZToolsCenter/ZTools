import { addZtoolsCodeEventListener } from '@/events/codeEvent'
import { useMarketLayout } from '@/composables'
import { jumpFunctionPluginInstaller } from '@/views/PluginInstaller/PluginInstaller'
import { jumpFunctionPluginMarketSetting } from '@/views/PluginMarketSetting/PluginMarketSetting'
import { jumpLocalLaunchSettingJumpFunction } from '@/views/LocalLaunchSetting/LocalLaunchSetting'

/**
 * 将文件和文件夹添加到本地启动
 */
addZtoolsCodeEventListener('function.local-launch-add', (e) => {
  const { payload, code } = e.pluginEnterParams
  console.info(`[code-event] ${code} 成功接收事件`)
  const files = Array.isArray(payload) ? payload : []
  const pendingFiles = files
    .map((file: { path?: string }) => file.path?.trim())
    .filter((path): path is string => Boolean(path))
  jumpLocalLaunchSettingJumpFunction({
    pendingFiles
  })
})

/**
 * 插件市场搜索
 */
addZtoolsCodeEventListener('function.plugin-market-search', async (e) => {
  const { payload, code, type } = e.pluginEnterParams
  console.info(`[code-event] ${code} 成功接收事件`, payload)
  if (payload) {
    jumpFunctionPluginMarketSetting({ payload, type })
  }
})

/**
 * 插件市场（独立一级入口，全屏浏览模式，隐藏设置侧栏）
 * 由主进程 showPluginMarket 触发：home=市场首页，detail=指定插件详情。
 */
addZtoolsCodeEventListener('function.plugin-market', (e) => {
  const { payload, code, type } = e.pluginEnterParams
  console.info(`[code-event] ${code} 成功接收事件`, payload)
  const { setMarketFullscreen } = useMarketLayout()
  setMarketFullscreen(true)
  jumpFunctionPluginMarketSetting({ payload, type })
})

/**
 * 安装插件
 */
addZtoolsCodeEventListener('function.install-plugin', (e) => {
  const { payload, code } = e.pluginEnterParams
  console.info(`[code-event] ${code} 成功接收事件`)
  const files = Array.isArray(payload) ? payload : []
  const installFilePaths = files
    .map((file: { path?: string }) => file.path?.trim())
    .filter((path): path is string => Boolean(path))

  if (files && files.length > 0) {
    console.log({ installFilePath: installFilePaths[0] })
    jumpFunctionPluginInstaller({ installFilePath: installFilePaths[0] })
  }
})

/**
 * 固定文件/文件夹到搜索框
 */
addZtoolsCodeEventListener('function.pin-to-search', async (e) => {
  const { payload, code } = e.pluginEnterParams
  console.info(`[code-event] ${code} 成功接收事件`)
  const files = Array.isArray(payload) ? payload : []

  for (const file of files) {
    if (!file.path) continue

    const isDirectory = file.isDirectory || false
    const fileName = file.name || file.path.split(/[\\/]/).pop() || file.path

    // 构造 Command 对象
    const command = {
      name: fileName,
      path: file.path,
      type: 'file', // 使用特殊类型标识文件/文件夹
      subType: isDirectory ? 'folder' : 'file',
      // 文件夹图标：蓝色文件夹
      // 文件图标：灰色文档图标（统一的通用文件图标）
      icon: isDirectory
        ? 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTMgNkMzIDQuODk1NDMgMy44OTU0MyA0IDUgNEg5TDExIDZIMTlDMjAuMTA0NiA2IDIxIDYuODk1NDMgMjEgOFYxOEMyMSAxOS4xMDQ2IDIwLjEwNDYgMjAgMTkgMjBINUMzLjg5NTQzIDIwIDMgMTkuMTA0NiAzIDE4VjZaIiBmaWxsPSIjNEFBREVDIi8+Cjwvc3ZnPgo='
        : 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE0IDJINkM0Ljg5NTQzIDIgNCAyLjg5NTQzIDQgNFYyMEM0IDIxLjEwNDYgNC44OTU0MyAyMiA2IDIySDE4QzE5LjEwNDYgMjIgMjAgMjEuMTA0NiAyMCAyMFY4TDE0IDJaIiBmaWxsPSIjNzg5MEE0Ii8+CjxwYXRoIGQ9Ik0xNCAyVjhIMjAiIGZpbGw9IiM1NDY5N0UiLz4KPC9zdmc+Cg==',
      cmdType: 'text'
    }

    // 调用固定 API（内置插件使用 internal 命名空间）
    await window.ztools.internal.pinApp(command)
  }

  // 固定完成后，显示提示并退出插件
  if (files.length > 0) {
    await window.ztools.showNotification(
      `已固定 ${files.length} 个${files.length === 1 ? (files[0].isDirectory ? '文件夹' : '文件') : '项'}`
    )
    // 退出插件（内置插件通过 outPlugin 退出）
    await window.ztools.outPlugin()
  }
})

/**
 * 退出 ZTools 应用
 */
addZtoolsCodeEventListener('function.exit', () => {
  void window.ztools.internal.quitApp()
})
