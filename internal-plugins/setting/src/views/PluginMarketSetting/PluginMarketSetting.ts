import { router } from '@/router'

/**
 * 跳转到插件市场页面参数
 */
export interface PluginMarketSettingJumpFunction {
  /**
   * 自动打开详情的插件名称
   */
  payload?: string
  /**
   * 类型：over 表示填入搜索框，detail 表示打开插件详情
   */
  type?: 'over' | 'detail' | string
}

/**
 * 跳转到插件市场页面
 * @param config 路由状态参数
 */
export function jumpFunctionPluginMarketSetting(config: PluginMarketSettingJumpFunction): void {
  void router.replace({
    name: 'Market',
    query: { _t: Date.now() },
    state: { ...config }
  })
}
