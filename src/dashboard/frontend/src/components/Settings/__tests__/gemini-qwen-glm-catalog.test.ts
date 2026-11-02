import { describe, it, expect } from 'vitest';

import { MODELS_BY_PROVIDER } from '../modelCatalog';

describe('November 2026 Gemini, Qwen and GLM catalog refresh (PAN-4827)', () => {
  it('registers the GA Gemini 3.1 Flash Lite and the new Gemini 3.6 Flash, dropping the preview id', () => {
    const group = MODELS_BY_PROVIDER.google;
    expect(group).toBeDefined();

    const byId = Object.fromEntries(group.models.map((m) => [m.id, m]));
    expect(byId['gemini-3.6-flash'].costPer1MTokens).toBe(2.25);
    expect(byId['gemini-3.1-flash-lite'].costPer1MTokens).toBe(0.875);
    expect(byId['gemini-3.1-flash-lite-preview']).toBeUndefined();
  });

  it('reprices gemini-3.8-flash to the official rate', () => {
    const group = MODELS_BY_PROVIDER.google;
    const byId = Object.fromEntries(group.models.map((m) => [m.id, m]));
    expect(byId['gemini-3.8-flash'].costPer1MTokens).toBe(2.25);
  });

  it('prices every live DashScope model with no $0 placeholder', () => {
    const group = MODELS_BY_PROVIDER.dashscope;
    expect(group).toBeDefined();
    for (const model of group.models) {
      expect(model.costPer1MTokens).not.toBe(0);
    }
  });

  it('registers glm-5.3-flash and glm-5.3-flashx', () => {
    const group = MODELS_BY_PROVIDER.zai;
    expect(group).toBeDefined();
    const byId = Object.fromEntries(group.models.map((m) => [m.id, m]));
    expect(byId['glm-5.3-flash'].costPer1MTokens).toBe(0.325);
    expect(byId['glm-5.3-flashx'].costPer1MTokens).toBe(0.81);
  });
});
