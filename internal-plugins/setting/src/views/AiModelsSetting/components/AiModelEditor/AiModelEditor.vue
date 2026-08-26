<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BaseDialog, DetailPanel, Select, type SelectModelValue } from '@/components'
import {
  AI_API_FORMAT_OPTIONS,
  AI_REASONING_EFFORTS,
  DEFAULT_AI_API_FORMAT,
  type AiApiFormat,
  type AiReasoningConfig,
  type AiReasoningEffort,
  type AiReasoningProtocol,
  type AiReasoningResponseField,
  type AiProvider,
  type AiProviderInput,
  type AiProviderModelInput,
  type AiRemoteModel,
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
const formData = ref({
  name: '',
  apiUrl: '',
  apiKey: '',
  apiFormat: DEFAULT_AI_API_FORMAT as AiApiFormat
})

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
    (provider?.selectedModels || []).map((model) => [
      model.modelId,
      { modelId: model.modelId, ...normalizeAiModelCapabilities(model) }
    ])
  )
  pendingModelIds.value = new Set()
  modelQuery.value = ''
  remoteModelQuery.value = ''
  manualModelId.value = ''
  fetchError.value = ''
  saveError.value = ''
  showModelDialog.value = false
  showPassword.value = false
}

watch(() => props.editingProvider, resetEditor, { immediate: true })

/**
 * 从当前供应商的 OpenAI 兼容接口拉取模型并打开选择弹窗。
 * @returns 操作完成后结束的 Promise
 */
async function fetchModels(): Promise<void> {
  if (!formData.value.apiUrl.trim() || !formData.value.apiKey.trim()) {
    fetchError.value = '请先填写 API 地址和密钥'
    return
  }

  fetching.value = true
  fetchError.value = ''
  try {
    const result = await window.ztools.internal.aiProviders.fetchModels(
      formData.value.apiUrl,
      formData.value.apiKey
    )
    if (!result.success || !result.data) {
      fetchError.value = result.error || '获取模型列表失败'
      return
    }

    // 拉取结果仅用于本次弹窗选择，不直接改变已选模型。
    fetchedModels.value = [...result.data].sort((left, right) => left.id.localeCompare(right.id))
    pendingModelIds.value = new Set()
    remoteModelQuery.value = ''
    showModelDialog.value = true
  } catch (error) {
    fetchError.value = error instanceof Error ? error.message : '获取模型列表失败'
  } finally {
    fetching.value = false
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

/**
 * 关闭远端模型选择弹窗并清理临时选择。
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
      ...normalizeAiModelCapabilities({ modelId })
    }
  }
  return selectedModelConfigs.value[modelId]
}

type ReasoningCapabilityMode = 'provider-default' | 'unsupported' | 'custom'

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
 * 将表单转换为供应商保存请求并提交给父视图。
 * @returns 无返回值
 */
function handleSave(): void {
  // 保存前阻止不完整映射进入宿主持久化层，避免配置被静默降级。
  saveError.value = validateReasoningConfigs()
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
    selectedModels
  })
}
</script>

<template>
  <DetailPanel :title="isEditing ? '编辑供应商' : '添加供应商'" @back="$emit('back')">
    <div class="editor-wrapper">
      <div class="editor-content">
        <div class="connection-fields">
          <div class="form-group">
            <label class="form-label">供应商名称 *</label>
            <input v-model="formData.name" type="text" class="input" placeholder="例如：中转站 1" />
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

          <div class="form-group full-width-field">
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
            <button
              class="btn fetch-models-button"
              type="button"
              title="从供应商拉取模型"
              :disabled="fetching"
              @click="fetchModels"
            >
              <div class="i-z-refresh font-size-16px" :class="{ spinning: fetching }" />
              <span>{{ fetching ? '获取中...' : '从API获取模型' }}</span>
            </button>
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
                  <span>上下文</span>
                  <input
                    v-model.number="selectedModelConfigs[modelId].contextWindow"
                    class="input"
                    type="number"
                    min="4096"
                    max="2000000"
                    step="1024"
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
                <label class="image-capability-toggle"
                  ><input
                    type="checkbox"
                    :checked="selectedModelConfigs[modelId].inputModalities?.includes('image')"
                    @change="
                      selectedModelConfigs[modelId].inputModalities = (
                        $event.target as HTMLInputElement
                      ).checked
                        ? ['text', 'image']
                        : ['text']
                    "
                  /><span>支持图片</span></label
                >
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

    <BaseDialog
      v-model:visible="showModelDialog"
      title="选择供应商模型"
      :subtitle="`共 ${fetchedModels.length} 个模型`"
      max-width="620px"
      @close="closeModelDialog"
    >
      <div class="remote-model-dialog">
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
      </div>

      <template #footer>
        <button class="btn" type="button" @click="closeModelDialog">取消</button>
        <button
          class="btn btn-solid"
          type="button"
          :disabled="pendingModelIds.size === 0"
          @click="confirmFetchedModels"
        >
          添加{{ pendingModelIds.size > 0 ? ` ${pendingModelIds.size} 个模型` : '' }}
        </button>
      </template>
    </BaseDialog>
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

.image-capability-toggle {
  display: flex !important;
  min-height: 32px;
  align-items: center;
  grid-template-columns: auto auto;
  white-space: nowrap;
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

.model-picker {
  min-height: 220px;
  max-height: min(360px, 50vh);
  overflow-y: auto;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
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
  .reasoning-efforts-field {
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
