/**
 * PAN-800 Phase 3 — heartbeat endpoint parsing + DomainEvent validation.
 *
 * This is the parsing path between "bash hook POSTs a body" and
 * "AgentStateService.emit(decoded DomainEvent)". If any of these wire up
 * wrong, Phase 4 hook rewrites will produce events that either silently
 * no-op (bodyToEvent returns null) or corrupt the reducer (Schema decode
 * accepts a bad enum value).
 */

import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { DomainEvent } from '@panopticon/contracts'
import { bodyToEvent, mapLegacyState } from '../../src/dashboard/server/routes/agents'

const AGENT = 'agent-800'
const TS = '2026-04-22T06:00:00.000Z'
const decode = Schema.decodeUnknownResult(DomainEvent)

function decodeCandidate(raw: Record<string, unknown> | null) {
  if (!raw) return null
  return decode({ ...raw, sequence: 0 })
}

describe('PAN-800 bodyToEvent + DomainEvent decode', () => {
  it('new-shape activity → agent.activity_changed', () => {
    const ev = bodyToEvent(AGENT, { kind: 'activity', activity: 'working', tool: 'Read' }, TS)
    expect(ev?.['type']).toBe('agent.activity_changed')
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
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
    const ev = bodyToEvent(AGENT, { kind: 'model_set', model: 'claude-opus-4-7' }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('agent.model_set')
  })

  it('legacy state=active + tool → activity_changed working', () => {
    const mapped = mapLegacyState('active', 'Read')
    expect(mapped).toEqual({ kind: 'activity', activity: 'working', tool: 'Read' })
  })

  it('legacy state=idle → activity_changed idle', () => {
    const mapped = mapLegacyState('idle', undefined)
    expect(mapped).toEqual({ kind: 'activity', activity: 'idle' })
  })

  it('legacy state=waiting-on-human → waiting_start', () => {
    const mapped = mapLegacyState('waiting-on-human', undefined)
    expect(mapped).toEqual({ kind: 'waiting_start', reason: 'other' })
  })

  it('legacy state=uninitialized → null (no emit)', () => {
    expect(mapLegacyState('uninitialized', undefined)).toBeNull()
  })

  it('unknown kind → null (no emit)', () => {
    expect(bodyToEvent(AGENT, { kind: 'bogus_kind' }, TS)).toBeNull()
  })

  it('legacy body flows through bodyToEvent and decodes', () => {
    const ev = bodyToEvent(AGENT, { state: 'idle', timestamp: TS }, TS)
    const decoded = decodeCandidate(ev)!
    expect(decoded._tag).toBe('Success')
    expect((ev as any).type).toBe('agent.activity_changed')
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
