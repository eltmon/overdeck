import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { readFileSync } from 'fs'
import { parseOhmypiSessionCostEventsSync, parseOhmypiSessionSync, parseOhmypiSessionContent } from '../ohmypi-parser.js'

const FIXTURES = join(__dirname, 'fixtures', 'ohmypi')

const providerFixtures = [
  {
    name: 'zai GLM real fixture',
    file: 'rpc-toolcall.jsonl',
    requestId: 'ohmypi:019ef4f8-6317-7000-9277-81d3e9dd941e:56f1fdfa',
    sessionId: '019ef4f8-6317-7000-9277-81d3e9dd941e',
    provider: 'zai',
    model: 'glm-4.5-flash',
    input: 51444,
    output: 39,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  },
  {
    // Real fixture harvested from ~/.omp/agent/sessions/-Projects-overdeck/2026-06-27T14-43-13-805Z_019f0988-e30d-7000-b11c-23c3826c54ab.jsonl.
    name: 'openai-codex GPT-5.5 real fixture',
    file: 'openai-codex-gpt-5.5.jsonl',
    requestId: 'ohmypi:019f0988-e30d-7000-b11c-23c3826c54ab:8f73f17b',
    sessionId: '019f0988-e30d-7000-b11c-23c3826c54ab',
    provider: 'openai-codex',
    model: 'gpt-5.5',
    input: 42853,
    output: 125,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.21801500000000001,
  },
  {
    // synthetic: no Kimi omp session was present on disk in ~/.omp/agent/sessions or ~/.overdeck/agents/*/sessions.
    name: 'kimi synthetic fixture',
    file: 'kimi-k2.7-code.jsonl',
    requestId: 'ohmypi:synthetic-kimi-session:kimi-assistant',
    sessionId: 'synthetic-kimi-session',
    provider: 'kimi',
    model: 'kimi-k2.7-code',
    input: 1200,
    output: 80,
    cacheRead: 300,
    cacheWrite: 40,
    cost: 0.001555,
  },
  {
    // synthetic: no MiniMax omp session was present on disk in ~/.omp/agent/sessions or ~/.overdeck/agents/*/sessions.
    name: 'minimax synthetic fixture',
    file: 'minimax-m2.7-highspeed.jsonl',
    requestId: 'ohmypi:synthetic-minimax-session:minimax-assistant',
    sessionId: 'synthetic-minimax-session',
    provider: 'minimax',
    model: 'minimax-m2.7-highspeed',
    input: 2400,
    output: 160,
    cacheRead: 0,
    cacheWrite: 20,
    cost: 0.000918,
  },
  {
    // synthetic: no Gemini omp session was present on disk in ~/.omp/agent/sessions or ~/.overdeck/agents/*/sessions.
    name: 'gemini synthetic fixture',
    file: 'gemini-3-flash-preview.jsonl',
    requestId: 'ohmypi:synthetic-gemini-session:gemini-assistant',
    sessionId: 'synthetic-gemini-session',
    provider: 'google',
    model: 'gemini-3-flash-preview',
    input: 3200,
    output: 90,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.000534,
  },
] as const

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
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    })
  })

  it.each(providerFixtures)('PAN-2388: parses exact provider usage for $name', (fixture) => {
    const events = parseOhmypiSessionCostEventsSync(join(FIXTURES, fixture.file))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      requestId: fixture.requestId,
      sessionId: fixture.sessionId,
      provider: fixture.provider,
      model: fixture.model,
      input: fixture.input,
      output: fixture.output,
      cacheRead: fixture.cacheRead,
      cacheWrite: fixture.cacheWrite,
    })
    expect(events[0]!.cost).toBeCloseTo(fixture.cost, 12)
  })

  it.each(providerFixtures)('PAN-2388: session totals equal event sums for $name', (fixture) => {
    const path = join(FIXTURES, fixture.file)
    const events = parseOhmypiSessionCostEventsSync(path)
    const result = parseOhmypiSessionSync(path)
    expect(result).not.toBeNull()

    const sums = events.reduce(
      (acc, event) => ({
        input: acc.input + event.input,
        output: acc.output + event.output,
        cacheRead: acc.cacheRead + event.cacheRead,
        cacheWrite: acc.cacheWrite + event.cacheWrite,
        cost: acc.cost + event.cost,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    )

    expect(result!.usage.inputTokens).toBe(sums.input)
    expect(result!.usage.outputTokens).toBe(sums.output)
    expect(result!.usage.cacheReadTokens).toBe(sums.cacheRead)
    expect(result!.usage.cacheWriteTokens).toBe(sums.cacheWrite)
    expect(result!.cost_v2).toBeCloseTo(sums.cost, 12)
  })

  it('PAN-2388: committed ohmypi fixtures retain no real prompt or response text', () => {
    for (const fixture of providerFixtures) {
      const content = readFileSync(join(FIXTURES, fixture.file), 'utf8')
      expect(content).not.toContain('Use the read tool')
      expect(content).not.toContain('pi version is')
      expect(content).not.toContain('I’m `openai-codex/gpt-5.5`')
      expect(content).not.toMatch(/\/home\/|\/Users\/|\/tmp\//)
    }
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

  it('PAN-2388: recomputes event cost from pricing when inline cost is absent', () => {
    const content = [
      '{"type":"session","version":3,"id":"fallback-session","timestamp":"2026-07-06T00:00:00.000Z"}',
      '{"type":"message","id":"assistant-1","parentId":null,"timestamp":"2026-07-06T00:00:01.000Z","message":{"role":"assistant","provider":"openai-codex","model":"gpt-5.5","usage":{"input":1000,"output":100,"cacheRead":500,"cacheWrite":0,"totalTokens":1600}}}',
    ].join('\n')

    const result = parseOhmypiSessionContent(content)

    expect(result.ok).toBe(true)
    expect(result.usageEvents).toHaveLength(1)
    expect(result.usageEvents![0]!.cost).toBeCloseTo(0.00825, 12)
    expect(result.usage!.cost_v2).toBeCloseTo(0.00825, 12)
    expect(result.unpricedModels).toEqual([])
  })

  it('PAN-2388: preserves inline usage.cost.total without recomputing', () => {
    const content = [
      '{"type":"session","version":3,"id":"inline-session","timestamp":"2026-07-06T00:00:00.000Z"}',
      '{"type":"message","id":"assistant-1","parentId":null,"timestamp":"2026-07-06T00:00:01.000Z","message":{"role":"assistant","provider":"openai-codex","model":"gpt-5.5","usage":{"input":1000,"output":100,"cacheRead":500,"cacheWrite":0,"totalTokens":1600,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0.123456}}}}',
    ].join('\n')

    const result = parseOhmypiSessionContent(content)

    expect(result.ok).toBe(true)
    expect(result.usageEvents).toHaveLength(1)
    expect(result.usageEvents![0]!.cost).toBe(0.123456)
    expect(result.usage!.cost_v2).toBe(0.123456)
  })

  it('PAN-2388: reports a machine-readable reason when tokens have no pricing row', () => {
    const content = [
      '{"type":"session","version":3,"id":"unpriced-session","timestamp":"2026-07-06T00:00:00.000Z"}',
      '{"type":"message","id":"assistant-1","parentId":null,"timestamp":"2026-07-06T00:00:01.000Z","message":{"role":"assistant","provider":"mystery","model":"mystery-model","usage":{"input":100,"output":10,"cacheRead":0,"cacheWrite":0,"totalTokens":110}}}',
    ].join('\n')

    const result = parseOhmypiSessionContent(content)

    expect(result.ok).toBe(true)
    expect(result.usageEvents).toHaveLength(1)
    expect(result.usageEvents![0]!.cost).toBe(0)
    expect(result.usageEvents![0]!.warnings).toEqual([
      { type: 'unpriced-model', provider: 'mystery', model: 'mystery-model', reason: 'unknown-provider' },
    ])
    expect(result.usage!.cost_v2).toBe(0)
    expect(result.unpricedModels).toEqual([
      { provider: 'mystery', model: 'mystery-model', reason: 'unknown-provider' },
    ])
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

describe('parseOhmypiSession per-provider fixtures (PAN-2388)', () => {
  interface FixtureCase {
    file: string
    synthetic: boolean
    expected: {
      sessionId: string
      requestId: string
      provider: string
      model: string
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      cost: number
    }
  }

  const cases: FixtureCase[] = [
    {
      // Existing real fixture harvested from a zai/GLM omp session.
      file: 'rpc-toolcall.jsonl',
      synthetic: false,
      expected: {
        sessionId: '019ef4f8-6317-7000-9277-81d3e9dd941e',
        requestId: 'ohmypi:019ef4f8-6317-7000-9277-81d3e9dd941e:56f1fdfa',
        provider: 'zai',
        model: 'glm-4.5-flash',
        input: 51444,
        output: 39,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
      },
    },
    {
      // Real fixture derived from ~/.omp/agent/sessions (openai-codex/gpt-5.5).
      file: 'openai-codex.jsonl',
      synthetic: false,
      expected: {
        sessionId: '019f0988-e30d-7000-b11c-23c3826c54ab',
        requestId: 'ohmypi:019f0988-e30d-7000-b11c-23c3826c54ab:8f73f17b',
        provider: 'openai-codex',
        model: 'gpt-5.5',
        input: 42853,
        output: 125,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.21801500000000001,
      },
    },
    {
      // Synthetic: no real on-disk omp session for this provider was found.
      file: 'kimi.jsonl',
      synthetic: true,
      expected: {
        sessionId: 'sess-synthetic-kimi-001',
        requestId: 'ohmypi:sess-synthetic-kimi-001:msg-kimi-assistant-001',
        provider: 'kimi',
        model: 'kimi-k2',
        input: 1000,
        output: 200,
        cacheRead: 50,
        cacheWrite: 25,
        cost: 0.0007175,
      },
    },
    {
      // Synthetic: no real on-disk omp session for this provider was found.
      file: 'minimax.jsonl',
      synthetic: true,
      expected: {
        sessionId: 'sess-synthetic-minimax-001',
        requestId: 'ohmypi:sess-synthetic-minimax-001:msg-minimax-assistant-001',
        provider: 'minimax',
        model: 'minimax-pro',
        input: 2000,
        output: 300,
        cacheRead: 100,
        cacheWrite: 75,
        cost: 0.0013475,
      },
    },
    {
      // Synthetic: no real on-disk omp session for this provider was found.
      file: 'gemini.jsonl',
      synthetic: true,
      expected: {
        sessionId: 'sess-synthetic-gemini-001',
        requestId: 'ohmypi:sess-synthetic-gemini-001:msg-gemini-assistant-001',
        provider: 'google',
        model: 'gemini-2.5',
        input: 3000,
        output: 400,
        cacheRead: 150,
        cacheWrite: 100,
        cost: 0.001965,
      },
    },
  ]

  it.each(cases)('returns cost events for $expected.provider ($file)', ({ file, expected }) => {
    const events = parseOhmypiSessionCostEventsSync(join(FIXTURES, file))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      requestId: expected.requestId,
      sessionId: expected.sessionId,
      provider: expected.provider,
      model: expected.model,
      input: expected.input,
      output: expected.output,
      cacheRead: expected.cacheRead,
      cacheWrite: expected.cacheWrite,
      cost: expected.cost,
    })
  })

  it.each(cases)('returns session totals equal to event sums for $expected.provider ($file)', ({ file, expected }) => {
    const result = parseOhmypiSessionSync(join(FIXTURES, file))
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe(expected.sessionId)
    expect(result!.usage.inputTokens).toBe(expected.input)
    expect(result!.usage.outputTokens).toBe(expected.output)
    expect(result!.usage.cacheReadTokens).toBe(expected.cacheRead)
    expect(result!.usage.cacheWriteTokens).toBe(expected.cacheWrite)
    expect(result!.cost_v2).toBeCloseTo(expected.cost, 9)
    expect(result!.messageCount).toBe(1)

    const modelEntry = result!.modelBreakdown?.[expected.model]
    expect(modelEntry).toBeDefined()
    expect(modelEntry!.inputTokens).toBe(expected.input)
    expect(modelEntry!.outputTokens).toBe(expected.output)
    expect(modelEntry!.cacheReadTokens).toBe(expected.cacheRead)
    expect(modelEntry!.cacheWriteTokens).toBe(expected.cacheWrite)
    expect(modelEntry!.cost).toBeCloseTo(expected.cost, 9)
  })

  it('marks synthetic fixtures explicitly in test metadata', () => {
    const syntheticFiles = cases.filter((c) => c.synthetic).map((c) => c.file)
    expect(syntheticFiles).toEqual(['kimi.jsonl', 'minimax.jsonl', 'gemini.jsonl'])
  })
})
