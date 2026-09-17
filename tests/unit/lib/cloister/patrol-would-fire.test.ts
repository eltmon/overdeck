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
  getInMemoryWouldFireCounts,
  isPatrolShadowMode,
  readWouldFireCounts,
  recordWouldFire,
  resetInMemoryWouldFireCounts,
  runShadowablePatrol,
  wouldFireLogPath,
} from '../../../../src/lib/cloister/patrol-would-fire.js';
import { checkStuckReviewing } from '../../../../src/lib/cloister/deacon-review-unsignaled.js';
import { printPatrolWouldFireTable } from '../../../../src/cli/commands/doctor.js';

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

  it('readWouldFireCounts filters by sinceIso and skips torn lines', () => {
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
      'not json',
      '',
    ].join('\n'));

    expect(readWouldFireCounts(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()))
      .toEqual({ a: 2, b: 1 });
    expect(readWouldFireCounts()).toEqual({ a: 3, b: 1 });
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

  it('pan doctor prints a per-patrol would-fire table for the last 7 days', () => {
    mkdirSync(dirname(wouldFireLogPath()), { recursive: true });
    writeFileSync(wouldFireLogPath(), [
      JSON.stringify({ ts: new Date().toISOString(), patrol: 'checkOrphanedCompletions', issueId: 'PAN-1', shadow: true }),
      JSON.stringify({ ts: new Date().toISOString(), patrol: 'checkOrphanedCompletions', issueId: 'PAN-2', shadow: true }),
      JSON.stringify({ ts: new Date().toISOString(), patrol: 'checkStuckReviewing', issueId: 'PAN-3', shadow: false }),
    ].join('\n'));

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      printPatrolWouldFireTable();
    } finally {
      console.log = originalLog;
    }

    const out = lines.join('\n');
    expect(out).toContain('Patrol would-fire counts (last 7 days');
    expect(out).toContain('checkOrphanedCompletions: 2');
    expect(out).toContain('checkStuckReviewing: 1');
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
