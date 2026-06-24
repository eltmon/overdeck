import { describe, it, expect } from 'vitest';
import { getPricingSync, calculateCostSync, type TokenUsage } from '../../cost.js';
import { extractPiCostEvents } from '../reconciler.js';

// PAN-1935: pi/kimi work agents recorded $0 cost because (a) the reconciler
// only scanned ~/.claude/projects/ (Claude Code) transcripts and only knew the
// Anthropic usage shape, and (b) getPricingSync had no rows for glm-5.x /
// kimi-k2.7-code so even if usage were parsed, events were dropped. These tests
// pin both the pricing table and the pi-shape extractor.

describe('PAN-1935: pi-harness cost capture', () => {
  describe('pricing table covers pi-routed models', () => {
    it('returns pricing for glm-5.2 (zai)', () => {
      const pricing = getPricingSync('custom', 'glm-5.2');
      expect(pricing).not.toBeNull();
      expect(pricing!.inputPer1k).toBe(0.0014); // $1.4/M
      expect(pricing!.outputPer1k).toBe(0.0044); // $4.4/M
    });

    it('returns pricing for kimi-k2.7-code', () => {
      const pricing = getPricingSync('custom', 'kimi-k2.7-code');
      expect(pricing).not.toBeNull();
      expect(pricing!.inputPer1k).toBe(0.00095); // $0.95/M cache-miss
      expect(pricing!.outputPer1k).toBe(0.004); // $4.00/M
    });

    it('returns pricing for glm-5.1 and glm-4.7', () => {
      expect(getPricingSync('custom', 'glm-5.1')).not.toBeNull();
      expect(getPricingSync('custom', 'glm-4.7')).not.toBeNull();
    });
  });

  describe('extractPiCostEvents parses the pi transcript shape', () => {
    const sessionId = '019ef4ec-d53c-760f-ad02-af90a0f36b45';

    function piMessage(model: string, provider: string, usage: Record<string, number>, responseId: string, id: string): string {
      // Real pi transcript row shape (captured from a live glm-5.2 agent):
      // top-level type 'message', usage under message.* with short camelCase keys,
      // real model/provider on message, cost.total always 0 for non-Anthropic.
      return JSON.stringify({
        type: 'message',
        id,
        parentId: 'p-' + id,
        timestamp: '2026-06-23T14:42:54.230Z',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '…' }],
          api: 'openai-completions',
          provider,
          model,
          usage: { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop',
          timestamp: 1782225674876,
          responseId,
        },
      });
    }

    it('extracts a glm-5.2 event with non-zero cost and the real model', () => {
      const content = [
        '{"type":"session","version":3,"id":"' + sessionId + '","timestamp":"2026-06-23T14:40:22.332Z"}',
        piMessage('glm-5.2', 'zai', { input: 18404, output: 234, cacheRead: 9472, cacheWrite: 0, totalTokens: 28110 }, 'resp-1', '7186ce01'),
      ].join('\n');

      const events = extractPiCostEvents(content, 'agent-pan-1989', 'PAN-1989', 'work', sessionId);

      expect(events).toHaveLength(1);
      const ev = events[0]!;
      expect(ev.model).toBe('glm-5.2'); // NOT 'pi'
      expect(ev.provider).toBe('custom'); // zai → custom
      expect(ev.input).toBe(18404);
      expect(ev.output).toBe(234);
      expect(ev.cacheRead).toBe(9472);
      expect(ev.cost).toBeGreaterThan(0); // the whole point: was $0 before
      expect(ev.agentId).toBe('agent-pan-1989');
      expect(ev.issueId).toBe('PAN-1989');
      expect(ev.requestId).toBe('resp-1');
      expect(ev.sessionId).toBe(sessionId);
    });

    it('computes cost correctly for glm-5.2 (matches calculateCostSync)', () => {
      const usage: TokenUsage = { inputTokens: 18404, outputTokens: 234, cacheReadTokens: 9472, cacheWriteTokens: 0, cacheTTL: '5m' };
      const pricing = getPricingSync('custom', 'glm-5.2')!;
      const expected = calculateCostSync(usage, pricing);
      expect(expected).toBeGreaterThan(0);

      const content = piMessage('glm-5.2', 'zai', { input: 18404, output: 234, cacheRead: 9472, cacheWrite: 0, totalTokens: 28110 }, 'resp-2', 'abc1');
      const [ev] = extractPiCostEvents(content, 'a', 'PAN-1', 'work', sessionId);
      expect(ev!.cost).toBeCloseTo(expected, 6);
    });

    it('extracts a kimi-k2.7-code event', () => {
      const content = piMessage('kimi-k2.7-code', 'kimi', { input: 50000, output: 1000, cacheRead: 0, cacheWrite: 0, totalTokens: 51000 }, 'kresp-1', 'k1');
      const [ev] = extractPiCostEvents(content, 'agent-pan-1922', 'PAN-1922', 'work', sessionId);
      expect(ev!.model).toBe('kimi-k2.7-code');
      expect(ev!.provider).toBe('custom');
      expect(ev!.cost).toBeGreaterThan(0);
    });

    it('skips messages with all-zero usage (no hallucinated cost)', () => {
      const content = piMessage('glm-5.2', 'zai', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, 'z1', 'z1');
      expect(extractPiCostEvents(content, 'a', 'PAN-1', 'work', sessionId)).toHaveLength(0);
    });

    it('skips models with no pricing row (does not insert $0 junk)', () => {
      const content = piMessage('mystery-model-9999', 'unknown', { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 1500 }, 'm1', 'm1');
      expect(extractPiCostEvents(content, 'a', 'PAN-1', 'work', sessionId)).toHaveLength(0);
    });

    it('falls back to session-scoped requestId when responseId is absent (idempotent dedup)', () => {
      const line = JSON.stringify({
        type: 'message',
        id: 'abc2',
        timestamp: '2026-06-23T14:42:54.230Z',
        message: { role: 'assistant', provider: 'zai', model: 'glm-5.2', usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110 } },
      });
      const [ev] = extractPiCostEvents(line, 'a', 'PAN-1', 'work', sessionId);
      expect(ev!.requestId).toBe(`${sessionId}#abc2`);
    });

    it('ignores non-message rows (session header, model_change, thinking_level_change)', () => {
      const content = [
        '{"type":"session","version":3,"id":"x"}',
        '{"type":"model_change","model":"glm-5.2"}',
        '{"type":"thinking_level_change","level":"high"}',
      ].join('\n');
      expect(extractPiCostEvents(content, 'a', 'PAN-1', 'work', sessionId)).toHaveLength(0);
    });
  });
});
