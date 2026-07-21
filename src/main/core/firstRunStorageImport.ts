import { is } from '@electron-toolkit/utils'
import { BrowserWindow, dialog, ipcMain, screen } from 'electron'
import { getPreloadPath, getRendererPath } from '../utils/appBundlePath'
import { applyWindowMaterial, getDefaultWindowMaterial } from '../utils/windowUtils'
import { legacyImportService, type LegacyImportMode } from './storage/legacyImportService'
import { storageManager } from './storage/storageManager'

let legacyImportWindowActive = false

export function isLegacyImportWindowActive(): boolean {
  return legacyImportWindowActive
}

export async function handleFirstRunStorageImport(): Promise<void> {
  const state = storageManager.getInitState()
  if (!state.firstRun || !state.legacyLmdbFound) return

  const result = await showLegacyImportWindow()

  if (result.action === 'import') {
    await dialog.showMessageBox({
      type: 'info',
      title: '旧数据导入完成',
      message: '旧数据导入完成',
      detail: `迁移模式：${result.imported.mode === 'full' ? '完整迁移' : '精简迁移'}。已导入 ${result.imported.importedDocs} 条数据库记录、${result.imported.importedAttachments} 个附件，复制 ${result.imported.copiedDirs.length} 个数据目录，跳过 ${result.imported.skippedDocs} 条记录、${result.imported.skippedAttachments} 个附件。旧目录已保留不变。`,
      buttons: ['确定'],
      noLink: true
    })
    return
  }

  if (result.action === 'error') {
    await dialog.showMessageBox({
      type: 'error',
      title: '旧数据导入失败',
      message: '旧数据导入失败',
      detail: result.error,
      buttons: ['确定'],
      noLink: true
    })
    legacyImportService.startFresh()
    return
  }

  legacyImportService.startFresh()
}

type LegacyImportWindowResult =
  | { action: 'fresh' }
  | { action: 'import'; imported: ReturnType<typeof legacyImportService.importSelected> }
  | { action: 'error'; error: string }

function showLegacyImportWindow(): Promise<LegacyImportWindowResult> {
  legacyImportWindowActive = true

  const width = 600
  const height = 590
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y = Math.round(workArea.y + (workArea.height - height) / 2)

  const windowConfig: Electron.BrowserWindowConstructorOptions = {
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    hasShadow: true,
    type: 'panel',
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  }

  if (process.platform === 'darwin') {
    windowConfig.transparent = true
    windowConfig.vibrancy = 'fullscreen-ui'
  } else if (process.platform === 'win32') {
    windowConfig.backgroundColor = '#00000000'
  }

  const importWindow = new BrowserWindow(windowConfig)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    importWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/legacy-import.html`)
  } else {
    importWindow.loadFile(getRendererPath('legacy-import.html'))
  }

  if (process.platform === 'win32') {
    applyWindowMaterial(importWindow, getDefaultWindowMaterial())
  }

  importWindow.once('ready-to-show', () => {
    importWindow.show()
    importWindow.focus()
  })

  return new Promise((resolve) => {
    let settled = false

    const finish = (result: LegacyImportWindowResult): void => {
      if (settled) return
      settled = true
      ipcMain.removeListener('legacy-import:choose', handleChoice)
      resolve(result)
      if (!importWindow.isDestroyed()) {
        importWindow.close()
      }
    }

    const handleChoice = (
      event: Electron.IpcMainEvent,
      choice: { action: 'import' | 'fresh'; mode?: LegacyImportMode }
    ): void => {
      if (event.sender !== importWindow.webContents) return
      if (choice?.action !== 'import') {
        finish({ action: 'fresh' })
        return
      }

      try {
        const imported = legacyImportService.importSelected({
          mode: choice.mode === 'compact' ? 'compact' : 'full'
        })
        finish({ action: 'import', imported })
      } catch (error: unknown) {
        finish({
          action: 'error',
          error: error instanceof Error ? error.message : '未知错误'
        })
      }
    }

    ipcMain.on('legacy-import:choose', handleChoice)

    importWindow.on('closed', () => {
      finish({ action: 'fresh' })
      setTimeout(() => {
        legacyImportWindowActive = false
      }, 0)
    })
  })
}
