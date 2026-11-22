/** 安装记录随账号同步，插件实体和启动路径保留在当前设备。 */
export const MARKET_INSTALL_HISTORY_PREFIX = 'ZTOOLS/market-install-history/'

export interface MarketInstallRecord {
  name: string
  title: string
  logo?: string
  installedAt: string
  installedOn: string
  platform?: string[]
}
