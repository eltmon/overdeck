import { describe, expect, it, vi, beforeEach } from 'vitest';

const readProcMemoryMock = vi.fn();
const loadConfigSyncMock = vi.fn();

vi.mock('../../../../src/dashboard/server/services/system-health-service.js', () => ({
  readProcMemory: (...args: unknown[]) => readProcMemoryMock(...args),
}));

vi.mock('../../../../src/lib/config-yaml/load.js', () => ({
  loadConfigSync: (...args: unknown[]) => loadConfigSyncMock(...args),
}));

import {
  assessMemoryPressure,
  classifyMemoryPressure,
  nextGovernorMode,
  resetGovernorModeForTests,
  type GovernorReserves,
} from '../../../../src/lib/cloister/memory-governor.js';

const GIB = 1024 ** 3;

describe('classifyMemoryPressure', () => {
  const thresholds = { warningBytes: 4 * GIB, criticalBytes: 2 * GIB };

  it('returns hard below the critical threshold', () => {
    expect(classifyMemoryPressure(1 * GIB, thresholds)).toBe('hard');
  });

  it('returns soft between critical and warning thresholds', () => {
    expect(classifyMemoryPressure(3 * GIB, thresholds)).toBe('soft');
  });

  it('returns ok at or above the warning threshold', () => {
    expect(classifyMemoryPressure(5 * GIB, thresholds)).toBe('ok');
    expect(classifyMemoryPressure(4 * GIB, thresholds)).toBe('ok');
  });
});

describe('nextGovernorMode — hysteresis (PAN-2500 hysteresis-bands)', () => {
  const reserves: GovernorReserves = { softBytes: 8 * GIB, hardBytes: 4 * GIB, recoveryBytes: 12 * GIB };

  it('stays admitting while above SOFT', () => {
    expect(nextGovernorMode(20 * GIB, reserves, 'admitting')).toBe('admitting');
  });

  it('transitions admitting -> holding when it crosses SOFT downward', () => {
    expect(nextGovernorMode(7 * GIB, reserves, 'admitting')).toBe('holding');
  });

  it('transitions to shedding below HARD', () => {
    expect(nextGovernorMode(2 * GIB, reserves, 'admitting')).toBe('shedding');
    expect(nextGovernorMode(2 * GIB, reserves, 'holding')).toBe('shedding');
  });

  it('does not re-admit when it rises past SOFT but stays below RECOVERY (the core hysteresis case)', () => {
    let mode = nextGovernorMode(7 * GIB, reserves, 'admitting');
    expect(mode).toBe('holding');
    mode = nextGovernorMode(9 * GIB, reserves, mode); // above SOFT (8), below RECOVERY (12)
    expect(mode).toBe('holding');
  });

  it('downgrades shedding to holding once above HARD, still without re-admitting', () => {
    expect(nextGovernorMode(5 * GIB, reserves, 'shedding')).toBe('holding');
  });

  it('re-admits only once MemAvailable exceeds RECOVERY', () => {
    expect(nextGovernorMode(11.9 * GIB, reserves, 'holding')).toBe('holding');
    expect(nextGovernorMode(12 * GIB, reserves, 'holding')).toBe('admitting');
  });

  it('produces a stable mode across a threshold-straddling sequence (no oscillation, NFR-2)', () => {
    const sequence = [7.9 * GIB, 8.1 * GIB, 7.8 * GIB, 8.2 * GIB, 7.5 * GIB];
    let mode: 'admitting' | 'holding' | 'shedding' = 'admitting';
    const modes: string[] = [];
    for (const available of sequence) {
      mode = nextGovernorMode(available, reserves, mode);
      modes.push(mode);
    }
    expect(modes.every((m) => m === 'holding')).toBe(true);
  });
});

describe('assessMemoryPressure', () => {
  beforeEach(() => {
    resetGovernorModeForTests();
    loadConfigSyncMock.mockReturnValue({
      config: {
        resources: {
          governorSoftReserveGb: 8,
          governorHardReserveGb: 4,
          governorRecoveryReserveGb: 12,
        },
      },
    });
  });

  it('reads MemAvailable via the async proc parser and derives the band from governor reserves', async () => {
    readProcMemoryMock.mockResolvedValue({ memAvailable: 2 * GIB });
    const verdict = await assessMemoryPressure();
    expect(verdict.band).toBe('hard');
    expect(verdict.availableBytes).toBe(2 * GIB);
  });

  it('returns ok when memory is plentiful', async () => {
    readProcMemoryMock.mockResolvedValue({ memAvailable: 20 * GIB });
    const verdict = await assessMemoryPressure();
    expect(verdict.band).toBe('ok');
  });

  it('holds across successive calls per the hysteresis state machine', async () => {
    readProcMemoryMock.mockResolvedValue({ memAvailable: 7 * GIB });
    expect((await assessMemoryPressure()).band).toBe('soft');
    readProcMemoryMock.mockResolvedValue({ memAvailable: 9 * GIB }); // above soft, below recovery
    expect((await assessMemoryPressure()).band).toBe('soft'); // still holding, not ok
    readProcMemoryMock.mockResolvedValue({ memAvailable: 13 * GIB }); // above recovery
    expect((await assessMemoryPressure()).band).toBe('ok');
  });
});
