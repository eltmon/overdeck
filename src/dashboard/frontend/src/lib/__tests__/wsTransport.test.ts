import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dashboardSessionUrls, RECONNECT_MAX_DELAY_MS, reconnectBackoffDelayMs } from '../wsTransport'

describe('dashboard session bootstrap URLs', () => {
  it('mints cookies on both API and frontend hosts in split-host workspaces', () => {
    expect(dashboardSessionUrls(
      'wss://api-feature-pan-3703.overdeck.localhost/ws/rpc',
      'https://feature-pan-3703.overdeck.localhost',
    )).toEqual([
      'https://api-feature-pan-3703.overdeck.localhost/api/dashboard/session',
      'https://feature-pan-3703.overdeck.localhost/api/dashboard/session',
    ])
  })

  it('mints only once when the frontend and API share a host', () => {
    expect(dashboardSessionUrls('wss://overdeck.localhost/ws/rpc', 'https://overdeck.localhost')).toEqual([
      'https://overdeck.localhost/api/dashboard/session',
    ])
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
