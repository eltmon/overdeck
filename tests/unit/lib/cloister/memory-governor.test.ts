import { describe, expect, it, vi, beforeEach } from 'vitest';

const readProcMemoryMock = vi.fn();
const loadConfigSyncMock = vi.fn();
const getStatsMock = vi.fn();
const resolveProjectFromIssueSyncMock = vi.fn();

vi.mock('../../../../src/dashboard/server/services/system-health-service.js', () => ({
  readProcMemory: (...args: unknown[]) => readProcMemoryMock(...args),
}));

vi.mock('../../../../src/lib/config-yaml/load.js', () => ({
  loadConfigSync: (...args: unknown[]) => loadConfigSyncMock(...args),
}));

vi.mock('../../../../src/dashboard/server/routes/resources/shared.js', () => ({
  getDockerStatsCollector: () => ({ getStats: (...args: unknown[]) => getStatsMock(...args) }),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (...args: unknown[]) => resolveProjectFromIssueSyncMock(...args),
}));

import {
  assessMemoryPressure,
  classifyMemoryPressure,
  nextGovernorMode,
  resetGovernorModeForTests,
  computeLearnedFootprintBytes,
  estimateFootprint,
  canAdmit,
  getCachedMemoryVerdict,
  type GovernorReserves,
} from '../../../../src/lib/cloister/memory-governor.js';
import { getResourceStacks, type ResourceStack, type StackContainerResource } from '../../../../src/dashboard/server/routes/resources/stacks.js';

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

  it('caches the verdict for synchronous consumers (PAN-2500 specialist-budget)', async () => {
    expect(getCachedMemoryVerdict()).toBeNull();
    readProcMemoryMock.mockResolvedValue({ memAvailable: 2 * GIB });
    const verdict = await assessMemoryPressure();
    expect(getCachedMemoryVerdict()).toEqual(verdict);
  });
});

function stack(issueId: string, memoryBytes: number): ResourceStack {
  return {
    id: issueId,
    issueId,
    issueTitle: issueId,
    composeProject: `feature-${issueId.toLowerCase()}`,
    serviceCount: 1,
    services: [{ id: issueId, name: `${issueId}-svc`, memoryUsage: memoryBytes }] as StackContainerResource[],
    aggregates: { cpuPercent: 0, memoryBytes, diskBytes: 0 },
    phase: 'work',
  };
}

describe('computeLearnedFootprintBytes (PAN-2500 footprint-budget)', () => {
  it('returns null when no stack exists yet for the project (cold start)', () => {
    resolveProjectFromIssueSyncMock.mockReturnValue(null);
    expect(computeLearnedFootprintBytes([stack('PAN-1', 3 * GIB)], 'overdeck')).toBeNull();
  });

  it('averages live memoryBytes across the project\'s current stacks', () => {
    resolveProjectFromIssueSyncMock.mockReturnValue({ projectKey: 'overdeck' });
    const stacks = [stack('PAN-1', 2 * GIB), stack('PAN-2', 4 * GIB)];
    expect(computeLearnedFootprintBytes(stacks, 'overdeck')).toBe(3 * GIB);
  });
});

describe('estimateFootprint (PAN-2500 footprint-budget)', () => {
  beforeEach(() => {
    loadConfigSyncMock.mockReturnValue({
      config: {
        resources: {
          governorSoftReserveGb: 8,
          governorHardReserveGb: 4,
          governorRecoveryReserveGb: 12,
          governorFootprintDefaultWorkGb: 2,
          governorFootprintDefaultReviewGb: 1,
          governorFootprintDefaultTestGb: 1,
        },
      },
    });
  });

  it('returns a learned per-stack value from a stubbed docker-stats map when available', async () => {
    resolveProjectFromIssueSyncMock.mockReturnValue({ projectKey: 'overdeck' });
    getStatsMock.mockReturnValue([{ id: 'c1', name: 'feature-pan-1-svc-1', memoryUsage: 5 * GIB }]);
    const footprint = await estimateFootprint('work', 'overdeck');
    expect(footprint).toBe(5 * GIB);
  });

  it('falls back to the configured cold-start default per role otherwise', async () => {
    resolveProjectFromIssueSyncMock.mockReturnValue(null);
    getStatsMock.mockReturnValue([]);
    expect(await estimateFootprint('work', 'overdeck')).toBe(2 * GIB);
    expect(await estimateFootprint('review', 'overdeck')).toBe(1 * GIB);
    expect(await estimateFootprint('test', 'overdeck')).toBe(1 * GIB);
  });
});

describe('canAdmit (PAN-2500 footprint-budget)', () => {
  beforeEach(() => {
    loadConfigSyncMock.mockReturnValue({
      config: { resources: { governorSoftReserveGb: 8, governorHardReserveGb: 4, governorRecoveryReserveGb: 12 } },
    });
  });

  it('defers an agent whose footprint would exceed MemAvailable minus the SOFT reserve, even with a free count slot (PRD AC-3)', () => {
    // 20GB available, 8GB soft reserve -> 12GB budget. A 13GB footprint does not fit.
    expect(canAdmit(13 * GIB, 20 * GIB)).toBe(false);
    expect(canAdmit(10 * GIB, 20 * GIB)).toBe(true);
  });

  it('admits N agents whose summed footprint fits the free budget and defers the N+1th', () => {
    let availableBytes = 28 * GIB; // soft reserve is 8GB -> 20GB budget
    const footprintEach = 5 * GIB;
    let admitted = 0;
    for (let i = 0; i < 5; i++) {
      if (!canAdmit(footprintEach, availableBytes)) break;
      admitted++;
      availableBytes -= footprintEach;
    }
    expect(admitted).toBe(4); // 4 * 5GB = 20GB budget exactly; the 5th has nothing left
  });
});
