import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardSnapshot, DomainEvent } from '@panctl/contracts'
import { INITIAL_READ_MODEL_STATE } from '@panctl/contracts'
import { EventRouter } from './EventRouter'
import { useDashboardStore } from '../lib/store'

const wsTransport = vi.hoisted(() => {
  const state = {
    request: vi.fn(),
    subscribe: vi.fn(),
    resetTransport: vi.fn(),
    subscribed: null as ((event: DomainEvent) => void) | null,
    subscribeOptions: null as { onReconnect?: () => void; onRetry?: (attempt: number) => void } | null,
    unsubscribe: vi.fn(),
  }
  state.subscribe.mockImplementation((_connect, listener, options) => {
    state.subscribed = listener
    state.subscribeOptions = options
    return state.unsubscribe
  })
  return state
})
const { request, subscribe, resetTransport, unsubscribe } = wsTransport

vi.mock('../lib/wsTransport', () => ({
  getTransport: () => ({
    request: wsTransport.request,
    subscribe: wsTransport.subscribe,
  }),
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
        projectId: 'panopticon-cli',
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
  beforeEach(() => {
    vi.useFakeTimers()
    request.mockReset()
    request.mockResolvedValue(snapshot)
    subscribe.mockClear()
    resetTransport.mockClear()
    unsubscribe.mockReset()
    wsTransport.subscribed = null
    wsTransport.subscribeOptions = null
    document.body.innerHTML = ''
    resetDashboardStore()
  })

  afterEach(() => {
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
    expect(resetTransport).toHaveBeenCalledTimes(1)
  })

  it('forces a fresh reconnect when the domain stream goes stale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
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

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(resetTransport).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('shows reconnect overlay on retries and hides it after reconnect', async () => {
    render(<EventRouter />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(wsTransport.subscribeOptions?.onRetry).toBeTypeOf('function')
    expect(wsTransport.subscribeOptions?.onReconnect).toBeTypeOf('function')

    act(() => {
      wsTransport.subscribeOptions!.onRetry!(1)
    })
    expect(document.getElementById('pan-recovery-overlay')?.textContent).toContain('Reconnecting to the dashboard…')

    act(() => {
      wsTransport.subscribeOptions!.onReconnect!()
    })
    expect(document.getElementById('pan-recovery-overlay')).toBeNull()
  })

  it('shows an actionable retry overlay after repeated reconnect failures', async () => {
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
