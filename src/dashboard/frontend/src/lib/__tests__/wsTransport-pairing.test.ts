/**
 * PAN-3762 W2.8: a `#pair=<credential>` landing strips the hash before any
 * request, exchanges the credential before the session mint, never sends the
 * internal-token header, and surfaces the server's refusal text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CREDENTIAL = `odp_${'b'.repeat(64)}`

describe('dashboard pairing landing', () => {
  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState(null, '', `http://localhost:3000/#pair=${CREDENTIAL}`)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', 'http://localhost:3000/')
  })

  it('strips the hash before any fetch and exchanges before minting', async () => {
    const hashesAtFetch: string[] = []
    const fetchMock = vi.fn().mockImplementation(async () => {
      hashesAtFetch.push(window.location.hash)
      return Response.json({ csrfToken: 'csrf', deviceId: 'dev-1', environmentId: 'env-1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ensureDashboardSession } = await import('../wsTransport')

    await ensureDashboardSession('ws://localhost:3000/ws/rpc')

    expect(hashesAtFetch).toEqual(['', ''])
    expect(window.location.hash).toBe('')
    expect(fetchMock.mock.calls.map(([requestUrl]) => requestUrl)).toEqual([
      'http://localhost:3000/api/pairing/exchange',
      'http://localhost:3000/api/dashboard/session',
    ])
    const exchangeInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(exchangeInit).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(exchangeInit.body as string)).toMatchObject({ credential: CREDENTIAL, delivery: 'cookie' })
  })

  it('never sends the internal-token header when only #pair= is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ csrfToken: 'csrf' }))
    vi.stubGlobal('fetch', fetchMock)
    const { ensureDashboardSession } = await import('../wsTransport')

    await ensureDashboardSession('ws://localhost:3000/ws/rpc')

    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit | undefined]>) {
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('x-overdeck-internal-token')
    }
  })

  it('surfaces an expired credential and does not fall back to the session mint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: 'pairing credential expired; run pan pair again' }, { status: 410 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { ensureDashboardSession } = await import('../wsTransport')

    await expect(ensureDashboardSession('ws://localhost:3000/ws/rpc')).rejects.toThrow('expired')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
