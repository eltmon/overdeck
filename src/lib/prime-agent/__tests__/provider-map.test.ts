import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertPrimeAgentCredentialAvailable,
  PrimeAgentCredentialError,
  PrimeAgentProviderMappingError,
  resolvePrimeAgentModelRoute,
} from '../provider-map.js';

describe('resolvePrimeAgentModelRoute', () => {
  it('maps verified API-key providers without changing the model', () => {
    expect(resolvePrimeAgentModelRoute('gpt-5.4')).toEqual({ provider: 'openai', model: 'gpt-5.4' });
    expect(resolvePrimeAgentModelRoute('claude-sonnet-4-6')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(resolvePrimeAgentModelRoute('gemini-3.1-pro-preview')).toEqual({ provider: 'google', model: 'gemini-3.1-pro-preview' });
  });

  it('uses the Prime subscription provider ID for ChatGPT auth', () => {
    expect(resolvePrimeAgentModelRoute('gpt-5.4', 'subscription')).toEqual({ provider: 'openai-codex', model: 'gpt-5.4' });
  });

  it('rejects an unsupported provider instead of choosing a fallback', () => {
    expect(() => resolvePrimeAgentModelRoute('ql-swift-8b')).toThrow(PrimeAgentProviderMappingError);
    expect(() => resolvePrimeAgentModelRoute('ql-swift-8b')).toThrow('no fallback model was selected');
  });

  it('rejects unsupported subscription routing', () => {
    expect(() => resolvePrimeAgentModelRoute('gemini-3.1-pro-preview', 'subscription')).toThrow(
      'subscription authentication',
    );
  });
});

describe('assertPrimeAgentCredentialAvailable', () => {
  const saved = { ...process.env };

  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it('accepts a provider whose API key is in the environment', () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    expect(() => assertPrimeAgentCredentialAvailable('minimax-m2.7')).not.toThrow();
  });

  it('names the missing variable and where to set it (provider-map.ac2)', () => {
    delete process.env.MINIMAX_API_KEY;
    expect(() => assertPrimeAgentCredentialAvailable('minimax-m2.7')).toThrow(PrimeAgentCredentialError);
    expect(() => assertPrimeAgentCredentialAvailable('minimax-m2.7')).toThrow('MINIMAX_API_KEY');
    expect(() => assertPrimeAgentCredentialAvailable('minimax-m2.7')).toThrow('api_keys.minimax');
  });

  it('refuses a subscription path the map does not carry', () => {
    expect(() => assertPrimeAgentCredentialAvailable('gemini-3.1-pro-preview', 'subscription'))
      .toThrow(PrimeAgentCredentialError);
  });
});
