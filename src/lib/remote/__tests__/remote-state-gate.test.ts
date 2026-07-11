import { describe, expect, it } from 'vitest';
import { assertFlyRemoteStateSupported } from '../remote-agents.js';

describe('Fly migrated-state gate', () => {
  it('fails fast with D14 and the remote-state follow-up', () => {
    expect(() => assertFlyRemoteStateSupported('PAN-2541', true)).toThrow(/D14.*PAN-2549/);
    expect(() => assertFlyRemoteStateSupported('PAN-2541', false)).not.toThrow();
  });
});
