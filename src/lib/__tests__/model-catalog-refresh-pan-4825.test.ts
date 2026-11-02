import { describe, expect, it } from 'vitest';
import { getPricing } from '../cost.js';
import { MODEL_CAPABILITY_CLASSES } from '../model-capability-class.js';
import { hasModelCapability, resolveModelId } from '../model-capabilities.js';
import { MODEL_DEPRECATIONS } from '../model-deprecations.js';
import { getProviderForModel, PROVIDERS, type ProviderName } from '../providers.js';

// PAN-4825: November 2026 catalog refresh. Sources: docs/MODEL-CONTEXT-AUDIT.md.

function expectRegistered(id: string, provider: ProviderName): void {
  expect(getProviderForModel(id).name).toBe(provider);
  expect(PROVIDERS[provider].models).toContain(id);
  expect(hasModelCapability(id)).toBe(true);
  expect(getPricing('custom', id)?.model).toBe(id);
  expect(MODEL_CAPABILITY_CLASSES[id]).toBeDefined();
}

function expectRetired(id: string, target: string, provider: ProviderName): void {
  expect(MODEL_DEPRECATIONS[id]).toBe(target);
  expect(resolveModelId(id)).toBe(target);
  expect(PROVIDERS[provider].models).toContain(target);
  expect(PROVIDERS[provider].models).not.toContain(id);
}

function expectNoRetiredSlots(provider: ProviderName): void {
  const config = PROVIDERS[provider];
  const slots = [...config.models, config.haikuModel, ...Object.values(config.tierModels ?? {})];
  for (const id of slots) {
    if (id) expect(MODEL_DEPRECATIONS).not.toHaveProperty(id);
  }
}

describe('MiMo V2.6 replaces the retired V2.5 ids', () => {
  it.each(['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'])('registers %s', (id) => {
    expectRegistered(id, 'mimo');
  });

  it('retires V2.5 Pro and V2.5 to their V2.6 successors', () => {
    expectRetired('mimo-v2.5-pro', 'mimo-v2.6-pro', 'mimo');
    expectRetired('mimo-v2.5', 'mimo-v2.6-flash', 'mimo');
  });

  it('lists only V2.6 ids and keeps retired ids out of every launch slot', () => {
    expect(PROVIDERS.mimo.models).toEqual(['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed']);
    expect(PROVIDERS.mimo.haikuModel).toBe('mimo-v2.6-flash');
    expect(PROVIDERS.mimo.tierModels).toEqual({ opus: 'mimo-v2.6-pro', sonnet: 'mimo-v2.6-pro', haiku: 'mimo-v2.6-flash' });
    expectNoRetiredSlots('mimo');
  });
});
