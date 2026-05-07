/**
 * PAN-800 — reducer tests for the agent runtime events.
 *
 * Every runtime event must have a dedicated case. Without these tests, a
 * misspelled case label silently falls through to the default no-op and
 * state drift happens in production.
 */

import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '@panctl/contracts'
import { INITIAL_READ_MODEL_STATE, applyEvent } from '@panctl/contracts'

const AGENT = 'agent-800'
const TS = '2026-04-22T06:00:00.000Z'

function at(sequence: number, e: Omit<DomainEvent, 'sequence' | 'timestamp'>): DomainEvent {
  return { ...e, sequence, timestamp: TS } as DomainEvent
}

describe('PAN-800 runtime reducer', () => {
  it('agent.activity_changed writes activity and currentTool when working', () => {
    const next = applyEvent(
      INITIAL_READ_MODEL_STATE,
      at(1, {
        type: 'agent.activity_changed',
        payload: { agentId: AGENT, activity: 'working', currentTool: 'Read' },
      } as any),
    )
    expect(next.agentRuntimeById[AGENT]).toMatchObject({
      id: AGENT,
      activity: 'working',
      currentTool: 'Read',
      updatedAtSequence: 1,
    })
  })

  it('agent.activity_changed clears currentTool when activity is not working', () => {
    const start = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.activity_changed',
      payload: { agentId: AGENT, activity: 'working', currentTool: 'Read' },
    } as any))
    const next = applyEvent(start, at(2, {
      type: 'agent.activity_changed',
      payload: { agentId: AGENT, activity: 'idle' },
    } as any))
    expect(next.agentRuntimeById[AGENT].activity).toBe('idle')
    expect(next.agentRuntimeById[AGENT].currentTool).toBeUndefined()
  })

  it('agent.thinking_started sets activity=thinking with since and lastToolAt', () => {
    const next = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.thinking_started',
      payload: { agentId: AGENT, lastToolAt: '2026-04-22T05:59:00.000Z' },
    } as any))
    expect(next.agentRuntimeById[AGENT].activity).toBe('thinking')
    expect(next.agentRuntimeById[AGENT].thinking).toEqual({
      since: TS,
      lastToolAt: '2026-04-22T05:59:00.000Z',
    })
  })

  it('agent.thinking_stopped clears thinking but leaves activity for follow-up', () => {
    let s = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.thinking_started',
      payload: { agentId: AGENT, lastToolAt: TS },
    } as any))
    s = applyEvent(s, at(2, {
      type: 'agent.thinking_stopped',
      payload: { agentId: AGENT, resolvedBy: 'tool' },
    } as any))
    expect(s.agentRuntimeById[AGENT].thinking).toBeUndefined()
    // Activity stays 'thinking' until the follow-up event sets it.
    expect(s.agentRuntimeById[AGENT].activity).toBe('thinking')
  })

  it('agent.thinking_stopped on unknown agent is a no-op', () => {
    const next = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.thinking_stopped',
      payload: { agentId: 'ghost', resolvedBy: 'stopped' },
    } as any))
    expect(next.agentRuntimeById).toEqual({})
  })

  it('agent.waiting_started sets waiting with reason and optional message', () => {
    const next = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.waiting_started',
      payload: { agentId: AGENT, reason: 'tool_permission', message: 'Allow Bash?' },
    } as any))
    expect(next.agentRuntimeById[AGENT].activity).toBe('waiting')
    expect(next.agentRuntimeById[AGENT].waiting).toMatchObject({
      reason: 'tool_permission',
      message: 'Allow Bash?',
      startedAt: TS,
    })
  })

  it('agent.waiting_cleared removes waiting but leaves activity', () => {
    let s = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.waiting_started',
      payload: { agentId: AGENT, reason: 'user_question' },
    } as any))
    s = applyEvent(s, at(2, {
      type: 'agent.waiting_cleared',
      payload: { agentId: AGENT, clearedBy: 'user_response' },
    } as any))
    expect(s.agentRuntimeById[AGENT].waiting).toBeUndefined()
    expect(s.agentRuntimeById[AGENT].activity).toBe('waiting')
  })

  it('agent.permission_requested stores pending permission requests by requestId', () => {
    const next = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.permission_requested',
      payload: {
        requestId: 'perm-1',
        agentId: AGENT,
        issueId: 'PAN-800',
        toolName: 'Bash',
        description: 'Run npm test',
        inputPreview: '{"command":"npm test"}',
        createdAt: TS,
      },
    } as any))
    expect(next.channelPermissionRequestsById['perm-1']).toMatchObject({
      requestId: 'perm-1',
      agentId: AGENT,
      toolName: 'Bash',
    })
  })

  it('agent.permission_resolved removes pending permission requests', () => {
    let s = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.permission_requested',
      payload: {
        requestId: 'perm-1',
        agentId: AGENT,
        issueId: 'PAN-800',
        toolName: 'Bash',
        description: 'Run npm test',
        inputPreview: '{"command":"npm test"}',
        createdAt: TS,
      },
    } as any))
    s = applyEvent(s, at(2, {
      type: 'agent.permission_resolved',
      payload: {
        requestId: 'perm-1',
        agentId: AGENT,
        issueId: 'PAN-800',
        behavior: 'allow',
      },
    } as any))
    expect(s.channelPermissionRequestsById['perm-1']).toBeUndefined()
  })

  it('agent.message_received bumps lastMessageAt without changing activity', () => {
    let s = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.activity_changed',
      payload: { agentId: AGENT, activity: 'idle' },
    } as any))
    s = applyEvent(s, at(2, {
      type: 'agent.message_received',
      payload: { agentId: AGENT, direction: 'to_agent', source: 'user' },
    } as any))
    expect(s.agentRuntimeById[AGENT].lastMessageAt).toBe(TS)
    expect(s.agentRuntimeById[AGENT].activity).toBe('idle')
  })

  it('agent.model_set stores model and optional claudeSessionId', () => {
    const next = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.model_set',
      payload: { agentId: AGENT, model: 'claude-opus-4-7', claudeSessionId: 'sess-xyz' },
    } as any))
    expect(next.agentRuntimeById[AGENT]).toMatchObject({
      model: 'claude-opus-4-7',
      claudeSessionId: 'sess-xyz',
    })
  })

  it('agent.state_restored seeds a full snapshot and uses the event sequence', () => {
    const restored = {
      id: AGENT,
      activity: 'idle' as const,
      lastActivity: '2026-04-21T00:00:00.000Z',
      updatedAtSequence: 999, // old, pre-compaction sequence
      model: 'claude-sonnet-4-6',
    }
    const next = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.state_restored',
      payload: { agentId: AGENT, snapshot: restored },
    } as any))
    expect(next.agentRuntimeById[AGENT]).toMatchObject({ model: 'claude-sonnet-4-6' })
    expect(next.agentRuntimeById[AGENT].updatedAtSequence).toBe(1)
  })

  it('agent.stopped marks runtime activity stopped and clears stale channel replies', () => {
    let s = applyEvent(INITIAL_READ_MODEL_STATE, at(1, {
      type: 'agent.channel_reply',
      payload: {
        agentId: AGENT,
        reply: { kind: 'done', summary: 'Implementation complete', artifactRefs: [] },
      },
    } as any))
    s = applyEvent(s, at(2, {
      type: 'agent.activity_changed',
      payload: { agentId: AGENT, activity: 'idle' },
    } as any))
    s = applyEvent(s, at(3, {
      type: 'agent.stopped',
      payload: { agentId: AGENT, issueId: 'PAN-800' },
    } as any))
    expect(s.agentRuntimeById[AGENT].activity).toBe('stopped')
    expect(s.agentRuntimeById[AGENT].currentTool).toBeUndefined()
    expect(s.agentRuntimeById[AGENT].channelReply).toBeUndefined()
  })

  it('bumps AgentSnapshot.runtimeSnapshotSequence when agent exists', () => {
    const withAgent = {
      ...INITIAL_READ_MODEL_STATE,
      agentsById: {
        [AGENT]: {
          id: AGENT,
          issueId: 'PAN-800',
          status: 'running' as const,
        },
      },
    }
    const next = applyEvent(withAgent, at(42, {
      type: 'agent.activity_changed',
      payload: { agentId: AGENT, activity: 'working', currentTool: 'Write' },
    } as any))
    expect(next.agentsById[AGENT].runtimeSnapshotSequence).toBe(42)
  })
})
