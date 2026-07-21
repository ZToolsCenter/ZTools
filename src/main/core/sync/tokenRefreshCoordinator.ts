export type RefreshedTokens = {
  token: string
  refreshToken: string
}

const refreshes = new Map<string, Promise<RefreshedTokens | null>>()
const SUCCESS_REUSE_WINDOW_MS = 1_000

export function coordinateTokenRefresh(
  refreshToken: string,
  refresh: () => Promise<RefreshedTokens | null>
): Promise<RefreshedTokens | null> {
  const existing = refreshes.get(refreshToken)
  if (existing) return existing

  const pending = refresh()
  refreshes.set(refreshToken, pending)
  void pending.then(
    (tokens) => {
      if (!tokens) {
        if (refreshes.get(refreshToken) === pending) refreshes.delete(refreshToken)
        return
      }
      const cleanupTimer = setTimeout(() => {
        if (refreshes.get(refreshToken) === pending) refreshes.delete(refreshToken)
      }, SUCCESS_REUSE_WINDOW_MS)
      cleanupTimer.unref?.()
    },
    () => {
      if (refreshes.get(refreshToken) === pending) refreshes.delete(refreshToken)
    }
  )
  return pending
}
