import { describe, expect, it } from 'vitest';

import { resolveWorkSpawnRequestedModel } from '../../../../src/dashboard/server/routes/agents/shared.js';

// PAN-3022: a work spawn's requested model is the operator's explicit body
// model when present, else the model carried on a consent-bearing spawn's
// auto-start consent record.
describe('resolveWorkSpawnRequestedModel', () => {
  it('prefers a trimmed body model over the consent model', () => {
    expect(resolveWorkSpawnRequestedModel(' gpt-5.6-sol ', 'k3')).toBe('gpt-5.6-sol');
  });

  it('falls back to the consent model when no body model is given', () => {
    expect(resolveWorkSpawnRequestedModel(undefined, 'k3')).toBe('k3');
  });

  it('returns undefined for an empty or non-string body model with no consent model', () => {
    expect(resolveWorkSpawnRequestedModel('', undefined)).toBeUndefined();
    expect(resolveWorkSpawnRequestedModel(42, undefined)).toBeUndefined();
    expect(resolveWorkSpawnRequestedModel(null, undefined)).toBeUndefined();
  });
});
