import { app, dialog, shell } from 'electron'
import './core/appData/configureAppDataRoot'
import { writeBootstrapLog } from './core/bootstrapLog'
import {
  checkRuntimeCompatibility,
  EXPECTED_ELECTRON_VERSION,
  FULL_INSTALL_RELEASE_URL
} from './runtimeCompatibility'

if (process.platform === 'win32') app.setAppUserModelId('top.z-tools')

writeBootstrapLog(
  `start pid=${process.pid} packaged=${String(app.isPackaged)} cwd=${process.cwd()} exec=${process.execPath} argv=${JSON.stringify(process.argv)}`
)

const gotTheLock = app.requestSingleInstanceLock()
writeBootstrapLog(`single-instance lock=${String(gotTheLock)}`)
const runtimeCompatibility = checkRuntimeCompatibility({
  platform: process.platform,
  isPackaged: app.isPackaged,
  runtimeElectronVersion: process.versions.electron
})
writeBootstrapLog(
  `runtime blocked=${String(runtimeCompatibility.blocked)} reason=${runtimeCompatibility.reason || ''}`
)

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
  writeBootstrapLog('exit: second-instance')
  app.exit(0)
} else if (runtimeCompatibility.blocked) {
  writeBootstrapLog(`exit: runtime-blocked ${runtimeCompatibility.reason || ''}`)
  console.error(
    `[Bootstrap] 阻止启动: ${runtimeCompatibility.reason}; target=${EXPECTED_ELECTRON_VERSION}`
  )
  void showBlockingRuntimePrompt()
} else {
  void import('./appMain').catch((error) => {
    writeBootstrapLog(
      `exit: appMain-import-failed ${error instanceof Error ? error.stack || error.message : String(error)}`
    )
    console.error('[Bootstrap] 加载主程序失败:', error)
    app.exit(1)
  })
}
