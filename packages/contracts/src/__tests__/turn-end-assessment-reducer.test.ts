import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'

import { DomainEvent } from '../events'
import { applyEvent, INITIAL_READ_MODEL_STATE } from '../event-reducers'

const AGENT_ID = 'agent-1'

function created(sequence: number) {
  return Schema.decodeUnknownSync(DomainEvent)({
    type: 'agent.created',
    sequence,
    timestamp: '2026-09-29T00:00:00Z',
    payload: {
      agentId: AGENT_ID,
      issueId: 'PAN-1',
      agent: { id: AGENT_ID, issueId: 'PAN-1', status: 'running' },
    },
  })
}

function enrichmentChanged(sequence: number, turnEndAssessment?: Record<string, unknown>) {
  return Schema.decodeUnknownSync(DomainEvent)({
    type: 'agent.enrichment_changed',
    sequence,
    timestamp: '2026-09-29T00:00:01Z',
    payload: {
      agentId: AGENT_ID,
      ...(turnEndAssessment ? { turnEndAssessment } : {}),
    },
  })
}

function statusChangedStopped(sequence: number) {
  return Schema.decodeUnknownSync(DomainEvent)({
    type: 'agent.status_changed',
    sequence,
    timestamp: '2026-09-29T00:00:02Z',
    payload: {
      agentId: AGENT_ID,
      status: 'stopped',
      hasLivePane: false,
    },
  })
}

describe('turnEndAssessment reducer (PAN-4371)', () => {
  it('sets turnEndAssessment on an agent.enrichment_changed event', () => {
    let state = applyEvent(INITIAL_READ_MODEL_STATE, created(1))
    state = applyEvent(state, enrichmentChanged(2, { kind: 'asks_operator', confidence: 0.9, needsAnswer: true, model: 'm' }))
    expect(state.agentsById[AGENT_ID]?.turnEndAssessment).toEqual({
      kind: 'asks_operator',
      confidence: 0.9,
      needsAnswer: true,
      model: 'm',
    })
  })

  it('clears turnEndAssessment when a following enrichment_changed event omits it', () => {
    let state = applyEvent(INITIAL_READ_MODEL_STATE, created(1))
    state = applyEvent(state, enrichmentChanged(2, { kind: 'reports_blocked', confidence: 0.84, needsAnswer: false, model: 'm' }))
    expect(state.agentsById[AGENT_ID]?.turnEndAssessment).toBeDefined()
    state = applyEvent(state, enrichmentChanged(3))
    expect(state.agentsById[AGENT_ID]?.turnEndAssessment).toBeUndefined()
  })

  it('deletes turnEndAssessment on a stop-shaped agent.status_changed event with no live pane', () => {
    let state = applyEvent(INITIAL_READ_MODEL_STATE, created(1))
    state = applyEvent(state, enrichmentChanged(2, { kind: 'progress_update', confidence: 0.75, needsAnswer: false, model: 'm' }))
    expect(state.agentsById[AGENT_ID]?.turnEndAssessment).toBeDefined()
    state = applyEvent(state, statusChangedStopped(3))
    expect('turnEndAssessment' in (state.agentsById[AGENT_ID] ?? {})).toBe(false)
  })

  it('decodes an old persisted agent.enrichment_changed payload with no turnEndAssessment field', () => {
    const event = Schema.decodeUnknownSync(DomainEvent)({
      type: 'agent.enrichment_changed',
      sequence: 1,
      timestamp: '2026-09-29T00:00:00Z',
      payload: { agentId: AGENT_ID, resolution: 'working' },
    })
    let state = applyEvent(INITIAL_READ_MODEL_STATE, created(1))
    state = applyEvent(state, event)
    expect(state.agentsById[AGENT_ID]?.turnEndAssessment).toBeUndefined()
  })
})
