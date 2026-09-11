<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { DetailPanel, Select, type SelectModelValue } from '@/components'
import {
  AI_API_FORMAT_OPTIONS,
  AI_REASONING_EFFORTS,
  DEFAULT_AI_API_FORMAT,
  type AiInputModality,
  type AiApiFormat,
  type AiReasoningConfig,
  type AiReasoningEffort,
  type AiReasoningProtocol,
  type AiReasoningResponseField,
  type AiTemperatureCapability,
  type AiProvider,
  type AiProviderInput,
  type AiProviderModelInput,
  type AiModelCapability,
  type AiProviderCredentialView,
  type AiRemoteModel,
  isOrcaRouterProvider,
  ORCAROUTER_CONSOLE_URL,
  normalizeAiApiFormat,
  normalizeAiModelCapabilities
} from '@shared/aiProviderShared'

interface Props {
  editingProvider: AiProvider | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  back: []
  save: [provider: AiProviderInput]
}>()

const isEditing = computed(() => props.editingProvider !== null)
const showPassword = ref(false)
const fetching = ref(false)
const fetchError = ref('')
const saveError = ref('')
const modelQuery = ref('')
const remoteModelQuery = ref('')
const manualModelId = ref('')
const fetchedModels = ref<AiRemoteModel[]>([])
const selectedModelIds = ref<Set<string>>(new Set())
const selectedModelConfigs = ref<Record<string, AiProviderModelInput>>({})
const pendingModelIds = ref<Set<string>>(new Set())
const showModelDialog = ref(false)
/** 下拉浮层的定位样式；右边缘与触发按钮对齐，避免被滚动容器裁剪。 */
const modelDropdownStyle = ref<Record<string, string>>({})
const formData = ref({
  name: '',
  apiUrl: '',
  apiKey: '',
  apiFormat: DEFAULT_AI_API_FORMAT as AiApiFormat
})

/** OrcaRouter 具名供应商：模型控件改为从真实目录生成的能力过滤下拉。 */
const isOrcaProvider = computed(() => isOrcaRouterProvider(formData.value))
/** 当前 AI 入口实际需要的能力；OrcaRouter 目录按它过滤。 */
const orcaCapability = ref<AiModelCapability>('chat')
/** 当前入口实际上传的非 text 模态（由附件开关驱动）。 */
const requiredModalities = ref<AiInputModality[]>([])
/** 目录是否退回到已验证的冷启动种子。 */
const catalogDegraded = ref(false)
/** 目录降级原因，用于界面提示。 */
const catalogNotice = ref('')
/** 当前保存的凭据状态（脱敏，不含密钥本体）。 */
const credentialView = ref<AiProviderCredentialView | null>(null)
/** 认证方式：手填 API Key 或 OAuth 2.0 + PKCE。 */
const authMethod = ref<'api-key' | 'pkce'>('api-key')
/** 待提交的统一凭据；两种认证入口都只写入这一个字段。 */
const pendingCredential = ref<AiProviderInput['credential']>(undefined)
/** PKCE 登录会话；verifier 只在主进程，这里只保留会话 ID 与授权地址。 */
const pkceSession = ref<{
  attemptId: string
  authorizeUrl: string
  flow: 'loopback' | 'oob'
} | null>(null)
/** OOB 流程用户粘贴的一次性授权码。 */
const pkceCode = ref('')
const pkceBusy = ref(false)
const pkceError = ref('')
/** 单调递增的登录代次：迟到的响应不得覆盖新登录。 */
let pkceGeneration = 0

/**
 * Select 的 v-model 代理：Select 发出的值类型宽于窄字面量 AiApiFormat，
 * 经 normalizeAiApiFormat 归一化后写回表单，保证类型与取值合法。
 * @returns 可读写的 AiApiFormat 代理
 */
const apiFormatProxy = computed<SelectModelValue>({
  get: () => formData.value.apiFormat,
  set: (value) => {
    formData.value.apiFormat = normalizeAiApiFormat(value)
  }
})

const reasoningEffortLabels: Record<AiReasoningEffort, string> = {
  off: '关闭',
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高'
}
const filteredSelectedModelIds = computed(() => {
  const query = modelQuery.value.trim().toLowerCase()
  const modelIds = Array.from(selectedModelIds.value)
  if (!query) return modelIds
  return modelIds.filter((modelId) => modelId.toLowerCase().includes(query))
})

const filteredRemoteModels = computed(() => {
  const query = remoteModelQuery.value.trim().toLowerCase()
  if (!query) return fetchedModels.value
  return fetchedModels.value.filter((model) => model.id.toLowerCase().includes(query))
})

/**
 * 用编辑目标重置表单、远端模型缓存和选择状态。
 * @param provider 当前编辑的供应商；null 表示新建
 * @returns 无返回值
 */
function resetEditor(provider: AiProvider | null): void {
  formData.value = {
    name: provider?.name || '',
    apiUrl: provider?.apiUrl || '',
    apiKey: provider?.apiKey || '',
    apiFormat: provider?.apiFormat ?? DEFAULT_AI_API_FORMAT
  }
  fetchedModels.value = []
  selectedModelIds.value = new Set(provider?.selectedModels.map((model) => model.modelId) || [])
  selectedModelConfigs.value = Object.fromEntries(
    (provider?.selectedModels || []).map((model) => {
      const capabilities = normalizeAiModelCapabilities(model)
      return [
        model.modelId,
        {
          modelId: model.modelId,
          ...capabilities,
          temperature: capabilities.temperature ?? false
        }
      ]
    })
  )
  pendingModelIds.value = new Set()
  modelQuery.value = ''
  remoteModelQuery.value = ''
  manualModelId.value = ''
  fetchError.value = ''
  saveError.value = ''
  showModelDialog.value = false
  showPassword.value = false
  resetOrcaState(provider)
}

/**
 * 重置 OrcaRouter 专有状态：认证方式、凭据视图与目录降级标记。
 *
 * 两种认证入口都要在界面上并列可用，因此默认展示手填 API Key，同时保留 PKCE 入口。
 * @param provider 当前编辑的供应商；null 表示新建
 * @returns 无返回值
 */
function resetOrcaState(provider: AiProvider | null): void {
  authMethod.value = provider?.credential?.source === 'pkce' ? 'pkce' : 'api-key'
  pendingCredential.value = undefined
  credentialView.value = null
  catalogDegraded.value = false
  catalogNotice.value = ''
  orcaCapability.value = 'chat'
  requiredModalities.value = ['text']
  cancelPkceLogin()
  if (provider && isOrcaRouterProvider(provider)) void loadCredentialView(provider.id)
}

/**
 * 读取供应商凭据的脱敏状态。
 * @param providerId 供应商内部 ID
 * @returns 操作完成后结束的 Promise
 */
async function loadCredentialView(providerId: string): Promise<void> {
  try {
    const result = await window.ztools.internal.aiProviders.orcaGetCredential(providerId)
    if (result.success && result.data) credentialView.value = result.data
  } catch (error) {
    console.error('读取 OrcaRouter 凭据状态失败:', error)
  }
}

/**
 * 通过 API Key 入口保存密钥；密钥只在渲染进程短暂停留后交给主进程。
 * @returns 操作完成后结束的 Promise
 */
async function saveApiKeyCredential(): Promise<void> {
  saveError.value = ''
  if (!formData.value.apiKey.trim()) {
    saveError.value = '请填写 OrcaRouter API Key'
    return
  }
  if (!props.editingProvider) {
    // 新建供应商时随保存提交，由主进程按统一凭据结构写入。
    pendingCredential.value = {
      source: 'api-key',
      key: formData.value.apiKey.trim(),
      scope: 'api',
      generation: 1,
      status: 'active',
      updatedAt: Date.now()
    }
    return
  }
  const result = await window.ztools.internal.aiProviders.orcaApplyApiKey(
    props.editingProvider.id,
    formData.value.apiKey.trim()
  )
  if (!result.success) {
    saveError.value = result.error || '保存 API Key 失败'
    return
  }
  await loadCredentialView(props.editingProvider.id)
}

/**
 * 开始一次 PKCE 登录并把授权地址展示给用户。
 * @returns 操作完成后结束的 Promise
 */
async function startPkceLogin(): Promise<void> {
  pkceGeneration += 1
  const generation = pkceGeneration
  pkceBusy.value = true
  pkceError.value = ''
  try {
    const result = await window.ztools.internal.aiProviders.orcaLoginStart(pkceFlow.value)
    // 迟到的响应不得覆盖更新的一次登录尝试。
    if (generation !== pkceGeneration) return
    if (!result.success || !result.data) {
      pkceError.value = result.error || '无法开始 OrcaRouter 登录'
      return
    }
    pkceSession.value = result.data
    if (result.data.flow === 'loopback') {
      void waitForPkceCallback(result.data.attemptId, generation)
    }
  } catch (error) {
    if (generation !== pkceGeneration) return
    pkceError.value = error instanceof Error ? error.message : '无法开始 OrcaRouter 登录'
  } finally {
    if (generation === pkceGeneration) pkceBusy.value = false
  }
}

/**
 * 等待 loopback 回调完成兑换并刷新凭据状态。
 * @param attemptId 会话 ID
 * @param generation 发起本次登录时的代次
 * @returns 操作完成后结束的 Promise
 */
async function waitForPkceCallback(attemptId: string, generation: number): Promise<void> {
  try {
    const result = await window.ztools.internal.aiProviders.orcaLoginWait(
      attemptId,
      props.editingProvider?.id
    )
    if (generation !== pkceGeneration) return
    if (!result.success) {
      pkceError.value = result.error || 'OrcaRouter 登录失败'
      return
    }
    pkceSession.value = null
    if (props.editingProvider) await loadCredentialView(props.editingProvider.id)
    emit('back')
  } catch (error) {
    if (generation !== pkceGeneration) return
    pkceError.value = error instanceof Error ? error.message : 'OrcaRouter 登录失败'
  }
}

/**
 * 使用用户粘贴的一次性授权码完成 PKCE 兑换。
 * @returns 操作完成后结束的 Promise
 */
async function completePkceLogin(): Promise<void> {
  if (!pkceSession.value || !pkceCode.value.trim()) {
    pkceError.value = '请填写授权码'
    return
  }
  pkceBusy.value = true
  pkceError.value = ''
  try {
    const acquired = await window.ztools.internal.aiProviders.orcaLoginComplete(
      pkceSession.value.attemptId,
      pkceCode.value.trim()
    )
    if (!acquired.success) {
      pkceError.value = acquired.error || 'OrcaRouter 登录失败'
      return
    }
    // 新建供应商时把兑换结果作为统一凭据随保存提交。
    const credential = acquired.data?.providers.find(
      (provider) => provider.id === props.editingProvider?.id
    )?.credential
    if (!props.editingProvider && credential) pendingCredential.value = credential
    pkceCode.value = ''
    pkceSession.value = null
    if (props.editingProvider) await loadCredentialView(props.editingProvider.id)
  } catch (error) {
    pkceError.value = error instanceof Error ? error.message : 'OrcaRouter 登录失败'
  } finally {
    pkceBusy.value = false
  }
}

/**
 * 取消进行中的 PKCE 登录并释放主进程监听器。
 * @returns 无返回值
 */
function cancelPkceLogin(): void {
  pkceGeneration += 1
  const session = pkceSession.value
  pkceSession.value = null
  pkceCode.value = ''
  pkceBusy.value = false
  pkceError.value = ''
  if (!session) return
  void window.ztools.internal.aiProviders.orcaLoginCancel(session.attemptId).catch(() => undefined)
}

/**
 * 切换图片附件模态，并按当前入口能力重算可选模型。
 * @returns 无返回值
 */
function toggleImageModality(): void {
  requiredModalities.value = requiredModalities.value.includes('image')
    ? requiredModalities.value.filter((modality) => modality !== 'image')
    : [...requiredModalities.value, 'image']
}

/** PKCE 流程：桌面端可监听 loopback，同时保留一次性代码入口。 */
const pkceFlow = ref<'loopback' | 'oob'>('loopback')

/**
 * 切换认证方式时释放上一条路径的登录状态，避免锁被一直持有。
 * @returns 无返回值
 */
function handleAuthMethodChange(): void {
  cancelPkceLogin()
  saveError.value = ''
}

/**
 * 清除已保存的 OrcaRouter 凭据（退出登录）。
 * @returns 操作完成后结束的 Promise
 */
async function clearCredential(): Promise<void> {
  if (!props.editingProvider) return
  cancelPkceLogin()
  const result = await window.ztools.internal.aiProviders.orcaClearCredential(
    props.editingProvider.id
  )
  if (!result.success) {
    saveError.value = result.error || '退出登录失败'
    return
  }
  formData.value.apiKey = ''
  await loadCredentialView(props.editingProvider.id)
}

watch(() => props.editingProvider, resetEditor, { immediate: true })

// 入口能力或附件模态变化时必须重算目录：不兼容的旧值会被清空并要求重新选择。
watch([orcaCapability, requiredModalities], () => {
  if (!isOrcaProvider.value) return
  const allowed = new Set(fetchedModels.value.map((model) => model.id))
  if (allowed.size === 0) return
  const next = new Set(Array.from(selectedModelIds.value).filter((id) => allowed.has(id)))
  if (next.size === selectedModelIds.value.size) return
  for (const removed of Array.from(selectedModelIds.value)) {
    if (!next.has(removed)) delete selectedModelConfigs.value[removed]
  }
  selectedModelIds.value = next
  fetchError.value = '当前入口能力已变化，不兼容的已选模型已移除，请重新选择'
})

/**
 * 从当前供应商的 OpenAI 兼容接口拉取模型并打开选择弹窗。
 * @returns 操作完成后结束的 Promise
 */
async function fetchModels(): Promise<void> {
  if (!formData.value.apiUrl.trim()) {
    fetchError.value = '请先填写 API 地址'
    return
  }
  if (!isOrcaProvider.value && !formData.value.apiKey.trim()) {
    fetchError.value = '请先填写 API 地址和密钥'
    return
  }

  fetching.value = true
  fetchError.value = ''
  catalogNotice.value = ''
  try {
    // OrcaRouter 使用真实目录接口并按当前入口能力过滤；其他供应商保持原有行为。
    if (isOrcaProvider.value) {
      // 目录请求由主进程持有密钥：渲染进程不把密钥交给发现路径。
      const discovery = await window.ztools.internal.aiProviders.discoverModels({
        providerId: props.editingProvider?.id,
        apiUrl: formData.value.apiUrl,
        capability: orcaCapability.value,
        requiredModalities: requiredModalities.value
      })
      if (!discovery.success || !discovery.data) {
        fetchError.value = discovery.error || '获取模型列表失败'
        return
      }
      catalogDegraded.value = discovery.data.degraded
      if (discovery.data.degraded) {
        catalogNotice.value = `实时目录不可用，已切换到已验证的降级目录：${discovery.data.error || ''}`
      }
      applyFetchedModels(discovery.data.models)
      return
    }

    const result = await window.ztools.internal.aiProviders.fetchModels(
      formData.value.apiUrl,
      formData.value.apiKey
    )
    if (!result.success || !result.data) {
      fetchError.value = result.error || '获取模型列表失败'
      return
    }
    catalogDegraded.value = false
    applyFetchedModels(result.data)
  } catch (error) {
    fetchError.value = error instanceof Error ? error.message : '获取模型列表失败'
  } finally {
    fetching.value = false
  }
}

/**
 * 应用一次目录结果并打开选择弹窗。
 * @param models 目录返回的模型列表
 * @returns 无返回值
 */
function applyFetchedModels(models: AiRemoteModel[]): void {
  const ids = new Set(models.map((model) => model.id))
  fetchedModels.value = [...models].sort((left, right) => left.id.localeCompare(right.id))
  pendingModelIds.value = new Set()
  remoteModelQuery.value = ''
  openModelDropdown()
  // 目录重新计算后不再兼容的旧值必须清空，不能静默保留错误模型。
  const nextSelected = new Set(Array.from(selectedModelIds.value).filter((id) => ids.has(id)))
  if (nextSelected.size !== selectedModelIds.value.size) {
    for (const removed of Array.from(selectedModelIds.value)) {
      if (nextSelected.has(removed)) continue
      delete selectedModelConfigs.value[removed]
    }
    selectedModelIds.value = nextSelected
    fetchError.value = '部分已选模型不再符合当前入口能力，已移除，请重新选择'
  }
}

/**
 * 切换弹窗中尚未添加的远端模型。
 * @param modelId 远端模型 ID
 * @returns 无返回值
 */
function togglePendingModel(modelId: string): void {
  if (selectedModelIds.value.has(modelId)) return

  const next = new Set(pendingModelIds.value)
  if (next.has(modelId)) next.delete(modelId)
  else next.add(modelId)
  pendingModelIds.value = next
}

/**
 * 将弹窗中勾选的远端模型批量加入已选模型。
 * @returns 无返回值
 */
function confirmFetchedModels(): void {
  for (const modelId of pendingModelIds.value) ensureModelConfig(modelId)
  selectedModelIds.value = new Set([...selectedModelIds.value, ...pendingModelIds.value])
  closeModelDialog()
}

/** 下拉浮层宽度；与触发按钮右对齐时使用同一常量便于断言。 */
const MODEL_DROPDOWN_WIDTH = 360

/**
 * 打开锚定在触发按钮右侧的模型下拉浮层。
 *
 * 使用 fixed 定位并按视口计算右偏移，保证浮层右边缘与触发按钮右边缘对齐，
 * 同时不被编辑器滚动容器裁剪。
 * @returns 无返回值
 */
function openModelDropdown(): void {
  const trigger = document.querySelector('[data-testid="fetch-models"]')
  // 先把触发按钮滚动到可见区域，避免浮层贴着视口边缘被裁掉。
  trigger?.scrollIntoView({ block: 'center' })
  const rect = trigger?.getBoundingClientRect()
  const viewportWidth = window.innerWidth || 1280
  const viewportHeight = window.innerHeight || 800
  const right = rect ? Math.max(8, Math.round(viewportWidth - rect.right)) : 24
  const top = rect ? Math.round(rect.bottom + 6) : 120
  // 剩余空间不足时收缩浮层高度，保证整块面板都在视口内。
  const maxHeight = Math.max(240, Math.round(viewportHeight - top - 12))
  modelDropdownStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    right: `${right}px`,
    width: `${MODEL_DROPDOWN_WIDTH}px`,
    maxHeight: `${maxHeight}px`
  }
  showModelDialog.value = true
}

/**
 * 关闭远端模型选择浮层并清理临时选择。
 * @returns 无返回值
 */
function closeModelDialog(): void {
  showModelDialog.value = false
  pendingModelIds.value = new Set()
  remoteModelQuery.value = ''
}

/**
 * 从供应商的已选模型中移除指定模型。
 * @param modelId 要移除的远端模型 ID
 * @returns 无返回值
 */
function removeSelectedModel(modelId: string): void {
  const next = new Set(selectedModelIds.value)
  next.delete(modelId)
  selectedModelIds.value = next
  delete selectedModelConfigs.value[modelId]
}

/**
 * 将手动输入的模型 ID 直接加入已选模型。
 * @returns 无返回值
 */
function addManualModel(): void {
  const modelId = manualModelId.value.trim()
  if (!modelId) return

  ensureModelConfig(modelId)
  selectedModelIds.value = new Set([...selectedModelIds.value, modelId])
  manualModelId.value = ''
}

/**
 * 为新加入的模型补齐宿主统一管理的能力配置。
 * @param modelId 远端模型 ID
 * @returns 当前模型的可编辑配置
 */
function ensureModelConfig(modelId: string): AiProviderModelInput {
  if (!selectedModelConfigs.value[modelId]) {
    selectedModelConfigs.value[modelId] = {
      modelId,
      ...normalizeAiModelCapabilities({ modelId }),
      temperature: false
    }
  }
  return selectedModelConfigs.value[modelId]
}

type ReasoningCapabilityMode = 'provider-default' | 'unsupported' | 'custom'

type TemperatureCapabilityMode = 'unsupported' | 'fixed' | 'range'

type ConfiguredTemperatureCapability = Exclude<AiTemperatureCapability, false>

const contextWindowBytesPerK = 1024
const contextWindowMinK = 4
const contextWindowMaxK = Math.floor(2_000_000 / contextWindowBytesPerK)

const inputModalityOptions: ReadonlyArray<{ value: AiInputModality; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' }
]

/**
 * 判断模型当前采用的推理能力声明模式。
 * @param modelId 正在编辑的远端模型 ID
 * @returns 供应商默认、明确不支持或自定义能力
 */
function reasoningCapabilityMode(modelId: string): ReasoningCapabilityMode {
  const reasoning = ensureModelConfig(modelId).reasoning
  if (reasoning === false) return 'unsupported'
  return reasoning && typeof reasoning === 'object' ? 'custom' : 'provider-default'
}

/**
 * 获取模型已声明的推理配置。
 * @param modelId 正在编辑的远端模型 ID
 * @returns 自定义推理配置；其他模式返回 null
 */
function reasoningConfig(modelId: string): AiReasoningConfig | null {
  const reasoning = ensureModelConfig(modelId).reasoning
  return reasoning && typeof reasoning === 'object' ? reasoning : null
}

/**
 * 判断模型当前采用的温度能力声明模式。
 * @param modelId 正在编辑的远端模型 ID
 * @returns 不支持、固定值或范围模式
 */
function temperatureCapabilityMode(modelId: string): TemperatureCapabilityMode {
  const temperature = ensureModelConfig(modelId).temperature
  if (temperature === false) return 'unsupported'
  return temperature && typeof temperature === 'object' ? temperature.mode : 'unsupported'
}

/**
 * 获取模型已声明的温度配置。
 * @param modelId 正在编辑的远端模型 ID
 * @returns 固定值或范围配置；其他模式返回 null
 */
function temperatureConfig(modelId: string): ConfiguredTemperatureCapability | null {
  const temperature = ensureModelConfig(modelId).temperature
  return temperature && typeof temperature === 'object' ? temperature : null
}

/**
 * 切换模型温度能力声明模式。
 * @param modelId 正在编辑的远端模型 ID
 * @param mode 新的温度能力模式
 * @returns 无返回值
 */
function setTemperatureCapabilityMode(modelId: string, mode: TemperatureCapabilityMode): void {
  const config = ensureModelConfig(modelId)
  if (mode === 'unsupported') {
    config.temperature = false
    return
  }
  const current = temperatureConfig(modelId)
  if (mode === 'fixed') {
    config.temperature = current?.mode === 'fixed' ? current : { mode: 'fixed', value: 1 }
    return
  }
  config.temperature =
    current?.mode === 'range' ? current : { mode: 'range', min: 0, max: 2, default: 0.2 }
}

/**
 * 更新模型温度配置中的数值字段。
 * @param modelId 正在编辑的远端模型 ID
 * @param field 要更新的温度字段
 * @param value 输入的数值
 * @returns 无返回值
 */
function updateTemperatureField(
  modelId: string,
  field: 'value' | 'min' | 'max' | 'default',
  value: number
): void {
  const temperature = temperatureConfig(modelId)
  if (!temperature || !(field in temperature)) return
  ;(temperature as unknown as Record<string, number>)[field] = value
}

/**
 * 获取编辑器中按 K 展示的上下文大小；供应商配置内部仍保存字节数。
 * @param modelId 正在编辑的远端模型 ID
 * @returns 上下文大小（K）
 */
function contextWindowK(modelId: string): number {
  const bytes = Number(ensureModelConfig(modelId).contextWindow)
  return Number.isFinite(bytes) && bytes > 0 ? bytes / contextWindowBytesPerK : 0
}

/**
 * 将编辑器输入的 K 值转换为供应商配置保存的字节数。
 * @param modelId 正在编辑的远端模型 ID
 * @param value 上下文大小（K）
 */
function updateContextWindowK(modelId: string, value: number): void {
  if (!Number.isFinite(value)) return
  ensureModelConfig(modelId).contextWindow = Math.round(value * contextWindowBytesPerK)
}

/**
 * 更新模型支持的输入模态，至少保留一种模态。
 * @param modelId 正在编辑的远端模型 ID
 * @param modality 要切换的输入模态
 * @param enabled 是否声明支持该模态
 * @returns 无返回值
 */
function setInputModality(modelId: string, modality: AiInputModality, enabled: boolean): void {
  const config = ensureModelConfig(modelId)
  const current = config.inputModalities?.length ? [...config.inputModalities] : ['text']
  const next = enabled
    ? Array.from(new Set([...current, modality]))
    : current.filter((item) => item !== modality)
  // 至少保留一种输入模态，避免生成无法调用的空能力声明。
  if (next.length === 0) return
  config.inputModalities = next
}

/**
 * 切换模型推理能力声明模式。
 * @param modelId 正在编辑的远端模型 ID
 * @param mode 新的能力声明模式
 * @returns 无返回值
 */
function setReasoningCapabilityMode(modelId: string, mode: ReasoningCapabilityMode): void {
  const config = ensureModelConfig(modelId)
  if (mode === 'provider-default') {
    // 使用显式清除标记覆盖宿主旧配置，避免字段缺失被合并逻辑理解为沿用旧值。
    config.reasoning = null
    return
  }
  if (mode === 'unsupported') {
    config.reasoning = false
    return
  }
  if (!config.reasoning || typeof config.reasoning !== 'object') {
    config.reasoning = {
      protocol: 'auto',
      efforts: { high: 'high' },
      defaultEffort: 'high',
      responseField: 'auto'
    }
  }
}

/**
 * 获取模型当前启用的推理强度，并保持标准档位顺序。
 * @param modelId 正在编辑的远端模型 ID
 * @returns 当前模型已启用的推理强度
 */
function supportedReasoningEfforts(modelId: string): AiReasoningEffort[] {
  const efforts = reasoningConfig(modelId)?.efforts || {}
  return AI_REASONING_EFFORTS.filter((effort) =>
    Object.prototype.hasOwnProperty.call(efforts, effort)
  )
}

/**
 * 更新自定义推理配置的协议字段。
 * @param modelId 正在编辑的远端模型 ID
 * @param protocol 新的推理请求协议
 * @returns 无返回值
 */
function setReasoningProtocol(modelId: string, protocol: AiReasoningProtocol): void {
  const reasoning = reasoningConfig(modelId)
  if (reasoning) reasoning.protocol = protocol
}

/**
 * 更新自定义推理配置的响应字段。
 * @param modelId 正在编辑的远端模型 ID
 * @param responseField 新的推理响应字段
 * @returns 无返回值
 */
function setReasoningResponseField(modelId: string, responseField: AiReasoningResponseField): void {
  const reasoning = reasoningConfig(modelId)
  if (reasoning) reasoning.responseField = responseField
}

/**
 * 更新模型未被调用方覆盖时使用的推理档位。
 * @param modelId 正在编辑的远端模型 ID
 * @param effort 默认推理档位
 * @returns 无返回值
 */
function setDefaultReasoningEffort(modelId: string, effort: AiReasoningEffort): void {
  const reasoning = reasoningConfig(modelId)
  if (reasoning && Object.prototype.hasOwnProperty.call(reasoning.efforts, effort)) {
    reasoning.defaultEffort = effort
  }
}

/**
 * 更新模型支持的推理强度，同时禁止移除当前默认值。
 * @param modelId 正在编辑的远端模型 ID
 * @param effort 要切换的推理强度
 * @param enabled 是否声明模型支持该强度
 * @returns 无返回值
 */
function toggleSupportedReasoningEffort(
  modelId: string,
  effort: AiReasoningEffort,
  enabled: boolean
): void {
  const reasoning = reasoningConfig(modelId)
  if (!reasoning) return

  // 使用新对象触发 Vue 更新，并让未声明档位保持真正缺席。
  const efforts = { ...reasoning.efforts }
  if (enabled) efforts[effort] = effort === 'off' ? null : effort
  else delete efforts[effort]
  reasoning.efforts = efforts
  if (!enabled && reasoning.defaultEffort === effort) {
    // 当前默认档位被移除后，自动切换到剩余的第一个标准档位。
    const fallbackEffort = AI_REASONING_EFFORTS.find((item) =>
      Object.prototype.hasOwnProperty.call(efforts, item)
    )
    if (fallbackEffort) reasoning.defaultEffort = fallbackEffort
    else delete reasoning.defaultEffort
  }
}

/**
 * 更新单个推理档位发送给供应商的协议值。
 * @param modelId 正在编辑的远端模型 ID
 * @param effort 标准推理档位
 * @param wireValue 用户填写的供应商协议值
 * @returns 无返回值
 */
function setReasoningWireValue(
  modelId: string,
  effort: AiReasoningEffort,
  wireValue: string
): void {
  const reasoning = reasoningConfig(modelId)
  if (!reasoning || !Object.prototype.hasOwnProperty.call(reasoning.efforts, effort)) return
  reasoning.efforts = {
    ...reasoning.efforts,
    [effort]: effort === 'off' && !wireValue.trim() ? null : wireValue
  }
}

/**
 * 校验所有自定义推理能力是否能稳定映射到供应商协议。
 * @returns 首个配置错误；全部有效时返回空字符串
 */
function validateReasoningConfigs(): string {
  for (const modelId of selectedModelIds.value) {
    const reasoning = reasoningConfig(modelId)
    if (!reasoning) continue

    const enabledEfforts = Object.entries(reasoning.efforts)
    if (enabledEfforts.length === 0) {
      return `模型 ${modelId} 至少需要选择一个推理强度`
    }
    for (const [effort, wireValue] of enabledEfforts) {
      // “关闭”允许以 null 表示不发送参数，其余档位必须具备实际协议值。
      if (effort !== 'off' && (typeof wireValue !== 'string' || !wireValue.trim())) {
        return `模型 ${modelId} 的“${reasoningEffortLabels[effort as AiReasoningEffort]}”缺少供应商协议值`
      }
    }
    if (!reasoning.defaultEffort) {
      return `模型 ${modelId} 需要选择一个默认推理强度`
    }
    if (!Object.prototype.hasOwnProperty.call(reasoning.efforts, reasoning.defaultEffort)) {
      return `模型 ${modelId} 的默认推理强度不在支持列表中`
    }
  }
  return ''
}

/**
 * 校验所有自定义温度能力是否满足范围约束。
 * @returns 首个配置错误；全部有效时返回空字符串
 */
function validateTemperatureConfigs(): string {
  for (const modelId of selectedModelIds.value) {
    const temperature = temperatureConfig(modelId)
    if (!temperature) continue
    if (temperature.mode === 'fixed') {
      if (!Number.isFinite(temperature.value) || temperature.value < 0 || temperature.value > 2) {
        return `模型 ${modelId} 的固定温度必须在 0 到 2 之间`
      }
      continue
    }
    if (
      ![temperature.min, temperature.max, temperature.default].every(Number.isFinite) ||
      temperature.min < 0 ||
      temperature.max > 2 ||
      temperature.min > temperature.default ||
      temperature.default > temperature.max
    ) {
      return `模型 ${modelId} 的温度范围必须满足 0 ≤ 最小值 ≤ 默认值 ≤ 最大值 ≤ 2`
    }
  }
  return ''
}

/**
 * 将表单转换为供应商保存请求并提交给父视图。
 * @returns 无返回值
 */
function handleSave(): void {
  // 保存前阻止不完整映射进入宿主持久化层，避免配置被静默降级。
  saveError.value = validateReasoningConfigs()
  if (!saveError.value) saveError.value = validateTemperatureConfigs()
  if (saveError.value) return

  const selectedModels: AiProviderModelInput[] = Array.from(selectedModelIds.value).map(
    (modelId) => ({ ...ensureModelConfig(modelId), modelId })
  )

  emit('save', {
    id: props.editingProvider?.id,
    name: formData.value.name,
    apiUrl: formData.value.apiUrl,
    apiKey: formData.value.apiKey,
    apiFormat: formData.value.apiFormat,
    ...(isOrcaProvider.value
      ? {
          presetId: 'orcarouter' as const,
          // 两种认证入口产出的都是同一种普通 OrcaRouter API key。
          ...(pendingCredential.value === undefined ? {} : { credential: pendingCredential.value })
        }
      : {}),
    selectedModels
  })
}

// 组件卸载时释放进行中的登录，避免主进程监听器被遗留占用。
onBeforeUnmount(() => {
  cancelPkceLogin()
})
</script>

<template>
  <DetailPanel :title="isEditing ? '编辑供应商' : '添加供应商'" @back="$emit('back')">
    <div class="editor-wrapper">
      <div class="editor-content">
        <div class="connection-fields">
          <div class="form-group">
            <label class="form-label">供应商名称 *</label>
            <input
              v-model="formData.name"
              type="text"
              class="input"
              placeholder="例如：我的 AI 供应商"
            />
          </div>

          <div class="form-group">
            <label class="form-label">API 格式 *</label>
            <Select
              v-model="apiFormatProxy"
              :options="AI_API_FORMAT_OPTIONS"
              size="medium"
              placeholder="选择 API 格式"
              style="width: 100%"
            />
          </div>

          <div class="form-group full-width-field">
            <label class="form-label">API 地址 *</label>
            <input
              v-model="formData.apiUrl"
              type="url"
              class="input"
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div v-if="isOrcaProvider" class="orca-auth-section">
            <div class="section-header">
              <div>
                <h3>认证方式</h3>
                <span>两种方式最终都保存同一把 OrcaRouter API Key</span>
              </div>
            </div>

            <div v-if="credentialView?.configured" class="orca-credential-status">
              <span class="orca-credential-label">
                {{ credentialView.source === 'pkce' ? 'OrcaRouter - Auth' : 'OrcaRouter - API' }}
              </span>
              <span class="orca-credential-key">{{ credentialView.maskedKey }}</span>
              <span
                class="orca-credential-state"
                :class="{ 'orca-credential-state-warn': credentialView.status === 'needsReauth' }"
              >
                {{ credentialView.status === 'needsReauth' ? '需要重新登录' : '可用' }}
              </span>
              <a class="btn" :href="ORCAROUTER_CONSOLE_URL" target="_blank" rel="noreferrer">
                管理密钥
              </a>
              <button class="btn" type="button" @click="clearCredential">退出登录</button>
            </div>

            <div class="orca-auth-methods" role="radiogroup" aria-label="OrcaRouter 认证方式">
              <div
                class="orca-auth-method"
                :class="{ 'orca-auth-method-active': authMethod === 'api-key' }"
              >
                <input
                  id="orca-auth-api-key"
                  v-model="authMethod"
                  type="radio"
                  name="orca-auth"
                  value="api-key"
                  @change="handleAuthMethodChange"
                />
                <label for="orca-auth-api-key">
                  <strong>OrcaRouter - API</strong>
                  <span>粘贴已有的 sk-orca-… 密钥</span>
                </label>
              </div>
              <div
                class="orca-auth-method"
                :class="{ 'orca-auth-method-active': authMethod === 'pkce' }"
              >
                <input
                  id="orca-auth-pkce"
                  v-model="authMethod"
                  type="radio"
                  name="orca-auth"
                  value="pkce"
                  @change="handleAuthMethodChange"
                />
                <label for="orca-auth-pkce">
                  <strong>OrcaRouter - Auth</strong>
                  <span>使用 OrcaRouter 账号授权（OAuth 2.0 + PKCE）</span>
                </label>
                <button
                  class="btn orca-connect-button"
                  type="button"
                  :disabled="pkceBusy"
                  @click="startPkceLogin"
                >
                  Connect with OrcaRouter
                </button>
              </div>
            </div>

            <div v-if="authMethod === 'api-key'" class="form-group full-width-field">
              <label class="form-label">OrcaRouter API Key *</label>
              <div class="input-wrapper">
                <input
                  v-model="formData.apiKey"
                  type="password"
                  class="input input-with-icon"
                  placeholder="sk-orca-…"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="toggle-password"
                  :title="showPassword ? '隐藏 API 密钥' : '显示 API 密钥'"
                  :aria-label="showPassword ? '隐藏 API 密钥' : '显示 API 密钥'"
                  @click="showPassword = !showPassword"
                >
                  <span aria-hidden="true">{{ showPassword ? '隐藏' : '显示' }}</span>
                </button>
              </div>
              <span class="field-hint">
                密钥保存在 ZTools 现有的供应商配置中，不会写入日志、错误或遥测。
              </span>
              <button class="btn" type="button" @click="saveApiKeyCredential">保存 API Key</button>
            </div>

            <div v-else class="orca-pkce-panel">
              <div class="orca-pkce-flow">
                <label>
                  <input v-model="pkceFlow" type="radio" value="loopback" />
                  浏览器回调（本机 127.0.0.1 随机端口）
                </label>
                <label>
                  <input v-model="pkceFlow" type="radio" value="oob" />
                  一次性代码（在授权页复制后粘贴）
                </label>
              </div>

              <div v-if="pkceSession" class="orca-pkce-session">
                <span class="field-hint">
                  在浏览器中完成授权{pkceSession.flow === 'oob' ? '，然后复制授权页显示的代码' : ''}
                </span>
                <input
                  class="input"
                  type="text"
                  readonly
                  :value="pkceSession.authorizeUrl"
                  aria-label="OrcaRouter 授权地址"
                />
                <div v-if="pkceSession.flow === 'oob'" class="orca-pkce-code">
                  <input
                    v-model="pkceCode"
                    class="input"
                    type="text"
                    placeholder="粘贴授权码"
                    aria-label="OrcaRouter 授权码"
                  />
                  <button class="btn btn-solid" type="button" @click="completePkceLogin">
                    完成登录
                  </button>
                </div>
                <button class="btn" type="button" @click="cancelPkceLogin">取消</button>
              </div>
              <span v-if="pkceError" class="fetch-error">{{ pkceError }}</span>
            </div>
          </div>

          <div v-if="!isOrcaProvider" class="form-group full-width-field">
            <label class="form-label">API 密钥 *</label>
            <div class="input-wrapper">
              <input
                v-model="formData.apiKey"
                :type="showPassword ? 'text' : 'password'"
                class="input input-with-icon"
                placeholder="输入 API 密钥"
              />
              <button
                type="button"
                class="toggle-password"
                :title="showPassword ? '隐藏 API 密钥' : '显示 API 密钥'"
                :aria-label="showPassword ? '隐藏 API 密钥' : '显示 API 密钥'"
                @click="showPassword = !showPassword"
              >
                <svg
                  v-if="showPassword"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M3 3L21 21M10.584 10.587C10.2087 10.9624 9.99775 11.4708 9.99775 12C9.99775 12.5292 10.2087 13.0376 10.584 13.413C10.9594 13.7884 11.4678 13.9993 11.997 13.9993C12.5262 13.9993 13.0346 13.7884 13.41 13.413M10.584 10.587L13.41 13.413M10.584 10.587L8.636 8.636M13.41 13.413L15.364 15.364M8.636 8.636C6.736 9.636 5.264 11.364 4 12C5.272 14.272 8.182 18 12 18C13.09 18 14.09 17.727 15 17.273M8.636 8.636L5 5M15.364 15.364C17.264 14.364 18.736 12.636 20 12C18.728 9.728 15.818 6 12 6C10.91 6 9.91 6.273 9 6.727M15.364 15.364L19 19"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <svg
                  v-else
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M12 5C8.24261 5 5.43602 7.4404 3.76737 9.43934C2.74421 10.6278 2.74421 13.3722 3.76737 14.5607C5.43602 16.5596 8.24261 19 12 19C15.7574 19 18.564 16.5596 20.2326 14.5607C21.2558 13.3722 21.2558 10.6278 20.2326 9.43934C18.564 7.4404 15.7574 5 12 5Z"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="models-section">
          <div class="section-header">
            <div>
              <h3>模型</h3>
              <span>{{ selectedModelIds.size }} 个已选择</span>
            </div>
            <div class="model-dropdown-anchor">
              <button
                class="btn fetch-models-button"
                type="button"
                title="从供应商拉取模型"
                :disabled="fetching"
                data-testid="fetch-models"
                @click="fetchModels"
              >
                <div class="i-z-refresh font-size-16px" :class="{ spinning: fetching }" />
                <span>{{ fetching ? '获取中...' : '从API获取模型' }}</span>
              </button>
            </div>
          </div>

          <div v-if="isOrcaProvider" class="orca-capability-row">
            <label class="orca-capability-field">
              <span>入口能力</span>
              <select v-model="orcaCapability" class="input" data-testid="orca-capability">
                <option value="chat">文本对话 / Agent</option>
                <option value="embedding">向量检索 (embedding)</option>
                <option value="image">图片生成</option>
                <option value="video">视频生成</option>
                <option value="rerank">重排序 (rerank)</option>
              </select>
            </label>
            <label class="orca-capability-field orca-modality-toggle">
              <input
                type="checkbox"
                :checked="requiredModalities.includes('image')"
                data-testid="orca-image-attachment"
                @change="toggleImageModality"
              />
              <span>已附加图片（仅显示声明 image 输入的对话模型）</span>
            </label>
          </div>

          <div v-if="catalogNotice" class="fetch-error" data-testid="orca-catalog-notice">
            {{ catalogNotice }}
          </div>

          <div v-if="fetchError" class="fetch-error">{{ fetchError }}</div>

          <div class="model-tools">
            <input v-model="modelQuery" class="input" type="search" placeholder="搜索已选模型" />
            <div class="manual-row">
              <input
                v-model="manualModelId"
                class="input"
                type="text"
                placeholder="手动输入模型 ID"
                @keyup.enter="addManualModel"
              />
              <button class="btn" type="button" @click="addManualModel">添加</button>
            </div>
          </div>

          <div class="selected-model-list">
            <div
              v-for="modelId in filteredSelectedModelIds"
              :key="modelId"
              class="selected-model-row"
            >
              <div class="selected-model-heading">
                <strong>{{ modelId }}</strong>
                <button
                  type="button"
                  class="icon-btn selected-model-delete"
                  :title="`移除 ${modelId}`"
                  :aria-label="`移除 ${modelId}`"
                  @click="removeSelectedModel(modelId)"
                >
                  <div class="i-z-trash font-size-14px" />
                </button>
              </div>
              <div v-if="selectedModelConfigs[modelId]" class="model-capability-grid">
                <label>
                  <span>上下文（K）</span>
                  <input
                    :value="contextWindowK(modelId)"
                    class="input"
                    type="number"
                    :min="contextWindowMinK"
                    :max="contextWindowMaxK"
                    step="1"
                    @input="
                      updateContextWindowK(
                        modelId,
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                  />
                </label>
                <label>
                  <span>推理能力</span>
                  <select
                    class="input"
                    :value="reasoningCapabilityMode(modelId)"
                    @change="
                      setReasoningCapabilityMode(
                        modelId,
                        ($event.target as HTMLSelectElement).value as ReasoningCapabilityMode
                      )
                    "
                  >
                    <option value="provider-default">供应商默认</option>
                    <option value="unsupported">不支持推理</option>
                    <option value="custom">自定义推理能力</option>
                  </select>
                </label>
                <label>
                  <span>温度能力</span>
                  <select
                    class="input"
                    :value="temperatureCapabilityMode(modelId)"
                    @change="
                      setTemperatureCapabilityMode(
                        modelId,
                        ($event.target as HTMLSelectElement).value as TemperatureCapabilityMode
                      )
                    "
                  >
                    <option value="unsupported">不支持</option>
                    <option value="fixed">固定值</option>
                    <option value="range">可调范围</option>
                  </select>
                </label>
              </div>
              <fieldset class="input-modalities-field">
                <legend>输入模态</legend>
                <label v-for="modality in inputModalityOptions" :key="modality.value">
                  <input
                    type="checkbox"
                    :checked="
                      selectedModelConfigs[modelId].inputModalities?.includes(modality.value)
                    "
                    @change="
                      setInputModality(
                        modelId,
                        modality.value,
                        ($event.target as HTMLInputElement).checked
                      )
                    "
                  />
                  <span>{{ modality.label }}</span>
                </label>
              </fieldset>
              <div
                v-if="temperatureCapabilityMode(modelId) === 'fixed'"
                class="temperature-settings-grid"
              >
                <label>
                  <span>固定温度</span>
                  <input
                    class="input"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    :value="
                      temperatureConfig(modelId)?.mode === 'fixed'
                        ? temperatureConfig(modelId)?.value
                        : ''
                    "
                    @input="
                      updateTemperatureField(
                        modelId,
                        'value',
                        ($event.target as HTMLInputElement).valueAsNumber
                      )
                    "
                  />
                </label>
              </div>
              <div
                v-else-if="temperatureCapabilityMode(modelId) === 'range'"
                class="temperature-settings-grid"
              >
                <label>
                  <span>最小温度</span>
                  <input
                    class="input"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    :value="
                      temperatureConfig(modelId)?.mode === 'range'
                        ? temperatureConfig(modelId)?.min
                        : ''
                    "
                    @input="
                      updateTemperatureField(
                        modelId,
                        'min',
                        ($event.target as HTMLInputElement).valueAsNumber
                      )
                    "
                  />
                </label>
                <label>
                  <span>最大温度</span>
                  <input
                    class="input"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    :value="
                      temperatureConfig(modelId)?.mode === 'range'
                        ? temperatureConfig(modelId)?.max
                        : ''
                    "
                    @input="
                      updateTemperatureField(
                        modelId,
                        'max',
                        ($event.target as HTMLInputElement).valueAsNumber
                      )
                    "
                  />
                </label>
                <label>
                  <span>默认温度</span>
                  <input
                    class="input"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    :value="
                      temperatureConfig(modelId)?.mode === 'range'
                        ? temperatureConfig(modelId)?.default
                        : ''
                    "
                    @input="
                      updateTemperatureField(
                        modelId,
                        'default',
                        ($event.target as HTMLInputElement).valueAsNumber
                      )
                    "
                  />
                </label>
              </div>
              <template v-if="reasoningCapabilityMode(modelId) === 'custom'">
                <div class="reasoning-settings-grid">
                  <label>
                    <span>推理协议</span>
                    <select
                      class="input"
                      :value="reasoningConfig(modelId)?.protocol"
                      @change="
                        setReasoningProtocol(
                          modelId,
                          ($event.target as HTMLSelectElement).value as AiReasoningProtocol
                        )
                      "
                    >
                      <option value="auto">自动</option>
                      <option value="passthrough">不发送参数</option>
                      <option value="openai-compatible">OpenAI 兼容</option>
                      <option value="deepseek">DeepSeek</option>
                    </select>
                  </label>
                  <label>
                    <span>默认强度</span>
                    <select
                      class="input"
                      :value="reasoningConfig(modelId)?.defaultEffort"
                      @change="
                        setDefaultReasoningEffort(
                          modelId,
                          ($event.target as HTMLSelectElement).value as AiReasoningEffort
                        )
                      "
                    >
                      <option
                        v-for="effort in supportedReasoningEfforts(modelId)"
                        :key="effort"
                        :value="effort"
                      >
                        {{ reasoningEffortLabels[effort] }}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span>响应字段</span>
                    <select
                      class="input"
                      :value="reasoningConfig(modelId)?.responseField"
                      @change="
                        setReasoningResponseField(
                          modelId,
                          ($event.target as HTMLSelectElement).value as AiReasoningResponseField
                        )
                      "
                    >
                      <option value="auto">自动</option>
                      <option value="reasoning_content">reasoning_content</option>
                      <option value="reasoning">reasoning</option>
                      <option value="reasoning_text">reasoning_text</option>
                      <option value="reasoning_details">reasoning_details</option>
                    </select>
                  </label>
                </div>
                <fieldset class="reasoning-efforts-field">
                  <legend>支持的推理强度与供应商协议值</legend>
                  <div
                    v-for="effort in AI_REASONING_EFFORTS"
                    :key="effort"
                    class="reasoning-effort-row"
                  >
                    <label>
                      <input
                        type="checkbox"
                        :checked="
                          Object.prototype.hasOwnProperty.call(
                            reasoningConfig(modelId)?.efforts || {},
                            effort
                          )
                        "
                        @change="
                          toggleSupportedReasoningEffort(
                            modelId,
                            effort,
                            ($event.target as HTMLInputElement).checked
                          )
                        "
                      />
                      <span>{{ reasoningEffortLabels[effort] }}</span>
                    </label>
                    <input
                      class="input reasoning-wire-input"
                      type="text"
                      :disabled="
                        !Object.prototype.hasOwnProperty.call(
                          reasoningConfig(modelId)?.efforts || {},
                          effort
                        )
                      "
                      :placeholder="effort === 'off' ? '留空表示不发送参数' : effort"
                      :value="reasoningConfig(modelId)?.efforts[effort] ?? ''"
                      @input="
                        setReasoningWireValue(
                          modelId,
                          effort,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                    />
                  </div>
                </fieldset>
              </template>
            </div>
            <div v-if="selectedModelIds.size === 0" class="model-empty">暂未添加模型</div>
            <div v-else-if="filteredSelectedModelIds.length === 0" class="model-empty">
              没有匹配模型
            </div>
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <span v-if="saveError" class="save-error">{{ saveError }}</span>
        <button class="btn" @click="$emit('back')">取消</button>
        <button
          class="btn btn-solid"
          :disabled="fetching || selectedModelIds.size === 0"
          @click="handleSave"
        >
          保存
        </button>
      </div>
    </div>

    <!-- 模型下拉浮层：锚定在触发按钮右侧，右边缘与按钮对齐。 -->
    <div
      v-if="showModelDialog"
      class="model-dropdown-panel"
      :style="modelDropdownStyle"
      role="listbox"
      aria-expanded="true"
      aria-multiselectable="true"
      :aria-label="`供应商模型列表（共 ${filteredRemoteModels.length} 个）`"
      data-testid="model-dropdown"
    >
      <div class="model-dropdown-header">
        <strong>{{ isOrcaProvider ? 'OrcaRouter 模型' : '供应商模型' }}</strong>
        <span>{{ filteredRemoteModels.length }} / {{ fetchedModels.length }} 个</span>
      </div>
      <input
        v-model="remoteModelQuery"
        class="input dialog-search"
        type="search"
        placeholder="搜索供应商模型"
      />

      <div class="model-picker">
        <label
          v-for="model in filteredRemoteModels"
          :key="model.id"
          class="model-option"
          :class="{ 'model-option-added': selectedModelIds.has(model.id) }"
          role="option"
          :aria-selected="selectedModelIds.has(model.id) || pendingModelIds.has(model.id)"
        >
          <input
            type="checkbox"
            :checked="selectedModelIds.has(model.id) || pendingModelIds.has(model.id)"
            :disabled="selectedModelIds.has(model.id)"
            @change="togglePendingModel(model.id)"
          />
          <span>{{ model.id }}</span>
          <span v-if="selectedModelIds.has(model.id)" class="added-label">已添加</span>
        </label>
        <div v-if="fetchedModels.length === 0" class="model-empty">供应商未返回模型</div>
        <div v-else-if="filteredRemoteModels.length === 0" class="model-empty">没有匹配模型</div>
      </div>

      <div class="model-dropdown-footer">
        <button class="btn" type="button" @click="closeModelDialog">取消</button>
        <button
          class="btn btn-solid"
          type="button"
          :disabled="pendingModelIds.size === 0"
          @click="confirmFetchedModels"
        >
          添加{{ pendingModelIds.size > 0 ? ` ${pendingModelIds.size} 个模型` : '' }}
        </button>
      </div>
    </div>
  </DetailPanel>
</template>

<style scoped>
.editor-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.connection-fields {
  display: grid;
  grid-template-columns: minmax(180px, 0.7fr) minmax(260px, 1.3fr);
  gap: 18px;
}

.full-width-field {
  grid-column: 1 / -1;
}

.form-group {
  min-width: 0;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-with-icon {
  padding-right: 40px;
}

.toggle-password {
  position: absolute;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 0;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s ease;
}

.toggle-password:hover {
  color: var(--text-color);
}

.toggle-password:active {
  transform: scale(0.95);
}

.models-section {
  margin-top: 28px;
  border-top: 1px solid var(--divider-color);
  padding-top: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-header h3 {
  margin: 0 0 3px;
  font-size: 15px;
}

.section-header span {
  color: var(--text-secondary);
  font-size: 12px;
}

.fetch-models-button {
  display: inline-flex;
  min-width: 126px;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.model-tools {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(260px, 1.2fr);
  gap: 12px;
  margin-bottom: 12px;
}

.manual-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.selected-model-list {
  min-height: 120px;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
}

.selected-model-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
  border-bottom: 1px solid var(--divider-color);
  color: var(--text-color);
  font-size: 13px;
}

.selected-model-row:last-child {
  border-bottom: 0;
}

.selected-model-heading {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.selected-model-heading > strong {
  min-width: 0;
  overflow-wrap: anywhere;
}

.model-capability-grid {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(110px, 0.8fr) minmax(180px, 1.2fr) auto;
  gap: 8px;
  align-items: end;
}

.model-capability-grid label {
  display: grid;
  min-width: 0;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}

.model-capability-grid .input {
  min-width: 0;
  height: 32px;
  padding: 4px 7px;
  font-size: 12px;
}

.input-modalities-field {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
}

.input-modalities-field legend {
  padding: 0 4px;
  color: var(--text-secondary);
  font-size: 11px;
}

.input-modalities-field label {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  gap: 4px;
  color: var(--text-color);
  font-size: 11px;
  white-space: nowrap;
}

.input-modalities-field input[type='checkbox'] {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--primary-color);
}

.temperature-settings-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 8px;
}

.temperature-settings-grid label {
  display: grid;
  min-width: 0;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}

.temperature-settings-grid .input {
  min-width: 0;
  height: 32px;
  padding: 4px 7px;
  font-size: 12px;
}

.reasoning-settings-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(140px, 1fr));
  gap: 8px;
}

.reasoning-settings-grid label {
  display: grid;
  min-width: 0;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}

.reasoning-settings-grid .input {
  min-width: 0;
  height: 32px;
  padding: 4px 7px;
  font-size: 12px;
}

.reasoning-efforts-field {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 12px;
  margin: 0;
  padding: 7px 9px;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
}

.reasoning-efforts-field legend {
  padding: 0 4px;
  color: var(--text-secondary);
  font-size: 11px;
}

.reasoning-effort-row {
  display: grid;
  min-width: 0;
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.reasoning-effort-row label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-color);
  font-size: 11px;
  white-space: nowrap;
}

.reasoning-efforts-field input[type='checkbox'] {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--primary-color);
}

.reasoning-wire-input {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 4px 7px;
  font-size: 12px;
}

.selected-model-delete {
  flex-shrink: 0;
}

.selected-model-delete:hover:not(:disabled) {
  background: var(--danger-light-bg);
  color: var(--danger-color);
}

.remote-model-dialog {
  min-width: 0;
}

.dialog-search {
  width: 100%;
  margin-bottom: 12px;
}

.model-dropdown-anchor {
  position: relative;
}

.model-dropdown-panel {
  /* 浮层必须有可见背景与边框，并与触发按钮右边缘对齐。 */
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--color-bg-elevated, #ffffff);
  border: 1px solid var(--color-border, #d0d5dd);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(16, 24, 40, 0.18);
}

.model-dropdown-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 13px;
}

.model-dropdown-header span {
  color: var(--color-text-secondary, #667085);
}

.model-dropdown-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.model-picker {
  /* 选项列表可滚动，浮层本身保持固定尺寸。 */
  max-height: 420px;
  overflow-y: auto;
  background: var(--color-bg-elevated, #ffffff);
  border: 1px solid var(--color-border, #d0d5dd);
  border-radius: 8px;
  padding: 4px;
  min-height: 220px;
  max-height: min(360px, 50vh);
  overflow-y: auto;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
}

.orca-auth-section {
  margin-bottom: 16px;
}

.orca-auth-methods {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.orca-auth-method {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border, #d0d5dd);
  border-radius: 8px;
  background: var(--color-bg-elevated, #fff);
}

.orca-auth-method-active {
  border-color: var(--color-primary, #4f46e5);
}

.orca-auth-method label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  cursor: pointer;
}

.orca-auth-method label span {
  font-size: 12px;
  color: var(--color-text-secondary, #667085);
}

.orca-auth-method input[type='radio'] {
  width: 16px;
  height: 16px;
}

.orca-connect-button {
  white-space: nowrap;
}

.orca-credential-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 13px;
}

.orca-credential-key {
  font-family: monospace;
  color: var(--color-text-secondary, #667085);
}

.orca-credential-state-warn {
  color: #d97706;
  font-weight: 600;
}

.orca-pkce-panel {
  display: grid;
  gap: 8px;
}

.orca-pkce-flow {
  display: flex;
  gap: 16px;
  font-size: 13px;
}

.orca-pkce-session {
  display: grid;
  gap: 8px;
}

.orca-pkce-code {
  display: flex;
  gap: 8px;
}

.field-hint {
  font-size: 12px;
  color: var(--color-text-secondary, #667085);
}

.orca-capability-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 10px;
}

.orca-capability-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.orca-capability-field .input {
  width: auto;
  min-width: 180px;
}

.orca-modality-toggle {
  cursor: pointer;
}

.model-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--divider-color);
  color: var(--text-color);
  font-size: 13px;
  cursor: pointer;
}

.model-option:last-child {
  border-bottom: 0;
}

.model-option:hover {
  background: var(--hover-bg);
}

.model-option-added {
  cursor: default;
  opacity: 0.65;
}

.model-option-added:hover {
  background: transparent;
}

.model-option span {
  overflow-wrap: anywhere;
}

.added-label {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.fetch-error {
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--danger-light-bg);
  color: var(--danger-color);
  font-size: 12px;
}

.model-empty {
  display: flex;
  min-height: 218px;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.selected-model-list .model-empty {
  min-height: 118px;
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--divider-color);
}

.save-error {
  min-width: 0;
  margin-right: auto;
  color: var(--danger-color);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 700px) {
  .connection-fields,
  .model-tools,
  .reasoning-settings-grid,
  .reasoning-efforts-field,
  .temperature-settings-grid {
    grid-template-columns: 1fr;
  }

  .connection-fields .full-width-field {
    grid-column: auto;
  }

  .model-picker {
    max-height: 46vh;
  }
}
</style>
