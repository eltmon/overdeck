import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractJsonArray, loadPromptFile, runPromptScenario } from '../../../../evals/lib/prompt-harness.js';

const { streamMock, anthropicCtor } = vi.hoisted(() => {
  const streamMock = vi.fn();
  const anthropicCtor = vi.fn(function AnthropicMock(this: { messages: { stream: typeof streamMock } }) {
    this.messages = { stream: streamMock };
  });
  return { streamMock, anthropicCtor };
});

vi.mock('@anthropic-ai/sdk', () => ({ default: anthropicCtor }));

function mockFinalMessage(overrides: {
  text?: string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  stop_reason?: string | null;
} = {}) {
  streamMock.mockReturnValue({
    finalMessage: async () => ({
      content: [{ type: 'text', text: overrides.text ?? 'ok' }],
      usage: overrides.usage ?? { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      stop_reason: overrides.stop_reason ?? 'end_turn',
    }),
  });
}

describe('evals/lib/prompt-harness', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    streamMock.mockReset();
    anthropicCtor.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockFinalMessage();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('loadPromptFile', () => {
    it('returns the file content for roles/flywheel.md', () => {
      const content = loadPromptFile('roles/flywheel.md');
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('flywheel');
    });

    it('throws a descriptive error for a missing path', () => {
      expect(() => loadPromptFile('roles/does-not-exist.md')).toThrow(
        /Prompt file not found: roles\/does-not-exist\.md/,
      );
    });
  });

  describe('runPromptScenario', () => {
    it('rejects before any network call when OVERDECK_EVAL_MODEL is unset', async () => {
      const original = process.env['OVERDECK_EVAL_MODEL'];
      delete process.env['OVERDECK_EVAL_MODEL'];

      await expect(runPromptScenario({ system: 'system prompt', user: 'user prompt' })).rejects.toThrow(
        /OVERDECK_EVAL_MODEL is not set/,
      );

      if (original !== undefined) {
        process.env['OVERDECK_EVAL_MODEL'] = original;
      }
      expect(anthropicCtor).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('claude-sonnet-5-5 request carries no temperature and sends adaptive thinking with effort high', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-sonnet-5-5');
      await runPromptScenario({ system: 'sys', user: 'usr' });

      const params = streamMock.mock.calls[0][0];
      expect(params).not.toHaveProperty('temperature');
      expect(params).not.toHaveProperty('top_p');
      expect(params).not.toHaveProperty('top_k');
      expect(params.thinking).toEqual({ type: 'adaptive' });
      expect(params.output_config).toEqual({ effort: 'high' });
      expect(params.max_tokens).toBe(128000);
    });

    it('claude-haiku-4-5-20251001 request sends temperature 0 and no thinking or effort', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-haiku-4-5-20251001');
      await runPromptScenario({ system: 'sys', user: 'usr' });

      const params = streamMock.mock.calls[0][0];
      expect(params.temperature).toBe(0);
      expect(params).not.toHaveProperty('thinking');
      expect(params).not.toHaveProperty('output_config');
    });

    it('an unknown model id rejects naming the id and sends no request', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-nonexistent-9');
      await expect(runPromptScenario({ system: 'sys', user: 'usr' })).rejects.toThrow(
        /Unknown eval model "claude-nonexistent-9"/,
      );
      expect(anthropicCtor).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a deprecated model id rejects and sends no request', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-sonnet-4-5');
      await expect(runPromptScenario({ system: 'sys', user: 'usr' })).rejects.toThrow(/claude-sonnet-4-6/);
      expect(anthropicCtor).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns text and run info with usage and cost', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-haiku-4-5-20251001');
      const { text, run } = await runPromptScenario({ system: 'sys', user: 'usr' });

      expect(text).toBe('ok');
      expect(run.provider).toBe('anthropic');
      expect(run.usage.outputTokens).toBe(20);
      expect(typeof run.costUsd).toBe('number');
      expect(run.costBasis).toBe('api');
      expect(run.stopReason).toBe('end_turn');
    });
  });

  describe('extractJsonArray', () => {
    it('returns the parsed array for a response wrapped in a json code fence', () => {
      const text = '```json\n[{"id": 1}, {"id": 2}]\n```';
      expect(extractJsonArray(text)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('returns the parsed array for a plain response', () => {
      const text = '[1, 2, 3]';
      expect(extractJsonArray(text)).toEqual([1, 2, 3]);
    });

    it('throws a descriptive error when the text contains no JSON array', () => {
      expect(() => extractJsonArray('just plain text')).toThrow(/No JSON array found in response/);
    });
  });
});
