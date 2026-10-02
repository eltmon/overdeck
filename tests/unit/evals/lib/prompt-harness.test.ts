import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractJsonArray, loadPromptFile, runPromptScenario } from '../../../../evals/lib/prompt-harness.js';

const { streamMock, anthropicCtor, callClaudeCliMock } = vi.hoisted(() => {
  const streamMock = vi.fn();
  const anthropicCtor = vi.fn(function AnthropicMock(this: { messages: { stream: typeof streamMock } }) {
    this.messages = { stream: streamMock };
  });
  const callClaudeCliMock = vi.fn();
  return { streamMock, anthropicCtor, callClaudeCliMock };
});

vi.mock('@anthropic-ai/sdk', () => ({ default: anthropicCtor }));
vi.mock('../../../../evals/lib/claude-cli.js', () => ({ callClaudeCli: callClaudeCliMock }));

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
    callClaudeCliMock.mockReset();
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

    it('gpt-6-luna via cliproxy calls fetch, not the Anthropic client, and reports api-equivalent cost', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'gpt-6-luna');
      vi.stubEnv('OVERDECK_EVAL_OPENAI_VIA', 'cliproxy');
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

      const { run } = await runPromptScenario({ system: 'sys', user: 'usr' });

      expect(anthropicCtor).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(run.provider).toBe('openai');
      expect(run.costBasis).toBe('api-equivalent');
      expect(typeof run.costUsd).toBe('number');
    });

    it('claude-sonnet-5-5 with OVERDECK_EVAL_ANTHROPIC_VIA=claude-cli calls the CLI route, not the SDK, at api-equivalent cost', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-sonnet-5-5');
      vi.stubEnv('OVERDECK_EVAL_ANTHROPIC_VIA', 'claude-cli');
      callClaudeCliMock.mockResolvedValue({
        text: 'from cli',
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 2 },
        stopReason: 'end_turn',
      });

      const { text, run } = await runPromptScenario({ system: 'sys', user: 'usr' });

      expect(callClaudeCliMock).toHaveBeenCalledTimes(1);
      expect(callClaudeCliMock.mock.calls[0]![1]).toEqual({ system: 'sys', messages: [{ role: 'user', content: 'usr' }] });
      expect(anthropicCtor).not.toHaveBeenCalled();
      expect(text).toBe('from cli');
      expect(run.anthropicVia).toBe('claude-cli');
      expect(run.costBasis).toBe('api-equivalent');
      expect(typeof run.costUsd).toBe('number');
    });

    it('claude-sonnet-5-5 without the route variable uses the SDK and stamps anthropicVia api', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-sonnet-5-5');
      vi.stubEnv('OVERDECK_EVAL_ANTHROPIC_VIA', '');

      const { run } = await runPromptScenario({ system: 'sys', user: 'usr' });

      expect(streamMock).toHaveBeenCalledTimes(1);
      expect(callClaudeCliMock).not.toHaveBeenCalled();
      expect(run.anthropicVia).toBe('api');
      expect(run.costBasis).toBe('api');
    });
  });

  describe('multi-turn messages', () => {
    it('sends the messages array verbatim to Anthropic', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-sonnet-5-5');
      const messages = [
        { role: 'user' as const, content: 'kickoff' },
        { role: 'assistant' as const, content: 'progress' },
        { role: 'user' as const, content: 'feedback' },
      ];
      await runPromptScenario({ system: 'sys', messages });

      const params = streamMock.mock.calls[0][0];
      expect(params.messages).toEqual(messages);
    });

    it('rejects when both user and messages are given, with no request', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-sonnet-5-5');
      await expect(
        runPromptScenario({ system: 'sys', user: 'usr', messages: [{ role: 'user', content: 'usr' }] }),
      ).rejects.toThrow(/exactly one of `user` or `messages`/);
      expect(anthropicCtor).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when neither user nor messages is given, with no request', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-sonnet-5-5');
      await expect(runPromptScenario({ system: 'sys' })).rejects.toThrow(/exactly one of `user` or `messages`/);
      expect(anthropicCtor).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when messages ends with an assistant turn', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-sonnet-5-5');
      await expect(
        runPromptScenario({
          system: 'sys',
          messages: [
            { role: 'user', content: 'kickoff' },
            { role: 'assistant', content: 'progress' },
          ],
        }),
      ).rejects.toThrow(/end with a user turn/);
      expect(anthropicCtor).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an empty messages array', async () => {
      vi.stubEnv('OVERDECK_EVAL_MODEL', 'claude-sonnet-5-5');
      await expect(runPromptScenario({ system: 'sys', messages: [] })).rejects.toThrow(/non-empty/);
      expect(anthropicCtor).not.toHaveBeenCalled();
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
