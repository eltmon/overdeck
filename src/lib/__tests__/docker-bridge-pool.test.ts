import { describe, expect, it } from 'vitest';

import {
  assessBridgePoolPressure,
  bridgePoolLimitFromPools,
  DEFAULT_DOCKER_BRIDGE_POOL_LIMIT,
  formatBridgePoolBreakdown,
  groupBridgeNetworkNames,
  parseBridgeNetworkNames,
} from '../docker-bridge-pool.js';

describe('parseBridgeNetworkNames', () => {
  it('trims and drops blank lines', () => {
    expect(parseBridgeNetworkNames('bridge\n  overdeck  \n\n')).toEqual(['bridge', 'overdeck']);
  });

  it('returns an empty list for empty output', () => {
    expect(parseBridgeNetworkNames('')).toEqual([]);
  });
});

describe('groupBridgeNetworkNames', () => {
  it('groups workspace stack networks by project prefix, largest first', () => {
    const groups = groupBridgeNetworkNames([
      'bridge',
      'overdeck',
      'myn-feature-min-852_devnet',
      'myn-feature-min-858_devnet',
      'myn-feature-min-864_devnet',
      'overdeck-feature-pan-2997_devnet',
      'overdeck-feature-pan-2998_default',
      'myn-main_devnet',
    ]);

    expect(groups).toEqual([
      { label: 'myn-feature-*', count: 3 },
      { label: 'other', count: 3 },
      { label: 'overdeck-feature-*', count: 2 },
    ]);
  });

  it('counts a _default-suffixed workspace network with its project', () => {
    // The old regex required `_devnet`, so `overdeck-feature-pan-2997_default`
    // was invisible even under the overdeck- prefix (PAN-3053).
    const groups = groupBridgeNetworkNames(['overdeck-feature-pan-2997_default']);
    expect(groups).toEqual([{ label: 'overdeck-feature-*', count: 1 }]);
  });

  it('returns nothing for no networks', () => {
    expect(groupBridgeNetworkNames([])).toEqual([]);
  });
});

describe('bridgePoolLimitFromPools', () => {
  it('sums the subnets each pool provides', () => {
    expect(bridgePoolLimitFromPools([{ base: '10.200.0.0/16', size: 24 }])).toBe(256);
    expect(bridgePoolLimitFromPools([
      { base: '172.17.0.0/12', size: 16 },
      { base: '192.168.0.0/16', size: 20 },
    ])).toBe(32);
  });

  it('returns null when pools are absent, empty, or malformed', () => {
    expect(bridgePoolLimitFromPools(null)).toBeNull();
    expect(bridgePoolLimitFromPools([])).toBeNull();
    expect(bridgePoolLimitFromPools([{ base: '10.0.0.0/16' }])).toBeNull();
    expect(bridgePoolLimitFromPools([{ base: 'not-a-cidr', size: 24 }])).toBeNull();
    // A size narrower than the base mask would carve fewer than one subnet.
    expect(bridgePoolLimitFromPools([{ base: '10.0.0.0/24', size: 16 }])).toBeNull();
  });
});

describe('assessBridgePoolPressure', () => {
  it('counts every bridge network against the limit', () => {
    // The host measured in PAN-3053: 31 bridge networks, only 12 overdeck-named.
    const names = [
      'bridge',
      'overdeck',
      'panopticon',
      'myn-main_devnet',
      'overdeck-feature-pan-2997_default',
      ...Array.from({ length: 13 }, (_, i) => `myn-feature-min-${800 + i}_devnet`),
      ...Array.from({ length: 13 }, (_, i) => `overdeck-feature-pan-${1000 + i}_devnet`),
    ];
    expect(names).toHaveLength(31);

    const pressure = assessBridgePoolPressure(names);

    expect(pressure.total).toBe(31);
    expect(pressure.limit).toBe(DEFAULT_DOCKER_BRIDGE_POOL_LIMIT);
    expect(pressure.headroom).toBe(0);
    expect(pressure.underPressure).toBe(true);
    expect(pressure.exhausted).toBe(true);
  });

  it('reports pressure five slots out and healthy one slot before that', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `net-${i}`);

    expect(assessBridgePoolPressure(names(25)).underPressure).toBe(false);
    expect(assessBridgePoolPressure(names(26)).underPressure).toBe(true);
    expect(assessBridgePoolPressure(names(26)).exhausted).toBe(false);
    expect(assessBridgePoolPressure(names(26)).headroom).toBe(5);
  });

  it('honours a wider configured limit', () => {
    const names = Array.from({ length: 40 }, (_, i) => `net-${i}`);
    const pressure = assessBridgePoolPressure(names, 256);

    expect(pressure.limit).toBe(256);
    expect(pressure.headroom).toBe(216);
    expect(pressure.underPressure).toBe(false);
  });

  it('never reports negative headroom past the limit', () => {
    const names = Array.from({ length: 40 }, (_, i) => `net-${i}`);
    expect(assessBridgePoolPressure(names, 31).headroom).toBe(0);
  });
});

describe('formatBridgePoolBreakdown', () => {
  it('renders a comma-separated per-project tally', () => {
    expect(formatBridgePoolBreakdown([
      { label: 'myn-feature-*', count: 13 },
      { label: 'overdeck-feature-*', count: 6 },
      { label: 'other', count: 5 },
    ])).toBe('myn-feature-* 13, overdeck-feature-* 6, other 5');
  });

  it('renders empty for no groups', () => {
    expect(formatBridgePoolBreakdown([])).toBe('');
  });
});
