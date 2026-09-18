/**
 * PAN-3848 (W30, FR-22): would-have-fired counters, shadow mode, and the
 * `pan doctor` table. The counters are the soak's evidence: with
 * OVERDECK_PATROL_SHADOW=1 the wrapped patrols detect but never act, so a
 * week of zeroes proves the state a patrol repaired is unreachable.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadReviewStatuses = vi.hoisted(() => vi.fn());
const mockSetReviewStatusSync = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/review-status.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/review-status.js')>()),
  loadReviewStatuses: mockLoadReviewStatuses,
  setReviewStatusSync: mockSetReviewStatusSync,
}));
vi.mock('../../../../src/lib/cloister/specialists.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/cloister/specialists.js')>()),
  getAllProjectSpecialistStatuses: vi.fn(async () => []),
  getTmuxSessionName: vi.fn(() => 'agent-review-agent'),
}));
vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/tmux.js')>()),
  sessionExistsSync: vi.fn(() => false),
}));
vi.mock('../../../../src/lib/agents.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/agents.js')>()),
  getAgentRuntimeStateSync: vi.fn(() => undefined),
  listRunningAgents: vi.fn(() => Effect.succeed([])),
}));
vi.mock('../../../../src/lib/cloister/review-convoy-liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/cloister/review-convoy-liveness.js')>()),
  evaluateReviewConvoyLiveness: vi.fn(() => ({ active: false })),
}));

import {
  findMixedWouldFireModes,
  getInMemoryWouldFireCounts,
  isPatrolShadowMode,
  readWouldFireCounts,
  readWouldFireRecorderHealth,
  recordWouldFire,
  resetInMemoryWouldFireCounts,
  runShadowablePatrol,
  wouldFireLogPath,
  wouldFireRecorderHealthPath,
} from '../../../../src/lib/cloister/patrol-would-fire.js';
import { checkStuckReviewing } from '../../../../src/lib/cloister/deacon-review-unsignaled.js';
import { checkPatrolSoakEvidence, printPatrolWouldFireTable } from '../../../../src/cli/commands/doctor.js';

describe('patrol would-fire counters (PAN-3848 W30)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;
  const originalShadow = process.env.OVERDECK_PATROL_SHADOW;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-would-fire-'));
    process.env.OVERDECK_HOME = home;
    delete process.env.OVERDECK_PATROL_SHADOW;
    resetInMemoryWouldFireCounts();
    mockLoadReviewStatuses.mockReset();
    mockSetReviewStatusSync.mockReset();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    if (originalShadow === undefined) delete process.env.OVERDECK_PATROL_SHADOW;
    else process.env.OVERDECK_PATROL_SHADOW = originalShadow;
    rmSync(home, { recursive: true, force: true });
  });

  it('recordWouldFire increments the in-memory counter and grows would-fire.jsonl by one line', () => {
    recordWouldFire('checkStuckReviewing', 'PAN-1');
    recordWouldFire('checkStuckReviewing', 'PAN-2');
    recordWouldFire('sweepStrandedVerdictFallbacks');

    expect(getInMemoryWouldFireCounts()).toEqual({
      checkStuckReviewing: 2,
      sweepStrandedVerdictFallbacks: 1,
    });

    const lines = readFileSync(wouldFireLogPath(), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    const first = JSON.parse(lines[0]!);
    expect(first.patrol).toBe('checkStuckReviewing');
    expect(first.issueId).toBe('PAN-1');
    expect(first.shadow).toBe(false);
    expect(typeof first.ts).toBe('string');
  });

  it('readWouldFireCounts splits by recorded mode, filters by sinceIso, skips torn lines', () => {
    const path = wouldFireLogPath();
    mkdirSync(dirname(path), { recursive: true });
    const now = Date.now();
    const recent = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(path, [
      JSON.stringify({ ts: recent, patrol: 'a', shadow: true }),
      JSON.stringify({ ts: recent, patrol: 'a', shadow: true }),
      JSON.stringify({ ts: recent, patrol: 'b', shadow: false }),
      JSON.stringify({ ts: old, patrol: 'a', shadow: true }),
      // No flag: counted as live, so an unknown firing blocks the deletion
      // gate instead of vanishing into a zero.
      JSON.stringify({ ts: recent, patrol: 'c' }),
      'not json',
      '',
    ].join('\n'));

    expect(readWouldFireCounts(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()))
      .toEqual({ shadow: { a: 2 }, normal: { b: 1, c: 1 } });
    expect(readWouldFireCounts()).toEqual({ shadow: { a: 3 }, normal: { b: 1, c: 1 } });
  });

  it('findMixedWouldFireModes names patrols recorded in both modes', () => {
    const path = wouldFireLogPath();
    mkdirSync(dirname(path), { recursive: true });
    const ts = new Date().toISOString();
    writeFileSync(path, [
      JSON.stringify({ ts, patrol: 'mixed', shadow: true }),
      JSON.stringify({ ts, patrol: 'mixed', shadow: false }),
      JSON.stringify({ ts, patrol: 'pure-shadow', shadow: true }),
      JSON.stringify({ ts, patrol: 'pure-live', shadow: false }),
    ].join('\n'));

    expect(findMixedWouldFireModes()).toEqual(['mixed']);
  });

  it('shadow mode: a wrapped patrol detects and counts but never acts', async () => {
    process.env.OVERDECK_PATROL_SHADOW = '1';
    expect(isPatrolShadowMode()).toBe(true);

    // A review row stuck in 'reviewing' with a 2-hour-old spawn marker and no
    // live session: checkStuckReviewing would normally reset it to pending.
    mockLoadReviewStatuses.mockReturnValue({
      'PAN-3848': {
        issueId: 'PAN-3848',
        reviewStatus: 'reviewing',
        reviewSpawnedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const actions = await runShadowablePatrol('checkStuckReviewing', (shadow) => checkStuckReviewing({ shadow }));

    // The action function (setReviewStatusSync) was NOT called...
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    // ...the counter recorded the would-fire...
    expect(getInMemoryWouldFireCounts()).toEqual({ checkStuckReviewing: 1 });
    const lines = readFileSync(wouldFireLogPath(), 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]!).shadow).toBe(true);
    // ...and the wrapper suppressed the action from the deacon's real action log.
    expect(actions).toEqual([]);
  });

  it('normal mode: the patrol acts and the counter still records the firing', async () => {
    expect(isPatrolShadowMode()).toBe(false);
    mockLoadReviewStatuses.mockReturnValue({
      'PAN-3848': {
        issueId: 'PAN-3848',
        reviewStatus: 'reviewing',
        reviewSpawnedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const actions = await runShadowablePatrol('checkStuckReviewing', (shadow) => checkStuckReviewing({ shadow }));

    expect(mockSetReviewStatusSync).toHaveBeenCalledWith('PAN-3848', expect.objectContaining({ reviewStatus: 'pending' }));
    expect(getInMemoryWouldFireCounts()).toEqual({ checkStuckReviewing: 1 });
    expect(actions).toHaveLength(1);
  });

  it('pan doctor prints per-mode would-fire counts without claiming this process mode', () => {
    mkdirSync(dirname(wouldFireLogPath()), { recursive: true });
    writeFileSync(wouldFireLogPath(), [
      JSON.stringify({ ts: new Date().toISOString(), patrol: 'checkOrphanedCompletions', issueId: 'PAN-1', shadow: true }),
      JSON.stringify({ ts: new Date().toISOString(), patrol: 'checkOrphanedCompletions', issueId: 'PAN-2', shadow: true }),
      JSON.stringify({ ts: new Date().toISOString(), patrol: 'checkStuckReviewing', issueId: 'PAN-3', shadow: false }),
    ].join('\n'));

    // Even with shadow mode ON in THIS process, the table reports the
    // recorded mode per entry — never the reader's environment.
    process.env.OVERDECK_PATROL_SHADOW = '1';
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      printPatrolWouldFireTable();
    } finally {
      console.log = originalLog;
    }

    const out = lines.join('\n');
    expect(out).toContain('Patrol would-fire counts (last 7 days, by recorded mode)');
    expect(out).not.toContain('shadow mode ON');
    expect(out).toContain('checkOrphanedCompletions: shadow=2 live=0');
    expect(out).toContain('checkStuckReviewing: shadow=0 live=1');
  });

  it('pan doctor flags a mixed-mode patrol in the table and as soak-evidence error', () => {
    mkdirSync(dirname(wouldFireLogPath()), { recursive: true });
    const ts = new Date().toISOString();
    writeFileSync(wouldFireLogPath(), [
      JSON.stringify({ ts, patrol: 'checkStuckReviewing', shadow: true }),
      JSON.stringify({ ts, patrol: 'checkStuckReviewing', shadow: false }),
    ].join('\n'));

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      printPatrolWouldFireTable();
    } finally {
      console.log = originalLog;
    }
    expect(lines.join('\n')).toContain('checkStuckReviewing: shadow=1 live=1 (MIXED — soak evidence invalid)');

    const results = checkPatrolSoakEvidence();
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('error');
    expect(results[0]!.message).toContain('checkStuckReviewing');
    expect(results[0]!.message).toContain('both shadow and live');
  });

  it('pan doctor prints an empty table line when nothing was recorded', () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      printPatrolWouldFireTable();
    } finally {
      console.log = originalLog;
    }
    expect(lines.join('\n')).toContain('(no would-fire events recorded)');
  });
});

describe('would-fire recorder health (PAN-3848 F1)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-would-fire-health-'));
    process.env.OVERDECK_HOME = home;
    delete process.env.OVERDECK_PATROL_SHADOW;
    resetInMemoryWouldFireCounts();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('a failed JSONL append marks the recorder unhealthy instead of a quiet zero', () => {
    // A directory where the log file should be: the append fails no matter
    // which user runs the test, while the sibling health marker still writes.
    mkdirSync(wouldFireLogPath(), { recursive: true });

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      recordWouldFire('checkStuckReviewing', 'PAN-1');
    } finally {
      console.warn = originalWarn;
    }

    // Observability is preserved and the patrol itself does not fail...
    expect(getInMemoryWouldFireCounts()).toEqual({ checkStuckReviewing: 1 });
    // ...but the soak evidence is marked invalid instead of reading as zero.
    const health = readWouldFireRecorderHealth();
    expect(health.healthy).toBe(false);
    expect(health.failureCount).toBe(1);
    expect(typeof health.firstFailureAt).toBe('string');
    expect(typeof health.lastFailureAt).toBe('string');
  });

  it('repeated append failures accumulate on the marker rather than resetting it', () => {
    mkdirSync(wouldFireLogPath(), { recursive: true });

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      recordWouldFire('checkStuckReviewing', 'PAN-1');
      recordWouldFire('checkStuckReviewing', 'PAN-2');
    } finally {
      console.warn = originalWarn;
    }

    const health = readWouldFireRecorderHealth();
    expect(health.healthy).toBe(false);
    expect(health.failureCount).toBe(2);
  });

  it('no marker reads as healthy; a torn marker reads as unhealthy (fail-closed)', () => {
    expect(readWouldFireRecorderHealth()).toEqual({ healthy: true });

    const healthPath = wouldFireRecorderHealthPath();
    mkdirSync(dirname(healthPath), { recursive: true });
    writeFileSync(healthPath, 'not json{{{');
    expect(readWouldFireRecorderHealth()).toEqual({ healthy: false });
  });

  it('pan doctor reports an error while the recorder is unhealthy, and nothing when healthy', () => {
    expect(checkPatrolSoakEvidence()).toEqual([]);

    mkdirSync(wouldFireLogPath(), { recursive: true });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      recordWouldFire('checkStuckReviewing');
    } finally {
      console.warn = originalWarn;
    }

    const results = checkPatrolSoakEvidence();
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('error');
    expect(results[0]!.name).toBe('Patrol soak evidence');
    expect(results[0]!.message).toContain('false zeroes');
    expect(results[0]!.fix).toContain('would-fire.unhealthy.json');
  });
});

/**
 * PAN-3894 (W6, FR-6): the six Phase 4 patrols that had no counter now record a
 * would-fire at every action site and accept PatrolShadowOptions, so PAN-3895
 * has deletion evidence for them.
 *
 * Four of the six are cleanly shadowable: their detection is a pure predicate,
 * so shadow mode counts and returns a would-have-acted line without acting. Two
 * are not, and skip instead of counting a fiction — see the cases below.
 */
describe('Phase 4 patrol would-fire counters (PAN-3894 W6)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-3894-w6-'));
    process.env.OVERDECK_HOME = home;
    resetInMemoryWouldFireCounts();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('every one of the six names records a would-fire somewhere in src (AC-5)', async () => {
    const { execSync } = await import('node:child_process');
    const names = [
      'checkStuckAgentRemediation',
      'reconcileAgentLiveness',
      'cleanupOrphanedPlanningSessions',
      'cleanupOrphanedInspectSessions',
      'cleanupOrphanedReviewSessions',
      'cleanupOrphanReviewerSessions',
    ];
    for (const name of names) {
      const hits = execSync(`grep -rn "recordWouldFire('${name}'" src || true`, { encoding: 'utf8' }).trim();
      expect(hits, `${name} has no recordWouldFire call site`).not.toBe('');
    }
  });

  // The runShadowablePatrol wrapping of these six registrations is asserted in
  // patrol-no-loss-audit.test.ts, which already owns parsing runPatrol's source.

  it('cleanupOrphanedPlanningSessions counts in both modes and only kills when not shadowing', async () => {
    const tmux = await import('../../../../src/lib/tmux.js');
    const agents = await import('../../../../src/lib/agents.js');
    const liveness = await import('../../../../src/lib/agents/liveness.js');
    const killSpy = vi.spyOn(tmux, 'killSession').mockReturnValue(Effect.succeed(undefined) as never);
    vi.spyOn(tmux, 'listSessionNames').mockReturnValue(Effect.succeed(['planning-pan-1']) as never);
    vi.spyOn(liveness, 'isAliveSync').mockReturnValue({ alive: true } as never);
    vi.spyOn(agents, 'getAgentStateSync').mockReturnValue(null as never);

    const { cleanupOrphanedPlanningSessions } = await import(
      '../../../../src/lib/cloister/deacon-auto-resume.js'
    );
    const deps = { notifyAgentStopped: vi.fn(), notifyAgentStarted: vi.fn() } as never;

    const shadowActions = await cleanupOrphanedPlanningSessions(deps, { shadow: true });
    expect(killSpy).not.toHaveBeenCalled();
    expect(shadowActions[0]).toContain('(shadow)');
    expect(getInMemoryWouldFireCounts().cleanupOrphanedPlanningSessions).toBe(1);

    resetInMemoryWouldFireCounts();
    const liveActions = await cleanupOrphanedPlanningSessions(deps, {});
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(liveActions[0]).not.toContain('(shadow)');
    expect(getInMemoryWouldFireCounts().cleanupOrphanedPlanningSessions).toBe(1);
  });

  it('reconcileAgentLiveness skips in shadow mode instead of counting a firing it would not make', async () => {
    const { reconcileAgentLiveness } = await import(
      '../../../../src/lib/cloister/deacon-auto-resume.js'
    );
    const deps = { notifyAgentStopped: vi.fn(), notifyAgentStarted: vi.fn() } as never;

    await expect(reconcileAgentLiveness(deps, { shadow: true })).resolves.toEqual([]);
    expect(getInMemoryWouldFireCounts().reconcileAgentLiveness ?? 0).toBe(0);
  });

  it('checkStuckAgentRemediation skips in shadow mode because its ladder advances by acting', async () => {
    const { checkStuckAgentRemediation } = await import(
      '../../../../src/lib/cloister/stuck-remediation.js'
    );

    await expect(checkStuckAgentRemediation({ shadow: true })).resolves.toEqual([]);
    expect(getInMemoryWouldFireCounts().checkStuckAgentRemediation ?? 0).toBe(0);
  });
});
