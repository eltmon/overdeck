import { describe, expect, it } from 'vitest';

import { PROVIDERS } from '../../providers.js';
import { buildTierFitnessContext } from '../tier-fitness-context.js';

describe('buildTierFitnessContextSync', () => {
  const ctx = buildTierFitnessContext({ enabledProviders: new Set(['anthropic', 'zai']) });

  it('knownModelIds contains claude-haiku-4-5 and every PROVIDERS.anthropic.models id', () => {
    expect(ctx.knownModelIds.has('claude-haiku-4-5')).toBe(true);
    for (const id of PROVIDERS.anthropic.models) {
      expect(ctx.knownModelIds.has(id), `knownModelIds must contain ${id}`).toBe(true);
    }
  });

  it("providerOf('gpt-5.6-luna') returns 'openai'", () => {
    expect(ctx.providerOf('gpt-5.6-luna')).toBe('openai');
  });

  it('classOf resolves through the capability-class table', () => {
    expect(ctx.classOf('claude-haiku-4-5')).toBe('small');
    expect(ctx.classOf('gpt-5.5')).toBe('frontier');
  });

  it('enabledProviders mirrors the input set exactly', () => {
    expect(ctx.enabledProviders).toEqual(new Set(['anthropic', 'zai']));
  });
});
