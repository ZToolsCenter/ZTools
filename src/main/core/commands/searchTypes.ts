import type { Command } from '../../../shared/commandService'

/** 字段身份允许由注册的匹配器扩展，评分配置缺省为零。 */
export type SearchFieldKind = string
export type SourceRange = [number, number]

export interface SearchField {
  kind: SearchFieldKind
  text: string
  ranges: SourceRange[]
  /** 每个 UTF-16 位置的边界位：1 为 token 起点，2 为 token 终点。 */
  boundaries: Uint8Array
  compact: boolean
}

export interface PronunciationToken {
  literal: string
  primary: string
  alternatives: string[]
  range: SourceRange
  han: boolean
}

export interface NameMatch {
  score: number
  shape: 'exact' | 'prefix' | 'contains'
  partial: boolean
  compact: boolean
  position: number
  length: number
  field: SearchFieldKind
  alternatives: number
  ranges: SourceRange[]
}

export interface RankedName {
  command: Command
  match: NameMatch
  score: number
  stableKey: string
}

export interface MatchBudget {
  remaining: number
  degraded: number
}
