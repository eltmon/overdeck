import { describe, it, expect } from 'vitest';

import { MODELS_BY_PROVIDER } from '../modelCatalog';

describe('Muse Ember dashboard visibility (PAN-5106)', () => {
  it('lists Muse Ember and Muse Wonder Full in the meta group', () => {
    const group = MODELS_BY_PROVIDER.meta;
    expect(group).toBeDefined();

    expect(group.models.map((model) => model.id)).toEqual([
      'muse-wonder-1.0', 'muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-ember-1.0', 'muse-wonder-full-1.0',
    ]);

    const ember = group.models.find((model) => model.id === 'muse-ember-1.0');
    expect(ember).toMatchObject({ id: 'muse-ember-1.0', name: 'Muse Ember 1.0', costPer1MTokens: 0.3 });
    expect(ember?.description).toContain('$0.10 input');
    expect(ember?.description).toContain('$0.30');

    // Muse Wonder Full: Muse Code-only, no per-token price (operator addition, issue comment 2026-11-10).
    const wonderFull = group.models.find((model) => model.id === 'muse-wonder-full-1.0');
    expect(wonderFull).toMatchObject({ id: 'muse-wonder-full-1.0', name: 'Muse Wonder Full 1.0', costPer1MTokens: 0 });
    expect(wonderFull?.description).toContain('no per-token price');
  });
});
