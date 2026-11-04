import { describe, expect, it } from 'vitest';

import { connectRuntimeHome } from '../misc/updates.js';

describe('connectRuntimeHome', () => {
  it('returns the home when the root is its connect runtime', () => {
    expect(connectRuntimeHome('/h/.overdeck/runtime/node_modules/@overdeck/core', '/h/.overdeck')).toBe('/h/.overdeck');
  });

  it('returns null for a global install', () => {
    expect(connectRuntimeHome('/usr/lib/node_modules/@overdeck/core', '/h/.overdeck')).toBeNull();
  });
});
