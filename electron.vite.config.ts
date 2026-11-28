import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import svgLoader from 'vite-svg-loader'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))
const targetElectronVersion = packageJson.devDependencies.electron
const officialSyncServerUrl =
  process.env.ZTOOLS_OFFICIAL_SYNC_SERVER_URL?.trim() || 'https://z-tools.top'

const sharedDefines = {
  __ZTOOLS_OFFICIAL_SYNC_SERVER_URL__: JSON.stringify(officialSyncServerUrl)
}

function getPlatformUpdaterEntry(): string {
  const targetPlatform = process.env.ZTOOLS_TARGET_PLATFORM || process.platform
  if (targetPlatform === 'win32')
    return resolve(__dirname, 'src/main/api/platformUpdater/windows.ts')
  if (targetPlatform === 'darwin')
    return resolve(__dirname, 'src/main/api/platformUpdater/macos.ts')
  return resolve(__dirname, 'src/main/api/platformUpdater/disabled.ts')
}

export default defineConfig({
  main: {
    define: {
      __ZTOOLS_TARGET_ELECTRON_VERSION__: JSON.stringify(targetElectronVersion),
      ...sharedDefines
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@platform-updater': getPlatformUpdaterEntry()
      }
    },
    // Bundle ESM-only uuid for the CommonJS main process on Electron's Node 22.9.
    plugins: [externalizeDepsPlugin({ exclude: ['uuid'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    define: sharedDefines,
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'afdian-payment': resolve(__dirname, 'src/preload/afdian-payment.ts')
        }
      }
    }
  },
  renderer: {
    define: sharedDefines,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [vue(), svgLoader()],
    server: {
      port: 5174,
      host: '127.0.0.1',
      open: false
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          'detached-titlebar': resolve(__dirname, 'src/renderer/detached-titlebar.html'),
          'super-panel': resolve(__dirname, 'src/renderer/super-panel.html'),
          updater: resolve(__dirname, 'src/renderer/updater.html'),
          'legacy-import': resolve(__dirname, 'src/renderer/legacy-import.html'),
          'afdian-payment': resolve(__dirname, 'src/renderer/afdian-payment.html'),
          'accessibility-permission': resolve(
            __dirname,
            'src/renderer/accessibility-permission.html'
          )
        }
      }
    }
  }
})
