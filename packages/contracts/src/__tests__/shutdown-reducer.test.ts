import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'

import { DomainEvent } from '../events'
import { applyEvent, INITIAL_READ_MODEL_STATE, syncSnapshot } from '../event-reducers'
import type { ShutdownSnapshot } from '../types'

const AGENT_ID = 'agent-pan-1'

function activity(sequence: number, act: string, hookName?: string, timestamp = `2026-11-15T20:00:0${sequence}Z`) {
  return Schema.decodeUnknownSync(DomainEvent)({
    type: 'agent.activity_changed',
    sequence,
    timestamp,
    payload: {
      agentId: AGENT_ID,
      activity: act,
      ...(act === 'working' ? { currentTool: 'Bash', toolDescription: 'npm test' } : {}),
      ...(hookName ? { hookName } : {}),
    },
  })
}

const drain: ShutdownSnapshot = {
  phase: 'draining',
  startedAt: '2026-11-15T20:00:00Z',
  deadlineAt: '2026-11-15T20:02:00Z',
  overdue: false,
  reboot: false,
  force: 'never',
  pending: [{ id: AGENT_ID, kind: 'agent', label: 'PAN-1 work agent', issueId: 'PAN-1', activity: 'working', tool: 'Bash' }],
  writers: [{ kind: 'auto-merge', label: 'Merging PAN-2' }],
  stoppedCount: 0,
  warnings: [],
}

function shutdownChanged(sequence: number, shutdown: ShutdownSnapshot | null) {
  return Schema.decodeUnknownSync(DomainEvent)({
    type: 'system.shutdown_changed',
    sequence,
    timestamp: '2026-11-15T20:00:10Z',
    payload: { shutdown },
  })
}

describe('toolStartedAt (PAN-5342 WI-3)', () => {
  it('PreToolUse sets it, PostToolUse clears it', () => {
    let state = applyEvent(INITIAL_READ_MODEL_STATE, activity(1, 'working', 'PreToolUse'))
    expect(state.agentRuntimeById[AGENT_ID]?.toolStartedAt).toBe('2026-11-15T20:00:01Z')
    state = applyEvent(state, activity(2, 'working', 'PostToolUse'))
    expect(state.agentRuntimeById[AGENT_ID]?.toolStartedAt).toBeUndefined()
  })

  it('keeps the start time across a working event without a hook name', () => {
    let state = applyEvent(INITIAL_READ_MODEL_STATE, activity(1, 'working', 'PreToolUse'))
    state = applyEvent(state, activity(2, 'working'))
    expect(state.agentRuntimeById[AGENT_ID]?.toolStartedAt).toBe('2026-11-15T20:00:01Z')
  })

  it('idle clears it', () => {
    let state = applyEvent(INITIAL_READ_MODEL_STATE, activity(1, 'working', 'PreToolUse'))
    state = applyEvent(state, activity(2, 'idle'))
    expect(state.agentRuntimeById[AGENT_ID]?.toolStartedAt).toBeUndefined()
  })
})

describe('system.shutdown_changed (PAN-5342 WI-4)', () => {
  it('sets the snapshot and clears it with null', () => {
    let state = applyEvent(INITIAL_READ_MODEL_STATE, shutdownChanged(1, drain))
    expect(state.shutdown).toEqual(drain)
    expect(state.sequence).toBe(1)
    state = applyEvent(state, shutdownChanged(2, null))
    expect(state.shutdown).toBeNull()
  })

  it('hydrating from a snapshot without shutdown yields null, never the old state', () => {
    const draining = applyEvent(INITIAL_READ_MODEL_STATE, shutdownChanged(1, drain))
    const synced = syncSnapshot(draining, { sequence: 2, agents: [], specialists: [], timestamp: 't' } as never)
    expect(synced.shutdown).toBeNull()
  })

  it('hydrating from a snapshot with shutdown carries it', () => {
    const synced = syncSnapshot(INITIAL_READ_MODEL_STATE, { sequence: 2, agents: [], specialists: [], shutdown: drain, timestamp: 't' } as never)
    expect(synced.shutdown).toEqual(drain)
  })
})
