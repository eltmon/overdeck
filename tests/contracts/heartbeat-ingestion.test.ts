/**
 * PAN-800 Phase 3 — heartbeat endpoint parsing + DomainEvent validation.
 *
 * This is the parsing path between "bash hook POSTs a body" and
 * "AgentStateService.emit(decoded DomainEvent)". If any of these wire up
 * wrong, Phase 4 hook rewrites will produce events that either silently
 * no-op (bodyToEvent returns null) or corrupt the reducer (Schema decode
 * accepts a bad enum value).
 */

import { Effect, Schema, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { DomainEvent } from '@overdeck/contracts'
import { emitAgentRuntimeEvent } from '../../src/dashboard/server/routes/agents/runtime-events'
import {
  AgentStateService,
  type AgentStateServiceShape,
} from '../../src/dashboard/server/services/agent-state-service'
import { bodyToEvent } from '../../src/dashboard/server/services/agent-event-utils'

const AGENT = 'agent-800'
const TS = '2026-04-22T06:00:00.000Z'
const decode = Schema.decodeUnknownResult(DomainEvent)

function decodeCandidate(raw: Record<string, unknown> | null) {
  if (!raw) return null
  return decode({ ...raw, sequence: 0 })
}

function makeAgentStateService(emitted: Array<Omit<DomainEvent, 'sequence'>>): AgentStateServiceShape {
  const snapshot = {
    id: AGENT,
    activity: 'idle' as const,
    lastActivity: TS,
    currentIssue: 'PAN-2997',
    updatedAtSequence: 1,
  }
  return {
    get: () => Effect.succeed(snapshot),
    getAll: Effect.succeed({ [AGENT]: snapshot }),
    changes: Stream.empty,
    emit: event => Effect.sync(() => {
      emitted.push(event)
    }),
  }
}

async function runHeartbeat(body: Record<string, unknown>) {
  const emitted: Array<Omit<DomainEvent, 'sequence'>> = []
  const result = await Effect.runPromise(
    emitAgentRuntimeEvent(AGENT, body, TS).pipe(
      Effect.provideService(AgentStateService, makeAgentStateService(emitted)),
    ),
  )
  return { emitted, result }
}

describe('PAN-800 bodyToEvent + DomainEvent decode', () => {
  it('new-shape activity → agent.activity_changed with hook identity', () => {
    const ev = bodyToEvent(AGENT, {
      kind: 'activity',
      activity: 'working',
      tool: 'Read',
      hookName: 'PreToolUse',
    }, TS)
    expect(ev?.['type']).toBe('agent.activity_changed')
    expect((ev?.['payload'] as Record<string, unknown>)['hookName']).toBe('PreToolUse')
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
  })

  it('hook_fired → agent.hook_fired without changing activity state', () => {
    const ev = bodyToEvent(AGENT, {
      kind: 'hook_fired',
      hookName: 'Notification',
      tool: 'Notification',
    }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('agent.hook_fired')
    expect((ev as any).payload).toMatchObject({
      agentId: AGENT,
      hookName: 'Notification',
      tool: 'Notification',
    })
  })

  it('new-shape thinking_start → agent.thinking_started', () => {
    const ev = bodyToEvent(AGENT, { kind: 'thinking_start', lastToolAt: TS }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('agent.thinking_started')
  })

  it('new-shape waiting_start → agent.waiting_started', () => {
    const ev = bodyToEvent(AGENT, { kind: 'waiting_start', reason: 'tool_permission' }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('agent.waiting_started')
  })

  it('new-shape model_set → agent.model_set', () => {
    const ev = bodyToEvent(AGENT, {
      kind: 'model_set',
      model: 'claude-opus-4-7',
      claudeSessionId: 'sess-xyz',
      sessionModel: 'claude-opus-4-7',
      sessionHarness: 'claude-code',
    }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('agent.model_set')
    expect((ev as any).payload).toMatchObject({
      claudeSessionId: 'sess-xyz',
      sessionModel: 'claude-opus-4-7',
      sessionHarness: 'claude-code',
    })
  })

  it('linear_mcp_auth_required → Schema-valid event with resolved issue attribution', async () => {
    const { emitted, result } = await runHeartbeat({
      kind: 'linear_mcp_auth_required',
      authUrl: 'https://linear.app/oauth/authorize?state=test',
      expiresAt: '2026-04-22T06:30:00.000Z',
    })

    expect(result).toEqual({ ok: true, emitted: true })
    expect(emitted).toEqual([{
      sequence: 0,
      type: 'linear_mcp_auth.required',
      timestamp: TS,
      payload: {
        agentId: AGENT,
        issueId: 'PAN-2997',
        authUrl: 'https://linear.app/oauth/authorize?state=test',
        expiresAt: '2026-04-22T06:30:00.000Z',
      },
    }])
  })

  it('linear_mcp_auth_healthy → Schema-valid hook event with resolved issue attribution', async () => {
    const { emitted, result } = await runHeartbeat({ kind: 'linear_mcp_auth_healthy' })

    expect(result).toEqual({ ok: true, emitted: true })
    expect(emitted).toEqual([{
      sequence: 0,
      type: 'linear_mcp_auth.healthy',
      timestamp: TS,
      payload: {
        agentId: AGENT,
        issueId: 'PAN-2997',
        source: 'hook',
      },
    }])
  })

  it('rejects a malformed Linear MCP auth heartbeat with 400 and emits nothing', async () => {
    const { emitted, result } = await runHeartbeat({
      kind: 'linear_mcp_auth_required',
      authUrl: 42,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected malformed heartbeat to be rejected')
    expect(result.response.status).toBe(400)
    expect(emitted).toEqual([])
  })

  it('unknown kind → null (no emit)', () => {
    expect(bodyToEvent(AGENT, { kind: 'bogus_kind' }, TS)).toBeNull()
  })

  it('body without kind → null (no emit)', () => {
    expect(bodyToEvent(AGENT, { state: 'idle', timestamp: TS }, TS)).toBeNull()
  })

  it('resolution_set → agent.resolution_changed', () => {
    const ev = bodyToEvent(AGENT, { kind: 'resolution_set', resolution: 'done', resolutionCount: 1 }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('agent.resolution_changed')
  })

  it('cost-event → cost.event_recorded', () => {
    const ev = bodyToEvent(AGENT, { kind: 'cost-event', issueId: 'PAN-1134', costUsd: 0.002, usage: { inputTokens: 10, outputTokens: 5 } }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('cost.event_recorded')
    expect((ev as any).payload).toMatchObject({ agentId: AGENT, issueId: 'PAN-1134', cost: 0.002, inputTokens: 10, outputTokens: 5 })
  })

  it('channel_reply → agent.channel_reply', () => {
    const ev = bodyToEvent(
      AGENT,
      {
        kind: 'channel_reply',
        reply: {
          kind: 'needs_input',
          summary: 'Need user answer',
          artifactRefs: [{ uri: 'file:///tmp/question.md', label: 'question' }],
        },
      },
      TS,
    )
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('agent.channel_reply')
    expect((ev as any).payload.reply.reportedAt).toBe(TS)
  })

  it('channel_reply rejects invalid kind with targeted error', () => {
    expect(() =>
      bodyToEvent(
        AGENT,
        {
          kind: 'channel_reply',
          reply: {
            kind: 'bogus',
            summary: 'Need user answer',
            artifactRefs: [],
          },
        },
        TS,
      ),
    ).toThrow('reply.kind must be one of: status, done, needs_input')
  })

  it('channel_reply rejects oversized summaries before DomainEvent decode', () => {
    expect(() =>
      bodyToEvent(
        AGENT,
        {
          kind: 'channel_reply',
          reply: {
            kind: 'status',
            summary: 'x'.repeat(4097),
            artifactRefs: [],
          },
        },
        TS,
      ),
    ).toThrow('reply.summary must be at most 4096 characters')
  })

  it('current_issue_set → agent.current_issue_set', () => {
    const ev = bodyToEvent(AGENT, { kind: 'current_issue_set', currentIssue: 'PAN-800' }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('agent.current_issue_set')
  })

  it('bad activity enum is rejected by DomainEvent decode', () => {
    const ev = bodyToEvent(AGENT, { kind: 'activity', activity: 'garbage' }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Failure')
  })

  it('bad waiting reason is rejected by DomainEvent decode', () => {
    const ev = bodyToEvent(AGENT, { kind: 'waiting_start', reason: 'not_a_reason' }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Failure')
  })

  it('bad resolvedBy is rejected by DomainEvent decode', () => {
    const ev = bodyToEvent(AGENT, { kind: 'thinking_stop', resolvedBy: 'hope' }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Failure')
  })
})
