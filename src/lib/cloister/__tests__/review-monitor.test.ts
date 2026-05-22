/**
 * Tests for review-monitor.ts (PAN-1059)
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';

// ── fs/promises mock ───────────────────────────────────────────────────────
const mockStat = vi.fn();
vi.mock('fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
}));

// ── fs (sync) mock ─────────────────────────────────────────────────────────
const mockExistsSync = vi.fn(() => false);
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// ── tmux mocks ─────────────────────────────────────────────────────────────
const mockSessionExistsEffect = vi.fn();
const mockIsPaneDeadEffect = vi.fn();
vi.mock('../../tmux.js', () => ({
  sessionExistsAsyncEffect: (...args: unknown[]) => mockSessionExistsEffect(...args),
  isPaneDeadAsyncEffect: (...args: unknown[]) => mockIsPaneDeadEffect(...args),
}));

import { waitForReviewerOutputs, reviewerOutputPath, REVIEW_SUB_ROLES } from '../review-monitor.js';

const WORKSPACE = '/workspace';
const RUN_ID = 'agent-pan-1059-review-abc12345';

describe('reviewerOutputPath', () => {
  it('returns correct path for each sub-role', () => {
    expect(reviewerOutputPath(WORKSPACE, RUN_ID, 'security')).toBe(
      join(WORKSPACE, '.pan', 'review', RUN_ID, 'security.md'),
    );
    expect(reviewerOutputPath(WORKSPACE, RUN_ID, 'correctness')).toBe(
      join(WORKSPACE, '.pan', 'review', RUN_ID, 'correctness.md'),
    );
  });
});

describe('REVIEW_SUB_ROLES', () => {
  it('contains exactly the four expected roles', () => {
    expect([...REVIEW_SUB_ROLES]).toEqual(['security', 'correctness', 'performance', 'requirements']);
  });
});

describe('waitForReviewerOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockExistsSync.mockReturnValue(false);
    mockSessionExistsEffect.mockReturnValue(Effect.succeed(false));
    mockIsPaneDeadEffect.mockReturnValue(Effect.succeed(true));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns done for all sub-roles when output files exist and sessions are dead', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 10 * 60 * 1000 }); // old mtime → settled

    const resultPromise = waitForReviewerOutputs({
      issueId: 'PAN-1059',
      runId: RUN_ID,
      workspace: WORKSPACE,
      pollIntervalMs: 100,
      staleAfterMs: 5 * 60 * 1000,
    });

    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.status).toBe('done');
    }
  });

  it('returns missing when session is dead and output file was never written', async () => {
    mockExistsSync.mockReturnValue(false);
    mockIsPaneDeadEffect.mockReturnValue(Effect.succeed(true));

    const resultPromise = waitForReviewerOutputs({
      issueId: 'PAN-1059',
      runId: RUN_ID,
      workspace: WORKSPACE,
      pollIntervalMs: 50,
      staleAfterMs: 5_000,
      timeoutMs: 500,
    });

    await vi.runAllTimersAsync();
    const results = await resultPromise;

    for (const r of results) {
      expect(r.status).toBe('missing');
    }
  });

  it('returns stalled when file exists but session died without updating it', async () => {
    mockExistsSync.mockReturnValue(true);
    const oldMtime = Date.now() - 1000;
    mockStat.mockResolvedValue({ mtimeMs: oldMtime });
    mockIsPaneDeadEffect.mockReturnValue(Effect.succeed(true));

    const resultPromise = waitForReviewerOutputs({
      issueId: 'PAN-1059',
      runId: RUN_ID,
      workspace: WORKSPACE,
      pollIntervalMs: 50,
      staleAfterMs: 5_000,
      timeoutMs: 500,
    });

    await vi.runAllTimersAsync();
    const results = await resultPromise;

    // File exists + pane dead → stalled (not missing)
    for (const r of results) {
      expect(r.status).toBe('stalled');
    }
  });

  it('marks as done when file mtime stops changing (stale threshold crossed)', async () => {
    const now = Date.now();
    // First poll: file just written (mtime = now)
    // Second poll: same mtime, now - mtime > staleAfterMs → settled
    let callCount = 0;
    mockExistsSync.mockReturnValue(true);
    mockStat.mockImplementation(async () => {
      callCount++;
      // Return very old mtime on all calls so staleAfterMs is immediately exceeded
      return { mtimeMs: now - 20 * 60 * 1000 };
    });
    mockIsPaneDeadEffect.mockReturnValue(Effect.succeed(false)); // sessions still alive

    const resultPromise = waitForReviewerOutputs({
      issueId: 'PAN-1059',
      runId: RUN_ID,
      workspace: WORKSPACE,
      pollIntervalMs: 100,
      staleAfterMs: 5 * 60 * 1000,
      timeoutMs: 60_000,
    });

    await vi.runAllTimersAsync();
    const results = await resultPromise;

    for (const r of results) {
      expect(r.status).toBe('done');
    }
  });

  it('returns mixed done, missing, and stalled statuses in one convoy wait', async () => {
    vi.setSystemTime(new Date('2026-05-11T21:00:00Z'));
    const now = Date.now();
    mockExistsSync.mockImplementation((path: string) => (
      path.endsWith('/security.md')
      || path.endsWith('/performance.md')
      || path.endsWith('/requirements.md')
    ));
    mockStat.mockImplementation(async (path: string) => {
      if (path.endsWith('/performance.md')) return { mtimeMs: now - 1_000 };
      return { mtimeMs: now - 10 * 60 * 1000 };
    });
    mockIsPaneDeadEffect.mockReturnValue(Effect.succeed(true));

    const resultPromise = waitForReviewerOutputs({
      issueId: 'PAN-1059',
      runId: RUN_ID,
      workspace: WORKSPACE,
      pollIntervalMs: 50,
      staleAfterMs: 5 * 60 * 1000,
      timeoutMs: 500,
    });

    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results.map(r => [r.subRole, r.status])).toEqual([
      ['security', 'done'],
      ['correctness', 'missing'],
      ['performance', 'stalled'],
      ['requirements', 'done'],
    ]);
  });

  it('only waits on requested sub-roles', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 10 * 60 * 1000 });

    const resultPromise = waitForReviewerOutputs({
      issueId: 'PAN-1059',
      runId: RUN_ID,
      workspace: WORKSPACE,
      subRoles: ['security', 'correctness'],
      pollIntervalMs: 50,
      staleAfterMs: 5 * 60 * 1000,
    });

    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results).toHaveLength(2);
    expect(results.map(r => r.subRole)).toEqual(['security', 'correctness']);
  });
});
