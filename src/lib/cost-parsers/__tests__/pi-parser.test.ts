import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { parsePiSession } from '../pi-parser.js'

const FIXTURES = join(__dirname, 'fixtures', 'pi')

describe('parsePiSession', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    debugSpy.mockRestore()
  })

  it('linear session: sums per-message usage and cost across the active branch (AC1, AC6)', () => {
    const result = parsePiSession(join(FIXTURES, 'linear.jsonl'))
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe('019df5a5-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(result!.messageCount).toBe(2)
    expect(result!.usage.inputTokens).toBe(250)
    expect(result!.usage.outputTokens).toBe(25)
    // AC6: cost_v2 == sum of entry.usage.cost.total along active branch.
    expect(result!.cost_v2).toBeCloseTo(0.0006 + 0.000525, 9)
    expect(result!.cost).toBeCloseTo(0.0006 + 0.000525, 9)
    expect(result!.model).toBe('claude-sonnet-4-6')
    expect(result!.modelBreakdown!['claude-sonnet-4-6']!.messageCount).toBe(2)
  })

  it('forked session: counts only the active (latest-leaf) branch (AC2)', () => {
    const result = parsePiSession(join(FIXTURES, 'forked.jsonl'))
    expect(result).not.toBeNull()
    // Active branch: f1 -> f2 -> f3 (cost 0.00045) -> f4-active -> f5-active (cost 0.0012).
    // Abandoned branch carries cost 198 — it MUST NOT be summed.
    expect(result!.messageCount).toBe(2)
    expect(result!.usage.inputTokens).toBe(100 + 200)
    expect(result!.usage.outputTokens).toBe(10 + 40)
    expect(result!.cost_v2).toBeCloseTo(0.00045 + 0.0012, 9)
    expect(result!.cost_v2).toBeLessThan(1) // sanity: abandoned branch costs 198
  })

  it('model_change session: modelBreakdown contains both models with separate totals (AC3)', () => {
    const result = parsePiSession(join(FIXTURES, 'model-change.jsonl'))
    expect(result).not.toBeNull()
    expect(result!.messageCount).toBe(2)
    expect(Object.keys(result!.modelBreakdown!)).toEqual(
      expect.arrayContaining(['claude-sonnet-4-6', 'gpt-5.4-mini']),
    )
    expect(result!.modelBreakdown!['claude-sonnet-4-6']).toEqual({
      cost: 0.00045,
      inputTokens: 100,
      outputTokens: 10,
      messageCount: 1,
    })
    expect(result!.modelBreakdown!['gpt-5.4-mini']).toEqual({
      cost: 0.00065,
      inputTokens: 300,
      outputTokens: 50,
      messageCount: 1,
    })
    expect(result!.model).toBe('claude-sonnet-4-6 → gpt-5.4-mini')
  })

  it('compaction session: input tokens are NOT double-counted across the boundary (AC4)', () => {
    const result = parsePiSession(join(FIXTURES, 'compaction.jsonl'))
    expect(result).not.toBeNull()
    // Three assistant messages on the active branch:
    //   c3 (pre-compact): input=1000, output=200, cost=0.006
    //   c6 (compaction summary): input=1100, output=300, cost=0.0078
    //   c9 (post-compact): input=250, output=15, cost=0.000975
    // Pi reports per-call usage so the parser sums each call's actual token
    // delta exactly once — pre-compaction tokens are NOT also folded into
    // the compaction summary's tally.
    expect(result!.messageCount).toBe(3)
    expect(result!.usage.inputTokens).toBe(1000 + 1100 + 250)
    expect(result!.usage.outputTokens).toBe(200 + 300 + 15)
    expect(result!.cost_v2).toBeCloseTo(0.006 + 0.0078 + 0.000975, 9)
    // Debug log mentions compaction count for observability.
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('compaction event'))
  })

  it('unknown event types are logged once (deduped) and do not throw (AC5)', () => {
    const result = parsePiSession(join(FIXTURES, 'unknown-event.jsonl'))
    expect(result).not.toBeNull()
    expect(result!.messageCount).toBe(1)
    expect(result!.usage.inputTokens).toBe(50)
    expect(result!.cost_v2).toBeCloseTo(0.0003, 9)

    const unknownLogs = debugSpy.mock.calls.filter(call =>
      String(call[0] ?? '').includes('unknown entry type'),
    )
    // Two unknown types in fixture (future_event_v9, another_future_event), each logged exactly once.
    expect(unknownLogs).toHaveLength(2)
  })

  it('returns null for a missing file', () => {
    expect(parsePiSession('/nonexistent/path/session.jsonl')).toBeNull()
  })
})
