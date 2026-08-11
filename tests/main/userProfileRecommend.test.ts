import { describe, expect, it, vi } from 'vitest'

// userProfile.ts 顶部依赖 databaseAPI → lmdb → electron，单测环境无 electron，mock 掉。
vi.mock('../../src/main/api/shared/database', () => ({
  default: { dbGet: vi.fn(), dbPut: vi.fn() }
}))

import { matchPluginsByScenarios } from '../../src/main/core/userPreferences/userProfile'

interface FakePlugin {
  name: string
  categoryTitle?: string | null
}

describe('matchPluginsByScenarios', () => {
  const plugins: FakePlugin[] = [
    { name: '截图工具', categoryTitle: '效率办公' },
    { name: '代码片段', categoryTitle: '开发编程' },
    { name: '翻译词典', categoryTitle: '学习翻译' },
    { name: '无分类', categoryTitle: null },
    { name: '未分类', categoryTitle: undefined }
  ]

  it('returns empty when no scenarios are given', () => {
    expect(matchPluginsByScenarios(plugins, [])).toEqual([])
  })

  it('matches plugins by scenario keywords in category title', () => {
    const matched = matchPluginsByScenarios(plugins, ['productivity'])
    expect(matched.map((p) => p.name)).toEqual(['截图工具'])
  })

  it('matches multiple scenarios and preserves source order', () => {
    const matched = matchPluginsByScenarios(plugins, ['development', 'productivity'])
    expect(matched.map((p) => p.name)).toEqual(['截图工具', '代码片段'])
  })

  it('handles null/undefined categoryTitle without matching', () => {
    const matched = matchPluginsByScenarios(plugins, ['development'])
    expect(matched.map((p) => p.name)).toEqual(['代码片段'])
  })

  it('returns empty when no plugin matches the scenario', () => {
    expect(matchPluginsByScenarios(plugins, ['game'])).toEqual([])
  })
})
