export interface SleepingSearch {
  searchQuery: string
  pastedImage: string | null
  pastedFiles: Array<{ path: string; name: string; isDirectory: boolean }> | null
  pastedText: string | null
  lastShownAt: number
}

export const DEFAULT_MAIN_WINDOW_SLEEP_SECONDS = 60

/**
 * 统一处理旧配置、空值和非正整数延时。
 * @param value 以秒为单位的延时。
 * @returns 有效的正整数秒数，缺省时为 60 秒。
 */
export function normalizeMainWindowSleepSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MAIN_WINDOW_SLEEP_SECONDS
}
