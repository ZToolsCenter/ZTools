import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useNavigation } from '../../src/renderer/src/composables/useNavigation'
import {
  buildAggregateNavigationGrid,
  type NavigationGridRow
} from '../../src/renderer/src/components/search/navigationGrid'

function buildGrid(overrides: Record<string, unknown> = {}): NavigationGridRow[] {
  return buildAggregateNavigationGrid({
    hasSearchContent: true,
    bestSearchResults: [{ id: 'first' }],
    bestMatches: [],
    recommendations: [],
    mainPushGroups: [],
    windowMatchedActions: [{ id: 'window' }],
    displayApps: [],
    pinnedApps: [],
    showRecentInSearch: true,
    recentExpanded: false,
    pinnedExpanded: false,
    searchResultsExpanded: false,
    bestMatchesExpanded: false,
    recommendationsExpanded: false,
    recentRows: 2,
    pinnedRows: 2,
    ...overrides
  })
}

function keyboardEvent(key: string): KeyboardEvent {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

describe('aggregate navigation grid', () => {
  it('keeps mainPush before window to match the rendered section order', () => {
    const grid = buildGrid({
      mainPushGroups: [
        {
          featureKey: 'plugin:feature',
          pluginPath: '/plugin',
          pluginName: 'plugin',
          pluginLogo: '',
          featureCode: 'feature',
          featureExplain: 'feature',
          matchedCmdType: 'text',
          items: [{ id: 'push' }]
        }
      ]
    })

    expect(grid.map((row) => row.type)).toEqual(['bestSearch', 'mainPush:plugin:feature', 'window'])
  })

  it('moves from the first item to the visually last window item with one ArrowUp', () => {
    const grid = ref(buildGrid())
    const mode = ref<'aggregate' | 'list'>('aggregate')
    const navigation = useNavigation(mode, grid)

    expect(navigation.selectedItem.value.id).toBe('first')

    navigation.handleKeydown(keyboardEvent('ArrowUp'), vi.fn())
    expect(navigation.selectedItem.value.id).toBe('window')

    navigation.handleKeydown(keyboardEvent('ArrowDown'), vi.fn())
    expect(navigation.selectedItem.value.id).toBe('first')
  })

  it('excludes recent items when showRecentInSearch is disabled', () => {
    const grid = buildGrid({
      hasSearchContent: false,
      displayApps: [{ id: 'recent' }],
      pinnedApps: [{ id: 'pinned' }],
      showRecentInSearch: false
    })

    expect(grid.map((row) => row.type)).toEqual(['pinned', 'window'])
    expect(grid.flatMap((row) => row.items).map((item) => item.id)).toEqual(['pinned', 'window'])
  })

  it('includes recent items when showRecentInSearch is enabled', () => {
    const grid = buildGrid({
      hasSearchContent: false,
      displayApps: [{ id: 'recent' }],
      pinnedApps: [{ id: 'pinned' }],
      showRecentInSearch: true
    })

    expect(grid.map((row) => row.type)).toEqual(['apps', 'pinned', 'window'])
  })
})
