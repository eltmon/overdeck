import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { parseOhmypiSessionCostEventsSync, parseOhmypiSessionSync, parseOhmypiSessionContent } from '../ohmypi-parser.js'

const FIXTURES = join(__dirname, 'fixtures', 'ohmypi')

describe('parseOhmypiSession (PAN-1989)', () => {
  it('parses the committed real omp fixture and returns non-zero usage (AC1)', () => {
    const result = parseOhmypiSessionSync(join(FIXTURES, 'rpc-toolcall.jsonl'))
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe('019ef4f8-6317-7000-9277-81d3e9dd941e')
    // The fixture has one assistant message with 51444 input tokens.
    expect(result!.usage.inputTokens).toBeGreaterThan(0)
    expect(result!.usage.outputTokens).toBeGreaterThanOrEqual(0)
  })

  it('returns per-model breakdown for the omp fixture (AC1)', () => {
    const result = parseOhmypiSessionSync(join(FIXTURES, 'rpc-toolcall.jsonl'))
    expect(result).not.toBeNull()
    // The fixture uses model glm-4.5-flash via provider zai.
    expect(result!.modelBreakdown).toBeDefined()
    const keys = Object.keys(result!.modelBreakdown ?? {})
    expect(keys.length).toBeGreaterThan(0)
  })

  it('exposes one stable cost event per assistant usage message', () => {
    const events = parseOhmypiSessionCostEventsSync(join(FIXTURES, 'rpc-toolcall.jsonl'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      requestId: 'ohmypi:019ef4f8-6317-7000-9277-81d3e9dd941e:56f1fdfa',
      sessionId: '019ef4f8-6317-7000-9277-81d3e9dd941e',
      provider: 'zai',
      model: 'glm-4.5-flash',
      input: 51444,
      output: 39,
      cost: 0,
    })
  })

  it('AC1: cache tokens (cacheRead, cacheWrite) are captured in totals and per-model breakdown', () => {
    const result = parseOhmypiSessionSync(join(FIXTURES, 'rpc-toolcall.jsonl'))
    expect(result).not.toBeNull()
    // Fixture has cacheRead:0, cacheWrite:0 — verify fields are present (not undefined).
    expect(typeof result!.usage.cacheReadTokens).toBe('number')
    expect(typeof result!.usage.cacheWriteTokens).toBe('number')
    // Per-model breakdown also carries cache tokens (ohmypi-specific extension).
    const modelEntry = Object.values(result!.modelBreakdown ?? {}).at(0)
    expect(modelEntry).toBeDefined()
    expect(typeof modelEntry!.cacheReadTokens).toBe('number')
    expect(typeof modelEntry!.cacheWriteTokens).toBe('number')
  })

  it('returns null for a non-existent file', () => {
    expect(parseOhmypiSessionSync('/nonexistent/session.jsonl')).toBeNull()
  })

  it('cost aggregation: walks leaf->root on the active branch without double-counting (AC2)', () => {
    // Two messages in sequence (linear tree): sum cost across both.
    const content = [
      '{"type":"session","version":3,"id":"sess-123","timestamp":"2026-01-01T00:00:00.000Z"}',
      '{"type":"message","id":"msg-1","parentId":null,"timestamp":"2026-01-01T00:01:00.000Z","message":{"role":"assistant","content":[],"model":"claude-sonnet-4-6","usage":{"input":100,"output":10,"cacheRead":0,"cacheWrite":0,"totalTokens":110,"cost":{"input":0.001,"output":0.001,"total":0.002}}}}',
      '{"type":"message","id":"msg-2","parentId":"msg-1","timestamp":"2026-01-01T00:02:00.000Z","message":{"role":"assistant","content":[],"model":"claude-sonnet-4-6","usage":{"input":100,"output":10,"cacheRead":0,"cacheWrite":0,"totalTokens":110,"cost":{"input":0.001,"output":0.001,"total":0.002}}}}',
    ].join('\n')
    const result = parseOhmypiSessionContent(content)
    expect(result.ok).toBe(true)
    // Total cost = 0.002 + 0.002 = 0.004 (no double-counting of input tokens).
    expect(result.usage!.cost_v2).toBeCloseTo(0.004, 9)
    expect(result.usage!.usage.inputTokens).toBe(200)
  })

  it('AC3: transcript-source harness filter — ohmypi sessions included in snapshot', () => {
    // This is a structural assertion: the filter in transcript-source.ts now
    // checks harness === 'ohmypi' in addition to 'pi'. The actual behavior is
    // integration-tested via the runtime; here we verify the filter string.
    const src = require('fs').readFileSync(
      require('path').join(
        __dirname,
        '../../memory/transcript-source.ts',
      ),
      'utf-8',
    )
    expect(src).toContain("agent.harness === 'ohmypi'")
  })
})
