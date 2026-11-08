import { randomUUID } from 'node:crypto'
import type { PanelMutation } from '../../../shared/commandService'

/**
 * 生成与面板显示一致的项目身份。
 * @param item 指令或文件夹
 * @returns 稳定项目键
 */
export function panelItemKey(item: any): string {
  return item.isFolder ? `folder-${item.id}` : `${item.path}-${item.featureCode || ''}-${item.name}`
}

/**
 * 校验持久化面板结构，阻止嵌套文件夹与重复目标。
 * @param items 原始项目列表
 * @returns 清理后的可序列化列表
 * @throws 无效结构、重复身份或嵌套文件夹时抛错
 */
export function normalizePanelState(items: any[]): any[] {
  if (!Array.isArray(items)) throw new Error('面板固定列表必须为数组')
  const seen = new Set<string>()
  const result = structuredClone(items)
  for (const item of result) {
    const children = item?.isFolder ? item.items : [item]
    if (!Array.isArray(children)) throw new Error('文件夹缺少内容列表')
    if (item?.isFolder && (typeof item.name !== 'string' || !item.name.trim()))
      throw new Error('文件夹缺少名称')
    if (item.isFolder) {
      // 旧版本仅存名称和内容，身份由主进程补齐后持久化，跨页面保持一致。
      if (!item.id) item.id = randomUUID()
      const key = panelItemKey(item)
      if (seen.has(key)) throw new Error('文件夹身份重复')
      seen.add(key)
    }
    for (const child of children) {
      if (child?.isFolder || typeof child?.path !== 'string' || typeof child.name !== 'string')
        throw new Error('面板指令无效或存在嵌套文件夹')
      const key = panelItemKey(child)
      if (seen.has(key)) throw new Error('同一指令不能重复固定')
      seen.add(key)
    }
  }
  return result.filter((item) => !item.isFolder || item.items.length)
}

/**
 * 在主进程执行拖动、合并、移出、解散与重命名操作。
 * @param items 当前持久化列表
 * @param operation 用户提交的身份操作
 * @returns 新的完整列表
 * @throws 操作目标失效或嵌套合并时抛错
 */
export function applyPanelMutation(items: any[], operation: PanelMutation): any[] {
  const next = normalizePanelState(items)
  const key = operation.action === 'move' ? operation.sourceKey : operation.key
  let sourceFolder: any
  let source: any
  for (const item of next) {
    if (panelItemKey(item) === key) {
      source = item
      break
    }
    if (item.isFolder) {
      source = item.items.find((child) => panelItemKey(child) === key)
      if (source) {
        sourceFolder = item
        break
      }
    }
  }
  if (!source) throw new Error('面板项目已变更，请重试')
  if (operation.action === 'rename') {
    if (!source.isFolder || !operation.name.trim()) throw new Error('文件夹名称不能为空')
    source.name = operation.name.trim()
    return next
  }
  const parent = sourceFolder ? sourceFolder.items : next
  const sourceIndex = parent.indexOf(source)
  if (operation.action === 'new-folder') {
    if (source.isFolder || sourceFolder) throw new Error('不能创建嵌套文件夹')
    parent.splice(sourceIndex, 1, {
      isFolder: true,
      id: randomUUID(),
      name: '新文件夹',
      items: [source]
    })
    return next
  }
  if (operation.action === 'ungroup') {
    if (!source.isFolder) throw new Error('目标不是文件夹')
    parent.splice(sourceIndex, 1, ...source.items)
    return next
  }
  // 移除与移动都先摘下源项，再处理源文件夹退化，避免复制产生重复指令。
  parent.splice(sourceIndex, 1)
  if (operation.action === 'move' && operation.containerKey) {
    const container = next.find((item) => panelItemKey(item) === operation.containerKey)
    if (!container?.isFolder || source.isFolder || sourceFolder !== container)
      throw new Error('文件夹内排序目标失效')
    const before = container.items.findIndex((item) => panelItemKey(item) === operation.beforeKey)
    container.items.splice(before < 0 ? container.items.length : before, 0, source)
    return normalizePanelState(next)
  }
  if (sourceFolder && sourceFolder.items.length <= 1)
    next.splice(next.indexOf(sourceFolder), 1, ...sourceFolder.items)
  if (operation.action === 'remove') return normalizePanelState(next)
  if (operation.action !== 'move') return next
  let target = operation.targetKey
    ? next.find((item) => panelItemKey(item) === operation.targetKey)
    : undefined
  if (!target && sourceFolder && operation.targetKey === panelItemKey(sourceFolder))
    target = sourceFolder.items[0]
  if (target && !source.isFolder) {
    if (target.isFolder) target.items.push(source)
    else
      next.splice(next.indexOf(target), 1, {
        isFolder: true,
        id: randomUUID(),
        name: '文件夹',
        items: [target, source]
      })
  } else {
    const beforeKey =
      sourceFolder &&
      operation.beforeKey === panelItemKey(sourceFolder) &&
      sourceFolder.items.length === 1
        ? panelItemKey(sourceFolder.items[0])
        : operation.beforeKey
    const before = next.findIndex((item) => panelItemKey(item) === beforeKey)
    next.splice(before < 0 ? next.length : before, 0, source)
  }
  return normalizePanelState(next)
}
