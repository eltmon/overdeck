import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECONNECT_MAX_DELAY_MS, reconnectBackoffDelayMs } from '../wsTransport'

describe('dashboard session bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState(null, '', 'http://localhost:3000/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mints sessions on both API and frontend hosts when they differ', async () => {
    window.history.replaceState(null, '', 'http://localhost:3000/#overdeck_token=bootstrap-token')
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ csrfToken: 'csrf' }))
    vi.stubGlobal('fetch', fetchMock)
    const { ensureDashboardSession } = await import('../wsTransport')

    await ensureDashboardSession('ws://api.workspace.test/ws/rpc')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([requestUrl]) => requestUrl)).toEqual([
      'http://api.workspace.test/api/dashboard/session',
      'http://localhost:3000/api/dashboard/session',
    ])
    const expectedOptions = {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-overdeck-internal-token': 'bootstrap-token' },
    }
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject(expectedOptions)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject(expectedOptions)
    expect(window.location.hash).toBe('')
  })

  it('mints only the API session when the API and frontend hosts match', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ csrfToken: 'csrf' }))
    vi.stubGlobal('fetch', fetchMock)
    const { ensureDashboardSession } = await import('../wsTransport')

    await ensureDashboardSession('ws://localhost:3000/ws/rpc')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/dashboard/session',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('rejects when either host fails to mint a session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const { ensureDashboardSession } = await import('../wsTransport')

    await expect(ensureDashboardSession('ws://api.workspace.test/ws/rpc'))
      .rejects.toThrow('Dashboard session bootstrap failed: HTTP 500')
  })

  it('retries both hosts after a partial mint failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(Response.json({ csrfToken: 'csrf' }))
    vi.stubGlobal('fetch', fetchMock)
    const { ensureDashboardSession } = await import('../wsTransport')

    await expect(ensureDashboardSession('ws://api.workspace.test/ws/rpc')).rejects.toThrow()
    await expect(ensureDashboardSession('ws://api.workspace.test/ws/rpc')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('wsTransport reconnect backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('increases reconnect delays exponentially and caps at the ceiling', async () => {
    expect([1, 2, 3, 4, 5, 6].map(reconnectBackoffDelayMs)).toEqual([
      500,
      1_000,
      2_000,
      4_000,
      8_000,
      RECONNECT_MAX_DELAY_MS,
    ])
    expect(reconnectBackoffDelayMs(7)).toBe(RECONNECT_MAX_DELAY_MS)

    const fired: number[] = []
    setTimeout(() => fired.push(1), reconnectBackoffDelayMs(1))
    setTimeout(() => fired.push(2), reconnectBackoffDelayMs(2))
    setTimeout(() => fired.push(3), reconnectBackoffDelayMs(3))

    await vi.advanceTimersByTimeAsync(499)
    expect(fired).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(fired).toEqual([1])
    await vi.advanceTimersByTimeAsync(500)
    expect(fired).toEqual([1, 2])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fired).toEqual([1, 2, 3])
  })
})
