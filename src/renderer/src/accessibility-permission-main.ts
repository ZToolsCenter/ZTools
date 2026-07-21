import './style.css'
import { createApp } from 'vue'
import AccessibilityPermissionWindow from './components/accessibility/AccessibilityPermissionWindow.vue'

document.documentElement.classList.add('os-mac')

createApp(AccessibilityPermissionWindow).mount('#accessibility-permission-app')
