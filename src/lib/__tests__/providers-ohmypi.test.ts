import { describe, expect, it } from 'vitest';
import { getProviderForModelSync, PROVIDERS } from '../providers.js';

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

  it('getProviderForModelSync resolves a groq model to the groq provider', () => {
    const p = getProviderForModelSync('llama-3.3-70b-versatile');
    expect(p.name).toBe('groq');
    expect(p.defaultHarness).toBe('ohmypi');
  });

  it('getProviderForModelSync resolves a cerebras model to the cerebras provider', () => {
    const p = getProviderForModelSync('llama3.3-70b');
    expect(p.name).toBe('cerebras');
    expect(p.defaultHarness).toBe('ohmypi');
  });

  it('getProviderForModelSync resolves a mistral model to the mistral provider', () => {
    const p = getProviderForModelSync('mistral-large-latest');
    expect(p.name).toBe('mistral');
    expect(p.defaultHarness).toBe('ohmypi');
  });
});
