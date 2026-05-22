/**
 * Unit tests for the DashboardStore event reducers and selectors (PAN-428 B4)
 */

import { beforeEach, describe, it, expect } from 'vitest'
import {
  syncSnapshotReducer,
  applyEventReducer,
  applyEventsReducer,
  selectAgents,
  selectAgentById,
  selectAgentsByRole,
  selectReviewStatus,
  selectAgentOutput,
  selectChannelPermissionRequests,
  selectIsBootstrapped,
  selectResources,
  selectIssues,
  selectIssuesByCycle,
  selectMemoryObservations,
  selectMemoryStatus,
  selectResetMarkersByScope,
  useDashboardStore,
  type DashboardState,
} from '../lib/store'
import {
  INITIAL_READ_MODEL_STATE,
  type AgentSnapshot,
  type DashboardSnapshot,
  type DomainEvent,
} from '@panctl/contracts'

// ─── Test fixtures ────────────────────────────────────────────────────────────

const baseAgent: AgentSnapshot = {
  id: 'agent-1',
  issueId: 'PAN-1',
  workspace: '/ws/1',
  runtime: 'claude-code',
  model: 'claude-sonnet-4',
  status: 'running',
  startedAt: '2026-01-01T00:00:00Z',
}

// PAN-1048 — role-tagged agent fixture used to exercise selectAgentsByRole.
const reviewAgent: AgentSnapshot = {
  id: 'review-1',
  issueId: 'PAN-1',
  workspace: '/ws/1',
  runtime: 'claude-code',
  model: 'claude-sonnet-4',
  status: 'running',
  startedAt: '2026-01-01T00:00:00Z',
  role: 'review',
}

const emptyState: DashboardState = {
  ...INITIAL_READ_MODEL_STATE,
  drawer: { issueId: null, tab: 'overview' },
  bootstrapComplete: false,
  snapshotTimestamp: null,
}

function makeSnapshot(seq = 5): DashboardSnapshot {
  return {
    sequence: seq,
    agents: [baseAgent],
    // PAN-1048 — specialists projection retired; field kept on the wire for
    // back-compat but always empty.
    specialists: [],
    reviewStatuses: [],
    issues: [],
    channelPermissionRequests: [],
    timestamp: '2026-01-01T00:00:00Z',
  }
}

function makeEvent(type: DomainEvent['type'], seq: number, payload: Record<string, unknown> = {}): DomainEvent {
  return { type, sequence: seq, timestamp: new Date().toISOString(), payload } as DomainEvent
}

function makeObservation(id: string) {
  return {
    id,
    timestamp: '2026-05-16T12:00:00.000Z',
    projectId: 'panopticon-cli',
    workspaceId: 'feature-pan-1052',
    issueId: 'PAN-1052',
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
    sourceTranscriptOffset: 1,
    actionStatus: `Completed ${id}`,
    narrative: `Narrative ${id}`,
    summary: `Summary ${id}`,
    files: [],
    tags: [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  }
}

const memoryStatus = {
  name: 'PAN-1052 memory status',
  headline: 'Memory status updated',
  summary: 'Memory status summary',
  goal: 'Exercise memory store slices',
  phase: 'verifying',
  accomplished: ['observations'],
  decided: [],
  open: [],
  nextSteps: ['continue'],
  confidence: 0.9,
  workingSet: ['src/dashboard/frontend/src/lib/store.ts'],
  tags: ['memory'],
} as const

const resetMarker = {
  id: 'reset-1',
  scope: 'workspace',
  scopeId: 'feature-pan-1052',
  reason: 'reset test',
  fromTimestamp: '2026-05-16T12:00:00.000Z',
  createdAt: '2026-05-16T12:00:00.000Z',
} as const

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  useDashboardStore.setState(emptyState)
})

describe('drawer store slice', () => {
  it('replaces the open issue instead of stacking drawers', () => {
    useDashboardStore.getState().openIssue('PAN-1')
    useDashboardStore.getState().openIssue('PAN-2', 'plan')

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-2', tab: 'plan' })
    expect(window.location.search).toBe('?issue=PAN-2&tab=plan')
  })

  it('closes by removing drawer URL params and resetting state', () => {
    window.history.replaceState(null, '', '/?phase=ship&issue=PAN-1&tab=activity')
    useDashboardStore.getState().syncDrawerFromUrl()

    useDashboardStore.getState().closeIssue()

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: null, tab: 'overview' })
    expect(window.location.search).toBe('?phase=ship')
  })

  it('handles rapid open-close-open bursts without creating stale state', () => {
    for (let i = 0; i < 50; i += 1) {
      useDashboardStore.getState().openIssue(`PAN-${i}`)
      useDashboardStore.getState().closeIssue()
    }

    useDashboardStore.getState().openIssue('PAN-final')

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-final', tab: 'overview' })
    expect(window.location.search).toBe('?issue=PAN-final&tab=overview')
  })

  it('preserves drawer state through event reducer updates', () => {
    const state = { ...emptyState, drawer: { issueId: 'PAN-1', tab: 'overview' } }
    const next = applyEventReducer(state, makeEvent('agent.created', 1, { agentId: 'agent-1', agent: baseAgent }))

    expect(next.drawer).toEqual({ issueId: 'PAN-1', tab: 'overview' })
  })
})

// ─── syncSnapshotReducer ──────────────────────────────────────────────────────

describe('syncSnapshotReducer', () => {
  it('sets bootstrapComplete and populates state from snapshot', () => {
    const next = syncSnapshotReducer(emptyState, makeSnapshot(10))
    expect(next.bootstrapComplete).toBe(true)
    expect(next.sequence).toBe(10)
    expect(Object.keys(next.agentsById)).toHaveLength(1)
    expect(next.agentsById['agent-1']).toEqual(baseAgent)
  })
})

// ─── Agent event reducers ─────────────────────────────────────────────────────

describe('applyEventReducer — agent events', () => {
  it('agent.created adds agent to store', () => {
    const event = makeEvent('agent.created', 1, { agentId: 'agent-1', issueId: 'PAN-1', agent: baseAgent })
    const next = applyEventReducer(emptyState, event)
    expect(next.agentsById['agent-1']).toEqual(baseAgent)
    expect(next.sequence).toBe(1)
  })

  it('agent.started adds agent to store', () => {
    const event = makeEvent('agent.started', 2, { agentId: 'agent-1', issueId: 'PAN-1', agent: baseAgent })
    const next = applyEventReducer(emptyState, event)
    expect(next.agentsById['agent-1']).toEqual(baseAgent)
  })

  it('agent.stopped removes agent from store', () => {
    const state: DashboardState = { ...emptyState, agentsById: { 'agent-1': baseAgent } }
    const event = makeEvent('agent.stopped', 3, { agentId: 'agent-1', issueId: 'PAN-1' })
    const next = applyEventReducer(state, event)
    expect(next.agentsById['agent-1']).toBeUndefined()
    expect(Object.keys(next.agentsById)).toHaveLength(0)
  })

  it('agent.status_changed updates agent status', () => {
    const state: DashboardState = { ...emptyState, agentsById: { 'agent-1': baseAgent } }
    const event = makeEvent('agent.status_changed', 4, { agentId: 'agent-1', status: 'stopped' })
    const next = applyEventReducer(state, event)
    expect(next.agentsById['agent-1']!.status).toBe('stopped')
  })

  it('agent.status_changed leaves agentsById unchanged if agent not found', () => {
    const event = makeEvent('agent.status_changed', 5, { agentId: 'unknown', status: 'stopped' })
    const next = applyEventReducer(emptyState, event)
    expect(next.agentsById).toEqual({})
    expect(next.agentsById).toBe(emptyState.agentsById)
  })

  it('agent.output_received appends lines and caps at 200', () => {
    const state: DashboardState = {
      ...emptyState,
      agentOutputById: { 'agent-1': ['existing line'] },
    }
    const event = makeEvent('agent.output_received', 6, {
      agentId: 'agent-1',
      lines: ['line 1', 'line 2'],
    })
    const next = applyEventReducer(state, event)
    expect(next.agentOutputById['agent-1']).toEqual(['existing line', 'line 1', 'line 2'])
  })

  it('agent.output_received caps at 200 lines', () => {
    const bigOutput = Array.from({ length: 199 }, (_, i) => `line ${i}`)
    const state: DashboardState = { ...emptyState, agentOutputById: { 'a1': bigOutput } }
    const event = makeEvent('agent.output_received', 7, { agentId: 'a1', lines: ['x', 'y'] })
    const next = applyEventReducer(state, event)
    expect(next.agentOutputById['a1']!.length).toBe(200)
  })
})

// ─── Runtime reducers ─────────────────────────────────────────────────────────

describe('applyEventReducer — runtime events', () => {
  it('agent.channel_reply stores structured reply in runtime snapshot', () => {
    const event = makeEvent('agent.channel_reply', 8, {
      agentId: 'agent-1',
      reply: {
        kind: 'done',
        summary: 'Implementation complete',
        artifactRefs: [{ uri: 'file:///tmp/report.txt', label: 'report' }],
      },
    })
    const next = applyEventReducer(emptyState, event)
    expect(next.agentRuntimeById['agent-1']?.channelReply).toMatchObject({
      kind: 'done',
      summary: 'Implementation complete',
      artifactRefs: [{ uri: 'file:///tmp/report.txt', label: 'report' }],
    })
    expect(next.agentRuntimeById['agent-1']?.resolution).toBe('done')
  })

  it('agent.message_received clears stale channel reply on new inbound message', () => {
    const withReply = applyEventReducer(
      emptyState,
      makeEvent('agent.channel_reply', 9, {
        agentId: 'agent-1',
        reply: { kind: 'needs_input', summary: 'Need answer', artifactRefs: [] },
      }),
    )
    const next = applyEventReducer(
      withReply,
      makeEvent('agent.message_received', 10, {
        agentId: 'agent-1',
        direction: 'to_agent',
        source: 'user',
      }),
    )
    expect(next.agentRuntimeById['agent-1']?.channelReply).toBeUndefined()
  })

  it('agent.stopped clears stale channel reply for restarted agents', () => {
    const withReply = applyEventReducer(
      emptyState,
      makeEvent('agent.channel_reply', 11, {
        agentId: 'agent-1',
        reply: { kind: 'done', summary: 'Implementation complete', artifactRefs: [] },
      }),
    )
    const next = applyEventReducer(
      withReply,
      makeEvent('agent.stopped', 12, {
        agentId: 'agent-1',
        issueId: 'PAN-1',
      }),
    )
    expect(next.agentRuntimeById['agent-1']?.activity).toBe('stopped')
    expect(next.agentRuntimeById['agent-1']?.channelReply).toBeUndefined()
  })
})

// ─── Pipeline / review reducers ───────────────────────────────────────────────

describe('applyEventReducer — review/pipeline events', () => {
  it('pipeline.status_changed updates review status', () => {
    const status = {
      issueId: 'PAN-1',
      reviewStatus: 'passed' as const,
      testStatus: 'pending' as const,
      readyForMerge: false,
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const event = makeEvent('pipeline.status_changed', 8, { issueId: 'PAN-1', status })
    const next = applyEventReducer(emptyState, event)
    expect(next.reviewStatusByIssueId['PAN-1']).toEqual(status)
  })
})

// ─── Resource / activity reducers ─────────────────────────────────────────────

describe('applyEventReducer — resources and activity', () => {
  it('resources.updated sets resource stats', () => {
    const resources = { containers: 3, networks: 2 }
    const event = makeEvent('resources.updated', 9, { resources })
    const next = applyEventReducer(emptyState, event)
    expect(next.resources).toEqual(resources)
  })

  it('shadow.inference_update stores content per issue', () => {
    const event = makeEvent('shadow.inference_update', 10, {
      issueId: 'PAN-42',
      content: 'Agent is working on...',
    })
    const next = applyEventReducer(emptyState, event)
    expect(next.shadowInferenceByIssueId['PAN-42']).toBe('Agent is working on...')
  })
})

// ─── Memory reducers ──────────────────────────────────────────────────────────

describe('applyEventReducer — memory events', () => {
  it('stores memory observations by issue through the shared reducer', () => {
    const observation = makeObservation('obs-1')
    const next = applyEventReducer(
      emptyState,
      makeEvent('memory.observation_created', 11, { observation }),
    )

    expect(next.observationsByIssueId['PAN-1052']).toEqual([observation])
    expect(next.sequence).toBe(11)
  })

  it('caps memory observations at 50 per issue', () => {
    const events = Array.from({ length: 51 }, (_, index) => makeEvent(
      'memory.observation_created',
      index + 1,
      { observation: makeObservation(`obs-${index}`) },
    ))

    const next = applyEventsReducer(emptyState, events)

    expect(next.observationsByIssueId['PAN-1052']).toHaveLength(50)
    expect(next.observationsByIssueId['PAN-1052']?.[0]?.id).toBe('obs-1')
    expect(next.observationsByIssueId['PAN-1052']?.[49]?.id).toBe('obs-50')
  })

  it('stores memory status and reset markers by key', () => {
    const withStatus = applyEventReducer(
      emptyState,
      makeEvent('memory.status_updated', 12, {
        identity: { projectId: 'panopticon-cli', workspaceId: 'feature-pan-1052', issueId: 'PAN-1052' },
        status: memoryStatus,
      }),
    )
    const next = applyEventReducer(
      withStatus,
      makeEvent('memory.reset_marker_created', 13, { marker: resetMarker }),
    )

    expect(next.statusByIssueId['PAN-1052']).toEqual(memoryStatus)
    expect(next.resetMarkersByScopeId['workspace:feature-pan-1052']).toEqual([resetMarker])
  })
})

// ─── applyEventsReducer ───────────────────────────────────────────────────────

describe('applyEventsReducer', () => {
  it('applies a batch of events in order', () => {
    const events: DomainEvent[] = [
      makeEvent('agent.created', 1, { agentId: 'a1', issueId: 'PAN-1', agent: baseAgent }),
      makeEvent('agent.stopped', 2, { agentId: 'a1', issueId: 'PAN-1' }),
    ]
    const next = applyEventsReducer(emptyState, events)
    expect(next.agentsById['a1']).toBeUndefined()
    expect(next.sequence).toBe(2)
  })

  it('sequence is set to maximum seen across events', () => {
    const events: DomainEvent[] = [
      makeEvent('agent.created', 5, { agentId: 'a1', issueId: 'PAN-1', agent: baseAgent }),
      makeEvent('agent.stopped', 7, { agentId: 'a1', issueId: 'PAN-1' }),
    ]
    const next = applyEventsReducer(emptyState, events)
    expect(next.sequence).toBe(7)
  })
})

// ─── Selectors ────────────────────────────────────────────────────────────────

describe('selectors', () => {
  const state: DashboardState = {
    ...emptyState,
    bootstrapComplete: true,
    agentsById: { 'a1': baseAgent, 'review-1': reviewAgent },
    agentOutputById: { 'a1': ['line 1', 'line 2'] },
    resources: { containers: 5, networks: 3 },
  }

  it('selectAgents returns array of agents', () => {
    expect(selectAgents(state).map((a) => a.id).sort()).toEqual(['agent-1', 'review-1'])
  })

  it('selectAgentById returns agent for known id', () => {
    expect(selectAgentById('a1')(state)).toEqual(baseAgent)
  })

  it('selectAgentById returns undefined for unknown id', () => {
    expect(selectAgentById('unknown')(state)).toBeUndefined()
  })

  it('selectAgentsByRole returns role-tagged agents (PAN-1048)', () => {
    expect(selectAgentsByRole('review')(state)).toEqual([reviewAgent])
    expect(selectAgentsByRole('test')(state)).toEqual([])
  })

  it('selectReviewStatus returns undefined when not present', () => {
    expect(selectReviewStatus('PAN-1')(state)).toBeUndefined()
  })

  it('selectAgentOutput returns lines for known agent', () => {
    expect(selectAgentOutput('a1')(state)).toEqual(['line 1', 'line 2'])
  })

  it('selectAgentOutput returns empty array for unknown agent', () => {
    expect(selectAgentOutput('unknown')(state)).toEqual([])
  })

  it('selectIsBootstrapped returns true when bootstrapped', () => {
    expect(selectIsBootstrapped(state)).toBe(true)
  })

  it('selectResources returns resource stats', () => {
    expect(selectResources(state)).toEqual({ containers: 5, networks: 3 })
  })

  it('selectMemoryObservations returns observations for an issue', () => {
    const observation = makeObservation('obs-selector')
    const withMemory: DashboardState = {
      ...state,
      observationsByIssueId: { 'PAN-1052': [observation] },
    }

    expect(selectMemoryObservations('PAN-1052')(withMemory)).toEqual([observation])
    expect(selectMemoryObservations('PAN-404')(withMemory)).toEqual([])
  })

  it('selectMemoryStatus returns status for an issue', () => {
    const withMemory: DashboardState = {
      ...state,
      statusByIssueId: { 'PAN-1052': memoryStatus },
    }

    expect(selectMemoryStatus('PAN-1052')(withMemory)).toEqual(memoryStatus)
    expect(selectMemoryStatus('PAN-404')(withMemory)).toBeUndefined()
  })

  it('selectResetMarkersByScope returns markers for a scope key', () => {
    const withMemory: DashboardState = {
      ...state,
      resetMarkersByScopeId: { 'workspace:feature-pan-1052': [resetMarker] },
    }

    expect(selectResetMarkersByScope('workspace', 'feature-pan-1052')(withMemory)).toEqual([resetMarker])
    expect(selectResetMarkersByScope('issue', 'PAN-404')(withMemory)).toEqual([])
  })

  it('selectChannelPermissionRequests returns pending requests oldest first', () => {
    const withPermissions: DashboardState = {
      ...state,
      channelPermissionRequestsById: {
        'perm-2': {
          requestId: 'perm-2',
          agentId: 'agent-2',
          issueId: 'PAN-2',
          toolName: 'Bash',
          description: 'Run npm test',
          inputPreview: '{"command":"npm test"}',
          createdAt: '2026-05-07T18:31:00.000Z',
        },
        'perm-1': {
          requestId: 'perm-1',
          agentId: 'agent-1',
          issueId: 'PAN-1',
          toolName: 'Read',
          description: 'Read continue file',
          inputPreview: '{"file":".pan/continue.json"}',
          createdAt: '2026-05-07T18:30:00.000Z',
        },
      },
    }

    expect(selectChannelPermissionRequests(withPermissions).map((request) => request.requestId)).toEqual([
      'perm-1',
      'perm-2',
    ])
  })
})

// ─── selectIssues / selectIssuesByCycle ───────────────────────────────────────

describe('selectIssues', () => {
  it('returns raw issues array', () => {
    const issues = [{ id: 'PAN-1' }, { id: 'PAN-2' }]
    const state: DashboardState = { ...emptyState, issuesRaw: issues }
    expect(selectIssues(state)).toEqual(issues)
  })

  it('returns empty array when no issues', () => {
    expect(selectIssues(emptyState)).toEqual([])
  })
})

describe('selectIssuesByCycle', () => {
  const issues = [
    { id: 'PAN-1', canonicalStatus: 'todo', state: 'todo' },
    { id: 'PAN-2', canonicalStatus: 'in_progress', state: 'started' },
    { id: 'PAN-3', canonicalStatus: 'done', state: 'done' },
    { id: 'PAN-4', canonicalStatus: 'canceled', state: 'canceled' },
    { id: 'PAN-5', canonicalStatus: 'in_review', state: 'in_review' },
  ]
  const state: DashboardState = { ...emptyState, issuesRaw: issues }

  it('excludes canceled issues when includeCompleted=false (done issues stay visible)', () => {
    const result = selectIssuesByCycle('current', false)(state) as Array<{ id: string }>
    expect(result.map(i => i.id)).toEqual(['PAN-1', 'PAN-2', 'PAN-3', 'PAN-5'])
  })

  it('includes all issues when includeCompleted=true', () => {
    const result = selectIssuesByCycle('current', true)(state)
    expect(result).toHaveLength(5)
  })

  it('filters by state field as well as canonicalStatus', () => {
    const mixedIssues = [
      { id: 'A', state: 'done' },
      { id: 'B', canonicalStatus: 'canceled' },
      { id: 'C', state: 'todo' },
    ]
    const s: DashboardState = { ...emptyState, issuesRaw: mixedIssues }
    const result = selectIssuesByCycle('all', false)(s) as Array<{ id: string }>
    // Done issues are always visible (PAN-500); only canceled filtered out
    expect(result.map(i => i.id)).toEqual(['A', 'C'])
  })

  it('returns empty array when no issues', () => {
    expect(selectIssuesByCycle('current', false)(emptyState)).toEqual([])
  })
})
