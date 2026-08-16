import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readProcMemoryMock = vi.fn();
const loadConfigSyncMock = vi.fn();
const getStatsMock = vi.fn();
const resolveProjectFromIssueSyncMock = vi.fn();
const loadCloisterConfigSyncMock = vi.fn();
const listRunningAgentsSyncMock = vi.fn();
const getAgentRuntimeStateSyncMock = vi.fn();
const setAgentPausedSyncMock = vi.fn();
const stopAgentSyncMock = vi.fn();
const execFileMock = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, res: { stdout: string; stderr: string }) => void) => {
  cb(null, { stdout: '', stderr: '' });
});

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

vi.mock('../../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfigSync: (...args: unknown[]) => loadCloisterConfigSyncMock(...args),
}));

vi.mock('../../../../src/lib/agents/queries.js', () => ({
  listRunningAgentsSync: (...args: unknown[]) => listRunningAgentsSyncMock(...args),
}));

vi.mock('../../../../src/lib/agents/runtime-state.js', () => ({
  getAgentRuntimeStateSync: (...args: unknown[]) => getAgentRuntimeStateSyncMock(...args),
}));

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  setAgentPausedSync: (...args: unknown[]) => setAgentPausedSyncMock(...args),
  GOVERNOR_SLOT_PAUSE_REASON_PREFIX: '[governor-slot]',
}));

vi.mock('../../../../src/lib/agents/termination.js', () => ({
  stopAgentSync: (...args: unknown[]) => stopAgentSyncMock(...args),
}));

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => (execFileMock as any)(...args),
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
  selectStackShedCandidates,
  selectAgentToPause,
  shed,
  type GovernorReserves,
} from '../../../../src/lib/cloister/memory-governor.js';
import {
  getResourceStacks,
  resetResourceStackReviewStatusReaderForTests,
  setResourceStackReviewStatusReaderForTests,
  type ResourceStack,
  type StackContainerResource,
} from '../../../../src/dashboard/server/routes/resources/stacks.js';

const GIB = 1024 ** 3;
const GOVERNOR_RESOURCES = {
  governorSoftReserveGb: 8,
  governorHardReserveGb: 4,
  governorRecoveryReserveGb: 12,
  governorSwapSoftFreePercent: 25,
  governorSwapRecoveryFreePercent: 50,
  governorPsiFullShedAvg10: 1,
  governorPsiCalmReadmitAvg10: 0.05,
  governorPsiCalmWindowMs: 600_000,
};

function procMemory(
  memAvailable: number,
  overrides: Partial<{
    swapTotal: number;
    swapFree: number;
    psiSomeAvg10: number | null;
    psiFullAvg10: number | null;
  }> = {},
) {
  return {
    memAvailable,
    swapTotal: 8 * GIB,
    swapFree: 8 * GIB,
    psiSomeAvg10: 0,
    psiFullAvg10: 0,
    ...overrides,
  };
}

beforeEach(() => {
  setResourceStackReviewStatusReaderForTests(() => null);
});

afterEach(() => {
  resetResourceStackReviewStatusReaderForTests();
});

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
      config: { resources: GOVERNOR_RESOURCES },
    });
  });

  it('reads MemAvailable via the async proc parser and derives the band from governor reserves', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(2 * GIB));
    const verdict = await assessMemoryPressure();
    expect(verdict.band).toBe('hard');
    expect(verdict.availableBytes).toBe(2 * GIB);
  });

  it('returns ok when memory is plentiful', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB));
    const verdict = await assessMemoryPressure();
    expect(verdict.band).toBe('ok');
  });

  it('holds across successive calls per the hysteresis state machine', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(7 * GIB));
    expect((await assessMemoryPressure()).band).toBe('soft');
    readProcMemoryMock.mockResolvedValue(procMemory(9 * GIB)); // above soft, below recovery
    expect((await assessMemoryPressure()).band).toBe('soft'); // still holding, not ok
    readProcMemoryMock.mockResolvedValue(procMemory(13 * GIB)); // above recovery
    expect((await assessMemoryPressure()).band).toBe('ok');
  });

  it('records the MemAvailable reading that triggered a soft hold', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(7 * GIB));

    await expect(assessMemoryPressure()).resolves.toMatchObject({
      trigger: {
        kind: 'soft-dip',
        readingBytes: 7 * GIB,
        thresholdBytes: 8 * GIB,
        at: expect.any(Number),
      },
    });
  });

  it('records the MemAvailable reading that triggered hard shedding', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(2 * GIB));

    await expect(assessMemoryPressure()).resolves.toMatchObject({
      trigger: {
        kind: 'hard',
        readingBytes: 2 * GIB,
        thresholdBytes: 4 * GIB,
        at: expect.any(Number),
      },
    });
  });

  it('records the swap reading that triggered PSI-backed shedding', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 1 * GIB,
      psiFullAvg10: 2,
    }));

    await expect(assessMemoryPressure()).resolves.toMatchObject({
      trigger: {
        kind: 'swap-psi',
        readingBytes: 1 * GIB,
        thresholdBytes: 2 * GIB,
        at: expect.any(Number),
      },
    });
  });

  it('records the swap reading that triggered a hold when PSI is unavailable', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 1 * GIB,
      psiFullAvg10: null,
    }));

    await expect(assessMemoryPressure()).resolves.toMatchObject({
      trigger: {
        kind: 'psi-unavailable',
        readingBytes: 1 * GIB,
        thresholdBytes: 2 * GIB,
        at: expect.any(Number),
      },
    });
  });

  it('updates trigger provenance when the trigger kind changes during a hold', async () => {
    readProcMemoryMock.mockResolvedValueOnce(procMemory(7 * GIB));
    expect((await assessMemoryPressure()).trigger?.kind).toBe('soft-dip');

    readProcMemoryMock.mockResolvedValue(procMemory(2 * GIB));
    await expect(assessMemoryPressure()).resolves.toMatchObject({
      trigger: { kind: 'hard', readingBytes: 2 * GIB, thresholdBytes: 4 * GIB },
    });
  });

  it('clears trigger provenance when the governor re-admits', async () => {
    readProcMemoryMock.mockResolvedValueOnce(procMemory(7 * GIB));
    expect((await assessMemoryPressure()).trigger?.kind).toBe('soft-dip');

    readProcMemoryMock.mockResolvedValue(procMemory(13 * GIB));
    expect((await assessMemoryPressure()).trigger).toBeNull();
  });

  it('re-admits above the soft reserve after PSI stays calm for the configured window', async () => {
    vi.useFakeTimers();
    try {
      readProcMemoryMock.mockResolvedValueOnce(procMemory(7 * GIB));
      expect((await assessMemoryPressure()).band).toBe('soft');

      await vi.advanceTimersByTimeAsync(600_000);
      readProcMemoryMock.mockResolvedValue(procMemory(9 * GIB));
      await expect(assessMemoryPressure()).resolves.toMatchObject({ band: 'ok', trigger: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays holding below recovery while PSI is not calm', async () => {
    vi.useFakeTimers();
    try {
      readProcMemoryMock.mockResolvedValueOnce(procMemory(7 * GIB, { psiFullAvg10: 0.3 }));
      expect((await assessMemoryPressure()).band).toBe('soft');

      await vi.advanceTimersByTimeAsync(600_000);
      readProcMemoryMock.mockResolvedValue(procMemory(9 * GIB, { psiFullAvg10: 0.3 }));
      expect((await assessMemoryPressure()).band).toBe('soft');

      readProcMemoryMock.mockResolvedValue(procMemory(13 * GIB, { psiFullAvg10: 0.3 }));
      expect((await assessMemoryPressure()).band).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires a fresh calm window after an early re-admit and a second dip', async () => {
    vi.useFakeTimers();
    try {
      readProcMemoryMock.mockResolvedValueOnce(procMemory(7 * GIB));
      expect((await assessMemoryPressure()).band).toBe('soft');
      await vi.advanceTimersByTimeAsync(600_000);
      readProcMemoryMock.mockResolvedValueOnce(procMemory(9 * GIB));
      expect((await assessMemoryPressure()).band).toBe('ok');

      readProcMemoryMock.mockResolvedValueOnce(procMemory(7 * GIB));
      expect((await assessMemoryPressure()).band).toBe('soft');
      await vi.advanceTimersByTimeAsync(599_999);
      readProcMemoryMock.mockResolvedValueOnce(procMemory(9 * GIB));
      expect((await assessMemoryPressure()).band).toBe('soft');
      await vi.advanceTimersByTimeAsync(1);
      readProcMemoryMock.mockResolvedValue(procMemory(9 * GIB));
      expect((await assessMemoryPressure()).band).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not count calm PSI time accumulated before a new pressure hold', async () => {
    vi.useFakeTimers();
    try {
      readProcMemoryMock.mockResolvedValueOnce(procMemory(20 * GIB));
      expect((await assessMemoryPressure()).band).toBe('ok');
      await vi.advanceTimersByTimeAsync(600_000);

      readProcMemoryMock.mockResolvedValueOnce(procMemory(7 * GIB));
      expect((await assessMemoryPressure()).band).toBe('soft');
      readProcMemoryMock.mockResolvedValueOnce(procMemory(9 * GIB));
      expect((await assessMemoryPressure()).band).toBe('soft');

      await vi.advanceTimersByTimeAsync(600_000);
      readProcMemoryMock.mockResolvedValue(procMemory(9 * GIB));
      expect((await assessMemoryPressure()).band).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('records the active swap recovery threshold after admissions are already held', async () => {
    readProcMemoryMock.mockResolvedValueOnce(procMemory(7 * GIB));
    expect((await assessMemoryPressure()).trigger?.kind).toBe('soft-dip');

    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 3 * GIB,
      psiFullAvg10: 2,
    }));
    await expect(assessMemoryPressure()).resolves.toMatchObject({
      trigger: {
        kind: 'swap-psi',
        readingBytes: 3 * GIB,
        thresholdBytes: 4 * GIB,
      },
    });
  });

  it('admits when swap is full but PSI shows no stalls (swap residency is not pressure)', async () => {
    // Operator-approved correction (PAN-3485 follow-up): full-but-idle swap
    // with PSI 0.00 must NOT hold admissions — pages swapped during a leak era
    // sit unused for weeks, and holding for them wedges the whole pipeline.
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 0,
    }));

    expect((await assessMemoryPressure()).band).toBe('ok');
  });

  it('still sheds when full swap comes with live memory stalls', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 0,
      psiFullAvg10: 2.5,
    }));

    expect((await assessMemoryPressure()).band).toBe('hard');
  });

  it('keeps the swap-recovery hysteresis only while PSI is unavailable', async () => {
    // PSI null = cannot prove safety → the conservative hold with its
    // swap-recovery threshold still applies.
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 1 * GIB,
      psiFullAvg10: null,
    }));
    expect((await assessMemoryPressure()).band).toBe('soft');

    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 3 * GIB,
      psiFullAvg10: null,
    }));
    expect((await assessMemoryPressure()).band).toBe('soft');

    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 4 * GIB,
      psiFullAvg10: null,
    }));
    expect((await assessMemoryPressure()).band).toBe('ok');
  });

  it('sheds when low swap is accompanied by full memory stalls', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 0,
      psiFullAvg10: 1,
    }));

    expect((await assessMemoryPressure()).band).toBe('hard');
  });

  it('holds instead of shedding when PSI is unavailable', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 0,
      psiFullAvg10: null,
    }));

    expect((await assessMemoryPressure()).band).toBe('soft');
  });

  it('preserves RAM-only behavior when the host has no configured swap', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapTotal: 0,
      swapFree: 0,
      psiFullAvg10: 10,
    }));

    expect((await assessMemoryPressure()).band).toBe('ok');
  });

  it('returns swap and PSI evidence in the verdict', async () => {
    readProcMemoryMock.mockResolvedValue(procMemory(20 * GIB, {
      swapFree: 2 * GIB,
      psiSomeAvg10: 0.5,
      psiFullAvg10: 0.25,
    }));

    await expect(assessMemoryPressure()).resolves.toMatchObject({
      swapTotalBytes: 8 * GIB,
      swapFreeBytes: 2 * GIB,
      psiSomeAvg10: 0.5,
      psiFullAvg10: 0.25,
    });
  });

  it('caches the verdict for synchronous consumers (PAN-2500 specialist-budget)', async () => {
    expect(getCachedMemoryVerdict()).toBeNull();
    readProcMemoryMock.mockResolvedValue(procMemory(2 * GIB));
    const verdict = await assessMemoryPressure();
    expect(getCachedMemoryVerdict()).toEqual(verdict);
    expect(getCachedMemoryVerdict()?.trigger).toEqual(verdict.trigger);
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
          ...GOVERNOR_RESOURCES,
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
      config: { resources: GOVERNOR_RESOURCES },
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

function mergedStack(issueId: string, memoryBytes: number, serviceId = `${issueId.toLowerCase()}-svc-1`): ResourceStack {
  return {
    id: issueId,
    issueId,
    issueTitle: issueId,
    composeProject: `feature-${issueId.toLowerCase()}`,
    serviceCount: 1,
    services: [{ id: serviceId, name: serviceId, memoryUsage: memoryBytes, status: 'running' }] as StackContainerResource[],
    aggregates: { cpuPercent: 0, memoryBytes, diskBytes: 0 },
    phase: 'merged',
  };
}

describe('selectStackShedCandidates (PAN-2500 tiered-eviction)', () => {
  it('selects merged/closed stacks with no live agent referencing them, via buildReclaimPayload (never re-derived)', () => {
    const stacks = [mergedStack('PAN-1', 2 * GIB), { ...mergedStack('PAN-2', 1 * GIB), phase: 'work' as const }];
    const result = selectStackShedCandidates(stacks, []);
    expect(result.map((s) => s.issueId)).toEqual(['PAN-1']);
  });

  it('excludes a merged stack whose issue still has a live agent session', () => {
    const stacks = [mergedStack('PAN-1', 2 * GIB)];
    const result = selectStackShedCandidates(stacks, [{ issueId: 'PAN-1', hasLiveTmuxSession: true }]);
    expect(result).toEqual([]);
  });
});

describe('selectAgentToPause (PAN-2500 tiered-eviction)', () => {
  const agents = [
    { id: 'agent-pan-1', issueId: 'PAN-1', flywheelRunId: 'run-1' },
    { id: 'agent-pan-2', issueId: 'PAN-2', flywheelRunId: undefined }, // operator-started
  ];

  it('never selects an operator-attached (no flywheelRunId) agent when exemptOperatorStarted is true', () => {
    const result = selectAgentToPause(agents, () => true, true);
    expect(result?.id).toBe('agent-pan-1');
  });

  it('only selects an idle agent', () => {
    const result = selectAgentToPause(agents, (id) => id === 'agent-pan-2', true);
    // agent-pan-2 is idle but operator-started (exempt) -> no eligible candidate
    expect(result).toBeNull();
  });

  it('considers all candidates when exemptOperatorStarted is false', () => {
    const result = selectAgentToPause(agents, (id) => id === 'agent-pan-2', false);
    expect(result?.id).toBe('agent-pan-2');
  });
});

describe('shed() (PAN-2500 tiered-eviction integration)', () => {
  beforeEach(() => {
    resetGovernorModeForTests();
    loadConfigSyncMock.mockReturnValue({
      config: { resources: GOVERNOR_RESOURCES },
    });
    loadCloisterConfigSyncMock.mockReturnValue({ concurrency: { exempt_operator_started: true } });
    execFileMock.mockClear();
    setAgentPausedSyncMock.mockClear();
    stopAgentSyncMock.mockClear();
  });

  it('stops both merged stacks first, then pauses the idle agent only if still HARD afterward (PRD AC-4)', async () => {
    getStatsMock.mockReturnValue([]); // stacks come from getResourceStacks(containers); stub via direct override below
    const stacks = [mergedStack('PAN-1', 1 * GIB, 'pan-1-svc'), mergedStack('PAN-2', 1 * GIB, 'pan-2-svc')];
    vi.spyOn(await import('../../../../src/dashboard/server/routes/resources/stacks.js'), 'getResourceStacks').mockReturnValue(stacks);

    listRunningAgentsSyncMock.mockReturnValue([
      { id: 'agent-pan-3', issueId: 'PAN-3', role: 'work', tmuxActive: true, flywheelRunId: 'run-1' },
    ]);
    getAgentRuntimeStateSyncMock.mockReturnValue({ state: 'idle' });
    // First assess (after stacks): still hard. Second (after pausing the agent): clears to ok.
    readProcMemoryMock.mockResolvedValueOnce(procMemory(1 * GIB)).mockResolvedValue(procMemory(20 * GIB));

    const result = await shed();

    expect(result.stoppedStacks.sort()).toEqual(['PAN-1', 'PAN-2']);
    expect(execFileMock).toHaveBeenCalledWith('docker', ['stop', '--time', '30', 'pan-1-svc'], expect.anything(), expect.anything());
    expect(execFileMock).toHaveBeenCalledWith('docker', ['stop', '--time', '30', 'pan-2-svc'], expect.anything(), expect.anything());
    expect(execFileMock).not.toHaveBeenCalledWith('docker', expect.arrayContaining(['pause']), expect.anything(), expect.anything());
    expect(result.pausedAgents).toEqual(['agent-pan-3']);
    expect(setAgentPausedSyncMock).toHaveBeenCalledWith('agent-pan-3', expect.stringContaining('[governor-slot]'), true);
    expect(stopAgentSyncMock).toHaveBeenCalledWith('agent-pan-3');
  });

  it('never sheds an operator-attached (no flywheelRunId) agent even under sustained HARD pressure', async () => {
    vi.spyOn(await import('../../../../src/dashboard/server/routes/resources/stacks.js'), 'getResourceStacks').mockReturnValue([]);
    listRunningAgentsSyncMock.mockReturnValue([
      { id: 'agent-operator', issueId: 'PAN-4', role: 'work', tmuxActive: true, flywheelRunId: undefined },
    ]);
    getAgentRuntimeStateSyncMock.mockReturnValue({ state: 'idle' });
    readProcMemoryMock.mockResolvedValue(procMemory(1 * GIB)); // stays hard forever

    const result = await shed();

    expect(result.pausedAgents).toEqual([]);
    expect(setAgentPausedSyncMock).not.toHaveBeenCalled();
  });
});
