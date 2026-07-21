import type { ProviderType } from '@shared/providerShared'
import providerManager from '../../core/provider/providerManager'
import { registerPluginApiServices } from './pluginApiDispatcher'

/**
 * 消费方入口：让任意插件能够主动查询、调用其它 provider（翻译 / OCR）。
 *
 * 与 `ztools.registerProvider`（提供方）和 `ztools.internal.providers.*`（管理方）互补：
 * 这里注册的 handler 面向所有插件，走统一 `plugin.api` 分发器，转发到 providerManager。
 */
class PluginProvidersAPI {
  public init(): void {
    registerPluginApiServices({
      /**
       * 查询某 type 下的全部 provider，并标注哪个是默认。
       * 返回结构直接给插件使用，不包裹 { success, data }（与 ai() 风格一致）。
       */
      providersGetProviders: async (_event, payload: { type?: ProviderType }) => {
        const type = payload?.type
        const all = providerManager.getAllProviders(type as never)
        const defaultId = type ? providerManager.getDefaultProviderId(type) : undefined
        return all.map((p) => ({ ...p, isDefault: p.id === defaultId }))
      },

      /**
       * 单独查询某 type 的默认 provider（defaultId 缺失时回退到首个启用/可用项）。
       * 无可用 provider 时返回 null。
       */
      providersGetDefault: async (_event, payload: { type?: ProviderType }) => {
        const type = payload?.type
        if (!type) return null
        const id = providerManager.getDefaultProviderId(type)
        if (!id) return null
        const entry = providerManager.getAllProviders(type).find((p) => p.id === id)
        return entry ? { ...entry, isDefault: true } : null
      },

      /**
       * 统一调用入口：type 必填，input 必填，providerId 可选（缺省走默认）。
       * 成功直接返回 provider 的输出；失败抛 Error（分发器已处理前缀去除）。
       */
      providersInvoke: async (
        _event,
        payload: {
          type: ProviderType
          input: Record<string, unknown>
          providerId?: string
        }
      ) => {
        const { type, input, providerId } = payload || {}
        if (!type) throw new Error('provider type 不能为空')
        if (!input || typeof input !== 'object') {
          throw new Error('provider 调用入参必须为对象')
        }
        return await providerManager.invoke(
          type,
          input as never,
          providerId ? { providerId } : undefined
        )
      }
    })
  }
}

export default new PluginProvidersAPI()
