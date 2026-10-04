/**
 * Unit tests for foldRuntimeSeed (PAN-4522)
 */

import { describe, it, expect } from 'vitest'
import { foldRuntimeSeed } from '../../src/dashboard/server/services/runtime-seed.js'
import type { StoredEvent } from '../../src/dashboard/server/event-store.js'
import type { AgentSnapshot } from '@overdeck/contracts'

function agent(id: string, status: AgentSnapshot['status'] = 'running'): AgentSnapshot {
  return { id, issueId: 'PAN-1', status }
}

function event(
  type: string,
  sequence: number,
  timestamp: string,
  payload: Record<string, unknown>,
): StoredEvent {
  return { type, sequence, timestamp, payload } as StoredEvent
}

describe('foldRuntimeSeed', () => {
  it('replays activity_changed events into the newest activity and lastActivity', () => {
    const agentsById = { 'agent-a': agent('agent-a') }
    const events = [
      event('agent.activity_changed', 10, '2026-10-04T03:00:00.000Z', { agentId: 'agent-a', activity: 'working' }),
      event('agent.activity_changed', 20, '2026-10-04T03:33:00.000Z', { agentId: 'agent-a', activity: 'idle' }),
    ]

    const seeded = foldRuntimeSeed(events, agentsById)

    expect(seeded['agent-a']?.lastActivity).toBe('2026-10-04T03:33:00.000Z')
    expect(seeded['agent-a']?.activity).toBe('idle')
  })

  it('keeps earlier model_set fields that a later model_set omits', () => {
    const agentsById = { 'agent-a': agent('agent-a') }
    const events = [
      event('agent.model_set', 1, '2026-10-04T03:00:00.000Z', {
        agentId: 'agent-a',
        model: 'm1',
        sessionModel: 's1',
        sessionHarness: 'claude-code',
        claudeSessionId: 'sess-1',
      }),
      event('agent.model_set', 2, '2026-10-04T03:01:00.000Z', { agentId: 'agent-a', model: 'm2' }),
    ]

    const seeded = foldRuntimeSeed(events, agentsById)

    expect(seeded['agent-a']?.model).toBe('m2')
    expect(seeded['agent-a']?.sessionModel).toBe('s1')
    expect(seeded['agent-a']?.sessionHarness).toBe('claude-code')
    expect(seeded['agent-a']?.claudeSessionId).toBe('sess-1')
  })

  it('requires full replay: an intervening activity_changed clears channelReply', () => {
    const agentsById = { 'agent-a': agent('agent-a') }
    const events = [
      event('agent.channel_reply', 3, '2026-10-04T03:00:00.000Z', { agentId: 'agent-a', reply: { kind: 'done' } }),
      event('agent.activity_changed', 4, '2026-10-04T03:01:00.000Z', { agentId: 'agent-a', activity: 'working' }),
      event('agent.activity_changed', 5, '2026-10-04T03:02:00.000Z', { agentId: 'agent-a', activity: 'idle' }),
    ]

    const seeded = foldRuntimeSeed(events, agentsById)

    expect(seeded['agent-a']?.channelReply).toBeUndefined()
  })

  it('does not leak a resumed agent back to a dead/stopped runtime status', () => {
    const agentsById = { 'agent-a': agent('agent-a', 'running') }
    const events = [
      event('agent.heartbeat_dead', 5, '2026-10-04T03:00:00.000Z', { agentId: 'agent-a' }),
      event('agent.activity_changed', 30, '2026-10-04T03:30:00.000Z', { agentId: 'agent-a', activity: 'working' }),
    ]

    const seeded = foldRuntimeSeed(events, agentsById)

    expect(seeded['agent-a']?.activity).toBe('working')
    expect(agentsById['agent-a']?.status).toBe('running')
  })

  it('drops events for an agent id not present in agentsById', () => {
    const agentsById = { 'agent-a': agent('agent-a') }
    const events = [
      event('agent.activity_changed', 1, '2026-10-04T03:00:00.000Z', { agentId: 'agent-zzz', activity: 'working' }),
    ]

    const seeded = foldRuntimeSeed(events, agentsById)

    expect(seeded['agent-zzz']).toBeUndefined()
    expect(Object.keys(seeded)).toHaveLength(0)
  })

  it('produces the same result regardless of input order', () => {
    const agentsById = { 'agent-a': agent('agent-a') }
    const ordered = [
      event('agent.activity_changed', 10, '2026-10-04T03:00:00.000Z', { agentId: 'agent-a', activity: 'working' }),
      event('agent.activity_changed', 20, '2026-10-04T03:33:00.000Z', { agentId: 'agent-a', activity: 'idle' }),
    ]
    const reversed = [...ordered].reverse()

    expect(foldRuntimeSeed(reversed, agentsById)).toEqual(foldRuntimeSeed(ordered, agentsById))
  })
})
