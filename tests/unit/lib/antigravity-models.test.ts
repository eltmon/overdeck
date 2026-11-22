import { describe, expect, it } from 'vitest';
import {
  ANTIGRAVITY_MODEL_IDS,
  antigravityModelIds,
  isAntigravityModel,
  translateAntigravityModelId,
} from '../../../src/lib/antigravity-models.js';
import { getProviderForModel } from '../../../src/lib/providers.js';

describe('antigravity-models (PAN-5587 D8)', () => {
  it('translates the Overdeck Gemini 3.1 Pro id to the agy value', () => {
    expect(translateAntigravityModelId('gemini-3.1-pro-preview')).toBe('gemini-3.1-pro');
  });

  it('passes ids agy serves under the same name through unchanged', () => {
    expect(translateAntigravityModelId('gemini-4-argon')).toBe('gemini-4-argon');
  });

  it('throws for a Google id agy does not serve, listing the served ids', () => {
    expect(() => translateAntigravityModelId('gemini-3.5-flash-lite')).toThrow(
      `Antigravity does not serve "gemini-3.5-flash-lite". Select one of: ${antigravityModelIds().join(', ')}.`,
    );
    for (const id of antigravityModelIds()) {
      expect(() => translateAntigravityModelId('gemini-3.5-flash-lite')).toThrow(id);
    }
  });

  it('does not treat a non-Google model as an Antigravity model', () => {
    expect(isAntigravityModel('claude-sonnet-5-5')).toBe(false);
    expect(isAntigravityModel('gemini-4-argon')).toBe(true);
  });

  it('maps only ids of the existing Google provider', () => {
    const keys = Object.keys(ANTIGRAVITY_MODEL_IDS);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(getProviderForModel(key).name).toBe('google');
  });
});
