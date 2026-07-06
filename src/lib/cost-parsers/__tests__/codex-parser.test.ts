import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseCodexSessionSync } from '../codex-parser.js';

const FIXTURE_DIR = join(__dirname, 'fixtures', 'codex');
const NONEXISTENT = join(__dirname, 'fixtures', 'codex', 'no-such-file.jsonl');

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
  });

  it('keeps real nested fixture content fields redacted', () => {
    for (const file of ['rollout-nested-single-turn.jsonl', 'rollout-nested-multi-turn.jsonl']) {
      const raw = readFileSync(join(FIXTURE_DIR, file), 'utf-8');

      expect(raw).toContain('[redacted instructions]');
      expect(raw).toContain('[redacted content]');
      expect(raw).not.toContain('developer_instructions":"#');
      expect(raw).not.toContain('encrypted_content":"gAAAA');
    }
  });
});
