/**
 * PAN-4849 review: open Deft `external` escalations travel in their own
 * enrichment field, never in pendingInputKinds/pendingInputCount.
 */
import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'

import { DomainEvent } from '../events'
import { applyEvent, INITIAL_READ_MODEL_STATE } from '../event-reducers'

const AGENT_ID = 'agent-pan-1'

const created = Schema.decodeUnknownSync(DomainEvent)({
  type: 'agent.created',
  sequence: 1,
  timestamp: '2026-11-03T00:00:00Z',
  payload: { agentId: AGENT_ID, issueId: 'PAN-1', agent: { id: AGENT_ID, issueId: 'PAN-1', status: 'running' } },
})

function enrichmentChanged(sequence: number, deftExternalEscalations?: number) {
  return Schema.decodeUnknownSync(DomainEvent)({
    type: 'agent.enrichment_changed',
    sequence,
    timestamp: '2026-11-03T00:00:01Z',
    payload: {
      agentId: AGENT_ID,
      pendingInputCount: 0,
      pendingInputKinds: [],
      ...(deftExternalEscalations !== undefined ? { deftExternalEscalations } : {}),
    },
  })
}

describe('deftExternalEscalations reducer (PAN-4849)', () => {
  it('sets the count without any pending input, and clears it when a later event omits it', () => {
    let state = applyEvent(INITIAL_READ_MODEL_STATE, created)
    state = applyEvent(state, enrichmentChanged(2, 1))
    expect(state.agentsById[AGENT_ID]).toMatchObject({ deftExternalEscalations: 1, pendingInputCount: 0, pendingInputKinds: [] })
    state = applyEvent(state, enrichmentChanged(3))
    expect(state.agentsById[AGENT_ID]?.deftExternalEscalations).toBeUndefined()
  })
})
