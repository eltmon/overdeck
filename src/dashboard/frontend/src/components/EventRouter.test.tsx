import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardSnapshot, DomainEvent } from '@overdeck/contracts'
import { INITIAL_READ_MODEL_STATE } from '@overdeck/contracts'
import { EventRouter, eventRouterReconnectDelayMs } from './EventRouter'
import { useDashboardStore } from '../lib/store'
import { installStrictFetchMock } from '../test-utils/strictFetchMock'
import { BACKEND_RECONNECTED_EVENT, BACKEND_RECONNECTING_EVENT } from '../lib/backendConnectionEvents'

const wsTransport = vi.hoisted(() => {
  const request = vi.fn()
  const subscribe = vi.fn()
  const state = {
    request,
    subscribe,
    currentTransport: { request, subscribe },
    resetTransport: vi.fn(),
    subscribed: null as ((event: DomainEvent) => void) | null,
    subscribeOptions: null as { onReconnect?: () => void; onRetry?: (attempt: number) => void } | null,
    unsubscribe: vi.fn(),
  }
  subscribe.mockImplementation((_connect, listener, options) => {
    state.subscribed = listener
    state.subscribeOptions = options
    return state.unsubscribe
  })
  return state
})
const { request, subscribe, resetTransport, unsubscribe } = wsTransport

vi.mock('../lib/wsTransport', () => ({
  getTransport: () => wsTransport.currentTransport,
  resetTransport: wsTransport.resetTransport,
}))

vi.mock('../lib/snapshotCache', () => ({
  loadSnapshotFromCache: () => null,
  saveSnapshotToCache: vi.fn(),
}))

const snapshot: DashboardSnapshot = {
  sequence: 0,
  agents: [],
  specialists: [],
  reviewStatuses: [],
  issues: [],
  channelPermissionRequests: [],
  timestamp: '2026-05-16T12:00:00.000Z',
}

function resetDashboardStore() {
  useDashboardStore.setState({
    ...INITIAL_READ_MODEL_STATE,
    bootstrapComplete: false,
    snapshotTimestamp: null,
  })
}

function memoryObservationEvent(sequence: number, id = 'obs-live'): DomainEvent {
  return {
    type: 'memory.observation_created',
    sequence,
    timestamp: '2026-05-16T12:00:01.000Z',
    payload: {
      observation: {
        id,
        timestamp: '2026-05-16T12:00:01.000Z',
        projectId: 'overdeck',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
        runId: 'run-1',
        sessionId: 'session-1',
        agentRole: 'work',
        agentHarness: 'claude-code',
        sourceTranscriptOffset: 1,
        actionStatus: 'Live memory update',
        narrative: 'Live memory update narrative',
        summary: 'Live memory update summary',
        files: [],
        tags: [],
        tokens: { prompt: 1, completion: 1, total: 2 },
        model: 'stub-model',
      },
    },
  } as DomainEvent
}

function systemHeartbeatEvent(): DomainEvent {
  return {
    type: 'system.heartbeat',
    timestamp: '2026-05-16T12:00:15.000Z',
    payload: { ts: 1780792215000 },
  } as DomainEvent
}

describe('EventRouter memory updates', () => {
  let fetchControl: ReturnType<typeof installStrictFetchMock>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/activity') return Response.json([])
      return undefined
    })
    request.mockReset()
    request.mockResolvedValue(snapshot)
    subscribe.mockClear()
    wsTransport.currentTransport = { request, subscribe }
    resetTransport.mockClear()
    unsubscribe.mockReset()
    wsTransport.subscribed = null
    wsTransport.subscribeOptions = null
    document.body.innerHTML = ''
    resetDashboardStore()
  })

  afterEach(async () => {
    cleanup()
    await fetchControl.assertNoUnexpectedRequests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('applies memory observation events from the domain stream to the store', async () => {
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(wsTransport.subscribed).not.toBeNull()

    act(() => {
      wsTransport.subscribed!(memoryObservationEvent(1))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16)
    })

    expect(useDashboardStore.getState().observationsByIssueId['PAN-1052']?.[0]?.id).toBe('obs-live')
  })

  it('does not show the fallback-expired overlay after bootstrap succeeds', async () => {
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })

    for (let elapsed = 0; elapsed < 180_000; elapsed += 30_000) {
      act(() => {
        wsTransport.subscribed!(systemHeartbeatEvent())
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.min(30_000, 180_000 - elapsed))
      })
    }

    expect(document.getElementById('pan-recovery-overlay')).toBeNull()
  })

  it('ignores heartbeat frames for sequencing while resetting stream staleness', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(wsTransport.subscribed).not.toBeNull()

    act(() => {
      wsTransport.subscribed!(systemHeartbeatEvent())
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16)
    })

    expect(useDashboardStore.getState()).toMatchObject({
      observationsByIssueId: {},
      sequence: 0,
    })
    expect(request).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(34_983)
    })
    expect(resetTransport).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(17)
    })
    expect(resetTransport).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(resetTransport).toHaveBeenCalledTimes(1)
    random.mockRestore()
  })

  it('forces a fresh reconnect when the domain stream goes stale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(subscribe).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(resetTransport).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      await Promise.resolve()
    })

    expect(unsubscribe).not.toHaveBeenCalled()
    expect(resetTransport).not.toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999)
    })
    expect(resetTransport).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await Promise.resolve()
    })

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(resetTransport).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledTimes(2)
    random.mockRestore()
    warn.mockRestore()
  })

  it('resets reconnect attempts to the base delay after receiving an event', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(37_000)
      await Promise.resolve()
    })
    expect(resetTransport).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(2)

    act(() => {
      wsTransport.subscribed!(systemHeartbeatEvent())
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000)
    })
    expect(resetTransport).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999)
    })
    expect(resetTransport).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await Promise.resolve()
    })
    expect(resetTransport).toHaveBeenCalledTimes(2)

    random.mockRestore()
    warn.mockRestore()
  })

  it('keeps early retries banner-only and escalates to the blocking overlay when unreachable', async () => {
    const reconnecting = vi.fn()
    window.addEventListener(BACKEND_RECONNECTING_EVENT, reconnecting)
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(wsTransport.subscribeOptions?.onRetry).toBeTypeOf('function')
    expect(wsTransport.subscribeOptions?.onReconnect).toBeTypeOf('function')

    // Early transient retries: reconnecting event fires (non-blocking banner),
    // but the full-screen recovery overlay must NOT appear.
    act(() => {
      wsTransport.subscribeOptions!.onRetry!(1)
    })
    expect(reconnecting).toHaveBeenCalled()
    expect(document.getElementById('pan-recovery-overlay')).toBeNull()

    // Persistent failure escalates to the blocking unreachable overlay.
    act(() => {
      wsTransport.subscribeOptions!.onRetry!(6)
    })
    expect(document.getElementById('pan-recovery-overlay')?.textContent).toContain('Server unreachable — Retry')

    await act(async () => {
      wsTransport.subscribeOptions!.onReconnect!()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.getElementById('pan-recovery-overlay')).toBeNull()
    window.removeEventListener(BACKEND_RECONNECTING_EVENT, reconnecting)
  })

  it('re-bootstraps through the live transport before announcing recovery', async () => {
    const reconnecting = vi.fn()
    const reconnected = vi.fn()
    window.addEventListener(BACKEND_RECONNECTING_EVENT, reconnecting)
    window.addEventListener(BACKEND_RECONNECTED_EVENT, reconnected)
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })

    const freshRequest = vi.fn().mockResolvedValue(snapshot)
    wsTransport.currentTransport = { request: freshRequest, subscribe }

    act(() => {
      wsTransport.subscribeOptions!.onRetry!(1)
    })
    expect(reconnecting).toHaveBeenCalledTimes(1)
    expect(reconnected).not.toHaveBeenCalled()

    await act(async () => {
      wsTransport.subscribeOptions!.onReconnect!()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(freshRequest).toHaveBeenCalledTimes(1)
    expect(reconnected).toHaveBeenCalledTimes(1)
    window.removeEventListener(BACKEND_RECONNECTING_EVENT, reconnecting)
    window.removeEventListener(BACKEND_RECONNECTED_EVENT, reconnected)
  })

  it('schedules another reconnect when snapshot bootstrap fails after transport recovery', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })

    const failedFreshRequest = vi.fn().mockRejectedValue(new Error('snapshot unavailable'))
    wsTransport.currentTransport = { request: failedFreshRequest, subscribe }
    act(() => {
      wsTransport.subscribeOptions!.onRetry!(1)
      wsTransport.subscribeOptions!.onReconnect!()
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999)
    })
    expect(resetTransport).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(resetTransport).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(2)
    random.mockRestore()
    error.mockRestore()
  })

  it('shows an actionable retry overlay after repeated reconnect failures', async () => {
    let resolveBootstrap: (value: DashboardSnapshot) => void = () => undefined
    request.mockReturnValueOnce(new Promise<DashboardSnapshot>((resolve) => {
      resolveBootstrap = resolve
    }))
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      wsTransport.subscribeOptions!.onRetry!(6)
    })

    expect(document.getElementById('pan-recovery-overlay')?.textContent).toContain('Server unreachable — Retry')
    const button = document.querySelector<HTMLButtonElement>('button')
    expect(button?.textContent).toBe('Retry')

    act(() => {
      button!.click()
    })

    expect(resetTransport).not.toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveBootstrap(snapshot)
      await Promise.resolve()
    })

    act(() => {
      button!.click()
    })

    expect(resetTransport).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(2)
  })

  it('drops deferred live events that are covered by replay', async () => {
    request
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce([memoryObservationEvent(1, 'obs-replay-1'), memoryObservationEvent(2, 'obs-replay-2')])

    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(wsTransport.subscribed).not.toBeNull()

    act(() => {
      wsTransport.subscribed!(memoryObservationEvent(2, 'obs-live-duplicate'))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const observations = useDashboardStore.getState().observationsByIssueId['PAN-1052'] ?? []
    expect(observations.map((item) => item.id)).toEqual(['obs-replay-1', 'obs-replay-2'])
  })

  it('applies deferred live events that remain after replay', async () => {
    request
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce([memoryObservationEvent(1, 'obs-replay-1')])
      .mockResolvedValueOnce([])

    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(wsTransport.subscribed).not.toBeNull()

    act(() => {
      wsTransport.subscribed!(memoryObservationEvent(2, 'obs-live-2'))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const observations = useDashboardStore.getState().observationsByIssueId['PAN-1052'] ?? []
    expect(observations.map((item) => item.id)).toEqual(['obs-replay-1', 'obs-live-2'])
  })

  it('does not flush out-of-order live events while sequence-gap replay is in flight', async () => {
    let resolveReplay: (events: DomainEvent[]) => void = () => undefined
    const replayPromise = new Promise<DomainEvent[]>((resolve) => {
      resolveReplay = resolve
    })
    request
      .mockResolvedValueOnce(snapshot)
      .mockReturnValueOnce(replayPromise)
      .mockResolvedValueOnce([])

    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(wsTransport.subscribed).not.toBeNull()

    act(() => {
      wsTransport.subscribed!(memoryObservationEvent(1, 'obs-live-1'))
      wsTransport.subscribed!(memoryObservationEvent(3, 'obs-live-3'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16)
    })

    expect(useDashboardStore.getState().observationsByIssueId['PAN-1052']).toBeUndefined()

    await act(async () => {
      resolveReplay([memoryObservationEvent(1, 'obs-replay-1'), memoryObservationEvent(2, 'obs-replay-2')])
      await Promise.resolve()
      await Promise.resolve()
    })

    const observations = useDashboardStore.getState().observationsByIssueId['PAN-1052'] ?? []
    expect(observations.map((item) => item.id)).toEqual(['obs-replay-1', 'obs-replay-2', 'obs-live-3'])
  })

  it('stops snapshot fallback polling after three minutes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    request.mockRejectedValue(new Error('offline'))

    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(request).toHaveBeenCalledTimes(2)

    for (let elapsed = 0; elapsed < 178_000; elapsed += 30_000) {
      act(() => {
        wsTransport.subscribed!(systemHeartbeatEvent())
      })
      await vi.advanceTimersByTimeAsync(Math.min(30_000, 178_000 - elapsed))
    }
    const callsAtWindowEnd = request.mock.calls.length
    expect(document.getElementById('pan-recovery-overlay')?.textContent).toContain('Server unreachable — Retry')
    act(() => {
      wsTransport.subscribed!(systemHeartbeatEvent())
    })
    await vi.advanceTimersByTimeAsync(4_000)

    expect(request.mock.calls.length).toBe(callsAtWindowEnd)
    error.mockRestore()
  })
})

describe('eventRouterReconnectDelayMs', () => {
  it('doubles reconnect delays and caps the base delay at 30s', () => {
    const noJitter = () => 0.5
    expect(eventRouterReconnectDelayMs(1, noJitter)).toBe(2_000)
    expect(eventRouterReconnectDelayMs(2, noJitter)).toBe(4_000)
    expect(eventRouterReconnectDelayMs(3, noJitter)).toBe(8_000)
    expect(eventRouterReconnectDelayMs(5, noJitter)).toBe(30_000)
    expect(eventRouterReconnectDelayMs(10, noJitter)).toBe(30_000)
  })

  it('applies jitter within -20% and +20% bounds without exceeding the 30s cap', () => {
    expect(eventRouterReconnectDelayMs(1, () => 0)).toBe(1_600)
    expect(eventRouterReconnectDelayMs(1, () => 1)).toBe(2_400)
    expect(eventRouterReconnectDelayMs(5, () => 0)).toBe(24_000)
    expect(eventRouterReconnectDelayMs(5, () => 1)).toBe(30_000)
  })
})
