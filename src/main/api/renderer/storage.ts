import { ipcMain } from 'electron'
import { storageManager } from '../../core/lmdb/lmdbInstance'
import {
  legacyImportService,
  type LegacyImportOptions
} from '../../core/storage/legacyImportService'

export class StorageAPI {
  public init(): void {
    ipcMain.handle('storage:get-init-state', async () => {
      try {
        return {
          success: true,
          state: storageManager.getInitState(),
          legacy: legacyImportService.detect()
        }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('storage:start-fresh', async () => {
      try {
        legacyImportService.startFresh()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('storage:import-legacy', async (_event, options: LegacyImportOptions) => {
      try {
        const result = legacyImportService.importSelected(options || {})
        return { success: true, result }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })
  }
}

export default new StorageAPI()
