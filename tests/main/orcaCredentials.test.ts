import { describe, expect, it, vi } from 'vitest'
import {
  isOrcaReauthStatus,
  markOrcaCredentialNeedsReauth,
  maskOrcaKey,
  OrcaApiKeyAdapter,
  OrcaPkceAdapter,
  persistOrcaCredential,
  validateOrcaApiKeyInput,
  type OrcaCredential,
  type OrcaCredentialStore
} from '../../src/main/core/provider/orcaCredentials'
import { resolveOrcaEndpoints } from '../../src/main/core/provider/orcaAuth'

/** 内存凭据存储，模拟宿主现有的密钥存储。 */
function createStore(initial: OrcaCredential | null = null): OrcaCredentialStore & {
  current: OrcaCredential | null
  writes: number
} {
  const store = {
    current: initial,
    writes: 0,
    read: () => store.current,
    write: (credential: OrcaCredential) => {
      store.current = credential
      store.writes += 1
    },
    clear: () => {
      store.current = null
    }
  }
  return store
}

describe('API key adapter', () => {
  it('produces the same credential result shape as the PKCE adapter', async () => {
    const result = await new OrcaApiKeyAdapter().acquire({
      source: 'api-key',
      key: '  sk-orca-fake-key  '
    })
    expect(result).toEqual({ key: 'sk-orca-fake-key', scope: 'api' })
  })

  it('rejects empty or whitespace-bearing input with a safe message', async () => {
    const adapter = new OrcaApiKeyAdapter()
    await expect(adapter.acquire({ source: 'api-key', key: '   ' })).rejects.toMatchObject({
      failure: 'invalid_response'
    })
    await expect(
      adapter.acquire({ source: 'api-key', key: 'sk-orca-bad key' })
    ).rejects.toMatchObject({ failure: 'invalid_response' })
    expect(validateOrcaApiKeyInput('')).not.toBeNull()
    expect(validateOrcaApiKeyInput('sk-orca-fake')).toBeNull()
  })
})

describe('PKCE adapter against a local fake auth server', () => {
  it('runs authorize -> oob code -> exchange -> persist end to end', async () => {
    const attempts: Array<{ url: string; body: Record<string, string> }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      attempts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
      return {
        ok: true,
        status: 200,
        json: async () => ({ key: 'sk-orca-pkce-key', user_id: 'u-1', scope: 'api' })
      }
    }) as unknown as typeof fetch

    const adapter = new OrcaPkceAdapter(resolveOrcaEndpoints({}), 'ZTools', fetchImpl)
    const session = await adapter.start({ flow: 'oob' })

    const authorizeUrl = new URL(session.authorizeUrl)
    expect(authorizeUrl.origin).toBe('https://www.orcarouter.ai')
    expect(authorizeUrl.pathname).toBe('/auth')
    expect(authorizeUrl.searchParams.get('callback_url')).toBe('oob')
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')

    const result = await adapter.acquire({
      source: 'pkce',
      attemptId: session.attemptId,
      code: 'fake-oob-code'
    })
    expect(result.key).toBe('sk-orca-pkce-key')

    // 兑换只发生在认证 origin 的 /api/v1/auth/keys。
    expect(attempts[0].url).toBe('https://www.orcarouter.ai/api/v1/auth/keys')
    expect(attempts[0].body.code).toBe('fake-oob-code')
    expect(attempts[0].body.code_challenge_method).toBe('S256')

    const store = createStore()
    const credential = persistOrcaCredential(store, 'pkce', result)
    expect(credential).toMatchObject({ source: 'pkce', key: 'sk-orca-pkce-key', generation: 1 })
  })

  it('uses a fresh verifier and state on every attempt', async () => {
    const adapter = new OrcaPkceAdapter(resolveOrcaEndpoints({}))
    const first = await adapter.start({ flow: 'oob' })
    const second = await adapter.start({ flow: 'oob' })
    const firstUrl = new URL(first.authorizeUrl)
    const secondUrl = new URL(second.authorizeUrl)

    expect(firstUrl.searchParams.get('code_challenge')).not.toBe(
      secondUrl.searchParams.get('code_challenge')
    )
    expect(firstUrl.searchParams.get('state')).not.toBe(secondUrl.searchParams.get('state'))
    expect(first.attemptId).not.toBe(second.attemptId)
    adapter.dispose()
  })

  it('completes a loopback login through the local callback listener', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ key: 'sk-orca-loopback-key', scope: 'api' })
    })) as unknown as typeof fetch

    const adapter = new OrcaPkceAdapter(resolveOrcaEndpoints({}), 'ZTools', fetchImpl)
    const session = await adapter.start({ flow: 'loopback' })
    const authorizeUrl = new URL(session.authorizeUrl)
    const callback = authorizeUrl.searchParams.get('callback_url') ?? ''

    // 模拟用户在同意的浏览器中完成授权后回调本机监听端口。
    expect(callback.startsWith('http://127.0.0.1:')).toBe(true)
    const state = authorizeUrl.searchParams.get('state') ?? ''
    await fetch(`${callback}?code=fake-loopback-code&state=${state}`)

    await expect(adapter.waitForCallback(session.attemptId)).resolves.toMatchObject({
      key: 'sk-orca-loopback-key'
    })
    adapter.dispose()
  })

  it('rejects a mismatched callback state and releases the session', async () => {
    const adapter = new OrcaPkceAdapter(resolveEndpointsForTest())
    const session = await adapter.start({ flow: 'loopback' })
    const callback = new URL(session.authorizeUrl).searchParams.get('callback_url') ?? ''

    await fetch(`${callback}?code=fake-code&state=wrong-state`)
    await expect(adapter.waitForCallback(session.attemptId)).rejects.toMatchObject({
      failure: 'state_mismatch'
    })
    adapter.dispose()
  })

  it('stops an explicit cancel instead of hanging', async () => {
    const adapter = new OrcaPkceAdapter(resolveEndpointsForTest())
    const session = await adapter.start({ flow: 'loopback' })
    expect(adapter.pendingCount).toBe(1)

    adapter.cancel(session.attemptId)
    expect(adapter.pendingCount).toBe(0)
    await expect(adapter.waitForCallback(session.attemptId)).rejects.toMatchObject({
      failure: 'invalid_response'
    })
  })

  it('never accepts a reused or unknown authorization code twice', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => '{"error":"invalid_grant"}'
    })) as unknown as typeof fetch
    const adapter = new OrcaPkceAdapter(resolveEndpointsForTest(), 'ZTools', fetchImpl)
    const session = await adapter.start({ flow: 'oob' })

    await expect(
      adapter.acquire({ source: 'pkce', attemptId: session.attemptId, code: 'used-code' })
    ).rejects.toMatchObject({ failure: 'expired_or_used' })

    // 会话在首次兑换后即结束，复用同一授权码必须立即失败。
    await expect(
      adapter.acquire({ source: 'pkce', attemptId: session.attemptId, code: 'used-code' })
    ).rejects.toMatchObject({ failure: 'expired_or_used' })
    adapter.dispose()
  })

  it('surfaces scope downgrade and 429 without inventing a refresh', async () => {
    const downgraded = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ key: 'sk-orca-connector', scope: 'connector' })
    })) as unknown as typeof fetch
    const adapter = new OrcaPkceAdapter(resolveEndpointsForTest(), 'ZTools', downgraded)
    const session = await adapter.start({ flow: 'oob' })
    const result = await adapter.acquire({
      source: 'pkce',
      attemptId: session.attemptId,
      code: 'fake-code'
    })
    const store = createStore()
    expect(() => persistOrcaCredential(store, 'pkce', result)).toThrowError(/授权范围/)
    expect(store.writes).toBe(0)

    const limited = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => '{"error":"too_many_requests"}'
    })) as unknown as typeof fetch
    const limitedAdapter = new OrcaPkceAdapter(resolveEndpointsForTest(), 'ZTools', limited)
    const limitedSession = await limitedAdapter.start({ flow: 'oob' })
    await expect(
      limitedAdapter.acquire({
        source: 'pkce',
        attemptId: limitedSession.attemptId,
        code: 'fake-code'
      })
    ).rejects.toMatchObject({ failure: 'rate_limited' })
  })
})

/**
 * 在测试中显式使用官方端点，避免受宿主环境变量影响。
 * @returns 官方认证与推理端点
 */
function resolveEndpointsForTest(): ReturnType<typeof resolveOrcaEndpoints> {
  return resolveOrcaEndpoints({})
}

describe('credential lifecycle', () => {
  it('masks keys and never returns the raw value', () => {
    expect(maskOrcaKey('sk-orca-1234567890abcdef')).toBe('sk-orca…cdef')
    expect(maskOrcaKey('short')).toBe('***')
    expect(maskOrcaKey('   ')).toBe('')
    expect(maskOrcaKey('sk-orca-1234567890abcdef')).not.toContain('567890abc')
  })

  it('increments the generation on replacement and keeps both entry points equivalent', async () => {
    const store = createStore()
    const apiKey = await new OrcaApiKeyAdapter().acquire({
      source: 'api-key',
      key: 'sk-orca-manual'
    })
    const first = persistOrcaCredential(store, 'api-key', apiKey)
    expect(first.generation).toBe(1)
    expect(first.source).toBe('api-key')

    const pkce = persistOrcaCredential(store, 'pkce', {
      key: 'sk-orca-pkce',
      scope: 'api',
      userId: 'u-1'
    })
    expect(pkce.generation).toBe(2)
    expect(pkce.source).toBe('pkce')
    expect(store.current?.key).toBe('sk-orca-pkce')
  })

  it('marks only the exact rejected generation as needing reauthentication', () => {
    const store = createStore()
    const first = persistOrcaCredential(store, 'api-key', { key: 'sk-orca-first', scope: 'api' })

    // 迟到的 401 属于上一代，不得污染重新登录后的新凭据。
    expect(markOrcaCredentialNeedsReauth(store, first.generation - 1)).toBe(false)
    expect(store.current?.status).toBe('active')
    expect(markOrcaCredentialNeedsReauth(store, first.generation)).toBe(true)
    expect(store.current?.status).toBe('needsReauth')
    // 幂等：重复标记不会重复写入。
    expect(markOrcaCredentialNeedsReauth(store, first.generation)).toBe(false)

    const second = persistOrcaCredential(store, 'pkce', { key: 'sk-orca-second', scope: 'api' })
    expect(second.status).toBe('active')
    // 旧代次的失败不得把新凭据标记为失效。
    expect(markOrcaCredentialNeedsReauth(store, first.generation)).toBe(false)
    expect(store.current?.status).toBe('active')
    expect(store.current?.key).toBe('sk-orca-second')
  })

  it('treats 401 as terminal and never produces a refresh grant', () => {
    expect(isOrcaReauthStatus(401)).toBe(true)
    expect(isOrcaReauthStatus(429)).toBe(false)
    expect(isOrcaReauthStatus(403)).toBe(false)
    // PKCE adapter 上没有 refresh 入口，持久密钥被撤销后只能重新登录。
    const adapter = new OrcaPkceAdapter(resolveEndpointsForTest())
    expect('refresh' in adapter).toBe(false)
    adapter.dispose()
  })
})
