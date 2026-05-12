/**
 * Tests for GET /api/settings/minimax-defaults route handler logic.
 *
 * The route at src/dashboard/server/routes/settings.ts:114-123 calls
 * getMiniMaxDefaultsApi() and returns its output as JSON. These tests
 * verify the shape and correctness of that function's output — the same
 * data the HTTP endpoint serialises.
 */

import { describe, it, expect } from 'vitest';
import { getMiniMaxDefaultsApi } from '../../src/lib/settings-api.js';

describe('GET /api/settings/minimax-defaults — route handler payload', () => {
  it('returns a well-formed ApiSettingsConfig object', () => {
    const defaults = getMiniMaxDefaultsApi();

    expect(defaults).toBeDefined();
    expect(typeof defaults).toBe('object');
    expect(defaults.models).toBeDefined();
    expect(defaults.api_keys).toBeDefined();
    expect(defaults.tracker_keys).toBeDefined();
  });

  it('enables only the minimax provider', () => {
    const { models } = getMiniMaxDefaultsApi();

    expect(models.providers).toBeDefined();
    const providers = models.providers!;

    expect(providers.minimax).toBe(true);
    // All other providers must be disabled so the preset is a clean MiniMax config
    expect(providers.anthropic).toBe(false);
    expect(providers.openai).toBe(false);
    expect(providers.google).toBe(false);
    expect(providers.zai).toBe(false);
    expect(providers.kimi).toBe(false);
    expect(providers.openrouter).toBe(false);
  });

  it('uses minimax workhorses for role-based model selection', () => {
    const defaults = getMiniMaxDefaultsApi();

    expect(defaults.models.overrides).toBeUndefined();
    expect(defaults.workhorses).toEqual({
      expensive: 'minimax-m2.7-highspeed',
      mid: 'minimax-m2.7-highspeed',
      cheap: 'minimax-m2.7-highspeed',
    });
    for (const role of ['plan', 'work', 'review', 'test', 'ship'] as const) {
      expect(defaults.roles?.[role]?.model).toBeDefined();
    }
  });

  it('returns empty api_keys and tracker_keys (no secrets in preset)', () => {
    const defaults = getMiniMaxDefaultsApi();
    expect(defaults.api_keys).toEqual({});
    expect(defaults.tracker_keys).toEqual({});
  });

  it('is idempotent — successive calls return equal values', () => {
    const first = getMiniMaxDefaultsApi();
    const second = getMiniMaxDefaultsApi();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
