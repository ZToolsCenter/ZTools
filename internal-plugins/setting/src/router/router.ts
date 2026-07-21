import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecord, RouteRecordRaw } from 'vue-router'

/**
 * 菜单项
 */
interface IMenuItem {
  label: string
  icon: string
}

/**
 * 路由菜单项类型
 */
export type MenuRouterItemType = (RouteRecord | RouteRecordRaw) & {
  meta?: {
    menu?: IMenuItem
  }
}

// @unocss-include
const homeRoutes: MenuRouterItemType[] = [
  {
    path: '/',
    redirect: '/generalSetting'
  },
  {
    path: '/generalSetting',
    name: 'GeneralSetting',
    component: () => import('@/views/GeneralSetting/GeneralSetting.vue'),
    meta: {
      menu: {
        label: '通用设置',
        icon: 'i-z-settings'
      }
    }
  },
  {
    path: '/shortcuts',
    name: 'Shortcuts',
    component: () => import('@/views/ShortcutsSetting/ShortcutsSetting.vue'),
    meta: {
      menu: {
        label: '快捷键',
        icon: 'i-z-keyboard'
      }
    }
  },
  {
    path: '/plugins',
    name: 'Plugins',
    component: () => import('@/views/PluginsSetting/PluginsSetting.vue'),
    meta: {
      menu: {
        label: '已安装插件',
        icon: 'i-z-plugin'
      }
    }
  },
  {
    path: '/market',
    name: 'Market',
    component: () => import('@/views/PluginMarketSetting/PluginMarketSetting.vue'),
    meta: {
      menu: {
        label: '插件市场',
        icon: 'i-z-store'
      }
    }
  },
  {
    path: '/providers',
    name: 'Providers',
    component: () => import('@/views/ProvidersSetting/ProvidersSetting.vue'),
    meta: {
      menu: {
        label: '提供商',
        icon: 'i-z-brain'
      }
    }
  },
  {
    path: '/mcpService',
    name: 'McpService',
    component: () => import('@/views/McpServiceSetting/McpServiceSetting.vue'),
    meta: {
      menu: {
        label: 'MCP 服务',
        icon: 'i-z-mcp'
      }
    }
  },
  {
    path: '/data',
    name: 'Data',
    component: () => import('@/views/DataSetting/DataSetting.vue'),
    meta: {
      menu: {
        label: '我的数据',
        icon: 'i-z-database'
      }
    }
  },
  {
    path: '/allCommands',
    name: 'AllCommands',
    component: () => import('@/views/AllCommandsSetting/AllCommandsSetting.vue'),
    meta: {
      menu: {
        label: '所有指令',
        icon: 'i-z-list'
      }
    }
  },
  {
    path: '/localLaunch',
    name: 'LocalLaunch',
    component: () => import('@/views/LocalLaunchSetting/LocalLaunchSetting.vue'),
    meta: {
      menu: {
        label: '本地启动',
        icon: 'i-z-folder'
      }
    }
  },
  {
    path: '/sync',
    name: 'Sync',
    component: () => import('@/views/SyncSetting/SyncSetting.vue'),
    meta: {
      menu: {
        label: '数据同步',
        icon: 'i-z-cloud'
      }
    }
  },
  {
    path: '/debug',
    name: 'Debug',
    component: () => import('@/views/DebugSetting/DebugSetting.vue'),
    meta: {
      menu: {
        label: '调试日志',
        icon: 'i-z-terminal'
      }
    }
  },
  {
    path: '/httpService',
    name: 'HttpService',
    component: () => import('@/views/HttpServiceSetting/HttpServiceSetting.vue'),
    meta: {
      menu: {
        label: 'HTTP 服务',
        icon: 'i-z-monitor'
      }
    }
  },
  {
    path: '/about',
    name: 'About',
    component: () => import('@/views/AboutSetting/AboutSetting.vue'),
    meta: {
      menu: {
        label: '关于',
        icon: 'i-z-info'
      }
    }
  },
  {
    path: '/account',
    name: 'Account',
    component: () => import('@/views/AccountSetting/AccountSetting.vue')
  },
  {
    path: '/pluginInstaller',
    name: 'PluginInstaller',
    component: () => import('@/views/PluginInstaller/PluginInstaller.vue')
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes: homeRoutes
})
