import { describe, expect, it } from 'vitest';
import { getProviderForModel, PROVIDERS } from '../providers.js';

// AC(PAN-1989) — new ohmypi-routed providers added to the registry

describe('providers-ohmypi: new omp-routable providers in registry', () => {
  it('PROVIDERS contains groq, cerebras, and mistral entries', () => {
    expect(PROVIDERS.groq).toBeDefined();
    expect(PROVIDERS.cerebras).toBeDefined();
    expect(PROVIDERS.mistral).toBeDefined();
  });

  it('each new provider defaults to the ohmypi harness', () => {
    expect(PROVIDERS.groq.defaultHarness).toBe('ohmypi');
    expect(PROVIDERS.cerebras.defaultHarness).toBe('ohmypi');
    expect(PROVIDERS.mistral.defaultHarness).toBe('ohmypi');
  });

  it('getProviderForModel resolves a groq model to the groq provider', () => {
    const p = getProviderForModel('openai/gpt-oss-120b');
    expect(p.name).toBe('groq');
    expect(p.defaultHarness).toBe('ohmypi');
    // Retired ids stay routed so the deprecation migration can fire (PAN-4825).
    expect(getProviderForModel('llama-3.3-70b-versatile').name).toBe('groq');
  });

  it('getProviderForModel resolves a cerebras model to the cerebras provider', () => {
    const p = getProviderForModel('gpt-oss-120b');
    expect(p.name).toBe('cerebras');
    expect(p.defaultHarness).toBe('ohmypi');
    expect(getProviderForModel('llama3.3-70b').name).toBe('cerebras');
  });

  it('getProviderForModel resolves a mistral model to the mistral provider', () => {
    const p = getProviderForModel('mistral-large-latest');
    expect(p.name).toBe('mistral');
    expect(p.defaultHarness).toBe('ohmypi');
  });
});
