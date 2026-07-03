import { describe, expect, it } from 'vitest';

import { shouldRefuseHostDashboardPort } from '../../../src/dashboard/server/identity.js';

describe('dashboard identity port guard', () => {
  it('refuses a peer dashboard on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'peer',
      port: 3011,
      hostDashboardApiPort: 3011,
    })).toBe(true);
  });

  it('allows a peer dashboard on an explicit non-host port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'peer',
      port: 4011,
      hostDashboardApiPort: 3011,
    })).toBe(false);
  });

  it('refuses a workspace checkout on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo/workspaces/feature-pan-2252',
      mode: 'primary',
      port: 3011,
      hostDashboardApiPort: 3011,
    })).toBe(true);
  });

  it('allows the primary checkout on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'primary',
      port: 3011,
      hostDashboardApiPort: 3011,
    })).toBe(false);
  });
});
