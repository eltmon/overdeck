import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetBridgePoolPatrolState, patrolDockerBridgePool } from '../bridge-pool-patrol.js';

/** Names are irrelevant to the threshold — only the host-wide count is (PAN-3053). */
function networks(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `overdeck-feature-pan-${1000 + i}_devnet`);
}

function deps(count: number, emit = vi.fn()) {
  return {
    listBridgeNetworkNames: async () => networks(count),
    readPools: async () => null,
    emit,
  };
}

describe('patrolDockerBridgePool (PAN-3053)', () => {
  beforeEach(() => {
    __resetBridgePoolPatrolState();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('stays silent while the pool has headroom', async () => {
    const emit = vi.fn();
    expect(await patrolDockerBridgePool(deps(10, emit))).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('warns once when pressure appears, not on every cycle', async () => {
    const emit = vi.fn();

    const first = await patrolDockerBridgePool(deps(27, emit));
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('27 of ~31');
    expect(first[0]).toContain('only 4 left');
    expect(emit).toHaveBeenCalledWith('warn', expect.stringContaining('under pressure'));

    emit.mockClear();
    expect(await patrolDockerBridgePool(deps(28, emit))).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('escalates to an error when the pool is exhausted', async () => {
    const emit = vi.fn();
    await patrolDockerBridgePool(deps(27, emit));
    emit.mockClear();

    const actions = await patrolDockerBridgePool(deps(31, emit));

    expect(actions[0]).toContain('EXHAUSTED');
    expect(actions[0]).toContain('queued agent feedback will not be delivered');
    expect(emit).toHaveBeenCalledWith('error', expect.stringContaining('EXHAUSTED'));
  });

  it('reports recovery when the pressure clears', async () => {
    const emit = vi.fn();
    await patrolDockerBridgePool(deps(31, emit));
    emit.mockClear();

    const actions = await patrolDockerBridgePool(deps(12, emit));

    expect(actions[0]).toContain('recovered');
    expect(actions[0]).toContain('19 free');
    expect(emit).toHaveBeenCalledWith('info', expect.stringContaining('recovered'));
  });

  it('uses the configured pool limit rather than false-alarming at 26', async () => {
    const emit = vi.fn();

    const actions = await patrolDockerBridgePool({
      listBridgeNetworkNames: async () => networks(40),
      readPools: async () => [{ base: '10.200.0.0/16', size: 24 }],
      emit,
    });

    expect(actions).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('skips the cycle when docker is unreachable', async () => {
    const emit = vi.fn();

    const actions = await patrolDockerBridgePool({
      listBridgeNetworkNames: async () => { throw new Error('docker daemon not running'); },
      readPools: async () => null,
      emit,
    });

    expect(actions).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });
});
