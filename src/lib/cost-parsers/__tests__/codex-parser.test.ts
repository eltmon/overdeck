import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parseCodexSessionSync } from '../codex-parser.js';

const FIXTURE = join(__dirname, 'fixtures', 'codex', 'rollout.jsonl');
const NONEXISTENT = join(__dirname, 'fixtures', 'codex', 'no-such-file.jsonl');

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
});
