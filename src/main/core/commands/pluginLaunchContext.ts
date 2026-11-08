import type { WebContents } from 'electron'

const contexts = new WeakMap<WebContents, any>()

/**
 * 绑定实际进入某个插件实例的参数，避免后续启动覆盖它。
 * @param contents 插件实例
 * @param payload 不可变进入参数
 * @returns 无返回值
 */
export function setPluginInstanceContext(contents: WebContents, payload: any): void {
  contexts.set(contents, structuredClone(payload))
}

/**
 * 按实际插件实例返回最后一次进入参数。
 * @param contents 发起生命周期查询的实例
 * @returns 参数快照或 null
 */
export function getPluginInstanceContext(contents: WebContents): any {
  return structuredClone(contexts.get(contents) || null)
}
