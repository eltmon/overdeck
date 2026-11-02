import { describe, it, expect } from 'vitest';

import { MODELS_BY_PROVIDER } from '../modelCatalog';

describe('Kimi K3.1 Pro dashboard visibility (PAN-4813)', () => {
  it('exposes K3.1 Pro and Highspeed in the kimi group ahead of K3', () => {
    const group = MODELS_BY_PROVIDER.kimi;
    expect(group).toBeDefined();

    const byId = Object.fromEntries(group.models.map((m) => [m.id, m]));
    expect(byId['k3.1-pro'].name).toBe('Kimi K3.1 Pro (1M context)');
    expect(byId['k3.1-pro'].costPer1MTokens).toBe(6);
    expect(byId['k3.1-pro-highspeed'].name).toBe('Kimi K3.1 Pro Highspeed (1M context)');
    expect(byId['k3.1-pro-highspeed'].costPer1MTokens).toBe(12);

    const ids = group.models.map((m) => m.id);
    expect(ids.indexOf('k3.1-pro')).toBeLessThan(ids.indexOf('k3'));
    expect(ids.indexOf('k3.1-pro-highspeed')).toBeLessThan(ids.indexOf('k3'));
  });
});
