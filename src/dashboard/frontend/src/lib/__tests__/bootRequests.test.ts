import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('startBootRequests', () => {
  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState(null, '', 'http://localhost:3000/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the session mint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')

    startBootRequests(new QueryClient(), { pathname: '/', search: '', hash: '' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(requestUrl.endsWith('/api/dashboard/session')).toBe(true)
    expect(init.method).toBe('POST')
  })

  it('shares the mint with later callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')
    const { ensureDashboardSession } = await import('../wsTransport')

    startBootRequests(new QueryClient(), { pathname: '/', search: '', hash: '' })
    await ensureDashboardSession()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends nothing on the shared-conversation route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')

    startBootRequests(new QueryClient(), { pathname: '/', search: '', hash: '#/shared/bcdf-ghjk' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a refused mint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    const { startBootRequests } = await import('../bootRequests')

    startBootRequests(new QueryClient(), { pathname: '/', search: '', hash: '' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    process.off('unhandledRejection', onUnhandledRejection)
    expect(unhandledRejections).toHaveLength(0)
  })
})
