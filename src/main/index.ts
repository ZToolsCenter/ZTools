import { spawn } from 'child_process'
import { app, dialog, shell } from 'electron'
import './core/appData/configureAppDataRoot'
import {
  checkRuntimeCompatibility,
  EXPECTED_ELECTRON_VERSION,
  FULL_INSTALL_RELEASE_URL
} from './runtimeCompatibility'

if (process.platform === 'win32') app.setAppUserModelId('top.z-tools')

// Linux/Wayland：改用 XWayland 后端。
// 原生 Wayland 下 setPosition / getCursorScreenPoint / alwaysOnTop 均为空操作，
// 且 globalShortcut 无法注册，启动器的定位与全局唤起键都会失效。
// 注意：appendSwitch 与 ELECTRON_OZONE_PLATFORM_HINT 实测只对渲染层生效，
// globalShortcut 仍走 Wayland 分支，因此必须把参数放到真实命令行上重新 exec。
// 设置 ZTOOLS_NATIVE_WAYLAND=1 可跳过（功能降级）。
const OZONE_X11_FLAG = '--ozone-platform=x11'
const REEXEC_MARKER_ENV = 'ZTOOLS_X11_REEXEC'

function needsX11Reexec(): boolean {
  if (process.platform !== 'linux') return false
  if (process.env.ZTOOLS_NATIVE_WAYLAND === '1') return false
  if (!process.env.WAYLAND_DISPLAY && process.env.XDG_SESSION_TYPE !== 'wayland') return false
  // 命令行已指定过平台，或用户传了 wayland，都不再干预
  if (process.argv.some((arg) => arg.startsWith('--ozone-platform'))) return false
  // --toggle 只做单实例转发，不创建窗口，无需 XWayland
  if (process.argv.includes('--toggle')) return false
  // 防止 re-exec 循环
  if (process.env[REEXEC_MARKER_ENV] === '1') return false

  return true
}

if (needsX11Reexec()) {
  console.log('[Bootstrap] 检测到 Wayland 会话，以 XWayland (--ozone-platform=x11) 重新启动')

  // 必须早于 requestSingleInstanceLock()，否则本进程先抢到锁会让新进程直接退出
  const child = spawn(process.execPath, [...process.argv.slice(1), OZONE_X11_FLAG], {
    detached: true,
    stdio: 'inherit',
    env: { ...process.env, [REEXEC_MARKER_ENV]: '1' }
  })
  child.unref()
  app.exit(0)
}

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
