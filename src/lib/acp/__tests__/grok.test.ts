import { describe, expect, it } from 'vitest';
import type * as EffectAcpSchema from 'effect-acp/schema';
import {
  buildGrokAcpSpawnInput,
  extractGrokTurnUsage,
  GROK_EFFORT_CONFIG_ID,
  resolveGrokAuthMethodId,
  translateGrokAcpModelId,
} from '../grok.js';
import { resolveAcpModelId, resolveAcpProviderSupport } from '../providers.js';

const initializeWith = (ids: readonly string[]): EffectAcpSchema.InitializeResponse =>
  ({ protocolVersion: 1, authMethods: ids.map((id) => ({ id, name: id })) }) as unknown as EffectAcpSchema.InitializeResponse;

describe('Grok Build ACP spawn input (PAN-5078)', () => {
  it('starts a persistent grok agent over stdio', () => {
    const spawn = buildGrokAcpSpawnInput({ binaryPath: '/tools/grok' }, '/workspace', { PATH: '/usr/bin' });
    expect(spawn.command).toBe('/tools/grok');
    expect(spawn.args).toEqual(['agent', '--always-approve', '--no-leader', 'stdio']);
    expect(spawn.cwd).toBe('/workspace');
    expect(spawn.env).toEqual({ PATH: '/usr/bin' });
  });

  it('falls back to grok on PATH when no binary path is configured', () => {
    expect(buildGrokAcpSpawnInput(null, '/workspace', {}).command).toBe('grok');
  });

  it('drops XAI_API_KEY so Grok bills the sign-in, not the API key', () => {
    const environment = { PATH: '/usr/bin', XAI_API_KEY: 'xai-test' };
    const spawn = buildGrokAcpSpawnInput(undefined, '/workspace', environment);
    expect(spawn.env).not.toHaveProperty('XAI_API_KEY');
    expect(environment.XAI_API_KEY).toBe('xai-test');
  });
});

describe('Grok Build ACP authentication (PAN-5078)', () => {
  it('uses the cached token saved by grok login', () => {
    expect(resolveGrokAuthMethodId(initializeWith(['cached_token', 'grok.com']))).toBe('cached_token');
  });

  it('requires a sign-in when only the browser method is offered', () => {
    expect(() => resolveGrokAuthMethodId(initializeWith(['grok.com']))).toThrow('Grok sign-in is required. Run grok login, then retry.');
  });
});

describe('Grok Build ACP model ids (PAN-5078)', () => {
  it('strips the grok/ prefix', () => {
    expect(translateGrokAcpModelId('grok/grok-4.6')).toBe('grok-4.6');
    expect(translateGrokAcpModelId('grok/grok-4.7-build-fast')).toBe('grok-4.7-build-fast');
    expect(resolveAcpModelId('grok', 'grok/grok-4.7')).toBe('grok-4.7');
  });

  it('rejects ids that are not grok/*', () => {
    expect(() => translateGrokAcpModelId('grok-4.6')).toThrow('Invalid Grok Build model "grok-4.6". Select a grok/* model.');
    expect(() => translateGrokAcpModelId('opencode/grok-4.7')).toThrow('Invalid Grok Build model');
  });
});

describe('Grok Build ACP provider support (PAN-5078)', () => {
  it('carries the effort config option and the grok session-index harness', () => {
    const support = resolveAcpProviderSupport('grok');
    expect(support.buildSpawnInput).toBe(buildGrokAcpSpawnInput);
    expect(support.effortConfigId).toBe(GROK_EFFORT_CONFIG_ID);
    expect(support.effortConfigId).toBe('reasoning_effort');
    expect(support.harness).toBe('grok');
  });

  it('leaves the existing providers without those fields', () => {
    for (const provider of ['kimi', 'opencode', 'opencode-go']) {
      expect(resolveAcpProviderSupport(provider).effortConfigId).toBeUndefined();
      expect(resolveAcpProviderSupport(provider).harness).toBeUndefined();
    }
  });
});

// Synthetic copy of the grok-4.6 probe result (PRD finding 4); no account fields.
const grokPromptResponse = {
  stopReason: 'end_turn',
  _meta: {
    modelId: 'grok-4.6',
    usage: {
      inputTokens: 31793,
      outputTokens: 32,
      cachedReadTokens: 640,
      cacheCreationTokens: 0,
      reasoningTokens: 31,
      costUsdTicks: 628180000,
      modelUsage: { 'grok-4.6-build': { inputTokens: 31793, outputTokens: 32 } },
    },
  },
} as unknown as EffectAcpSchema.PromptResponse;

describe('Grok Build turn usage (PAN-5078)', () => {
  it('maps the prompt result usage to uncached input, cache reads and the reported cost', () => {
    const usage = extractGrokTurnUsage(grokPromptResponse);
    expect(usage).toMatchObject({
      model: 'grok/grok-4.6',
      inputTokens: 31153,
      outputTokens: 32,
      cacheReadTokens: 640,
      cacheWriteTokens: 0,
      reasoningTokens: 31,
    });
    expect(usage?.costUsd).toBeCloseTo(0.062818, 10);
  });

  it('returns undefined when the result carries no usage', () => {
    expect(extractGrokTurnUsage({ stopReason: 'end_turn', _meta: { modelId: 'grok-4.6' } } as unknown as EffectAcpSchema.PromptResponse)).toBeUndefined();
    expect(extractGrokTurnUsage({ stopReason: 'end_turn' } as EffectAcpSchema.PromptResponse)).toBeUndefined();
  });

  it('is wired only for the grok provider', () => {
    expect(resolveAcpProviderSupport('grok').extractTurnUsage).toBe(extractGrokTurnUsage);
    expect(resolveAcpProviderSupport('kimi').extractTurnUsage).toBeUndefined();
  });
});
