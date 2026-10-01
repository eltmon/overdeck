import { describe, expect, it } from 'vitest';
import { EVAL_DEFAULT_MAX_OUTPUT_TOKENS, resolveEvalModelConfig } from '../../../../evals/lib/eval-model.js';

describe('resolveEvalModelConfig', () => {
  it.each([
    ['claude-opus-5-5', 'anthropic', 'high'],
    ['claude-sonnet-5-5', 'anthropic', 'high'],
    ['claude-haiku-4-5', 'anthropic', null],
    ['gpt-6-sol', 'openai', 'high'],
    ['gpt-6-luna', 'openai', 'high'],
  ] as const)('placement model %s resolves to provider %s with effort %s', (id, provider, effort) => {
    const config = resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: id, OPENAI_API_KEY: 'test' });
    expect(config.provider).toBe(provider);
    expect(config.effort).toBe(effort);
  });

  it('rejects when OVERDECK_EVAL_MODEL is unset', () => {
    expect(() => resolveEvalModelConfig({})).toThrow(/OVERDECK_EVAL_MODEL is not set/);
  });

  it('rejects an unknown id and names it', () => {
    expect(() => resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-nonexistent-9' })).toThrow(/Unknown eval model "claude-nonexistent-9"/);
  });

  it('rejects a deprecated id and names the replacement', () => {
    expect(() => resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-sonnet-4-5' })).toThrow(/claude-sonnet-4-6/);
  });

  it('rejects a catalogued model from an unsupported provider', () => {
    expect(() => resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'gemini-3.1-pro-preview' })).toThrow(
      /uses provider "google", which the eval harness does not support/,
    );
  });

  it('claude-sonnet-5-5 at default effort: adaptive thinking, effort high, no temperature, 128000 max tokens', () => {
    const config = resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-sonnet-5-5' });
    expect(config.thinking).toBe('adaptive');
    expect(config.effort).toBe('high');
    expect(config.temperature).toBeNull();
    expect(config.maxTokens).toBe(128000);
  });

  it('claude-opus-5-5 sends effort high explicitly', () => {
    const config = resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-opus-5-5', OVERDECK_EVAL_EFFORT: 'high' });
    expect(config.effort).toBe('high');
  });

  it('claude-sonnet-4-6 with thinking on sends no temperature', () => {
    const config = resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-sonnet-4-6' });
    expect(config.thinking).toBe('adaptive');
    expect(config.temperature).toBeNull();
  });

  it('claude-haiku-4-5-20251001 resolves to the haiku row: no effort, no thinking, temperature 0, 16000 max tokens', () => {
    const config = resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-haiku-4-5-20251001' });
    expect(config.catalogId).toBe('claude-haiku-4-5');
    expect(config.temperature).toBe(0);
    expect(config.effort).toBeNull();
    expect(config.thinking).toBeNull();
    expect(config.maxTokens).toBe(EVAL_DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it('explicit OVERDECK_EVAL_EFFORT on haiku rejects', () => {
    expect(() =>
      resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-haiku-4-5-20251001', OVERDECK_EVAL_EFFORT: 'high' }),
    ).toThrow(/accepts no effort setting/);
  });

  it("effort outside the row's levels rejects", () => {
    expect(() => resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-sonnet-4-6', OVERDECK_EVAL_EFFORT: 'xhigh' })).toThrow(
      /low, medium, high, max/,
    );
  });

  it('invalid OVERDECK_EVAL_EFFORT rejects and lists EFFORT_LEVELS', () => {
    expect(() => resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-sonnet-5-5', OVERDECK_EVAL_EFFORT: 'ultra' })).toThrow(
      /low, medium, high, xhigh, max/,
    );
  });

  it('opts.maxTokens caps the catalog value', () => {
    expect(resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-sonnet-5-5' }, { maxTokens: 2000 }).maxTokens).toBe(2000);
    expect(resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-sonnet-5-5' }, { maxTokens: 999999 }).maxTokens).toBe(128000);
  });

  it('gpt-6-luna defaults to api and rejects without OPENAI_API_KEY', () => {
    expect(() => resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'gpt-6-luna' })).toThrow(/OPENAI_API_KEY is not set/);
  });

  it('gpt-6-luna with OVERDECK_EVAL_OPENAI_VIA=cliproxy needs no key', () => {
    const config = resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'gpt-6-luna', OVERDECK_EVAL_OPENAI_VIA: 'cliproxy' });
    expect(config.openaiVia).toBe('cliproxy');
    expect(config.thinking).toBeNull();
    expect(config.temperature).toBeNull();
    expect(config.effort).toBe('high');
  });

  it('unsupported OVERDECK_EVAL_OPENAI_VIA rejects', () => {
    expect(() =>
      resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'gpt-6-luna', OVERDECK_EVAL_OPENAI_VIA: 'other', OPENAI_API_KEY: 'sk-test' }),
    ).toThrow(/OVERDECK_EVAL_OPENAI_VIA="other" is not supported/);
  });

  describe('OVERDECK_EVAL_ANTHROPIC_VIA (PAN-4406)', () => {
    it('defaults an Anthropic model to the api route', () => {
      expect(resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-sonnet-5-5' }).anthropicVia).toBe('api');
    });

    it('selects claude-cli when set, trimming whitespace', () => {
      expect(resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-opus-5-5', OVERDECK_EVAL_ANTHROPIC_VIA: 'claude-cli' }).anthropicVia).toBe(
        'claude-cli',
      );
      expect(resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-opus-5-5', OVERDECK_EVAL_ANTHROPIC_VIA: '  claude-cli ' }).anthropicVia).toBe(
        'claude-cli',
      );
    });

    it('rejects an unsupported route before any request', () => {
      expect(() => resolveEvalModelConfig({ OVERDECK_EVAL_MODEL: 'claude-sonnet-5-5', OVERDECK_EVAL_ANTHROPIC_VIA: 'cli' })).toThrow(
        'OVERDECK_EVAL_ANTHROPIC_VIA="cli" is not supported (use api or claude-cli).',
      );
    });

    it('ignores the variable for an OpenAI model', () => {
      const config = resolveEvalModelConfig({
        OVERDECK_EVAL_MODEL: 'gpt-6-luna',
        OVERDECK_EVAL_OPENAI_VIA: 'cliproxy',
        OVERDECK_EVAL_ANTHROPIC_VIA: 'claude-cli',
      });
      expect(config.anthropicVia).toBeNull();
    });
  });
});
