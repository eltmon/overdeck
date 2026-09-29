import { describe, expect, it } from 'vitest';

import { defaultBackgroundAiFeatures } from '../../background-ai/registry.js';
import { DEFAULT_NORMALIZED_JEV, type NormalizedJevConfig } from '../../config-yaml/jev.js';
import { resolveJevConfig, resolveJevForFeature, type JevConfigInput } from '../config.js';

function input(opts: {
  cheapMode?: boolean;
  featureOn?: boolean;
  jev?: Partial<NormalizedJevConfig>;
  typesafeKey?: string;
} = {}): JevConfigInput {
  return {
    backgroundAi: {
      cheapMode: opts.cheapMode ?? false,
      features: { ...defaultBackgroundAiFeatures(), jevTurnEndAssessment: opts.featureOn ?? true },
    },
    jev: { ...DEFAULT_NORMALIZED_JEV, configured: true, model: 'test-model-x', ...opts.jev },
    apiKeys: opts.typesafeKey === undefined ? {} : { typesafe: opts.typesafeKey },
  };
}

describe('resolveJevForFeature (PAN-4369)', () => {
  it('reports disabled when cheap mode is on', () => {
    expect(resolveJevForFeature('jevTurnEndAssessment', input({ cheapMode: true, typesafeKey: 'k' }), {})).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });

  it('reports disabled when the feature toggle is off', () => {
    expect(resolveJevForFeature('jevTurnEndAssessment', input({ featureOn: false, typesafeKey: 'k' }), {})).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });

  it('reports not-configured without a jev block', () => {
    expect(
      resolveJevForFeature('jevTurnEndAssessment', input({ jev: { configured: false }, typesafeKey: 'k' }), {}),
    ).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('reports model-not-configured when jev.model is unset, even with TYPESAFE_DEFAULT_MODEL in env', () => {
    expect(
      resolveJevForFeature('jevTurnEndAssessment', input({ jev: { model: undefined }, typesafeKey: 'k' }), {
        TYPESAFE_DEFAULT_MODEL: 'jev-latest',
      }),
    ).toEqual({ ok: false, reason: 'model-not-configured' });
  });

  it('reports no-api-key when neither the slot nor the env var holds a key', () => {
    expect(resolveJevForFeature('jevTurnEndAssessment', input(), {})).toEqual({ ok: false, reason: 'no-api-key' });
  });

  it('resolves a full config', () => {
    expect(
      resolveJevForFeature(
        'jevTurnEndAssessment',
        input({ jev: { baseUrl: 'https://opencode.ai/zen', timeoutMs: 1500 }, typesafeKey: 'k' }),
        {},
      ),
    ).toEqual({
      ok: true,
      config: { apiKey: 'k', model: 'test-model-x', baseUrl: 'https://opencode.ai/zen', timeoutMs: 1500 },
    });
  });
});

describe('resolveJevConfig key precedence (PAN-4369)', () => {
  it('prefers apiKeys.typesafe over the env var', () => {
    const result = resolveJevConfig(input({ typesafeKey: 'from-slot' }), { TYPESAFE_API_KEY: 'from-env' });
    expect(result.ok && result.config.apiKey).toBe('from-slot');
  });

  it('falls back to the env var named by the default apiKeyRef', () => {
    const result = resolveJevConfig(input(), { TYPESAFE_API_KEY: 'from-env' });
    expect(result.ok && result.config.apiKey).toBe('from-env');
  });

  it('reads a custom apiKeyRef from the injected env', () => {
    const result = resolveJevConfig(input({ jev: { apiKeyRef: 'MY_JEV_KEY' } }), {
      MY_JEV_KEY: 'custom',
      TYPESAFE_API_KEY: 'ignored',
    });
    expect(result.ok && result.config.apiKey).toBe('custom');
  });

  it('treats a blank slot as absent', () => {
    const result = resolveJevConfig(input({ typesafeKey: '  ' }), { TYPESAFE_API_KEY: 'from-env' });
    expect(result.ok && result.config.apiKey).toBe('from-env');
  });
});
