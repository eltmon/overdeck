import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseCodexSessionSync, parseCodexSessionCostEventsSync } from '../codex-parser.js';

const FIXTURE = join(__dirname, 'fixtures', 'codex', 'rollout.jsonl');
const NONEXISTENT = join(__dirname, 'fixtures', 'codex', 'no-such-file.jsonl');

/** Nested rollout schema (codex cli >= 0.137.0): event_msg/turn_context wrappers. */
const NESTED_ROLLOUT = [
  { type: 'session_meta', timestamp: '2026-06-09T00:10:50Z', payload: { id: 'thread-nested-42', model_provider: 'openai' } },
  { type: 'turn_context', timestamp: '2026-06-09T00:10:50Z', payload: { turn_id: 't1', model: 'gpt-5.5' } },
  { type: 'event_msg', timestamp: '2026-06-09T00:10:57Z', payload: { type: 'agent_message', message: 'Working on it.' } },
  { type: 'event_msg', timestamp: '2026-06-09T00:10:58Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 5000, cached_input_tokens: 1000, output_tokens: 200, total_tokens: 5200 } } } },
  { type: 'event_msg', timestamp: '2026-06-09T00:11:05Z', payload: { type: 'agent_message', message: 'Done.' } },
  { type: 'event_msg', timestamp: '2026-06-09T00:11:06Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 9000, cached_input_tokens: 1500, output_tokens: 500, total_tokens: 9500 } } } },
];

describe('parseCodexSessionSync', () => {
  it('returns null for a nonexistent file', () => {
    expect(parseCodexSessionSync(NONEXISTENT)).toBeNull();
  });

  it('parses token_count records into SessionUsage', () => {
    const result = parseCodexSessionSync(FIXTURE);
    expect(result).not.toBeNull();
    // Model extracted from task_started
    expect(result?.model).toBe('codex-4o');
    // Thread-id from task_started
    expect(result?.sessionId).toBe('abc1234567890def');
    // Cumulative totals from the LAST token_count record
    expect(result?.usage.inputTokens).toBe(1248);
    expect(result?.usage.outputTokens).toBe(100);
    expect(result?.usage.cacheReadTokens).toBe(200);
    // Message count = number of agent_message records
    expect(result?.messageCount).toBe(2);
    // Cost should be a positive number (codex-4o is priced)
    expect(result?.cost_v2).toBeGreaterThan(0);
  });

  it('returns null for empty/blank content', () => {
    // Test via inline parse — no file I/O needed
    expect(parseCodexSessionSync(NONEXISTENT)).toBeNull();
  });

  describe('nested schema (cli >= 0.137.0)', () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'codex-cost-'));
      file = join(dir, 'rollout-nested.jsonl');
      writeFileSync(file, NESTED_ROLLOUT.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('reads model from turn_context, thread id from session_meta, and latest cumulative usage', () => {
      const result = parseCodexSessionSync(file);
      expect(result).not.toBeNull();
      expect(result?.model).toBe('gpt-5.5');
      expect(result?.sessionId).toBe('thread-nested-42');
      expect(result?.usage.inputTokens).toBe(9000);
      expect(result?.usage.cacheReadTokens).toBe(1500);
      expect(result?.usage.outputTokens).toBe(500);
      expect(result?.messageCount).toBe(2);
      // Non-cached input (9000-1500) priced at input rate + cached at cache rate
      // + output, all > 0 with gpt-5.5 pricing.
      expect(result?.cost_v2).toBeGreaterThan(0);
    });
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
