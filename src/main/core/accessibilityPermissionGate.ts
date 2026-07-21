import { is } from '@electron-toolkit/utils'
import { execFile } from 'child_process'
import { app, BrowserWindow, ipcMain, screen, shell, systemPreferences } from 'electron'
import { getPreloadPath, getRendererPath } from '../utils/appBundlePath'

const APP_BUNDLE_ID = 'top.z-tools'
let permissionWindow: BrowserWindow | null = null

export function isAccessibilityPermissionWindowActive(): boolean {
  return Boolean(permissionWindow && !permissionWindow.isDestroyed())
}

export function focusAccessibilityPermissionWindow(): boolean {
  if (!permissionWindow || permissionWindow.isDestroyed()) return false

  permissionWindow.show()
  permissionWindow.focus()
  return true
}

export async function ensureMacAccessibilityPermission(): Promise<void> {
  if (process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false)) {
    return
  }

  await showAccessibilityPermissionWindow()
}

function showAccessibilityPermissionWindow(): Promise<void> {
  const width = 500
  const height = 360
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y = Math.round(workArea.y + (workArea.height - height) / 2)

  const window = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    vibrancy: 'fullscreen-ui',
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: false,
    alwaysOnTop: true,
    hasShadow: true,
    type: 'panel',
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  permissionWindow = window

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/accessibility-permission.html`)
  } else {
    window.loadFile(getRendererPath('accessibility-permission.html'))
  }

  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })

  return new Promise((resolve) => {
    let settled = false
    let resettingPermission = false

    const cleanup = (): void => {
      clearInterval(permissionPoller)
      ipcMain.removeListener('accessibility-permission:open-settings', handleOpenSettings)
      ipcMain.removeListener('accessibility-permission:reset', handleReset)
      ipcMain.removeListener('accessibility-permission:quit', handleQuit)
    }

    const finishWhenGranted = (): void => {
      if (
        settled ||
        resettingPermission ||
        !systemPreferences.isTrustedAccessibilityClient(false)
      ) {
        return
      }
      settled = true
      cleanup()
      window.webContents.send('accessibility-permission:granted')
      setTimeout(() => {
        permissionWindow = null
        if (!window.isDestroyed()) window.destroy()
        resolve()
      }, 250)
    }

    const isPermissionWindowSender = (event: Electron.IpcMainEvent): boolean =>
      event.sender === window.webContents

    const handleOpenSettings = (event: Electron.IpcMainEvent): void => {
      if (!isPermissionWindowSender(event)) return

      // 先触发系统授权请求，确保 ZTools 出现在辅助功能应用列表中。
      systemPreferences.isTrustedAccessibilityClient(true)
      window.setAlwaysOnTop(false)
      void shell
        .openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        )
        .catch((error) => console.error('[Main] 打开辅助功能设置失败:', error))
      finishWhenGranted()
    }

    const handleReset = (event: Electron.IpcMainEvent): void => {
      if (!isPermissionWindowSender(event) || resettingPermission) return

      if (!app.isPackaged) {
        window.webContents.send('accessibility-permission:reset-result', {
          success: false,
          error: '开发模式下不执行权限重置，请使用打包版本测试'
        })
        return
      }

      resettingPermission = true
      execFile(
        '/usr/bin/tccutil',
        ['reset', 'Accessibility', APP_BUNDLE_ID],
        (error, _stdout, stderr) => {
          if (error) {
            resettingPermission = false
            console.error('[Main] 重置辅助功能权限失败:', stderr.trim() || error)
            if (!window.isDestroyed()) {
              window.webContents.send('accessibility-permission:reset-result', {
                success: false,
                error: '权限重置失败，请在系统设置中手动删除 ZTools'
              })
            }
            return
          }

          settled = true
          cleanup()
          if (!window.isDestroyed()) {
            window.webContents.send('accessibility-permission:reset-result', { success: true })
          }
          setTimeout(() => {
            app.relaunch()
            app.exit(0)
          }, 1000)
        }
      )
    }

    const handleQuit = (event: Electron.IpcMainEvent): void => {
      if (!isPermissionWindowSender(event)) return
      settled = true
      cleanup()
      app.exit(0)
    }

    const permissionPoller = setInterval(finishWhenGranted, 1000)
    ipcMain.on('accessibility-permission:open-settings', handleOpenSettings)
    ipcMain.on('accessibility-permission:reset', handleReset)
    ipcMain.on('accessibility-permission:quit', handleQuit)
  })
}
