import { describe, expect, it } from 'vitest';
import { PrimeAgentProviderMappingError, resolvePrimeAgentModelRoute } from './provider-map.js';

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
