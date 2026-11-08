import { describe, expect, it } from 'vitest'
import {
  getDefaultUpdateSourceID,
  getGitHubReleaseUrl,
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_RELEASES_URL,
  GITHUB_REPOSITORY_URL,
  isInAppUpdateSource
} from '../../src/shared/updateSource'

describe('GitHub update source', () => {
  it('exposes the repository and Release entry URLs', () => {
    expect(GITHUB_REPOSITORY_URL).toBe('https://github.com/ZToolsCenter/ZTools')
    expect(GITHUB_RELEASES_URL).toBe('https://github.com/ZToolsCenter/ZTools/releases')
    expect(GITHUB_LATEST_RELEASE_URL).toBe('https://github.com/ZToolsCenter/ZTools/releases/latest')
  })

  it('builds latest and version-specific Release page URLs', () => {
    expect(getGitHubReleaseUrl()).toBe(GITHUB_LATEST_RELEASE_URL)
    expect(getGitHubReleaseUrl('3.1.0-beta.2')).toBe(
      'https://github.com/ZToolsCenter/ZTools/releases/tag/v3.1.0-beta.2'
    )
  })

  it('prefers the official mirror when available, then GitHub', () => {
    expect(
      getDefaultUpdateSourceID([
        { id: 2, platformName: '夸克网盘', isDirect: false },
        { id: 1, platformName: 'GitHub', isDirect: true, feedUrl: 'https://example.com/feed/' },
        { id: -3, platformName: '官方源', isDirect: true, feedUrl: 'https://example.com/official/' }
      ])
    ).toBe(-3)
    expect(
      getDefaultUpdateSourceID([
        { id: 2, platformName: '夸克网盘', isDirect: false },
        { id: 1, platformName: 'GitHub', isDirect: true }
      ])
    ).toBe(1)
  })

  it('falls back to the first source when GitHub is unavailable', () => {
    expect(
      getDefaultUpdateSourceID([
        { id: 8, platformName: '夸克网盘', isDirect: false },
        { id: 9, platformName: '其他渠道', isDirect: false }
      ])
    ).toBe(8)
    expect(getDefaultUpdateSourceID([])).toBeNull()
  })

  it('requires both a direct flag and feed URL for in-app updates', () => {
    expect(
      isInAppUpdateSource({
        id: 1,
        platformName: 'GitHub',
        isDirect: true,
        feedUrl: 'https://example.com/feed/'
      })
    ).toBe(true)
    expect(isInAppUpdateSource({ id: 2, platformName: '夸克网盘', isDirect: false })).toBe(false)
    expect(isInAppUpdateSource({ id: 3, platformName: 'GitHub', isDirect: true })).toBe(false)
  })
})
