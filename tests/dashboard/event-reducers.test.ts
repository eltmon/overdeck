/**
 * Unit tests for shared event reducers (PAN-434)
 *
 * Tests pure logic in packages/contracts/src/event-reducers.ts.
 * These reducers are used by both the server read model and the frontend Zustand store.
 */

import { describe, it, expect } from 'vitest'
import {
  applyEvent,
  applyEvents,
  syncSnapshot,
  INITIAL_READ_MODEL_STATE,
  ReadModelState,
} from '../../packages/contracts/src/event-reducers.js'
import type { AgentSnapshot, DashboardSnapshot } from '../../packages/contracts/src/index.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<ReadModelState> = {}): ReadModelState {
  return { ...INITIAL_READ_MODEL_STATE, ...overrides }
}

function ts(): string {
  return new Date().toISOString()
}

const baseAgent: AgentSnapshot = {
  id: 'agent-1',
  issueId: 'PAN-1',
  status: 'running',
  phase: 'implementation',
  worktree: '/tmp/agent-1',
  tmuxSession: 'pan-agent-1',
  startedAt: '2026-01-01T10:00:00Z',
  model: 'claude-opus-4-6',
}

// ─── INITIAL_READ_MODEL_STATE ────────────────────────────────────────────────

describe('INITIAL_READ_MODEL_STATE', () => {
  it('starts with sequence 0', () => {
    expect(INITIAL_READ_MODEL_STATE.sequence).toBe(0)
  })

  it('starts with empty collections', () => {
    expect(INITIAL_READ_MODEL_STATE.agentsById).toEqual({})
    expect(INITIAL_READ_MODEL_STATE.reviewStatusByIssueId).toEqual({})
    expect(INITIAL_READ_MODEL_STATE.agentOutputById).toEqual({})
    expect(INITIAL_READ_MODEL_STATE.issuesRaw).toEqual([])
    expect(INITIAL_READ_MODEL_STATE.recentActivity).toEqual([])
    expect(INITIAL_READ_MODEL_STATE.shadowInferenceByIssueId).toEqual({})
    expect(INITIAL_READ_MODEL_STATE.resources).toBeNull()
  })
})

// ─── syncSnapshot ────────────────────────────────────────────────────────────

describe('syncSnapshot', () => {
  // DashboardSnapshot only contains: sequence, agents, specialists, reviewStatuses, resources, timestamp
  // agentOutput, recentActivity, shadowInference are NOT part of the snapshot — they arrive via events
  const snapshot: DashboardSnapshot = {
    sequence: 10,
    agents: [baseAgent],
    // PAN-1048 — specialists projection retired; snapshot field kept on the
    // wire for back-compat but the reducer no longer materializes it.
    specialists: [],
    reviewStatuses: [],
    resources: { cpu: 30, memPercent: 50, memUsed: 1000, memTotal: 2000 },
    timestamp: new Date().toISOString(),
  }

  it('populates agentsById keyed by agent id', () => {
    const state = syncSnapshot(makeState(), snapshot)
    expect(state.agentsById['agent-1']).toEqual(baseAgent)
  })

  it('sets sequence from snapshot', () => {
    const state = syncSnapshot(makeState(), snapshot)
    expect(state.sequence).toBe(10)
  })

  it('sets resources', () => {
    const state = syncSnapshot(makeState(), snapshot)
    expect(state.resources).toEqual({ cpu: 30, memPercent: 50, memUsed: 1000, memTotal: 2000 })
  })

  it('sets issuesRaw from snapshot.issues if present', () => {
    const snapshotWithIssues = { ...snapshot, issues: [{ id: 'PAN-1' }, { id: 'PAN-2' }] } as any
    const state = syncSnapshot(makeState(), snapshotWithIssues)
    expect(state.issuesRaw).toHaveLength(2)
  })

  it('preserves existing issuesRaw when snapshot has no issues field', () => {
    const existing = makeState({ issuesRaw: [{ id: 'OLD' }] as unknown[] })
    const state = syncSnapshot(existing, snapshot)
    expect(state.issuesRaw).toHaveLength(1)
    expect((state.issuesRaw[0] as any).id).toBe('OLD')
  })
})

// ─── applyEvent — agent events ───────────────────────────────────────────────

describe('applyEvent — agent.started', () => {
  it('adds agent to agentsById', () => {
    const state = applyEvent(makeState(), {
      type: 'agent.started',
      sequence: 1,
      timestamp: ts(),
      payload: { agentId: 'agent-1', issueId: 'PAN-1', agent: baseAgent },
    })
    expect(state.agentsById['agent-1']).toEqual(baseAgent)
  })

  it('updates sequence', () => {
    const state = applyEvent(makeState(), {
      type: 'agent.started',
      sequence: 7,
      timestamp: ts(),
      payload: { agentId: 'agent-1', issueId: 'PAN-1', agent: baseAgent },
    })
    expect(state.sequence).toBe(7)
  })
})

describe('applyEvent — agent.created', () => {
  it('adds agent to agentsById', () => {
    const state = applyEvent(makeState(), {
      type: 'agent.created',
      sequence: 2,
      timestamp: ts(),
      payload: { agentId: 'agent-1', issueId: 'PAN-1', agent: baseAgent },
    })
    expect(state.agentsById['agent-1']).toEqual(baseAgent)
  })
})

describe('applyEvent — agent.stopped', () => {
  it('removes agent from agentsById', () => {
    const state = makeState({ agentsById: { 'agent-1': baseAgent } })
    const next = applyEvent(state, {
      type: 'agent.stopped',
      sequence: 3,
      timestamp: ts(),
      payload: { agentId: 'agent-1', issueId: 'PAN-1' },
    })
    expect(next.agentsById['agent-1']).toBeUndefined()
    expect(Object.keys(next.agentsById)).toHaveLength(0)
  })

  it('does not error when agent not found', () => {
    const state = makeState()
    const next = applyEvent(state, {
      type: 'agent.stopped',
      sequence: 3,
      timestamp: ts(),
      payload: { agentId: 'unknown', issueId: 'PAN-99' },
    })
    expect(next.agentsById).toEqual({})
  })

  it('preserves other agents', () => {
    const agent2: AgentSnapshot = { ...baseAgent, id: 'agent-2', issueId: 'PAN-2' }
    const state = makeState({ agentsById: { 'agent-1': baseAgent, 'agent-2': agent2 } })
    const next = applyEvent(state, {
      type: 'agent.stopped',
      sequence: 4,
      timestamp: ts(),
      payload: { agentId: 'agent-1', issueId: 'PAN-1' },
    })
    expect(next.agentsById['agent-2']).toEqual(agent2)
    expect(Object.keys(next.agentsById)).toHaveLength(1)
  })

  it('drops stored turn diff summaries for the stopped agent', () => {
    const state = makeState({
      agentsById: { 'agent-1': baseAgent },
      turnDiffSummariesByAgentId: {
        'agent-1': [{ turnId: 'turn-1', completedAt: ts(), files: [] }],
        'agent-2': [{ turnId: 'turn-2', completedAt: ts(), files: [] }],
      },
    })
    const next = applyEvent(state, {
      type: 'agent.stopped',
      sequence: 4,
      timestamp: ts(),
      payload: { agentId: 'agent-1', issueId: 'PAN-1' },
    })
    expect(next.turnDiffSummariesByAgentId['agent-1']).toBeUndefined()
    expect(next.turnDiffSummariesByAgentId['agent-2']).toEqual(state.turnDiffSummariesByAgentId['agent-2'])
  })
})

describe('applyEvent — agent.status_changed', () => {
  it('updates status on known agent', () => {
    const state = makeState({ agentsById: { 'agent-1': baseAgent } })
    const next = applyEvent(state, {
      type: 'agent.status_changed',
      sequence: 5,
      timestamp: ts(),
      payload: { agentId: 'agent-1', status: 'stopped' },
    })
    expect(next.agentsById['agent-1']!.status).toBe('stopped')
  })

  it('leaves agentsById unchanged if agent not found', () => {
    const state = makeState()
    const next = applyEvent(state, {
      type: 'agent.status_changed',
      sequence: 5,
      timestamp: ts(),
      payload: { agentId: 'unknown', status: 'stopped' },
    })
    expect(next.agentsById).toBe(state.agentsById)
  })

  it('updates sequence even when agent not found', () => {
    const state = makeState({ sequence: 0 })
    const next = applyEvent(state, {
      type: 'agent.status_changed',
      sequence: 5,
      timestamp: ts(),
      payload: { agentId: 'unknown', status: 'stopped' },
    })
    expect(next.sequence).toBe(5)
  })

  it('drops stored turn diff summaries when the agent enters a terminal status', () => {
    const state = makeState({
      agentsById: { 'agent-1': baseAgent },
      turnDiffSummariesByAgentId: {
        'agent-1': [{ turnId: 'turn-1', completedAt: ts(), files: [] }],
      },
    })
    const next = applyEvent(state, {
      type: 'agent.status_changed',
      sequence: 5,
      timestamp: ts(),
      payload: { agentId: 'agent-1', status: 'stopped' },
    })
    expect(next.turnDiffSummariesByAgentId['agent-1']).toBeUndefined()
  })
})

describe('applyEvent — agent.turn_diff_completed', () => {
  it('retains only the latest 200 summaries per agent', () => {
    const existing = Array.from({ length: 200 }, (_, index) => ({
      turnId: `turn-${index + 1}`,
      completedAt: `2026-05-08T05:${String(index).padStart(2, '0')}:00.000Z`,
      files: [{ path: `src/file-${index + 1}.ts`, additions: 1, deletions: 0 }],
    }))
    const state = makeState({ turnDiffSummariesByAgentId: { 'agent-1': existing } })
    const next = applyEvent(state, {
      type: 'agent.turn_diff_completed',
      sequence: 6,
      timestamp: ts(),
      payload: {
        agentId: 'agent-1',
        turnId: 'turn-201',
        completedAt: '2026-05-08T09:21:00.000Z',
        files: [{ path: 'src/file-201.ts', additions: 3, deletions: 1 }],
      },
    })

    expect(next.turnDiffSummariesByAgentId['agent-1']).toHaveLength(200)
    expect(next.turnDiffSummariesByAgentId['agent-1']?.[0]?.turnId).toBe('turn-2')
    expect(next.turnDiffSummariesByAgentId['agent-1']?.at(-1)?.turnId).toBe('turn-201')
  })
})

describe('applyEvent — agent.output_received', () => {
  it('appends lines to existing output', () => {
    const state = makeState({ agentOutputById: { 'agent-1': ['existing'] } })
    const next = applyEvent(state, {
      type: 'agent.output_received',
      sequence: 6,
      timestamp: ts(),
      payload: { agentId: 'agent-1', lines: ['new1', 'new2'] },
    })
    expect(next.agentOutputById['agent-1']).toEqual(['existing', 'new1', 'new2'])
  })

  it('creates new buffer for unknown agent', () => {
    const state = makeState()
    const next = applyEvent(state, {
      type: 'agent.output_received',
      sequence: 6,
      timestamp: ts(),
      payload: { agentId: 'agent-1', lines: ['hello'] },
    })
    expect(next.agentOutputById['agent-1']).toEqual(['hello'])
  })

  it('caps output at 200 lines', () => {
    const bigOutput = Array.from({ length: 199 }, (_, i) => `line ${i}`)
    const state = makeState({ agentOutputById: { 'agent-1': bigOutput } })
    const next = applyEvent(state, {
      type: 'agent.output_received',
      sequence: 7,
      timestamp: ts(),
      payload: { agentId: 'agent-1', lines: ['x', 'y', 'z'] },
    })
    expect(next.agentOutputById['agent-1']!.length).toBe(200)
    // Most recent lines kept
    expect(next.agentOutputById['agent-1']!.at(-1)).toBe('z')
    expect(next.agentOutputById['agent-1']!.at(-2)).toBe('y')
  })
})

// ─── applyEvent — specialist events (sequence-only no-ops post PAN-1048) ────
// The specialistsByName projection has been retired. Specialist lifecycle is
// now visible via agent.started / agent.stopped + role-filtered agentsById.
// Specialist events still flow over the wire so older clients don't crash, but
// the reducer only advances the sequence number.

describe('applyEvent — specialist.* events (post PAN-1048)', () => {
  it('only advances sequence for specialist.started', () => {
    const state = makeState({ sequence: 0 })
    const next = applyEvent(state, {
      type: 'specialist.started',
      sequence: 10,
      timestamp: ts(),
      payload: { name: 'review', state: 'active', isRunning: true },
    } as any)
    expect(next.sequence).toBe(10)
    expect(next.agentsById).toBe(state.agentsById)
  })

  it('only advances sequence for specialist.completed', () => {
    const state = makeState({ sequence: 0 })
    const next = applyEvent(state, {
      type: 'specialist.completed',
      sequence: 11,
      timestamp: ts(),
      payload: { name: 'review', issueId: 'PAN-1' },
    } as any)
    expect(next.sequence).toBe(11)
  })

  it('only advances sequence for specialist.failed', () => {
    const state = makeState({ sequence: 0 })
    const next = applyEvent(state, {
      type: 'specialist.failed',
      sequence: 12,
      timestamp: ts(),
      payload: { name: 'review', issueId: 'PAN-1', error: 'timeout' },
    } as any)
    expect(next.sequence).toBe(12)
  })
})

// ─── applyEvent — review/pipeline status ────────────────────────────────────

describe('applyEvent — review.status_changed', () => {
  it('updates reviewStatusByIssueId', () => {
    const status = { review: 'passed', test: 'passed', merge: 'pending' } as any
    const state = applyEvent(makeState(), {
      type: 'review.status_changed',
      sequence: 15,
      timestamp: ts(),
      payload: { issueId: 'PAN-1', status },
    })
    expect(state.reviewStatusByIssueId['PAN-1']).toEqual(status)
  })
})

describe('applyEvent — pipeline.status_changed', () => {
  it('updates reviewStatusByIssueId', () => {
    const status = { review: 'reviewing', test: 'pending', merge: 'pending' } as any
    const state = applyEvent(makeState(), {
      type: 'pipeline.status_changed',
      sequence: 16,
      timestamp: ts(),
      payload: { issueId: 'PAN-2', status },
    })
    expect(state.reviewStatusByIssueId['PAN-2']).toEqual(status)
  })
})

// ─── applyEvent — resources ──────────────────────────────────────────────────

describe('applyEvent — resources.updated', () => {
  it('updates resources', () => {
    const resources = { cpu: 45, memPercent: 60, memUsed: 8000, memTotal: 16000 }
    const state = applyEvent(makeState(), {
      type: 'resources.updated',
      sequence: 20,
      timestamp: ts(),
      payload: { resources },
    })
    expect(state.resources).toEqual(resources)
  })
})

// ─── applyEvent — issues ─────────────────────────────────────────────────────

describe('applyEvent — issues.snapshot', () => {
  it('replaces issuesRaw', () => {
    const issues = [{ id: 'PAN-1' }, { id: 'PAN-2' }]
    const state = makeState({ issuesRaw: [{ id: 'OLD' }] })
    const next = applyEvent(state, {
      type: 'issues.snapshot',
      sequence: 25,
      timestamp: ts(),
      payload: { issues } as any,
    })
    expect(next.issuesRaw).toHaveLength(2)
    expect((next.issuesRaw[0] as any).id).toBe('PAN-1')
  })
})

// ─── applyEvent — activity ───────────────────────────────────────────────────

describe('applyEvent — activity.updated', () => {
  it('replaces recentActivity', () => {
    const events = [{ agentId: 'a', type: 'commit', message: 'fix', timestamp: ts() }]
    const state = applyEvent(makeState(), {
      type: 'activity.updated',
      sequence: 30,
      timestamp: ts(),
      payload: { events } as any,
    })
    expect(state.recentActivity).toHaveLength(1)
  })

  it('caps activity at 50 entries', () => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      agentId: `agent-${i}`,
      type: 'activity',
      message: `event ${i}`,
      timestamp: ts(),
    }))
    const state = applyEvent(makeState(), {
      type: 'activity.updated',
      sequence: 31,
      timestamp: ts(),
      payload: { events } as any,
    })
    expect(state.recentActivity).toHaveLength(50)
  })
})

// ─── applyEvent — shadow inference ──────────────────────────────────────────

describe('applyEvent — shadow.inference_update', () => {
  it('updates shadowInferenceByIssueId', () => {
    const state = applyEvent(makeState(), {
      type: 'shadow.inference_update',
      sequence: 40,
      timestamp: ts(),
      payload: { issueId: 'PAN-1', content: 'analysis result' },
    })
    expect(state.shadowInferenceByIssueId['PAN-1']).toBe('analysis result')
  })

  it('preserves existing entries', () => {
    const state = makeState({ shadowInferenceByIssueId: { 'PAN-1': 'existing' } })
    const next = applyEvent(state, {
      type: 'shadow.inference_update',
      sequence: 41,
      timestamp: ts(),
      payload: { issueId: 'PAN-2', content: 'new analysis' },
    })
    expect(next.shadowInferenceByIssueId['PAN-1']).toBe('existing')
    expect(next.shadowInferenceByIssueId['PAN-2']).toBe('new analysis')
  })
})

// ─── applyEvent — sequence tracking ─────────────────────────────────────────

describe('applyEvent — sequence tracking', () => {
  it('uses max of current and event sequence', () => {
    const state = makeState({ sequence: 10 })
    // Lower sequence event should not decrease sequence
    const next = applyEvent(state, {
      type: 'resources.updated',
      sequence: 5,
      timestamp: ts(),
      payload: { resources: { cpu: 1, memPercent: 1, memUsed: 1, memTotal: 2 } },
    })
    expect(next.sequence).toBe(10)
  })

  it('advances sequence when event is higher', () => {
    const state = makeState({ sequence: 10 })
    const next = applyEvent(state, {
      type: 'resources.updated',
      sequence: 15,
      timestamp: ts(),
      payload: { resources: { cpu: 1, memPercent: 1, memUsed: 1, memTotal: 2 } },
    })
    expect(next.sequence).toBe(15)
  })

  it('planning/cost events only update sequence (no data change)', () => {
    const state = makeState({ sequence: 0, agentsById: { 'agent-1': baseAgent } })
    const next = applyEvent(state, {
      type: 'planning.started',
      sequence: 99,
      timestamp: ts(),
      payload: { issueId: 'PAN-1', planningId: 'plan-1' } as any,
    })
    expect(next.sequence).toBe(99)
    expect(next.agentsById).toBe(state.agentsById)
  })
})

// ─── applyEvents (batch) ─────────────────────────────────────────────────────

describe('applyEvents', () => {
  it('applies multiple events in order', () => {
    const state = makeState()
    const next = applyEvents(state, [
      {
        type: 'agent.started',
        sequence: 1,
        timestamp: ts(),
        payload: { agentId: 'agent-1', issueId: 'PAN-1', agent: baseAgent },
      },
      {
        type: 'agent.status_changed',
        sequence: 2,
        timestamp: ts(),
        payload: { agentId: 'agent-1', status: 'stopped' },
      },
    ])
    expect(next.sequence).toBe(2)
    expect(next.agentsById['agent-1']!.status).toBe('stopped')
  })

  it('returns initial state unchanged for empty array', () => {
    const state = makeState()
    expect(applyEvents(state, [])).toBe(state)
  })

  it('final sequence reflects highest event', () => {
    const state = makeState()
    const next = applyEvents(state, [
      {
        type: 'resources.updated',
        sequence: 3,
        timestamp: ts(),
        payload: { resources: { cpu: 1, memPercent: 1, memUsed: 1, memTotal: 2 } },
      },
      {
        type: 'resources.updated',
        sequence: 7,
        timestamp: ts(),
        payload: { resources: { cpu: 2, memPercent: 2, memUsed: 2, memTotal: 4 } },
      },
      {
        type: 'resources.updated',
        sequence: 5,
        timestamp: ts(),
        payload: { resources: { cpu: 3, memPercent: 3, memUsed: 3, memTotal: 6 } },
      },
    ])
    expect(next.sequence).toBe(7)
  })
})

// ─── Workspace Lifecycle Events (PAN-485) ────────────────────────────────────

describe('applyEvent — workspace.created', () => {
  it('is a no-op (only updates sequence)', () => {
    const state = makeState({ agentsById: { 'agent-1': baseAgent } })
    const next = applyEvent(state, {
      type: 'workspace.created',
      sequence: 5,
      timestamp: ts(),
      payload: { issueId: 'PAN-1', workspacePath: '/workspaces/feature-pan-1' },
    })
    expect(next.sequence).toBe(5)
    expect(next.agentsById).toEqual(state.agentsById)
    expect(next.issuesRaw).toEqual(state.issuesRaw)
  })
})

describe('applyEvent — workspace.wipe_started', () => {
  it('sets canonicalStatus and state to wiping on matching issue (by identifier)', () => {
    const state = makeState({
      issuesRaw: [{ identifier: 'PAN-1', canonicalStatus: 'in_progress', state: 'in_progress' }],
    })
    const next = applyEvent(state, {
      type: 'workspace.wipe_started',
      sequence: 6,
      timestamp: ts(),
      payload: { issueId: 'PAN-1' },
    })
    expect((next.issuesRaw[0] as any).canonicalStatus).toBe('wiping')
    expect((next.issuesRaw[0] as any).state).toBe('wiping')
  })

  it('sets canonicalStatus and state to wiping on matching issue (by id)', () => {
    const state = makeState({
      issuesRaw: [{ id: 'issue-uuid-1', canonicalStatus: 'in_progress', state: 'in_progress' }],
    })
    const next = applyEvent(state, {
      type: 'workspace.wipe_started',
      sequence: 6,
      timestamp: ts(),
      payload: { issueId: 'issue-uuid-1' },
    })
    expect((next.issuesRaw[0] as any).canonicalStatus).toBe('wiping')
  })

  it('does not affect other issues', () => {
    const state = makeState({
      issuesRaw: [
        { identifier: 'PAN-1', canonicalStatus: 'in_progress' },
        { identifier: 'PAN-2', canonicalStatus: 'in_progress' },
      ],
    })
    const next = applyEvent(state, {
      type: 'workspace.wipe_started',
      sequence: 6,
      timestamp: ts(),
      payload: { issueId: 'PAN-1' },
    })
    expect((next.issuesRaw[1] as any).canonicalStatus).toBe('in_progress')
  })
})

describe('applyEvent — workspace.destroyed', () => {
  it('removes all agents for the issue from agentsById', () => {
    const agent2: AgentSnapshot = { ...baseAgent, id: 'agent-2', issueId: 'PAN-2' }
    const state = makeState({
      agentsById: { 'agent-1': baseAgent, 'agent-2': agent2 },
      issuesRaw: [{ identifier: 'PAN-1', canonicalStatus: 'in_progress', state: 'in_progress' }],
    })
    const next = applyEvent(state, {
      type: 'workspace.destroyed',
      sequence: 7,
      timestamp: ts(),
      payload: { issueId: 'PAN-1' },
    })
    expect(next.agentsById['agent-1']).toBeUndefined()
    expect(next.agentsById['agent-2']).toEqual(agent2)
  })

  it('resets canonicalStatus and state to todo', () => {
    const state = makeState({
      issuesRaw: [{ identifier: 'PAN-1', canonicalStatus: 'wiping', state: 'wiping' }],
    })
    const next = applyEvent(state, {
      type: 'workspace.destroyed',
      sequence: 7,
      timestamp: ts(),
      payload: { issueId: 'PAN-1' },
    })
    expect((next.issuesRaw[0] as any).canonicalStatus).toBe('todo')
    expect((next.issuesRaw[0] as any).state).toBe('todo')
  })

  it('is safe when no agents exist for the issue', () => {
    const state = makeState({ issuesRaw: [{ identifier: 'PAN-1', canonicalStatus: 'in_progress' }] })
    const next = applyEvent(state, {
      type: 'workspace.destroyed',
      sequence: 7,
      timestamp: ts(),
      payload: { issueId: 'PAN-1' },
    })
    expect(next.agentsById).toEqual({})
  })
})

describe('applyEvent — workspace.deleted', () => {
  it('removes all agents for the issue and resets canonicalStatus to todo', () => {
    const state = makeState({
      agentsById: { 'agent-1': baseAgent },
      issuesRaw: [{ identifier: 'PAN-1', canonicalStatus: 'in_progress', state: 'in_progress' }],
    })
    const next = applyEvent(state, {
      type: 'workspace.deleted',
      sequence: 8,
      timestamp: ts(),
      payload: { issueId: 'PAN-1' },
    })
    expect(next.agentsById['agent-1']).toBeUndefined()
    expect((next.issuesRaw[0] as any).canonicalStatus).toBe('todo')
    expect((next.issuesRaw[0] as any).state).toBe('todo')
  })

  it('removes stored turn diff summaries for agents in the deleted workspace issue', () => {
    const agent2: AgentSnapshot = { ...baseAgent, id: 'agent-2', issueId: 'PAN-2' }
    const state = makeState({
      agentsById: { 'agent-1': baseAgent, 'agent-2': agent2 },
      turnDiffSummariesByAgentId: {
        'agent-1': [{ turnId: 'turn-1', completedAt: ts(), files: [] }],
        'agent-2': [{ turnId: 'turn-2', completedAt: ts(), files: [] }],
      },
    })
    const next = applyEvent(state, {
      type: 'workspace.deleted',
      sequence: 8,
      timestamp: ts(),
      payload: { issueId: 'PAN-1' },
    })
    expect(next.turnDiffSummariesByAgentId['agent-1']).toBeUndefined()
    expect(next.turnDiffSummariesByAgentId['agent-2']).toEqual(state.turnDiffSummariesByAgentId['agent-2'])
  })
})

describe('applyEvent — workspace.aborted', () => {
  it('removes planning agent by sessionName when provided', () => {
    const planningAgent: AgentSnapshot = { ...baseAgent, id: 'planning-pan-1', issueId: 'PAN-1' }
    const workAgent: AgentSnapshot = { ...baseAgent, id: 'agent-pan-1', issueId: 'PAN-1' }
    const state = makeState({ agentsById: { 'planning-pan-1': planningAgent, 'agent-pan-1': workAgent } })
    const next = applyEvent(state, {
      type: 'workspace.aborted',
      sequence: 9,
      timestamp: ts(),
      payload: { issueId: 'PAN-1', sessionName: 'planning-pan-1' },
    })
    expect(next.agentsById['planning-pan-1']).toBeUndefined()
    expect(next.agentsById['agent-pan-1']).toEqual(workAgent)
  })

  it('removes all agents for the issueId when sessionName is not provided', () => {
    const agent2: AgentSnapshot = { ...baseAgent, id: 'agent-2', issueId: 'PAN-2' }
    const state = makeState({ agentsById: { 'agent-1': baseAgent, 'agent-2': agent2 } })
    const next = applyEvent(state, {
      type: 'workspace.aborted',
      sequence: 9,
      timestamp: ts(),
      payload: { issueId: 'PAN-1' },
    })
    expect(next.agentsById['agent-1']).toBeUndefined()
    expect(next.agentsById['agent-2']).toEqual(agent2)
  })

  it('is safe when agent not found by sessionName', () => {
    const state = makeState({ agentsById: {} })
    const next = applyEvent(state, {
      type: 'workspace.aborted',
      sequence: 9,
      timestamp: ts(),
      payload: { issueId: 'PAN-1', sessionName: 'planning-pan-1' },
    })
    expect(next.agentsById).toEqual({})
  })

  it('removes turn diff summaries for the aborted planning session only', () => {
    const planningAgent: AgentSnapshot = { ...baseAgent, id: 'planning-pan-1', issueId: 'PAN-1' }
    const workAgent: AgentSnapshot = { ...baseAgent, id: 'agent-pan-1', issueId: 'PAN-1' }
    const state = makeState({
      agentsById: { 'planning-pan-1': planningAgent, 'agent-pan-1': workAgent },
      turnDiffSummariesByAgentId: {
        'planning-pan-1': [{ turnId: 'turn-plan', completedAt: ts(), files: [] }],
        'agent-pan-1': [{ turnId: 'turn-work', completedAt: ts(), files: [] }],
      },
    })
    const next = applyEvent(state, {
      type: 'workspace.aborted',
      sequence: 9,
      timestamp: ts(),
      payload: { issueId: 'PAN-1', sessionName: 'planning-pan-1' },
    })
    expect(next.turnDiffSummariesByAgentId['planning-pan-1']).toBeUndefined()
    expect(next.turnDiffSummariesByAgentId['agent-pan-1']).toEqual(state.turnDiffSummariesByAgentId['agent-pan-1'])
  })
})
