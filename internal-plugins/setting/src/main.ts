import { createApp } from 'vue'
import App from './App.vue'
import './assets/styles'
import { router } from './router'
import { dispatchZtoolsCodeEvent, initZtoolsBaseEventHandler } from '@/events'
import { refreshAccountProfile } from '@/composables'
// 单独导入注册事件
import './events/allCodeEvent'

// 统一对 ztools onPluginEnter 事件进行派发, 内部不要再对 ztools.onPluginEnter 进行监听
ztools.onPluginEnter((action) => {
  // 将 utools 事件派发根据不同的 code 进行派发出去
  console.log('[插件事件: onPluginEnter]', action)
  dispatchZtoolsCodeEvent(action, router)
  // 设置视图会被宿主缓存复用，每次重新进入都要从服务端刷新账号资料。
  void refreshAccountProfile({ force: true })
})

ztools.onPluginOut(() => {
  if (router.currentRoute.value.name === 'GeneralSetting') {
    return
  }

  void router.replace({ name: 'GeneralSetting' }).catch((error) => {
    console.error('[插件事件: onPluginOut] 重置设置页路由失败', error)
  })
})

// 检测操作系统并添加类名到 html 元素
function detectOS(): void {
  if (window.ztools.isWindows()) {
    document.documentElement.classList.add('os-windows')
  } else if (window.ztools.isMacOS()) {
    document.documentElement.classList.add('os-mac')
  } else {
    document.documentElement.classList.add('os-linux')
  }
}

// 在应用初始化前检测操作系统
detectOS()

const app = createApp(App)
// 注册路由
app.use(router)

app.mount('#app')

// 注册 ztools 关键字跳转事件
initZtoolsBaseEventHandler()
