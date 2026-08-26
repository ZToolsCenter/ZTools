import developmentIcon from '../../assets/market/development.png'
import gameIcon from '../../assets/market/game.png'
import mediaIcon from '../../assets/market/media.png'
import networkIcon from '../../assets/market/network.png'
import otherIcon from '../../assets/market/other.png'
import productivityIcon from '../../assets/market/productivity.png'
import systemIcon from '../../assets/market/system.png'
import textIcon from '../../assets/market/text.png'
import rankingPopularIcon from '../../assets/market/ranking-popular.svg'
import rankingRecentIcon from '../../assets/market/ranking-recent.svg'
import bannerImage from '../../assets/market/ztools-banner.png'

export const marketBannerImage = bannerImage

const marketCategoryIcons: Record<string, string> = {
  productivity: productivityIcon,
  development: developmentIcon,
  media: mediaIcon,
  text: textIcon,
  game: gameIcon,
  network: networkIcon,
  system: systemIcon,
  'ranking-popular': rankingPopularIcon,
  'ranking-recent': rankingRecentIcon,
  other: otherIcon
}

/**
 * 获取市场分类或排行榜使用的本地图标。
 * @param key 分类或排行榜标识。
 * @returns 对应的图标资源地址；未知标识回退到其他分类图标。
 */
export function getMarketCategoryIcon(key: string): string {
  return marketCategoryIcons[key] ?? otherIcon
}
