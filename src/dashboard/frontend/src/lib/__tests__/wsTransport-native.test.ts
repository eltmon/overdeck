/**
 * PAN-4837 FR-9: in the phone app the RPC transport skips the dashboard
 * session and CSRF, because the phone token inside the channel authorizes
 * every request. Outside the app the session POST still happens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = globalThis as { __OVERDECK_NATIVE__?: boolean }

describe('wsTransport in native shell mode', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    delete native.__OVERDECK_NATIVE__
    vi.unstubAllGlobals()
  })

  it('makes no session request and sends no CSRF header in the app', async () => {
    native.__OVERDECK_NATIVE__ = true
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { dashboardMutationJsonHeaders, ensureDashboardSession } = await import('../wsTransport')

    await ensureDashboardSession('ws://localhost:3000/ws/rpc')
    const headers = await dashboardMutationJsonHeaders('ws://localhost:3000/ws/rpc')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('still mints one dashboard session outside the app', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ csrfToken: 'csrf' }))
    vi.stubGlobal('fetch', fetchMock)
    const { dashboardMutationJsonHeaders } = await import('../wsTransport')

    const headers = await dashboardMutationJsonHeaders('ws://localhost:3000/ws/rpc')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3000/api/dashboard/session')
    expect(headers).toEqual({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'csrf' })
  })
})
