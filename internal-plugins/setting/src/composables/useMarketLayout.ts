import { ref, type Ref } from 'vue'

/**
 * 插件市场全屏浏览状态。
 * 当从外部直达（首页宫格 / 托盘菜单 / 首次启动）进入市场时置为 true，
 * 设置外壳据此隐藏左侧菜单，让市场以独立一级页面形态呈现，而非设置的一个 tab。
 */
const isMarketFullscreen = ref(false)

/**
 * 市场全屏布局控制接口。
 */
export interface MarketLayout {
  /** 是否处于市场全屏浏览态。 */
  isMarketFullscreen: Ref<boolean>
  /** 设置市场全屏浏览态。 */
  setMarketFullscreen: (value: boolean) => void
}

/**
 * 控制插件市场全屏浏览布局。
 * @returns 全屏状态与设置函数
 */
export function useMarketLayout(): MarketLayout {
  function setMarketFullscreen(value: boolean): void {
    isMarketFullscreen.value = value
  }
  return { isMarketFullscreen, setMarketFullscreen }
}
