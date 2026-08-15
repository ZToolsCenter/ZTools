import { describe, expect, it } from 'vitest'
import {
  mergeMacUpdateMetadata,
  mergeWindowsUpdateMetadata,
  selectMacUpdateZip,
  selectWindowsInstaller,
  validateReferencedAsset
} from '../../scripts/update-metadata.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const x64Metadata = {
  version: '3.0.0-beta.9',
  files: [
    { url: 'ZTools-3.0.0-beta.9-mac-x64.dmg', sha512: 'dmg-x64' },
    { url: 'ZTools-3.0.0-beta.9-mac-x64.zip', sha512: 'zip-x64', size: 100 }
  ],
  path: 'ZTools-3.0.0-beta.9-mac-x64.zip',
  sha512: 'zip-x64',
  releaseDate: '2026-07-20T00:00:00.000Z'
}

const arm64Metadata = {
  version: '3.0.0-beta.9',
  files: [{ url: 'ZTools-3.0.0-beta.9-mac-arm64.zip', sha512: 'zip-arm64', size: 90 }],
  releaseDate: '2026-07-20T00:00:01.000Z'
}

describe('macOS update metadata', () => {
  it('selects the standard full app zip for the requested architecture', () => {
    expect(selectMacUpdateZip(x64Metadata, 'x64')).toMatchObject({
      url: 'ZTools-3.0.0-beta.9-mac-x64.zip',
      sha512: 'zip-x64'
    })
  })

  it('merges x64 and arm64 full app zips and preserves checksums', () => {
    const merged = mergeMacUpdateMetadata(x64Metadata, arm64Metadata, 'release notes')

    expect(merged.files).toEqual([
      { url: 'ZTools-3.0.0-beta.9-mac-x64.zip', sha512: 'zip-x64', size: 100 },
      { url: 'ZTools-3.0.0-beta.9-mac-arm64.zip', sha512: 'zip-arm64', size: 90 }
    ])
    expect(merged.path).toBe('ZTools-3.0.0-beta.9-mac-x64.zip')
    expect(merged.sha512).toBe('zip-x64')
    expect(merged.releaseNotes).toBe('release notes')
    expect(merged).not.toHaveProperty('changelog')
  })

  it('rejects metadata from different versions', () => {
    expect(() =>
      mergeMacUpdateMetadata(x64Metadata, { ...arm64Metadata, version: '3.0.1' }, '')
    ).toThrow('版本不一致')
  })

  it('rejects a standard zip without SHA-512', () => {
    expect(() =>
      selectMacUpdateZip(
        {
          ...arm64Metadata,
          files: [{ url: 'ZTools-3.0.0-beta.9-mac-arm64.zip' }]
        },
        'arm64'
      )
    ).toThrow('缺少 SHA-512')
  })
})

describe('Windows update metadata', () => {
  const windowsX64Metadata = {
    version: '3.0.0-beta.9',
    files: [
      {
        url: 'ZTools-3.0.0-beta.9-win-x64-setup.exe',
        sha512: 'setup-x64',
        size: 120
      },
      { url: 'ZTools-3.0.0-beta.9-win-x64.zip', sha512: 'zip-x64' }
    ],
    path: 'ZTools-3.0.0-beta.9-win-x64-setup.exe',
    sha512: 'setup-x64',
    releaseDate: '2026-07-20T00:00:00.000Z'
  }

  const windowsArm64Metadata = {
    version: '3.0.0-beta.9',
    files: [
      {
        url: 'ZTools-3.0.0-beta.9-win-arm64-setup.exe',
        sha512: 'setup-arm64',
        size: 110
      }
    ],
    releaseDate: '2026-07-20T00:00:01.000Z'
  }

  it('selects exactly one checksummed installer for the requested architecture', () => {
    expect(selectWindowsInstaller(windowsArm64Metadata, 'arm64')).toMatchObject({
      url: 'ZTools-3.0.0-beta.9-win-arm64-setup.exe',
      sha512: 'setup-arm64'
    })
  })

  it('merges x64 then arm64 installers and keeps legacy fields on x64', () => {
    const merged = mergeWindowsUpdateMetadata(
      windowsX64Metadata,
      windowsArm64Metadata,
      'release notes'
    )

    expect(merged.files).toEqual([
      {
        url: 'ZTools-3.0.0-beta.9-win-x64-setup.exe',
        sha512: 'setup-x64',
        size: 120
      },
      {
        url: 'ZTools-3.0.0-beta.9-win-arm64-setup.exe',
        sha512: 'setup-arm64',
        size: 110
      }
    ])
    expect(merged.path).toBe('ZTools-3.0.0-beta.9-win-x64-setup.exe')
    expect(merged.sha512).toBe('setup-x64')
    expect(merged.releaseNotes).toBe('release notes')
  })

  it('rejects Windows metadata from different versions', () => {
    expect(() =>
      mergeWindowsUpdateMetadata(
        windowsX64Metadata,
        { ...windowsArm64Metadata, version: '3.0.1' },
        ''
      )
    ).toThrow('版本不一致')
  })

  it('rejects missing, duplicate, or unsigned Windows installers', () => {
    expect(() => selectWindowsInstaller({ ...windowsArm64Metadata, files: [] }, 'arm64')).toThrow(
      '必须包含且仅包含一个'
    )
    expect(() =>
      selectWindowsInstaller(
        {
          ...windowsArm64Metadata,
          files: [...windowsArm64Metadata.files, ...windowsArm64Metadata.files]
        },
        'arm64'
      )
    ).toThrow('必须包含且仅包含一个')
    expect(() =>
      selectWindowsInstaller(
        {
          ...windowsArm64Metadata,
          files: [{ url: 'ZTools-3.0.0-beta.9-win-arm64-setup.exe' }]
        },
        'arm64'
      )
    ).toThrow('缺少 SHA-512')
  })

  it('rejects metadata that references an installer missing from disk', () => {
    const metadataDir = mkdtempSync(path.join(tmpdir(), 'ztools-update-metadata-'))
    const metadataPath = path.join(metadataDir, 'latest.yml')
    writeFileSync(metadataPath, 'version: 3.0.0-beta.9\n')

    try {
      expect(() => validateReferencedAsset(metadataPath, windowsArm64Metadata.files[0])).toThrow(
        '引用的文件不存在'
      )
    } finally {
      rmSync(metadataDir, { recursive: true, force: true })
    }
  })
})
