import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import svgLoader from 'vite-svg-loader'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))
const targetElectronVersion = packageJson.devDependencies.electron

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
      __ZTOOLS_TARGET_ELECTRON_VERSION__: JSON.stringify(targetElectronVersion)
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@platform-updater': getPlatformUpdaterEntry()
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
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
          'accessibility-permission': resolve(
            __dirname,
            'src/renderer/accessibility-permission.html'
          )
        }
      }
    }
  }
})
