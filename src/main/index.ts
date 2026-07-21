import { app, dialog, shell } from 'electron'
import {
  checkRuntimeCompatibility,
  EXPECTED_ELECTRON_VERSION,
  FULL_INSTALL_RELEASE_URL
} from './runtimeCompatibility'

if (process.platform === 'win32') app.setAppUserModelId('top.z-tools')

const gotTheLock = app.requestSingleInstanceLock()
const runtimeCompatibility = checkRuntimeCompatibility({
  platform: process.platform,
  isPackaged: app.isPackaged,
  runtimeElectronVersion: process.versions.electron
})

async function showBlockingRuntimePrompt(): Promise<void> {
  try {
    await app.whenReady()
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '需要更新 ZTools',
      message: '当前版本需要升级后才能继续使用',
      detail:
        'ZTools 的基础组件已经升级，当前版本无法直接完成更新。请安装最新完整版本，您的数据、设置和插件都会保留。',
      buttons: ['下载最新版本', '退出应用'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })

    if (result.response === 0) await shell.openExternal(FULL_INSTALL_RELEASE_URL)
  } catch (error) {
    console.error('[Bootstrap] 显示 Electron 兼容性提示失败:', error)
  } finally {
    app.exit(0)
  }
}

if (!gotTheLock) {
  app.exit(0)
} else if (runtimeCompatibility.blocked) {
  console.error(
    `[Bootstrap] 阻止启动: ${runtimeCompatibility.reason}; target=${EXPECTED_ELECTRON_VERSION}`
  )
  void showBlockingRuntimePrompt()
} else {
  void import('./appMain').catch((error) => {
    console.error('[Bootstrap] 加载主程序失败:', error)
    app.exit(1)
  })
}
