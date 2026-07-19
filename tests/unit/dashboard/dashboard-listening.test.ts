import { afterEach, describe, expect, it } from 'vitest';

import {
  markDashboardListening,
  resetDashboardListeningForTests,
  whenDashboardListening,
} from '../../../src/dashboard/server/dashboard-listening.js';

afterEach(() => resetDashboardListeningForTests());

describe('dashboard listening signal', () => {
  it('does not release post-listen work until the HTTP layer marks readiness', async () => {
    let released = false;
    const wait = whenDashboardListening().then(() => { released = true; });

    await Promise.resolve();
    expect(released).toBe(false);

    markDashboardListening();
    await wait;
    expect(released).toBe(true);
  });
});
