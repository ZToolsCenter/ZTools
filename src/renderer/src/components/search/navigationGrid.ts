import type { MainPushGroup } from '../../composables/useMainPushResults'

export interface NavigationGridRow {
  type: string
  items: any[]
  mainPushGroup?: MainPushGroup
}

interface BuildAggregateNavigationGridOptions {
  hasSearchContent: boolean
  bestSearchResults: any[]
  bestMatches: any[]
  recommendations: any[]
  mainPushGroups: MainPushGroup[]
  windowMatchedActions: any[]
  displayApps: any[]
  pinnedApps: any[]
  showRecentInSearch: boolean
  recentExpanded: boolean
  pinnedExpanded: boolean
  searchResultsExpanded: boolean
  bestMatchesExpanded: boolean
  recommendationsExpanded: boolean
  recentRows: number
  pinnedRows: number
}

function getVisibleItems(items: any[], expanded: boolean, defaultVisibleRows: number): any[] {
  const defaultVisibleCount = 9 * defaultVisibleRows
  if (items.length <= defaultVisibleCount) return items
  return expanded ? items : items.slice(0, defaultVisibleCount)
}

function appendGridRows(rows: NavigationGridRow[], type: string, items: any[], columns = 9): void {
  for (let index = 0; index < items.length; index += columns) {
    rows.push({ type, items: items.slice(index, index + columns) })
  }
}

export function buildAggregateNavigationGrid(
  options: BuildAggregateNavigationGridOptions
): NavigationGridRow[] {
  const rows: NavigationGridRow[] = []

  if (options.hasSearchContent) {
    appendGridRows(
      rows,
      'bestSearch',
      getVisibleItems(options.bestSearchResults, options.searchResultsExpanded, 2)
    )
    appendGridRows(
      rows,
      'bestMatch',
      getVisibleItems(options.bestMatches, options.bestMatchesExpanded, 2)
    )
    appendGridRows(
      rows,
      'recommendation',
      getVisibleItems(options.recommendations, options.recommendationsExpanded, 2)
    )

    for (const group of options.mainPushGroups) {
      const type = `mainPush:${group.featureKey}`
      for (const item of group.items) {
        rows.push({ type, items: [item], mainPushGroup: group })
      }
    }

    appendGridRows(rows, 'window', options.windowMatchedActions)
    return rows
  }

  if (options.showRecentInSearch) {
    appendGridRows(
      rows,
      'apps',
      getVisibleItems(options.displayApps, options.recentExpanded, options.recentRows)
    )
  }
  appendGridRows(
    rows,
    'pinned',
    getVisibleItems(options.pinnedApps, options.pinnedExpanded, options.pinnedRows)
  )
  appendGridRows(rows, 'window', options.windowMatchedActions)

  return rows
}
