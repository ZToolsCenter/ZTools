import './style.css'
import { createApp } from 'vue'
import LegacyImportWindow from './components/legacyImport/LegacyImportWindow.vue'

function detectOS(): void {
  const userAgent = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()

  if (platform.includes('win') || userAgent.includes('windows')) {
    document.documentElement.classList.add('os-windows')
  } else if (platform.includes('mac') || userAgent.includes('mac')) {
    document.documentElement.classList.add('os-mac')
  } else if (platform.includes('linux') || userAgent.includes('linux')) {
    document.documentElement.classList.add('os-linux')
  }
}

detectOS()

createApp(LegacyImportWindow).mount('#legacy-import-app')
