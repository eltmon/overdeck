import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getPricingSync } from '../../cost.js';
import { parseCodexSessionSync } from '../codex-parser.js';

const GPT55_FIXTURE = join(__dirname, 'fixtures', 'rollout-gpt55-nested.jsonl');

describe('parseCodexSessionSync gpt-5.5 nested rollout fixture', () => {
  it('reads model, thread id, latest cumulative usage, and cached-input priced cost', () => {
    const result = parseCodexSessionSync(GPT55_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.model).toBe('gpt-5.5');
    expect(result!.sessionId).toBe('019f337a-5eb4-74f1-bd39-78c79a3f7588');
    expect(result!.usage.inputTokens).toBe(18000);
    expect(result!.usage.cacheReadTokens).toBe(6000);
    expect(result!.usage.outputTokens).toBe(1500);

    const pricing = getPricingSync('openai', 'gpt-5.5')!;
    const expectedCost =
      ((18000 - 6000) / 1000) * pricing.inputPer1k +
      (6000 / 1000) * (pricing.cacheReadPer1k ?? 0) +
      (1500 / 1000) * pricing.outputPer1k;
    expect(result!.cost).toBeCloseTo(expectedCost, 8);
    expect(result!.cost).toBeGreaterThan(0);
  });

  it('keeps codex-auto-review model id and prices it at zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-auto-review-'));
    const file = join(dir, 'rollout-auto-review.jsonl');
    try {
      writeFileSync(
        file,
        [
          JSON.stringify({ timestamp: '2026-07-05T14:20:00.000Z', type: 'session_meta', payload: { type: 'session_meta', id: 'auto-review-thread' } }),
          JSON.stringify({ timestamp: '2026-07-05T14:20:00.100Z', type: 'turn_context', payload: { type: 'turn_context', model: 'codex-auto-review' } }),
          JSON.stringify({ timestamp: '2026-07-05T14:20:01.000Z', type: 'event_msg', payload: { type: 'agent_message', message: '[redacted]' } }),
          JSON.stringify({ timestamp: '2026-07-05T14:20:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 3000, cached_input_tokens: 1000, output_tokens: 200, total_tokens: 3200 } } } }),
        ].join('\n') + '\n',
        'utf8',
      );

      const result = parseCodexSessionSync(file);
      expect(result).not.toBeNull();
      expect(result!.model).toBe('codex-auto-review');
      expect(result!.sessionId).toBe('auto-review-thread');
      expect(result!.cost).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
