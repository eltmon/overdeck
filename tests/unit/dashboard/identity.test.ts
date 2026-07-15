import { describe, expect, it } from 'vitest';

import { getBuildInfo } from '../../../src/lib/deploy/build-info.js';
import {
  getDashboardIdentity,
  shouldRefuseHostDashboardPort,
} from '../../../src/dashboard/server/identity.js';

describe('dashboard build identity', () => {
  it('returns null build metadata when build-time globals are undefined', () => {
    expect(getBuildInfo()).toEqual({ buildCommit: null, builtAt: null });
  });

  it('includes build metadata without removing existing identity fields', () => {
    expect(getDashboardIdentity()).toMatchObject({
      repoRoot: process.cwd(),
      mode: expect.stringMatching(/^(primary|peer)$/),
      buildCommit: null,
      builtAt: null,
    });
  });
});

describe('dashboard identity port guard', () => {
  it('refuses a peer dashboard on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'peer',
      port: 3011,
      hostDashboardApiPort: 3011,
      runningInContainer: false,
    })).toBe(true);
  });

  it('allows a peer dashboard on an explicit non-host port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'peer',
      port: 4011,
      hostDashboardApiPort: 3011,
      runningInContainer: false,
    })).toBe(false);
  });

  it('refuses a workspace checkout on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo/workspaces/feature-pan-2252',
      mode: 'primary',
      port: 3011,
      hostDashboardApiPort: 3011,
      runningInContainer: false,
    })).toBe(true);
  });

  it('allows the primary checkout on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'primary',
      port: 3011,
      hostDashboardApiPort: 3011,
      runningInContainer: false,
    })).toBe(false);
  });

  it('allows a peer dashboard on the host dashboard API port inside a container', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'peer',
      port: 3011,
      hostDashboardApiPort: 3011,
      runningInContainer: true,
    })).toBe(false);
  });

  it('allows the canonical workspace container repo root on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/workspaces/overdeck',
      mode: 'peer',
      port: 3011,
      hostDashboardApiPort: 3011,
    })).toBe(false);
  });
});
