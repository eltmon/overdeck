import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'

import { DomainEvent } from '../events'
import { applyEvent, INITIAL_READ_MODEL_STATE } from '../event-reducers'
import { createIssueDelta } from '../issue-delta'

describe('complete issue row deltas', () => {
  const first = { id: 'one', description: 'full description', status: 'open', custom: { labels: ['a'] } }
  const second = { identifier: 'TWO-2', description: 'another description', assignee: null }

  it('audits no loss across edits, additions, removals, reordering, and unidentified tracker rows', () => {
    let state = { ...INITIAL_READ_MODEL_STATE, issuesRaw: [first, second] as unknown[] }
    const targets = [
      [{ ...first, status: 'closed', custom: { labels: ['b', 'a'] } }, second],
      [second, first, { arbitrary: ['a', 7, null] }],
      [second],
      [],
      [first, second],
    ]
    for (const [index, target] of targets.entries()) {
      const event = Schema.decodeUnknownSync(DomainEvent)({
        type: 'issues.delta', sequence: index + 1, timestamp: '2026-09-09T00:00:00Z',
        payload: createIssueDelta(state.issuesRaw, target),
      })
      const previous = state.issuesRaw
      state = applyEvent(state, event)
      expect(state.issuesRaw).toEqual(target)
      expect(state.issuesRaw).not.toBe(previous)
      expect(state.sequence).toBe(index + 1)
    }
  })

  it('sends only changed rows and preserves unchanged row references in the reducer', () => {
    const previous = [first, second]
    const changed = { ...second, description: 'updated full detail' }
    const payload = createIssueDelta(previous, [structuredClone(first), changed])!
    expect(payload).toEqual({ length: 2, changes: [{ index: 1, issue: changed }] })
    const result = applyEvent({ ...INITIAL_READ_MODEL_STATE, issuesRaw: previous }, {
      type: 'issues.delta', sequence: 1, timestamp: '', payload,
    })
    expect(result.issuesRaw[0]).toBe(first)
    expect(result.issuesRaw[1]).toEqual(changed)
    expect(createIssueDelta(previous, structuredClone(previous))).toBeNull()
  })

  it('keeps complete snapshots as the initial and reconnect recovery path', () => {
    const result = applyEvent(INITIAL_READ_MODEL_STATE, {
      type: 'issues.snapshot', sequence: 10, timestamp: '', payload: { issues: [first, second] },
    })
    expect(result.issuesRaw).toEqual([first, second])
  })

  it('avoids resending unchanged descriptions in a large issue list', () => {
    const previous = Array.from({ length: 1_000 }, (_, id) => ({ id, description: 'x'.repeat(4_000) }))
    const next = previous.map((row, index) => index === 400 ? { ...row, status: 'closed' } : row)
    const delta = createIssueDelta(previous, next)!
    expect(delta.changes).toHaveLength(1)
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(next).length / 100)
  })
})
