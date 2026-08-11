import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getProfileMock, SCENARIO_KEYWORDS } = vi.hoisted(() => ({
  getProfileMock: vi.fn(),
  SCENARIO_KEYWORDS: {
    productivity: ['效率', '生产力', '办公'],
    development: ['开发', '编程', '代码']
  }
}))

vi.mock('../../src/main/api/shared/database', () => ({
  default: { dbGet: vi.fn(), dbPut: vi.fn() }
}))

vi.mock('../../src/main/utils/httpRequest', () => ({
  httpGet: vi.fn()
}))

vi.mock('../../src/main/api/renderer/pluginMarketConfig', () => ({
  getPluginMarketApiBase: vi.fn(() => 'http://test'),
  requestPluginMarket: vi.fn(),
  PluginMarketAuthMode: { OPTIONAL: 'optional', REQUIRED: 'required' },
  PluginMarketAuthRequiredError: class PluginMarketAuthRequiredError extends Error {}
}))

vi.mock('../../src/main/core/userPreferences/userProfile', () => ({
  getProfile: getProfileMock,
  SCENARIO_KEYWORDS,
  matchPluginsByScenarios: <T extends { categoryTitle?: string | null }>(
    plugins: T[],
    scenarios: string[]
  ): T[] =>
    plugins.filter((plugin) =>
      scenarios.some((scenario) => {
        const title = String(plugin.categoryTitle ?? '').toLowerCase()
        return (SCENARIO_KEYWORDS[scenario] ?? []).some((keyword) => title.includes(keyword))
      })
    )
}))

import { PluginMarketAPI } from '../../src/main/api/renderer/pluginMarket'

interface TestPlugin {
  name: string
  categoryTitle: string
}

interface TestCategory {
  id: number
  title: string
  plugins: TestPlugin[]
}

interface TestMarketData {
  categories: TestCategory[]
}

const api = new PluginMarketAPI() as unknown as {
  buildPersonalizedRecommendations: (marketData: TestMarketData, limit: number) => TestPlugin[]
}

function buildMarketData(): TestMarketData {
  return {
    categories: [
      { id: 1, title: '效率办公', plugins: [{ name: 'todo-app', categoryTitle: '效率办公' }] },
      { id: 2, title: '开发编程', plugins: [{ name: 'code-snippet', categoryTitle: '开发编程' }] },
      { id: 3, title: '其他', plugins: [{ name: 'misc', categoryTitle: '其他' }] }
    ]
  }
}

describe('buildPersonalizedRecommendations', () => {
  beforeEach(() => {
    getProfileMock.mockReset()
  })

  it('returns empty when profile is not completed', () => {
    getProfileMock.mockReturnValue({ completed: false, scenarios: ['productivity'] })
    expect(api.buildPersonalizedRecommendations(buildMarketData(), 10)).toEqual([])
  })

  it('matches plugins by category title matching scenario keywords', () => {
    getProfileMock.mockReturnValue({ completed: true, scenarios: ['productivity'] })
    expect(api.buildPersonalizedRecommendations(buildMarketData(), 10)).toEqual([
      { name: 'todo-app', categoryTitle: '效率办公' }
    ])
  })

  it('returns plugins of all matching categories in source order', () => {
    getProfileMock.mockReturnValue({
      completed: true,
      scenarios: ['productivity', 'development']
    })
    expect(api.buildPersonalizedRecommendations(buildMarketData(), 10).map((p) => p.name)).toEqual([
      'todo-app',
      'code-snippet'
    ])
  })

  it('respects the limit', () => {
    getProfileMock.mockReturnValue({
      completed: true,
      scenarios: ['productivity', 'development']
    })
    expect(api.buildPersonalizedRecommendations(buildMarketData(), 1).map((p) => p.name)).toEqual([
      'todo-app'
    ])
  })
})
