import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardSnapshot, DomainEvent } from '@panctl/contracts'
import { INITIAL_READ_MODEL_STATE } from '@panctl/contracts'
import { EventRouter } from './EventRouter'
import { useDashboardStore } from '../lib/store'

const request = vi.fn()
let subscribed: ((event: DomainEvent) => void) | null = null
const unsubscribe = vi.fn()

vi.mock('../lib/wsTransport', () => ({
  getTransport: () => ({
    request,
    subscribe: vi.fn((_connect, listener) => {
      subscribed = listener
      return unsubscribe
    }),
  }),
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

function memoryObservationEvent(sequence: number): DomainEvent {
  return {
    type: 'memory.observation_created',
    sequence,
    timestamp: '2026-05-16T12:00:01.000Z',
    payload: {
      observation: {
        id: 'obs-live',
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

describe('EventRouter memory updates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    request.mockReset()
    request.mockResolvedValue(snapshot)
    unsubscribe.mockReset()
    subscribed = null
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
    expect(subscribed).not.toBeNull()

    act(() => {
      subscribed!(memoryObservationEvent(1))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16)
    })

    expect(useDashboardStore.getState().observationsByIssueId['PAN-1052']?.[0]?.id).toBe('obs-live')
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

    await vi.advanceTimersByTimeAsync(178_000)
    const callsAtWindowEnd = request.mock.calls.length
    await vi.advanceTimersByTimeAsync(4_000)

    expect(request.mock.calls.length).toBe(callsAtWindowEnd)
    error.mockRestore()
  })
})
