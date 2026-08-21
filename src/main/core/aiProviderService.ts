import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import databaseAPI from '../api/shared/database.js'
import { HOST_STORAGE_KEYS } from '../../shared/storageKeys.js'
import {
  AI_PROVIDER_STORE_VERSION,
  DEFAULT_AI_API_FORMAT,
  isAiProviderStore,
  normalizeAiApiFormat,
  normalizeAiModelCapabilities,
  normalizeAiApiUrl,
  toAiModelReasoningInfo,
  type AiModelChoice,
  type AiProvider,
  type AiProviderInput,
  type AiProviderModel,
  type AiProviderMutationResult,
  type AiProviderStore,
  type AiRemoteModel,
  type LegacyAiModel
} from '../../shared/aiProviderShared.js'

/** 已解析的供应商和模型调用配置。 */
export interface ResolvedAiModel {
  provider: AiProvider
  model: AiProviderModel
}

/**
 * 从接口地址生成适合展示的供应商基础名称。
 * @param apiUrl 供应商的 OpenAI 兼容接口地址
 * @param fallback 无法解析地址时使用的名称
 * @returns 供应商基础名称
 */
function deriveProviderName(apiUrl: string, fallback: string): string {
  try {
    return new URL(apiUrl).hostname || fallback
  } catch {
    return fallback
  }
}

/**
 * 生成兼容旧插件直接展示和回传的可读模型选择 ID。
 * @param providerName 供应商展示名称
 * @param modelId 供应商接口接收的真实模型 ID
 * @returns 格式为“供应商 - 模型 ID”的公开选择 ID
 */
export function buildAiModelPublicId(providerName: string, modelId: string): string {
  return `${providerName} - ${modelId}`
}

/**
 * 将旧版单模型数组迁移为按供应商组织的版本 2 文档。
 * @param legacyModels 旧版模型配置数组
 * @param createId 创建供应商内部 ID 的函数
 * @returns 完整的版本 2 供应商文档
 */
export function migrateLegacyAiModels(
  legacyModels: LegacyAiModel[],
  createId: () => string = randomUUID
): AiProviderStore {
  const groups = new Map<string, AiProvider>()
  const providerNameCounts = new Map<string, number>()
  const usedRefs = new Set<string>()

  // 按实际连接凭据分组，使同一中转站的历史模型自动归入一个供应商。
  for (const legacyModel of legacyModels) {
    if (!legacyModel || typeof legacyModel !== 'object') continue

    const modelId = typeof legacyModel.id === 'string' ? legacyModel.id.trim() : ''
    const apiUrl = normalizeAiApiUrl(
      typeof legacyModel.apiUrl === 'string' ? legacyModel.apiUrl : ''
    )
    const apiKey = typeof legacyModel.apiKey === 'string' ? legacyModel.apiKey : ''
    if (!modelId || !apiUrl || !apiKey) continue

    const groupKey = `${apiUrl}\u0000${apiKey}`
    let provider = groups.get(groupKey)
    if (!provider) {
      const baseName = deriveProviderName(apiUrl, legacyModel.label || 'AI 供应商')
      const sequence = (providerNameCounts.get(baseName) || 0) + 1
      providerNameCounts.set(baseName, sequence)
      provider = {
        id: createId(),
        name: sequence === 1 ? baseName : `${baseName} ${sequence}`,
        apiUrl,
        apiKey,
        apiFormat: DEFAULT_AI_API_FORMAT,
        enabled: true,
        selectedModels: []
      }
      groups.set(groupKey, provider)
    }

    // 旧模型 ID 必须原样保留，兼容插件已经持久化的选择值。
    const ref = usedRefs.has(modelId) ? createId() : modelId
    usedRefs.add(ref)
    provider.selectedModels.push({
      ref,
      modelId,
      description: legacyModel.description,
      icon: legacyModel.icon,
      cost: legacyModel.cost
    })
  }

  const providers = Array.from(groups.values())
  return {
    version: AI_PROVIDER_STORE_VERSION,
    providers
  }
}

/**
 * 统一管理 AI 供应商持久化、远端模型发现和插件模型解析。
 */
class AiProviderService {
  /**
   * 读取供应商文档，并在遇到旧数组时立即完成幂等迁移。
   * @returns 当前有效的供应商文档
   */
  public getStore(): AiProviderStore {
    const raw = databaseAPI.dbGet(HOST_STORAGE_KEYS.aiModels)
    if (isAiProviderStore(raw)) {
      if (this.normalizeProviderStore(raw)) {
        databaseAPI.dbPut(HOST_STORAGE_KEYS.aiModels, raw)
      }
      return raw
    }

    if (Array.isArray(raw)) {
      const migrated = migrateLegacyAiModels(raw as LegacyAiModel[])
      databaseAPI.dbPut(HOST_STORAGE_KEYS.aiModels, migrated)
      console.log('[AIProviders] 已将旧版 AI 模型配置迁移为供应商结构')
      return migrated
    }

    return { version: AI_PROVIDER_STORE_VERSION, providers: [] }
  }

  /**
   * 在应用启动阶段迁移旧版 AI 模型文档。
   * @returns 是否实际写入了迁移后的文档
   */
  public migrateLegacyData(): boolean {
    const raw = databaseAPI.dbGet(HOST_STORAGE_KEYS.aiModels)
    if (!Array.isArray(raw)) return false

    // 迁移完成后写回原键，继续沿用现有账户同步与导入路由。
    databaseAPI.dbPut(HOST_STORAGE_KEYS.aiModels, migrateLegacyAiModels(raw as LegacyAiModel[]))
    console.log('[AIProviders] 已将旧版 AI 模型配置迁移为供应商结构')
    return true
  }

  /**
   * 新建一个供应商并保存用户选中的模型。
   * @param input 供应商连接信息和已选模型
   * @returns 操作结果及最新供应商文档
   */
  public addProvider(input: AiProviderInput): AiProviderMutationResult {
    const validationError = this.validateInput(input)
    if (validationError) return { success: false, error: validationError }

    const store = this.getStore()
    const duplicateNameError = this.validateProviderName(store, input.name)
    if (duplicateNameError) return { success: false, error: duplicateNameError }

    const provider: AiProvider = {
      id: randomUUID(),
      name: input.name.trim(),
      apiUrl: normalizeAiApiUrl(input.apiUrl),
      apiKey: input.apiKey.trim(),
      apiFormat: normalizeAiApiFormat(input.apiFormat),
      enabled: true,
      selectedModels: this.buildSelectedModels(input, [])
    }
    store.providers.push(provider)
    this.saveStore(store)
    return { success: true, data: store }
  }

  /**
   * 更新供应商连接信息和已选模型，并保留未移除模型的选择 ID。
   * @param input 带供应商 ID 的更新数据
   * @returns 操作结果及最新供应商文档
   */
  public updateProvider(input: AiProviderInput): AiProviderMutationResult {
    const validationError = this.validateInput(input)
    if (validationError) return { success: false, error: validationError }
    if (!input.id) return { success: false, error: '供应商 ID 不能为空' }

    const store = this.getStore()
    const index = store.providers.findIndex((provider) => provider.id === input.id)
    if (index === -1) return { success: false, error: '未找到该供应商' }

    const duplicateNameError = this.validateProviderName(store, input.name, input.id)
    if (duplicateNameError) return { success: false, error: duplicateNameError }

    const previous = store.providers[index]
    const nextModels = this.buildSelectedModels(input, previous.selectedModels)
    const nextName = input.name.trim()

    // 供应商改名时保留原公开 ID，兼容插件已经持久化的旧选择值。
    if (previous.name !== nextName) {
      for (const model of nextModels) {
        const previousModel = previous.selectedModels.find(
          (candidate) => candidate.modelId === model.modelId
        )
        if (!previousModel) continue

        model.aliases = Array.from(
          new Set([
            ...(previousModel.aliases || []),
            buildAiModelPublicId(previous.name, model.modelId)
          ])
        )
      }
    }
    store.providers[index] = {
      id: previous.id,
      name: nextName,
      apiUrl: normalizeAiApiUrl(input.apiUrl),
      apiKey: input.apiKey.trim(),
      apiFormat: normalizeAiApiFormat(input.apiFormat),
      enabled: previous.enabled,
      selectedModels: nextModels
    }
    this.saveStore(store)
    return { success: true, data: store }
  }

  /**
   * 删除供应商及其全部已选模型。
   * @param providerId 要删除的供应商内部 ID
   * @returns 操作结果及最新供应商文档
   */
  public deleteProvider(providerId: string): AiProviderMutationResult {
    const store = this.getStore()
    const index = store.providers.findIndex((provider) => provider.id === providerId)
    if (index === -1) return { success: false, error: '未找到该供应商' }

    store.providers.splice(index, 1)
    this.saveStore(store)
    return { success: true, data: store }
  }

  /**
   * 开启或关闭指定 AI 供应商。
   * @param providerId 供应商内部 ID
   * @param enabled 是否允许插件发现和调用该供应商
   * @returns 操作结果及最新供应商文档
   */
  public setProviderEnabled(providerId: string, enabled: boolean): AiProviderMutationResult {
    const store = this.getStore()
    const provider = store.providers.find((candidate) => candidate.id === providerId)
    if (!provider) return { success: false, error: '未找到该供应商' }
    if (typeof enabled !== 'boolean') return { success: false, error: '开启状态无效' }

    // 状态只控制插件侧的发现与调用，不修改供应商配置和已选模型。
    provider.enabled = enabled
    this.saveStore(store)
    return { success: true, data: store }
  }

  /**
   * 通过 OpenAI 兼容的 models 接口拉取供应商模型。
   * @param apiUrl 供应商接口基础地址
   * @param apiKey 供应商 API 密钥
   * @returns 去重并排序后的远端模型列表
   * @throws 供应商拒绝请求、超时或返回异常时抛出错误
   */
  public async fetchRemoteModels(apiUrl: string, apiKey: string): Promise<AiRemoteModel[]> {
    const normalizedUrl = normalizeAiApiUrl(apiUrl)
    if (!normalizedUrl || !apiKey.trim()) {
      throw new Error('API 地址和密钥不能为空')
    }

    const client = new OpenAI({
      apiKey: apiKey.trim(),
      baseURL: normalizedUrl,
      timeout: 15_000,
      maxRetries: 0
    })
    const page = await client.models.list()
    const uniqueIds = new Set<string>()

    // OpenAI 兼容接口通常一次返回完整模型列表，限制数量避免异常响应占用过多内存。
    for (const model of page.data.slice(0, 2_000)) {
      if (typeof model.id === 'string' && model.id.trim()) uniqueIds.add(model.id.trim())
    }

    return Array.from(uniqueIds)
      .sort((left, right) => left.localeCompare(right))
      .map((id) => ({ id }))
  }

  /**
   * 生成供第三方插件 select 使用的扁平模型列表。
   * @returns 同时包含旧插件可读 id 与新插件稳定 value 的模型条目
   */
  public getModelChoices(): AiModelChoice[] {
    const store = this.getStore()
    return store.providers
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        provider.selectedModels.map((model) => {
          const capabilities = normalizeAiModelCapabilities(model)
          const reasoning = toAiModelReasoningInfo(capabilities.reasoning)
          return {
            id: buildAiModelPublicId(provider.name, model.modelId),
            value: model.ref,
            label: buildAiModelPublicId(provider.name, model.modelId),
            providerId: provider.id,
            providerLabel: provider.name,
            modelId: model.modelId,
            description: model.description || '',
            icon: model.icon || '',
            cost: model.cost || 0,
            contextWindow: capabilities.contextWindow,
            inputModalities: [...capabilities.inputModalities],
            // 协议映射由宿主持有，插件只获得当前模型可选择的标准档位。
            ...(reasoning === undefined ? {} : { reasoning })
          }
        })
      )
  }

  /**
   * 将插件传入的选择值解析为实际供应商和远端模型。
   * @param modelRef 插件从 allAiModels 获取并回传的 id、value 或历史兼容 ID
   * @returns 已解析的调用配置；没有任何模型时返回 null
   * @throws 旧式远端模型 ID 同时匹配多个供应商时抛出歧义错误
   */
  public resolveModel(modelRef?: string): ResolvedAiModel | null {
    const store = this.getStore()
    const enabledProviders = store.providers.filter((provider) => provider.enabled)
    const requestedRef = modelRef || undefined

    if (requestedRef) {
      for (const provider of enabledProviders) {
        const exactModel = provider.selectedModels.find((model) => model.ref === requestedRef)
        if (exactModel) return { provider, model: exactModel }
      }

      // 旧插件会直接显示并回传 id，因此公开 ID 与改名前别名都必须可路由。
      const publicMatches = enabledProviders.flatMap((provider) =>
        provider.selectedModels
          .filter(
            (model) =>
              buildAiModelPublicId(provider.name, model.modelId) === requestedRef ||
              model.aliases?.includes(requestedRef)
          )
          .map((model) => ({ provider, model }))
      )
      if (publicMatches.length === 1) return publicMatches[0]
      if (publicMatches.length > 1) {
        throw new Error(`模型选择“${requestedRef}”匹配多个供应商，请重新选择具体模型`)
      }

      // 兼容少数直接硬编码远端模型 ID 的旧插件，但只接受无歧义匹配。
      const legacyMatches = enabledProviders.flatMap((provider) =>
        provider.selectedModels
          .filter((model) => model.modelId === requestedRef)
          .map((model) => ({ provider, model }))
      )
      if (legacyMatches.length === 1) return legacyMatches[0]
      if (legacyMatches.length > 1) {
        throw new Error(`模型“${requestedRef}”存在多个供应商，请重新选择具体模型`)
      }
      if (modelRef) return null
    }

    // 未显式指定模型时，按供应商和模型的保存顺序选取首个已开启项。
    for (const provider of enabledProviders) {
      if (provider.selectedModels[0]) return { provider, model: provider.selectedModels[0] }
    }
    return null
  }

  /**
   * 校验供应商保存请求的必填字段和模型列表。
   * @param input 待校验的供应商数据
   * @returns 校验错误；通过时返回 null
   */
  private validateInput(input: AiProviderInput): string | null {
    if (!input?.name?.trim() || !input?.apiUrl?.trim() || !input?.apiKey?.trim()) {
      return '供应商名称、API 地址和密钥不能为空'
    }
    if (!Array.isArray(input.selectedModels) || input.selectedModels.length === 0) {
      return '请至少选择一个模型'
    }
    if (input.selectedModels.some((model) => !model?.modelId?.trim())) {
      return '模型 ID 不能为空'
    }
    return null
  }

  /**
   * 根据保存请求构建已选模型，同时复用原有模型的稳定选择 ID。
   * @param input 供应商保存请求
   * @param previousModels 更新前的已选模型
   * @returns 去重后的已选模型列表
   */
  private buildSelectedModels(
    input: AiProviderInput,
    previousModels: AiProviderModel[]
  ): AiProviderModel[] {
    const previousByModelId = new Map(previousModels.map((model) => [model.modelId, model]))
    const seen = new Set<string>()
    const selectedModels: AiProviderModel[] = []

    for (const candidate of input.selectedModels) {
      const modelId = candidate.modelId.trim()
      if (seen.has(modelId)) continue
      seen.add(modelId)

      const previous = previousByModelId.get(modelId)
      const merged = { ...previous, ...candidate }
      if (!Object.prototype.hasOwnProperty.call(candidate, 'reasoning')) {
        // 完整模型表单省略字段仍兼容为恢复默认；显式 null 会由能力规范化统一清除。
        delete merged.reasoning
      }
      const capabilities = normalizeAiModelCapabilities(merged)
      selectedModels.push({
        ref: previous?.ref || randomUUID(),
        aliases: previous?.aliases ? [...previous.aliases] : undefined,
        modelId,
        description: candidate.description ?? previous?.description,
        icon: candidate.icon ?? previous?.icon,
        cost: candidate.cost ?? previous?.cost,
        ...capabilities
      })
    }
    return selectedModels
  }

  /**
   * 校验供应商名称在当前文档中是否唯一。
   * @param store 当前供应商文档
   * @param providerName 待保存的供应商名称
   * @param currentProviderId 更新时需要排除的当前供应商 ID
   * @returns 名称冲突错误；名称可用时返回 null
   */
  private validateProviderName(
    store: AiProviderStore,
    providerName: string,
    currentProviderId?: string
  ): string | null {
    const normalizedName = providerName.trim().toLowerCase()
    const duplicated = store.providers.some(
      (provider) =>
        provider.id !== currentProviderId && provider.name.trim().toLowerCase() === normalizedName
    )
    return duplicated ? '供应商名称已存在，请使用不同名称' : null
  }

  /**
   * 补全供应商开启状态、清理废弃字段，并修复空名称或重名供应商。
   * @param store 当前供应商文档
   * @returns 是否清理或补全了字段，或修改了供应商名称、模型历史别名
   */
  private normalizeProviderStore(store: AiProviderStore): boolean {
    const usedNames = new Set<string>()
    let changed = false

    // 早期版本 2 文档包含默认模型字段，当前按已开启供应商顺序自动兜底。
    const legacyStore = store as AiProviderStore & { defaultModelRef?: unknown }
    if ('defaultModelRef' in legacyStore) {
      delete legacyStore.defaultModelRef
      changed = true
    }

    // 按原有顺序保留第一个名称，后续冲突项使用稳定的数字后缀。
    for (const provider of store.providers) {
      // 旧版供应商没有开启状态，升级时保持原有可用行为。
      if (typeof provider.enabled !== 'boolean') {
        provider.enabled = true
        changed = true
      }

      // 历史供应商未保存接口格式，升级时回退为默认的 OpenAI Chat Completions。
      const normalizedFormat = normalizeAiApiFormat(provider.apiFormat)
      if (provider.apiFormat !== normalizedFormat) {
        provider.apiFormat = normalizedFormat
        changed = true
      }

      const originalName = provider.name?.trim() || 'AI 供应商'
      let nextName = originalName
      let sequence = 2
      while (usedNames.has(nextName.toLowerCase())) {
        nextName = `${originalName} (${sequence})`
        sequence += 1
      }
      usedNames.add(nextName.toLowerCase())

      // 版本 2 早期曾保存模型 label，当前仅保留真实 modelId。
      for (const model of provider.selectedModels) {
        const legacyModel = model as AiProviderModel & { label?: unknown }
        if (!('label' in legacyModel)) continue
        delete legacyModel.label
        changed = true
      }

      // 能力元数据只规范化已经声明的字段，未知推理能力保持缺省而不猜测 high。
      for (const model of provider.selectedModels) {
        const capabilities = normalizeAiModelCapabilities(model)
        if (
          model.contextWindow !== capabilities.contextWindow ||
          JSON.stringify(model.inputModalities) !== JSON.stringify(capabilities.inputModalities) ||
          JSON.stringify(model.reasoning) !== JSON.stringify(capabilities.reasoning)
        ) {
          Object.assign(model, capabilities)
          if (capabilities.reasoning === undefined) delete model.reasoning
          changed = true
        }
      }

      if (provider.name === nextName) continue
      for (const model of provider.selectedModels) {
        const previousPublicId = buildAiModelPublicId(provider.name || originalName, model.modelId)
        model.aliases = Array.from(new Set([...(model.aliases || []), previousPublicId]))
      }
      provider.name = nextName
      changed = true
    }

    return changed
  }

  /**
   * 将完整供应商文档写回账户级存储。
   * @param store 待保存的供应商文档
   * @returns 无返回值
   */
  private saveStore(store: AiProviderStore): void {
    databaseAPI.dbPut(HOST_STORAGE_KEYS.aiModels, store)
  }
}

export default new AiProviderService()
