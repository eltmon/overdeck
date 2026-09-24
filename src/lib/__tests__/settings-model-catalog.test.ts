import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAvailableModelsApi } from '../settings-model-catalog.js';
import { getAvailableModelsApi as compatibilityExport } from '../settings-api.js';

// Captured by executing the catalog functions from 7346a85bec0 before extraction.
const previousCatalog = JSON.parse(readFileSync(new URL('./fixtures/pre-opencode-model-catalog.json', import.meta.url), 'utf8'));
const opus55 = {
  id: 'claude-opus-5-5',
  name: 'Claude Opus 5.5 (1M context)',
  contextWindow: 1000000,
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  costPer1MTokens: 12,
};

function withoutOpus55<T extends { anthropic: Array<{ id: string }> }>(catalog: T): T {
  return { ...catalog, anthropic: catalog.anthropic.filter((model) => model.id !== opus55.id) };
}

describe('model catalog no-loss audit', () => {
  it('preserves every previous provider, ordered model, display name, price and effort field', () => {
    const { opencode, 'opencode-go': go, ...existing } = getAvailableModelsApi();
    expect(existing.anthropic.find((model) => model.id === opus55.id)).toEqual(opus55);
    expect(withoutOpus55(existing)).toEqual(previousCatalog);
    expect(opencode).toEqual([]);
    expect(go).toEqual([]);
    expect(compatibilityExport).toBe(getAvailableModelsApi);
  });

  it('adds native Go and Zen rows without changing the previous catalog', () => {
    const zen = { id: 'opencode/kimi-k3' as const, name: 'Kimi K3', costPer1MTokens: 3, harness: 'opencode' as const };
    const go = { ...zen, id: 'opencode-go/kimi-k3' as const };
    const { opencode, 'opencode-go': goModels, ...existing } = getAvailableModelsApi([zen, go]);
    expect(opencode).toEqual([zen]);
    expect(goModels).toEqual([go]);
    expect(existing.anthropic.find((model) => model.id === opus55.id)).toEqual(opus55);
    expect(withoutOpus55(existing)).toEqual(previousCatalog);
  });
});
