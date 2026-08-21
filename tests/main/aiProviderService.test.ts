import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbGet = vi.hoisted(() => vi.fn())
const mockDbPut = vi.hoisted(() => vi.fn())
const mockModelsList = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/api/shared/database.js', () => ({
  default: {
    dbGet: mockDbGet,
    dbPut: mockDbPut
  }
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    models = { list: mockModelsList }
  }
}))

import aiProviderService, { migrateLegacyAiModels } from '../../src/main/core/aiProviderService'
import type { AiProviderStore } from '../../src/shared/aiProviderShared'

describe('aiProviderService', () => {
  let stored: AiProviderStore | null

  beforeEach(() => {
    vi.clearAllMocks()
    stored = null
    mockDbGet.mockImplementation(() => stored)
    mockDbPut.mockImplementation((_key: string, value: AiProviderStore) => {
      stored = value
      return { ok: true }
    })
  })

  it('groups legacy models by connection and preserves old model ids as selection refs', () => {
    const ids = ['provider-a', 'provider-b']
    const migrated = migrateLegacyAiModels(
      [
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          apiUrl: 'https://one.example/v1/',
          apiKey: 'key-one'
        },
        {
          id: 'gpt-4o-mini',
          label: 'GPT-4o mini',
          apiUrl: 'https://one.example/v1',
          apiKey: 'key-one'
        },
        {
          id: 'deepseek-chat',
          label: 'DeepSeek',
          apiUrl: 'https://two.example/v1',
          apiKey: 'key-two'
        }
      ],
      () => ids.shift() || 'fallback-id'
    )

    expect(migrated.version).toBe(2)
    expect(migrated.providers).toHaveLength(2)
    expect(migrated.providers[0]).toMatchObject({
      id: 'provider-a',
      name: 'one.example',
      apiUrl: 'https://one.example/v1',
      enabled: true
    })
    expect(migrated.providers[0].selectedModels.map((model) => model.ref)).toEqual([
      'gpt-4o',
      'gpt-4o-mini'
    ])
    expect(migrated.providers.every((provider) => provider.apiFormat === 'openai-chat')).toBe(true)
    expect('defaultModelRef' in migrated).toBe(false)
  })

  it('allows the same remote model id under different providers and resolves by opaque ref', () => {
    expect(
      aiProviderService.addProvider({
        name: '供应商 1',
        apiUrl: 'https://one.example/v1',
        apiKey: 'key-one',
        selectedModels: [{ modelId: 'gpt-4o' }]
      }).success
    ).toBe(true)
    expect(
      aiProviderService.addProvider({
        name: '供应商 2',
        apiUrl: 'https://two.example/v1',
        apiKey: 'key-two',
        selectedModels: [{ modelId: 'gpt-4o' }]
      }).success
    ).toBe(true)

    const choices = aiProviderService.getModelChoices()
    expect(choices.map((choice) => choice.id)).toEqual(['供应商 1 - gpt-4o', '供应商 2 - gpt-4o'])
    expect(choices.map((choice) => choice.label)).toEqual([
      '供应商 1 - gpt-4o',
      '供应商 2 - gpt-4o'
    ])
    expect(choices[0].id).not.toBe(choices[1].id)
    expect(choices[0].value).not.toBe(choices[1].value)
    expect(aiProviderService.resolveModel(choices[1].id)?.provider.name).toBe('供应商 2')
    expect(aiProviderService.resolveModel(choices[1].value)?.provider.name).toBe('供应商 2')
    expect(() => aiProviderService.resolveModel('gpt-4o')).toThrow('存在多个供应商')
  })

  it('preserves model refs while updating an existing provider', () => {
    aiProviderService.addProvider({
      name: '供应商',
      apiUrl: 'https://example.com/v1',
      apiKey: 'secret',
      selectedModels: [{ modelId: 'model-a' }, { modelId: 'model-b' }]
    })
    const provider = stored!.providers[0]
    const originalRef = provider.selectedModels[0].ref
    const oldPublicId = aiProviderService.getModelChoices()[0].id

    const result = aiProviderService.updateProvider({
      id: provider.id,
      name: '新名称',
      apiUrl: provider.apiUrl,
      apiKey: provider.apiKey,
      selectedModels: [{ modelId: 'model-a' }, { modelId: 'model-c' }]
    })

    expect(result.success).toBe(true)
    expect(stored!.providers[0].selectedModels[0]).toMatchObject({
      ref: originalRef,
      modelId: 'model-a',
      aliases: [oldPublicId]
    })
    expect(aiProviderService.getModelChoices()[0]).toMatchObject({
      id: '新名称 - model-a',
      value: originalRef,
      label: '新名称 - model-a',
      contextWindow: 262_144,
      inputModalities: ['text']
    })
    expect(aiProviderService.resolveModel(oldPublicId)?.provider.name).toBe('新名称')
    expect(aiProviderService.resolveModel(originalRef)?.provider.name).toBe('新名称')
    expect(stored!.providers[0].selectedModels.some((model) => model.modelId === 'model-b')).toBe(
      false
    )
  })

  it('hides disabled providers from plugins and rejects their saved model ids', () => {
    aiProviderService.addProvider({
      name: '供应商 1',
      apiUrl: 'https://one.example/v1',
      apiKey: 'key-one',
      selectedModels: [{ modelId: 'model-a' }]
    })
    aiProviderService.addProvider({
      name: '供应商 2',
      apiUrl: 'https://two.example/v1',
      apiKey: 'key-two',
      selectedModels: [{ modelId: 'model-b' }]
    })
    const [firstChoice, secondChoice] = aiProviderService.getModelChoices()
    const [firstProvider, secondProvider] = stored!.providers

    expect(aiProviderService.setProviderEnabled(firstProvider.id, false).success).toBe(true)
    expect(
      aiProviderService.updateProvider({
        id: firstProvider.id,
        name: firstProvider.name,
        apiUrl: firstProvider.apiUrl,
        apiKey: firstProvider.apiKey,
        selectedModels: [{ modelId: 'model-a' }]
      }).success
    ).toBe(true)
    expect(stored!.providers[0].enabled).toBe(false)
    expect(aiProviderService.getModelChoices()).toEqual([secondChoice])
    expect(aiProviderService.resolveModel(firstChoice.id)).toBeNull()
    expect(aiProviderService.resolveModel(firstChoice.value)).toBeNull()
    expect(aiProviderService.resolveModel()?.provider.id).toBe(secondProvider.id)

    expect(aiProviderService.setProviderEnabled(secondProvider.id, false).success).toBe(true)
    expect(aiProviderService.getModelChoices()).toEqual([])
    expect(aiProviderService.resolveModel()).toBeNull()
  })

  it('normalizes supported reasoning efforts and returns an isolated list to plugins', () => {
    aiProviderService.addProvider({
      name: '推理供应商',
      apiUrl: 'https://reasoning.example/v1',
      apiKey: 'secret',
      selectedModels: [
        {
          modelId: 'reasoning-model',
          reasoning: {
            protocol: 'openai-compatible',
            efforts: { max: 'ultra', low: 'low', medium: 'medium' },
            defaultEffort: 'medium',
            responseField: 'auto'
          }
        }
      ]
    })

    const firstChoice = aiProviderService.getModelChoices()[0]
    expect(firstChoice.reasoning).toEqual({
      efforts: [
        { id: 'low', label: '低' },
        { id: 'medium', label: '中' },
        { id: 'max', label: '最高' }
      ],
      defaultEffort: 'medium'
    })

    // 插件修改返回值不得污染宿主持久化配置或后续查询。
    firstChoice.reasoning!.efforts.push({ id: 'xhigh', label: '极高' })
    expect(aiProviderService.getModelChoices()[0].reasoning?.efforts).toEqual([
      { id: 'low', label: '低' },
      { id: 'medium', label: '中' },
      { id: 'max', label: '最高' }
    ])
  })

  it('does not expose a selector for unknown or explicitly unsupported reasoning', () => {
    aiProviderService.addProvider({
      name: '能力三态供应商',
      apiUrl: 'https://tri-state.example/v1',
      apiKey: 'secret',
      selectedModels: [
        { modelId: 'unknown-model' },
        { modelId: 'unsupported-model', reasoning: false }
      ]
    })

    const choices = aiProviderService.getModelChoices()
    expect(choices).toHaveLength(2)
    expect(choices[0]).not.toHaveProperty('reasoning')
    expect(choices[1]).not.toHaveProperty('reasoning')
    expect(stored!.providers[0].selectedModels[1].reasoning).toBe(false)
  })

  it('clears an existing reasoning capability through the explicit null marker', () => {
    aiProviderService.addProvider({
      name: '可清除推理供应商',
      apiUrl: 'https://clear-reasoning.example/v1',
      apiKey: 'secret',
      selectedModels: [
        {
          modelId: 'reasoning-model',
          reasoning: {
            protocol: 'openai-compatible',
            efforts: { high: 'high' },
            defaultEffort: 'high',
            responseField: 'auto'
          }
        }
      ]
    })
    const provider = stored!.providers[0]

    const result = aiProviderService.updateProvider({
      id: provider.id,
      name: provider.name,
      apiUrl: provider.apiUrl,
      apiKey: provider.apiKey,
      selectedModels: [{ modelId: 'reasoning-model', reasoning: null }]
    })

    expect(result.success).toBe(true)
    expect(stored!.providers[0].selectedModels[0]).not.toHaveProperty('reasoning')
    expect(aiProviderService.getModelChoices()[0]).not.toHaveProperty('reasoning')
  })

  it('rejects duplicate provider names that would create ambiguous public ids', () => {
    aiProviderService.addProvider({
      name: '中转站',
      apiUrl: 'https://one.example/v1',
      apiKey: 'key-one',
      selectedModels: [{ modelId: 'model-a' }]
    })

    const result = aiProviderService.addProvider({
      name: ' 中转站 ',
      apiUrl: 'https://two.example/v1',
      apiKey: 'key-two',
      selectedModels: [{ modelId: 'model-a' }]
    })

    expect(result).toEqual({ success: false, error: '供应商名称已存在，请使用不同名称' })
    expect(stored!.providers).toHaveLength(1)
  })

  it('normalizes provider names saved by the earlier version before exposing public ids', () => {
    stored = {
      version: 2,
      defaultModelRef: 'ref-one',
      providers: [
        {
          id: 'provider-one',
          name: '中转站',
          apiUrl: 'https://one.example/v1',
          apiKey: 'key-one',
          selectedModels: [{ ref: 'ref-one', modelId: 'model-a', label: 'Model A' }]
        },
        {
          id: 'provider-two',
          name: '中转站',
          apiUrl: 'https://two.example/v1',
          apiKey: 'key-two',
          selectedModels: [{ ref: 'ref-two', modelId: 'model-a', label: 'Model A' }]
        }
      ]
    } as AiProviderStore

    expect(aiProviderService.getModelChoices().map((choice) => choice.id)).toEqual([
      '中转站 - model-a',
      '中转站 (2) - model-a'
    ])
    expect(stored.providers[1].selectedModels[0].aliases).toEqual(['中转站 - model-a'])
    expect(stored.providers.every((provider) => provider.enabled)).toBe(true)
    expect(stored.providers.every((provider) => provider.apiFormat === 'openai-chat')).toBe(true)
    expect('defaultModelRef' in stored).toBe(false)
    expect('label' in stored.providers[0].selectedModels[0]).toBe(false)
    expect('label' in stored.providers[1].selectedModels[0]).toBe(false)
    expect(mockDbPut).toHaveBeenCalled()
  })

  it('deduplicates and sorts models returned by an OpenAI-compatible endpoint', async () => {
    mockModelsList.mockResolvedValue({
      data: [{ id: 'model-z' }, { id: 'model-a' }, { id: 'model-a' }, { id: '' }]
    })

    await expect(
      aiProviderService.fetchRemoteModels('https://example.com/v1/', 'secret')
    ).resolves.toEqual([{ id: 'model-a' }, { id: 'model-z' }])
  })

  it('persists the api format and defaults legacy values to OpenAI Chat Completions', () => {
    // 未指定接口格式的新建供应商回退为默认格式。
    expect(
      aiProviderService.addProvider({
        name: '默认供应商',
        apiUrl: 'https://one.example/v1',
        apiKey: 'key-one',
        selectedModels: [{ modelId: 'model-a' }]
      }).success
    ).toBe(true)
    expect(stored!.providers[0].apiFormat).toBe('openai-chat')

    // 显式指定 Anthropic Messages 的供应商原样保存。
    expect(
      aiProviderService.addProvider({
        name: 'Anthropic 供应商',
        apiUrl: 'https://two.example/v1',
        apiKey: 'key-two',
        apiFormat: 'anthropic-messages',
        selectedModels: [{ modelId: 'model-a' }]
      }).success
    ).toBe(true)
    expect(stored!.providers[1].apiFormat).toBe('anthropic-messages')

    // 更新时可以切换为 OpenAI Responses API。
    const provider = stored!.providers[1]
    expect(
      aiProviderService.updateProvider({
        id: provider.id,
        name: provider.name,
        apiUrl: provider.apiUrl,
        apiKey: provider.apiKey,
        apiFormat: 'openai-responses',
        selectedModels: [{ modelId: 'model-a' }]
      }).success
    ).toBe(true)
    expect(stored!.providers[1].apiFormat).toBe('openai-responses')

    // 历史供应商保存了非法接口格式时，读取时回退为默认的 OpenAI Chat Completions。
    stored = {
      version: 2,
      providers: [
        {
          id: provider.id,
          name: provider.name,
          apiUrl: provider.apiUrl,
          apiKey: provider.apiKey,
          apiFormat: 'bogus-format',
          enabled: true,
          selectedModels: [{ ref: 'ref-a', modelId: 'model-a' }]
        }
      ]
    } as AiProviderStore

    expect(aiProviderService.getModelChoices()[0].value).toBe('ref-a')
    expect(stored!.providers[0].apiFormat).toBe('openai-chat')
    expect(mockDbPut).toHaveBeenCalled()
  })
})
