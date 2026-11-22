import {
  MARKET_INSTALL_HISTORY_PREFIX,
  type MarketInstallRecord
} from '../../../shared/marketInstallHistory'
import { storageManager } from './storageManager'
import type LmdbDatabase from '../lmdb'

/**
 * 为尚无记录的插件保存首次成功安装的快照。
 * @param account 发起安装的账号数据库。
 * @param record 本次安装的市场元数据。
 * @returns 无返回值。
 * @throws 账号库写入失败时抛出错误。
 */
export function saveFirstMarketInstall(account: LmdbDatabase, record: MarketInstallRecord): void {
  const key = MARKET_INSTALL_HISTORY_PREFIX + record.name
  // 兼容旧版按名称保存的文档；升级和重装不写新修订。
  if (account.get(key)?.data || account.allDocs(key + '/').length) return

  // 离线设备可能各自首次安装。同一插件的不同时间使用独立文档，同步时不会互相覆盖。
  const result = account.put({ _id: key + '/' + record.installedAt, data: record })
  if (!result.ok) throw new Error(result.message || '保存安装记录失败')
}

/**
 * 在安装开始时绑定账号库，避免下载期间切换账号后将记录写给另一位用户。
 * @returns 在安装成功后写入该次安装记录的回调。
 */
export function bindMarketInstallHistory(): (record: MarketInstallRecord) => void {
  const account = storageManager.getAccountDb()
  /**
   * 将首次安装写入发起下载的账号库。
   * @param record 本次成功安装的市场元数据。
   * @returns 无返回值。
   * @throws 账号库已切换或历史写入失败时抛出错误。
   */
  return (record) => {
    // 账号切换会关闭旧库，此时中止写入并由安装器报告警告。
    if (account !== storageManager.getAccountDb()) throw new Error('安装期间账号已切换')
    saveFirstMarketInstall(account, record)
  }
}

/**
 * 按插件合并各设备同步的首次安装记录。
 * @param account 要读取的账号库，默认为当前账号。
 * @returns 每个插件最早的有效记录，按首次安装时间从新到旧排列。
 */
export function getMarketInstallHistory(
  account = storageManager.getAccountDb()
): MarketInstallRecord[] {
  const earliest = new Map<string, MarketInstallRecord>()
  for (const doc of account.allDocs(MARKET_INSTALL_HISTORY_PREFIX)) {
    const record = doc.data
    if (typeof record?.name !== 'string' || !Number.isFinite(Date.parse(record.installedAt)))
      continue
    // 同时兼容旧的单文档记录和离线设备各自保存的快照，合并结果与接收顺序无关。
    const previous = earliest.get(record.name)
    if (!previous || Date.parse(record.installedAt) < Date.parse(previous.installedAt)) {
      earliest.set(record.name, record)
    }
  }
  return [...earliest.values()].sort(
    (a, b) => Date.parse(b.installedAt) - Date.parse(a.installedAt)
  )
}
