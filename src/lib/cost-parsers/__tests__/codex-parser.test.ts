import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseCodexSessionSync } from '../codex-parser.js';

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
