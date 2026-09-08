import { describe, expect, it } from 'vitest';
import { parseOpenCodeModels } from '../opencode-models.js';

const entry = (id: string, data: object) => `${id}\n${JSON.stringify(data, null, 2)}\n`;
describe('OpenCode installed model discovery', () => {
  it('keeps Go and Zen models, their variants and prices, and excludes other providers and retired models', () => {
    const output = entry('anthropic/claude-sonnet-5', { name: 'Sonnet' })
      + entry('opencode/kimi-k3', { name: 'Kimi K3', cost: { input: 1, output: 2 }, variants: { low: {}, high: {} } })
      + entry('opencode-go/kimi-k3', { name: 'Kimi K3 Go', cost: { input: 0, output: 0 } })
      + entry('opencode/retired', { name: 'Old', status: 'deprecated' });
    expect(parseOpenCodeModels(output)).toEqual([
      { id: 'opencode/kimi-k3', name: 'Kimi K3', costPer1MTokens: 1.5, harness: 'opencode', effortLevels: ['low', 'high'] },
      { id: 'opencode-go/kimi-k3', name: 'Kimi K3 Go', costPer1MTokens: 0, harness: 'opencode', effortLevels: [] },
    ]);
  });
  it('returns no invented model when OpenCode has no available models', () => {
    expect(parseOpenCodeModels('')).toEqual([]);
  });
  it('surfaces a malformed catalog instead of silently advertising partial support', () => {
    expect(() => parseOpenCodeModels('opencode/model\n{invalid json}')).toThrow();
  });
});
