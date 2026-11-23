import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'

import { DomainEvent } from '../events'
import { applyEvent, INITIAL_READ_MODEL_STATE, syncSnapshot } from '../event-reducers'
import type { ConversationSearchActivityKind, ConversationSearchActivitySnapshot } from '../conversation-search-activity'

const idle: ConversationSearchActivitySnapshot = {
  active: false,
  kind: null,
  filesScanned: 0,
  filesIndexed: 0,
  chunksIndexed: 0,
  currentFile: null,
  queued: 0,
  inFlight: 0,
  startedAt: null,
  endedAt: null,
  lastError: null,
  lastErrorAt: null,
}

const running: ConversationSearchActivitySnapshot = {
  active: true,
  kind: 'catch-up',
  filesScanned: 10,
  filesIndexed: 4,
  chunksIndexed: 37,
  currentFile: 'session-abc.jsonl',
  queued: 6,
  inFlight: 1,
  startedAt: '2026-11-15T20:00:00Z',
  endedAt: null,
  lastError: null,
  lastErrorAt: null,
}

function activityChanged(sequence: number, activity: ConversationSearchActivitySnapshot) {
  return Schema.decodeUnknownSync(DomainEvent)({
    type: 'conversation_search.activity_changed',
    sequence,
    timestamp: '2026-11-15T20:00:10Z',
    payload: { activity },
  })
}

describe('conversation_search.activity_changed (PAN-5609 WI-1)', () => {
  it('replaces conversationSearchActivity, and a second event replaces it again', () => {
    let state = applyEvent(INITIAL_READ_MODEL_STATE, activityChanged(1, running))
    expect(state.conversationSearchActivity).toEqual(running)
    expect(state.sequence).toBe(1)
    state = applyEvent(state, activityChanged(2, idle))
    expect(state.conversationSearchActivity).toEqual(idle)
  })

  it('hydrating from a snapshot without the field yields null, never the old state', () => {
    const withActivity = applyEvent(INITIAL_READ_MODEL_STATE, activityChanged(1, running))
    const synced = syncSnapshot(withActivity, { sequence: 2, agents: [], specialists: [], timestamp: 't' } as never)
    expect(synced.conversationSearchActivity).toBeNull()
  })

  it('hydrating from a snapshot with the field carries it', () => {
    const synced = syncSnapshot(INITIAL_READ_MODEL_STATE, {
      sequence: 2,
      agents: [],
      specialists: [],
      conversationSearchActivity: running,
      timestamp: 't',
    } as never)
    expect(synced.conversationSearchActivity).toEqual(running)
  })

  it.each(['startup', 'catch-up', 'incremental', 'full-reindex'] as ConversationSearchActivityKind[])(
    'decodes a JSON round-tripped event for kind %s with every nullable field null',
    (kind) => {
      const event = {
        type: 'conversation_search.activity_changed',
        sequence: 1,
        timestamp: '2026-11-15T20:00:10Z',
        payload: { activity: { ...idle, kind } },
      }
      const decoded = Schema.decodeUnknownSync(DomainEvent)(JSON.parse(JSON.stringify(event)))
      expect(decoded).toEqual(event)
    },
  )
})
