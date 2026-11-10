import { describe, it, expect } from 'vitest';

import { MODELS_BY_PROVIDER } from '../modelCatalog';

describe('Muse Ember dashboard visibility (PAN-5106)', () => {
  it('lists Muse Ember last in the meta group', () => {
    const group = MODELS_BY_PROVIDER.meta;
    expect(group).toBeDefined();

    expect(group.models.map((model) => model.id)).toEqual([
      'muse-wonder-1.0', 'muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-ember-1.0',
    ]);

    const ember = group.models.find((model) => model.id === 'muse-ember-1.0');
    expect(ember).toMatchObject({ id: 'muse-ember-1.0', name: 'Muse Ember 1.0', costPer1MTokens: 0.3 });
    expect(ember?.description).toContain('$0.10 input');
    expect(ember?.description).toContain('$0.30');
  });
});
