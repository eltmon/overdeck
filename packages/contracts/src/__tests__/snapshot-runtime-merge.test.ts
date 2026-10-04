/**
 * PAN-4522 — syncSnapshot must keep a client's newer runtime stamp across a
 * snapshot from a freshly restarted server rather than wholesale-replacing
 * the client's runtime map.
 */
import { describe, expect, it } from 'vitest'

import { syncSnapshot, INITIAL_READ_MODEL_STATE } from '../event-reducers'
import type { ReadModelState } from '../event-reducers'
import type { AgentRuntimeSnapshot, DashboardSnapshot } from '../types'

function runtime(overrides: Partial<AgentRuntimeSnapshot> & { id: string; lastActivity: string; updatedAtSequence: number }): AgentRuntimeSnapshot {
  return { activity: 'idle', ...overrides } as AgentRuntimeSnapshot
}

function snapshot(agentRuntimeById: Record<string, AgentRuntimeSnapshot>): DashboardSnapshot {
  return {
    sequence: 1,
    agents: [],
    specialists: [],
    agentRuntimeById,
    timestamp: '2026-10-04T00:00:00.000Z',
  } as unknown as DashboardSnapshot
}

function stateWithRuntime(agentRuntimeById: Record<string, AgentRuntimeSnapshot>): ReadModelState {
  return { ...INITIAL_READ_MODEL_STATE, agentRuntimeById }
}

describe('syncSnapshot — per-agent runtime merge (PAN-4522)', () => {
  it('keeps the newer client lastActivity over an older snapshot entry (AC2)', () => {
    const state = stateWithRuntime({
      'agent-a': runtime({ id: 'agent-a', activity: 'working', lastActivity: '2026-10-04T03:35:00.000Z', updatedAtSequence: 10 }),
    })
    const result = syncSnapshot(state, snapshot({
      'agent-a': runtime({ id: 'agent-a', activity: 'idle', lastActivity: '2026-10-04T02:22:58.000Z', updatedAtSequence: 20 }),
    }))

    expect(result.agentRuntimeById['agent-a']?.lastActivity).toBe('2026-10-04T03:35:00.000Z')
    expect(result.agentRuntimeById['agent-a']?.activity).toBe('working')
  })

  it('takes the snapshot entry when it is newer than the client entry', () => {
    const state = stateWithRuntime({
      'agent-a': runtime({ id: 'agent-a', lastActivity: '2026-10-04T02:00:00.000Z', updatedAtSequence: 1 }),
    })
    const result = syncSnapshot(state, snapshot({
      'agent-a': runtime({ id: 'agent-a', lastActivity: '2026-10-04T03:00:00.000Z', updatedAtSequence: 2 }),
    }))

    expect(result.agentRuntimeById['agent-a']?.lastActivity).toBe('2026-10-04T03:00:00.000Z')
  })

  it('keeps an agent the snapshot omits', () => {
    const state = stateWithRuntime({
      'agent-b': runtime({ id: 'agent-b', lastActivity: '2026-10-04T02:00:00.000Z', updatedAtSequence: 1 }),
    })
    const result = syncSnapshot(state, snapshot({}))

    expect(result.agentRuntimeById['agent-b']).toBeDefined()
  })

  it('keeps the client entry when stamps are equal and its updatedAtSequence is higher', () => {
    const state = stateWithRuntime({
      'agent-a': runtime({
        id: 'agent-a',
        lastActivity: '2026-10-04T03:00:00.000Z',
        updatedAtSequence: 11,
        contextSaturatedAt: '2026-10-04T03:00:00.000Z',
      }),
    })
    const result = syncSnapshot(state, snapshot({
      'agent-a': runtime({ id: 'agent-a', lastActivity: '2026-10-04T03:00:00.000Z', updatedAtSequence: 10 }),
    }))

    expect(result.agentRuntimeById['agent-a']?.updatedAtSequence).toBe(11)
    expect(result.agentRuntimeById['agent-a']?.contextSaturatedAt).toBe('2026-10-04T03:00:00.000Z')
  })

  it('takes the snapshot entry when stamps are equal and the snapshot sequence is higher', () => {
    const state = stateWithRuntime({
      'agent-a': runtime({ id: 'agent-a', lastActivity: '2026-10-04T03:00:00.000Z', updatedAtSequence: 10 }),
    })
    const result = syncSnapshot(state, snapshot({
      'agent-a': runtime({ id: 'agent-a', lastActivity: '2026-10-04T03:00:00.000Z', updatedAtSequence: 11 }),
    }))

    expect(result.agentRuntimeById['agent-a']?.updatedAtSequence).toBe(11)
  })
})
