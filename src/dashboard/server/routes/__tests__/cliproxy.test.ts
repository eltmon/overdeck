import { describe, expect, it } from 'vitest';

import { shouldStartCliproxyWatchdog } from '../cliproxy.js';

describe('shouldStartCliproxyWatchdog', () => {
  it('keeps host-side service management out of peer dashboards', () => {
    expect(shouldStartCliproxyWatchdog({ OVERDECK_DISABLE_DEACON: '1' })).toBe(false);
    expect(shouldStartCliproxyWatchdog({})).toBe(true);
  });
});
