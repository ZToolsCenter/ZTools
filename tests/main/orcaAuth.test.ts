import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  buildOrcaAuthorizeUrl,
  createOrcaPkceAttempt,
  createPkceMaterial,
  exchangeOrcaAuthCode,
  isOrcaScopeSatisfied,
  normalizeOrcaOrigin,
  OrcaAuthError,
  ORCAROUTER_DEFAULT_API_BASE_URL,
  ORCAROUTER_DEFAULT_AUTH_BASE_URL,
  resolveOrcaEndpoints,
  startOrcaLoopbackListener,
  toBase64Url
} from '../../src/main/core/provider/orcaAuth'

describe('orcaAuth origins', () => {
  it('defaults auth and inference to different public origins', () => {
    const config = resolveOrcaEndpoints({})
    expect(config.authBaseUrl).toBe(ORCAROUTER_DEFAULT_AUTH_BASE_URL)
    expect(config.apiBaseUrl).toBe(ORCAROUTER_DEFAULT_API_BASE_URL)
    // 认证 origin 绝不能由推理 origin 推导出来。
    expect(config.authBaseUrl).not.toContain('api.orcarouter.ai')
    expect(config.apiBaseUrl).not.toContain('www.orcarouter.ai')
  })

  it('prefers explicit overrides and falls back to the shared self-hosted base', () => {
    expect(
      resolveOrcaEndpoints({
        ORCA_AUTH_BASE_URL: 'https://auth.example.test',
        ORCA_API_BASE_URL: 'https://relay.example.test/v1',
        ORCA_BASE_URL: 'https://ignored.example.test'
      })
    ).toEqual({
      authBaseUrl: 'https://auth.example.test',
      apiBaseUrl: 'https://relay.example.test/v1'
    })

    // 共享 base 只追加一次 /v1。
    expect(resolveOrcaEndpoints({ ORCA_BASE_URL: 'https://one.example.test' }).apiBaseUrl).toBe(
      'https://one.example.test/v1'
    )
    expect(resolveOrcaEndpoints({ ORCA_BASE_URL: 'https://one.example.test/v1' }).apiBaseUrl).toBe(
      'https://one.example.test/v1'
    )
    expect(resolveOrcaEndpoints({ ORCA_BASE_URL: 'https://one.example.test' }).authBaseUrl).toBe(
      'https://one.example.test'
    )
  })

  it('rejects plain HTTP for remote origins and allows loopback', () => {
    expect(() => normalizeOrcaOrigin('http://evil.example.test', '', 'ORCA_AUTH_BASE_URL')).toThrow(
      OrcaAuthError
    )
    expect(normalizeOrcaOrigin('http://127.0.0.1:8080', '', 'x')).toBe('http://127.0.0.1:8080')
    expect(() => resolveOrcaEndpoints({ ORCA_BASE_URL: 'http://nas.local' })).toThrow(OrcaAuthError)
  })
})

describe('PKCE material', () => {
  it('derives the challenge as unpadded base64url(sha256(verifier)) and is fresh per attempt', () => {
    const first = createPkceMaterial()
    const second = createPkceMaterial()

    const expected = createHash('sha256').update(first.verifier).digest()
    expect(first.challenge).toBe(toBase64Url(expected))
    expect(first.challenge).not.toContain('=')
    expect(first.verifier).not.toContain('=')

    // 每次尝试都必须重新生成，不能复用 verifier/state。
    expect(first.verifier).not.toBe(second.verifier)
    expect(first.state).not.toBe(second.state)
    expect(first.challenge).not.toBe(second.challenge)
  })
})

describe('authorize URL', () => {
  it('always sends S256 and never puts the verifier in the URL', () => {
    const config = resolveOrcaEndpoints({})
    const attempt = createOrcaPkceAttempt('loopback', {
      port: 51733,
      callbackUrl: 'http://127.0.0.1:51733/cb',
      setExpectedState: () => undefined,
      waitForCode: () => new Promise(() => undefined),
      close: () => undefined
    })
    const url = buildOrcaAuthorizeUrl(attempt, config, 'ZTools')
    const parsed = new URL(url)

    expect(parsed.origin).toBe(ORCAROUTER_DEFAULT_AUTH_BASE_URL)
    expect(parsed.pathname).toBe('/auth')
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('code_challenge')).toBe(attempt.challenge)
    expect(parsed.searchParams.get('state')).toBe(attempt.state)
    expect(parsed.searchParams.get('callback_url')).toBe('http://127.0.0.1:51733/cb')
    expect(parsed.searchParams.get('app_name')).toBe('ZTools')
    expect(parsed.searchParams.get('scope')).toBe('api')

    // verifier 只能留在进程内。
    expect(url).not.toContain(attempt.verifier)
  })

  it('uses the literal oob callback for the out-of-band flow', () => {
    const attempt = createOrcaPkceAttempt('oob')
    const url = new URL(buildOrcaAuthorizeUrl(attempt, resolveOrcaEndpoints({}), 'ZTools'))
    expect(attempt.callbackUrl).toBe('oob')
    expect(url.searchParams.get('callback_url')).toBe('oob')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('code exchange', () => {
  const attempt = (): ReturnType<typeof createOrcaPkceAttempt> => createOrcaPkceAttempt('oob')

  it('posts to the auth origin exchange path with the verifier and S256', async () => {
    const current = attempt()
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ key: 'sk-orca-test-key', user_id: '12345', scope: 'api' })
    })) as unknown as typeof fetch

    const result = await exchangeOrcaAuthCode({
      code: 'fake-code',
      attempt: current,
      config: resolveOrcaEndpoints({}),
      fetchImpl
    })

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]
    expect(url).toBe('https://www.orcarouter.ai/api/v1/auth/keys')
    // 常见的错误写法必须被排除。
    expect(url).not.toContain('api.orcarouter.ai/v1/auth/keys')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({
      code: 'fake-code',
      code_verifier: current.verifier,
      code_challenge_method: 'S256'
    })
    expect(result.key).toBe('sk-orca-test-key')
    expect(result.scope).toBe('api')
  })

  it('classifies upstream failures without leaking the code or verifier', async () => {
    const statuses: Array<[number, string]> = [
      [400, 'challenge_rejected'],
      [403, 'expired_or_used'],
      [429, 'rate_limited']
    ]

    for (const [status, failure] of statuses) {
      const current = attempt()
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status,
        text: async () => `upstream body with ${current.verifier} and fake-code`
      })) as unknown as typeof fetch

      await expect(
        exchangeOrcaAuthCode({
          code: 'fake-code',
          attempt: current,
          config: resolveOrcaEndpoints({}),
          fetchImpl
        })
      ).rejects.toMatchObject({ failure })
    }
  })

  it('maps transport failures to a network failure and rejects an empty key', async () => {
    const current = attempt()
    const failing = vi.fn(async () => {
      throw new Error('socket hang up')
    }) as unknown as typeof fetch
    await expect(
      exchangeOrcaAuthCode({
        code: 'fake-code',
        attempt: current,
        config: resolveOrcaEndpoints({}),
        fetchImpl: failing
      })
    ).rejects.toMatchObject({ failure: 'network' })

    const emptyKey = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ scope: 'api' })
    })) as unknown as typeof fetch
    await expect(
      exchangeOrcaAuthCode({
        code: 'fake-code',
        attempt: current,
        config: resolveOrcaEndpoints({}),
        fetchImpl: emptyKey
      })
    ).rejects.toMatchObject({ failure: 'invalid_response' })
  })

  it('separates the granted scope from the requested one', () => {
    expect(isOrcaScopeSatisfied('api', 'api')).toBe(true)
    expect(isOrcaScopeSatisfied('connector', 'api')).toBe(false)
    expect(isOrcaScopeSatisfied('', 'api')).toBe(false)
  })
})

describe('loopback listener', () => {
  let listener: Awaited<ReturnType<typeof startOrcaLoopbackListener>> | null = null

  afterEach(() => {
    listener?.close()
    listener = null
  })

  it('accepts a matching state and returns the code', async () => {
    listener = await startOrcaLoopbackListener(2_000)
    const attempt = createOrcaPkceAttempt('loopback', listener)
    const pending = listener.waitForCode()
    const response = await fetch(`${listener.callbackUrl}?code=fake-code&state=${attempt.state}`)
    expect(response.status).toBe(200)
    await expect(pending).resolves.toBe('fake-code')
  })

  it('rejects a mismatched state before reading the code', async () => {
    listener = await startOrcaLoopbackListener(2_000)
    createOrcaPkceAttempt('loopback', listener)
    const pending = listener.waitForCode()
    await fetch(`${listener.callbackUrl}?code=fake-code&state=wrong-state`)
    await expect(pending).rejects.toMatchObject({ failure: 'state_mismatch' })
  })

  it('reports denial and timeout safely', async () => {
    listener = await startOrcaLoopbackListener(200)
    const attempt = createOrcaPkceAttempt('loopback', listener)
    const denied = listener.waitForCode()
    await fetch(`${listener.callbackUrl}?error=access_denied&state=${attempt.state}`)
    await expect(denied).rejects.toMatchObject({ failure: 'denied' })

    listener.close()
    listener = await startOrcaLoopbackListener(100)
    createOrcaPkceAttempt('loopback', listener)
    await expect(listener.waitForCode()).rejects.toMatchObject({ failure: 'timeout' })
  })

  it('supports explicit cancellation without hanging', async () => {
    listener = await startOrcaLoopbackListener(5_000)
    createOrcaPkceAttempt('loopback', listener)
    const controller = new AbortController()
    const pending = listener.waitForCode(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ failure: 'cancelled' })
  })
})
