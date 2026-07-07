import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseCodexSessionCostEventsSync, parseCodexSessionSync } from '../codex-parser.js';

const FIXTURE_DIR = join(__dirname, 'fixtures', 'codex');
const NONEXISTENT = join(__dirname, 'fixtures', 'codex', 'no-such-file.jsonl');
const FIXTURE = join(FIXTURE_DIR, 'rollout.jsonl');

const FIXTURES = [
  {
    name: 'legacy flat synthetic rollout',
    file: 'rollout.jsonl',
    model: 'codex-4o',
    inputTokens: 1248,
    cacheReadTokens: 200,
    outputTokens: 100,
    messageCount: 2,
    expectedCostUsd: 0.003269,
  },
  {
    name: 'nested single-turn rollout',
    file: 'rollout-nested-single-turn.jsonl',
    model: 'gpt-5.5',
    inputTokens: 14008,
    cacheReadTokens: 4992,
    outputTokens: 20,
    messageCount: 1,
    expectedCostUsd: 0.048176,
  },
  {
    name: 'nested multi-turn rollout',
    file: 'rollout-nested-multi-turn.jsonl',
    model: 'gpt-5.5',
    inputTokens: 60198,
    cacheReadTokens: 37120,
    outputTokens: 96,
    messageCount: 2,
    expectedCostUsd: 0.13683,
  },
];

describe('parseCodexSessionSync', () => {
  it('returns null for a nonexistent file', () => {
    expect(parseCodexSessionSync(NONEXISTENT)).toBeNull();
  });

  describe.each(FIXTURES)('$name', (fixture) => {
    it('returns exact model, cumulative tokens, and hand-computed cost', () => {
      const result = parseCodexSessionSync(join(FIXTURE_DIR, fixture.file));

      expect(result).not.toBeNull();
      expect(result?.model).toBe(fixture.model);
      expect(result?.usage.inputTokens).toBe(fixture.inputTokens);
      expect(result?.usage.cacheReadTokens).toBe(fixture.cacheReadTokens);
      expect(result?.usage.outputTokens).toBe(fixture.outputTokens);
      expect(result?.messageCount).toBe(fixture.messageCount);
      expect(result?.cost_v2).toBeCloseTo(fixture.expectedCostUsd, 12);
      expect(result?.cost_v2).toBeGreaterThan(0);
    });

    it('defaults to "unknown" model when no turn_context/task_started model is found', () => {
      const dir = mkdtempSync(join(tmpdir(), 'codex-no-model-'));
      const file = join(dir, 'no-model.jsonl');
      const content = [
        '{"type":"session_meta","timestamp":"2026-07-06T00:00:00Z","payload":{"id":"thread-no-model"}}',
        '{"type":"event_msg","timestamp":"2026-07-06T00:00:01Z","payload":{"type":"agent_message","message":"hello"}}',
        '{"type":"event_msg","timestamp":"2026-07-06T00:00:02Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":10,"output_tokens":20,"total_tokens":130},"last_token_usage":{"input_tokens":100,"cached_input_tokens":10,"output_tokens":20,"total_tokens":130}}}}',
      ].join('\n') + '\n';
      writeFileSync(file, content, 'utf-8');

      try {
        const result = parseCodexSessionSync(file);
        expect(result).not.toBeNull();
        expect(result!.model).toBe('unknown');
        expect(result!.cost_v2).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('keeps real nested fixture content fields redacted', () => {
    for (const file of ['rollout-nested-single-turn.jsonl', 'rollout-nested-multi-turn.jsonl']) {
      const raw = readFileSync(join(FIXTURE_DIR, file), 'utf-8');

      expect(raw).toContain('[redacted instructions]');
      expect(raw).toContain('[redacted content]');
      expect(raw).not.toContain('developer_instructions":"#');
      expect(raw).not.toContain('encrypted_content":"gAAAA');
      expect(raw).not.toMatch(/\/home\/|\/Users\/|\/tmp\//);
    }
  });

  it('emits one cost event per token_count record with stable request ids', () => {
    const file = join(FIXTURE_DIR, 'rollout-nested-multi-turn.jsonl');
    const events = parseCodexSessionCostEventsSync(file);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.requestId)).toEqual([
      'codex:019e7cf1-b148-7a80-80a4-2b891cb13d4c:0',
      'codex:019e7cf1-b148-7a80-80a4-2b891cb13d4c:1',
    ]);
    expect(events[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.5',
      input: 30074,
      cacheRead: 7552,
      output: 23,
      cacheWrite: 0,
    });
    expect(events[1]).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.5',
      input: 30124,
      cacheRead: 29568,
      output: 73,
      cacheWrite: 0,
    });
    expect(events[0]!.cost).toBeCloseTo(0.117076, 12);
    expect(events[1]!.cost).toBeCloseTo(0.019754, 12);
    expect(events.every((event) => event.cost > 0)).toBe(true);
  });

  it('event token sums equal the session-level cumulative totals', () => {
    const file = join(FIXTURE_DIR, 'rollout-nested-multi-turn.jsonl');
    const session = parseCodexSessionSync(file);
    const events = parseCodexSessionCostEventsSync(file);
    const sums = events.reduce(
      (acc, event) => ({
        input: acc.input + event.input,
        cacheRead: acc.cacheRead + event.cacheRead,
        output: acc.output + event.output,
        cost: acc.cost + event.cost,
      }),
      { input: 0, cacheRead: 0, output: 0, cost: 0 },
    );

    expect(session).not.toBeNull();
    expect(sums.input).toBe(session!.usage.inputTokens);
    expect(sums.cacheRead).toBe(session!.usage.cacheReadTokens);
    expect(sums.output).toBe(session!.usage.outputTokens);
    expect(sums.cost).toBeCloseTo(session!.cost_v2!, 12);
  });

  it('truncated reparse returns a strict prefix of the full event list', () => {
    const file = join(FIXTURE_DIR, 'rollout-nested-multi-turn.jsonl');
    const full = parseCodexSessionCostEventsSync(file);
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    const secondTurnStart = lines.findIndex((line) => line.includes('"turn_id":"019e7cf2-5022-7631-ab0e-77a116900dfe"'));
    const dir = mkdtempSync(join(tmpdir(), 'codex-events-'));
    const truncatedPath = join(dir, 'rollout-nested-multi-turn-truncated.jsonl');

    expect(secondTurnStart).toBeGreaterThan(0);
    try {
      writeFileSync(truncatedPath, `${lines.slice(0, secondTurnStart).join('\n')}\n`, 'utf-8');
      expect(parseCodexSessionCostEventsSync(truncatedPath)).toEqual(full.slice(0, 1).map((event) => ({
        ...event,
        sessionFile: truncatedPath,
      })));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses model unknown when token_count has no preceding model context', () => {
    const content = [
      '{"type":"session_meta","timestamp":"2026-07-06T00:00:00.000Z","payload":{"id":"no-model-thread"}}',
      '{"type":"event_msg","timestamp":"2026-07-06T00:00:01.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":10,"total_tokens":110},"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":10,"total_tokens":110}}}}',
    ].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'codex-events-'));
    const file = join(dir, 'no-model.jsonl');

    try {
      writeFileSync(file, `${content}\n`, 'utf-8');
      const session = parseCodexSessionSync(file);
      const events = parseCodexSessionCostEventsSync(file);

      expect(session).toMatchObject({
        model: 'unknown',
        cost_v2: 0,
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        requestId: 'codex:no-model-thread:0',
        model: 'unknown',
        input: 100,
        output: 10,
        cacheRead: 0,
        cost: 0,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseCodexSessionCostEventsSync (PAN-2388)', () => {
  it('returns an empty array for a nonexistent file', () => {
    expect(parseCodexSessionCostEventsSync(NONEXISTENT)).toEqual([]);
  });

  it('AC1: emits one event per token_count record with distinct codex:<threadId>:<seq> requestIds', () => {
    const events = parseCodexSessionCostEventsSync(FIXTURE);
    expect(events).toHaveLength(2);
    expect(events[0].requestId).toBe('codex:abc1234567890def:0');
    expect(events[1].requestId).toBe('codex:abc1234567890def:1');
  });

  it('AC2: event token sums equal session totals and each event has a positive cost', () => {
    const events = parseCodexSessionCostEventsSync(FIXTURE);
    const session = parseCodexSessionSync(FIXTURE);
    expect(session).not.toBeNull();

    expect(events.reduce((sum, e) => sum + e.input, 0)).toBe(session!.usage.inputTokens);
    expect(events.reduce((sum, e) => sum + e.output, 0)).toBe(session!.usage.outputTokens);
    expect(events.reduce((sum, e) => sum + e.cacheRead, 0)).toBe(session!.usage.cacheReadTokens);

    for (const event of events) {
      expect(event.cost).toBeGreaterThan(0);
      expect(event.provider).toBe('openai');
      expect(event.model).toBe('codex-4o');
      expect(event.cacheWrite).toBe(0);
    }
  });

  it('AC3: truncating the fixture returns a strict prefix of the full event list', () => {
    const fullEvents = parseCodexSessionCostEventsSync(FIXTURE);
    expect(fullEvents).toHaveLength(2);

    const raw = readFileSync(FIXTURE, 'utf-8');
    const lines = raw.split('\n');
    // Truncate after the first token_count line (line index 2 in the fixture).
    const truncated = lines.slice(0, 3).join('\n') + '\n';
    const dir = mkdtempSync(join(tmpdir(), 'codex-trunc-'));
    const truncatedFile = join(dir, 'truncated.jsonl');
    writeFileSync(truncatedFile, truncated, 'utf-8');

    try {
      const prefixEvents = parseCodexSessionCostEventsSync(truncatedFile);
      expect(prefixEvents).toHaveLength(1);
      expect(prefixEvents[0]).toMatchObject({
        requestId: fullEvents[0].requestId,
        input: fullEvents[0].input,
        output: fullEvents[0].output,
        cacheRead: fullEvents[0].cacheRead,
        cost: fullEvents[0].cost,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC4: token_count with no preceding model uses "unknown"', () => {
    const content = [
      '{"type":"session_meta","timestamp":"2026-07-06T00:00:00Z","payload":{"id":"thread-no-model"}}',
      '{"type":"event_msg","timestamp":"2026-07-06T00:00:01Z","payload":{"type":"agent_message","message":"hello"}}',
      '{"type":"event_msg","timestamp":"2026-07-06T00:00:02Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":10,"output_tokens":20,"total_tokens":130},"last_token_usage":{"input_tokens":100,"cached_input_tokens":10,"output_tokens":20,"total_tokens":130}}}}',
    ].join('\n') + '\n';
    const dir = mkdtempSync(join(tmpdir(), 'codex-no-model-'));
    const file = join(dir, 'no-model.jsonl');
    writeFileSync(file, content, 'utf-8');

    try {
      const events = parseCodexSessionCostEventsSync(file);
      expect(events).toHaveLength(1);
      expect(events[0].model).toBe('unknown');
      expect(events[0].requestId).toBe('codex:thread-no-model:0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses cumulative-delta arithmetic when last_token_usage does not sum to total_token_usage', () => {
    // Simulate a real-style rollout where last_token_usage is cumulative per-turn
    // rather than a delta. last values (100, 0, 10) + (120, 0, 15) = (220, 0, 25),
    // but final total is (120, 0, 15). The emitter must fall back to deltas.
    const content = [
      '{"type":"task_started","timestamp":"2026-07-06T00:00:00Z","model":"gpt-5.5","thread_id":"thread-delta"}',
      '{"type":"agent_message","timestamp":"2026-07-06T00:00:01Z"}',
      '{"type":"token_count","timestamp":"2026-07-06T00:00:02Z","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":10,"total_tokens":110},"last_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":10,"total_tokens":110}}}',
      '{"type":"agent_message","timestamp":"2026-07-06T00:00:03Z"}',
      '{"type":"token_count","timestamp":"2026-07-06T00:00:04Z","info":{"total_token_usage":{"input_tokens":120,"cached_input_tokens":0,"output_tokens":15,"total_tokens":135},"last_token_usage":{"input_tokens":120,"cached_input_tokens":0,"output_tokens":15,"total_tokens":135}}}',
    ].join('\n') + '\n';
    const dir = mkdtempSync(join(tmpdir(), 'codex-delta-'));
    const file = join(dir, 'delta.jsonl');
    writeFileSync(file, content, 'utf-8');

    try {
      const events = parseCodexSessionCostEventsSync(file);
      expect(events).toHaveLength(2);
      expect(events[0].input).toBe(100);
      expect(events[0].output).toBe(10);
      expect(events[1].input).toBe(20); // 120 - 100
      expect(events[1].output).toBe(5); // 15 - 10
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
